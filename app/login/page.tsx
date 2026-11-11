"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { Suspense } from "react";

function LoginForm() {
  const params = useSearchParams();
  const nextUrl = params.get("next");

  const [authMethod, setAuthMethod] = useState<"otp" | "password">("otp");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [msg, setMsg] = useState<{ text: string; type: "error" | "info" | "success" }>({
    text: "",
    type: "info",
  });
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      setUser(u?.email ?? null);
      if (u) {
        const { data: roles } = await supabase
          .from("admin_roles")
          .select("role")
          .eq("user_id", u.id);
        setIsAdmin((roles && roles.length > 0) ?? false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user.email ?? null);
        const { data: roles } = await supabase
          .from("admin_roles")
          .select("role")
          .eq("user_id", session.user.id);
        const userIsAdmin = (roles && roles.length > 0) ?? false;
        setIsAdmin(userIsAdmin);

        // Redirect after successful auth
        let redirect = nextUrl && nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : null;
        if (!redirect && userIsAdmin) {
          redirect = "/admin";
        }
        if (event === "SIGNED_IN") {
          window.location.href = redirect || "/";
        }
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [nextUrl]);

  const handleRedirectAfterLogin = async () => {
    let redirect = nextUrl && nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : null;
    if (!redirect) {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        const { data: roles } = await supabase
          .from("admin_roles")
          .select("role")
          .eq("user_id", currentUser.id);
        if (roles && roles.length > 0) {
          redirect = "/admin";
        }
      }
    }
    window.location.href = redirect || "/";
  };

  // 1-Click Google Sign-In
  const handleGoogleSignIn = async () => {
    setGoogleBusy(true);
    setMsg({ text: "", type: "info" });
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const redirectUri = `${origin}/login${nextUrl ? `?next=${encodeURIComponent(nextUrl)}` : ""}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      setMsg({
        text: (err as Error).message || "Google sign-in could not be initiated.",
        type: "error",
      });
      setGoogleBusy(false);
    }
  };

  // Send 6-Digit OTP / Magic Code to Email
  const handleSendOtp = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMsg({ text: "", type: "info" });
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${origin}/login${nextUrl ? `?next=${encodeURIComponent(nextUrl)}` : ""}`,
        },
      });

      if (error) throw error;

      setOtpSent(true);
      setMsg({
        text: "✓ 6-digit login code sent! Check your inbox or spam folder.",
        type: "success",
      });
    } catch (err: unknown) {
      setMsg({
        text: (err as Error).message || "Failed to send verification code. Please check your email.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  // Verify 6-Digit OTP Code
  const handleVerifyOtp = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!otpCode.trim()) return;
    setBusy(true);
    setMsg({ text: "", type: "info" });
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: "email",
      });

      if (error) throw error;

      if (data.session) {
        setMsg({ text: "✓ Verified successfully! Logging in…", type: "success" });
        await handleRedirectAfterLogin();
      }
    } catch (err: unknown) {
      setMsg({
        text: (err as Error).message || "Invalid or expired code. Please try again.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  // Password-based Login/Signup (Fallback for admin)
  const handlePasswordSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setMsg({ text: "", type: "info" });

    if (mode === "up") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      setBusy(false);
      if (error) return setMsg({ text: error.message, type: "error" });
      if (!data.session) {
        return setMsg({
          text: "Account created! Check your email to confirm, then sign in.",
          type: "info",
        });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setBusy(false);
        return setMsg({ text: error.message, type: "error" });
      }
    }

    await handleRedirectAfterLogin();
    setBusy(false);
  };

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setIsAdmin(false);
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#06070B] px-5 py-12 text-white overflow-hidden">
      {/* Tactical grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-100 tactical-grid"
        aria-hidden="true"
      />
      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Back link */}
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors mb-6"
        >
          <span>←</span> Back to home
        </a>

        <div className="rounded-3xl border border-white/[0.08] bg-[#0E1118] p-7 shadow-2xl backdrop-blur-xl">
          {/* Logo & Header */}
          <div className="mb-6 text-center">
            <span className="text-2xl font-black tracking-widest uppercase">
              {ORG_NAME.split(" ")[0]}{" "}
              <span className="text-emerald-400">
                {ORG_NAME.split(" ").slice(1).join(" ")}
              </span>
            </span>
            <p className="text-white/40 text-xs mt-1">Player &amp; Host Esports Portal</p>
          </div>

          {user ? (
            /* Signed-in state */
            <div>
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3.5 mb-5">
                <p className="text-[11px] uppercase tracking-wider text-emerald-400 font-bold mb-0.5">
                  Logged In As
                </p>
                <p className="font-bold text-sm truncate text-white">{user}</p>
                {isAdmin && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                    <span>👑</span> Owner / Admin Access
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2.5">
                {isAdmin && (
                  <a
                    href="/admin"
                    className="w-full text-center rounded-xl bg-amber-500 px-4 py-3 font-bold text-sm text-black hover:bg-amber-400 transition-colors shadow-lg shadow-amber-900/30 flex items-center justify-center gap-2"
                  >
                    <span>⚡</span> Open Admin Dashboard
                  </a>
                )}
                <a
                  href="/profile"
                  className="w-full text-center rounded-xl bg-emerald-500 px-4 py-3 font-bold text-sm text-black hover:bg-emerald-400 transition-colors shadow-md shadow-emerald-900/20"
                >
                  My Tournaments &amp; IDP →
                </a>
                <a
                  href="/"
                  className="w-full text-center rounded-xl border border-white/10 px-4 py-2.5 font-medium text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                >
                  Browse Lobbies
                </a>
                <button
                  onClick={signOut}
                  className="w-full rounded-xl border border-white/15 px-4 py-2.5 font-medium text-xs text-white/40 hover:text-white hover:bg-white/5 transition-colors mt-2"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            /* Auth Options */
            <div className="space-y-4">
              {/* 1-Click Google Sign-In */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleBusy}
                className="w-full py-3 px-4 rounded-xl border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all flex items-center justify-center gap-3 text-sm font-semibold text-white shadow-sm"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{googleBusy ? "Opening Google…" : "Continue with Google"}</span>
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 text-white/30 my-2">
                <div className="h-px flex-1 bg-white/[0.08]" />
                <span className="text-[11px] uppercase tracking-wider font-semibold">or email</span>
                <div className="h-px flex-1 bg-white/[0.08]" />
              </div>

              {/* Tabs: OTP (No Password) vs Password */}
              <div className="flex p-1 bg-black/40 border border-white/[0.06] rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod("otp");
                    setMsg({ text: "", type: "info" });
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    authMethod === "otp"
                      ? "bg-emerald-500 text-black shadow"
                      : "text-white/50 hover:text-white"
                  }`}
                >
                  ⚡ Instant Code (OTP)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod("password");
                    setMsg({ text: "", type: "info" });
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    authMethod === "password"
                      ? "bg-emerald-500 text-black shadow"
                      : "text-white/50 hover:text-white"
                  }`}
                >
                  🔑 Password
                </button>
              </div>

              {/* Method A: 6-Digit OTP Flow */}
              {authMethod === "otp" && (
                <div>
                  {!otpSent ? (
                    <form onSubmit={handleSendOtp} className="flex flex-col gap-3">
                      <p className="text-xs text-white/50">
                        No password needed. We will send a 6-digit login code directly to your email.
                      </p>
                      <input
                        type="email"
                        required
                        placeholder="Enter your email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="rounded-xl border border-white/10 bg-[#06070B] px-4 py-3 text-sm outline-none focus:border-emerald-500 transition-colors placeholder:text-white/30"
                      />
                      <button
                        type="submit"
                        disabled={busy || !email.trim()}
                        className="w-full py-3 rounded-xl bg-emerald-500 text-black font-extrabold text-sm hover:bg-emerald-400 disabled:opacity-50 transition-all shadow-md shadow-emerald-900/30"
                      >
                        {busy ? "Sending Code…" : "Send 6-Digit Code →"}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/50">Code sent to:</span>
                        <span className="font-bold text-emerald-400 truncate max-w-[180px]">{email}</span>
                      </div>
                      <input
                        type="text"
                        required
                        autoFocus
                        maxLength={8}
                        placeholder="Enter 6-digit code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ""))}
                        className="rounded-xl border border-emerald-500/40 bg-[#06070B] px-4 py-3 text-center text-lg font-mono tracking-widest font-black outline-none focus:border-emerald-400 transition-colors placeholder:text-white/20 placeholder:font-normal placeholder:tracking-normal placeholder:text-sm"
                      />
                      <button
                        type="submit"
                        disabled={busy || otpCode.length < 6}
                        className="w-full py-3 rounded-xl bg-emerald-500 text-black font-extrabold text-sm hover:bg-emerald-400 disabled:opacity-50 transition-all shadow-md shadow-emerald-900/30"
                      >
                        {busy ? "Verifying…" : "Verify & Sign In →"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOtpSent(false);
                          setOtpCode("");
                        }}
                        className="text-xs text-white/40 hover:text-white transition-colors text-center mt-1"
                      >
                        ← Change email or resend code
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Method B: Password Flow (Host/Admin) */}
              {authMethod === "password" && (
                <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
                  <input
                    type="email"
                    required
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded-xl border border-white/10 bg-[#06070B] px-4 py-3 text-sm outline-none focus:border-emerald-500 transition-colors placeholder:text-white/30"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Password (8+ characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="rounded-xl border border-white/10 bg-[#06070B] px-4 py-3 text-sm outline-none focus:border-emerald-500 transition-colors placeholder:text-white/30"
                  />
                  <button
                    disabled={busy}
                    className="rounded-xl bg-emerald-500 px-4 py-3 font-bold text-sm text-black hover:bg-emerald-400 disabled:opacity-50 transition-colors shadow-md shadow-emerald-900/30"
                  >
                    {busy ? "Please wait…" : mode === "in" ? "Sign In →" : "Create Account →"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode(mode === "in" ? "up" : "in");
                      setMsg({ text: "", type: "info" });
                    }}
                    className="text-xs text-white/40 hover:text-white transition-colors text-center"
                  >
                    {mode === "in" ? "Need a password account? Sign up" : "Already have an account? Sign in"}
                  </button>
                </form>
              )}

              {/* Feedback messages */}
              {msg.text && (
                <p
                  className={`text-xs rounded-xl px-3.5 py-2.5 font-medium ${
                    msg.type === "error"
                      ? "text-red-300 bg-red-500/10 border border-red-500/25"
                      : msg.type === "success"
                      ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/30"
                      : "text-amber-300 bg-amber-500/10 border border-amber-500/25"
                  }`}
                >
                  {msg.text}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Support link */}
        <p className="mt-5 text-center text-xs text-white/30">
          Need help?{" "}
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-500 hover:text-emerald-400 transition-colors font-semibold"
          >
            WhatsApp Support
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
