"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import Link from "next/link";

function LoginForm() {
  const params = useSearchParams();
  const nextUrl = params.get("next");

  const [authMethod, setAuthMethod] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "error" | "info" | "success" }>({
    text: "",
    type: "info",
  });
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Auto-reset any stuck loading states when user navigates back in browser
  useEffect(() => {
    const handleReset = () => {
      setGoogleBusy(false);
      setBusy(false);
    };
    window.addEventListener("pageshow", handleReset);
    window.addEventListener("focus", handleReset);
    document.addEventListener("visibilitychange", handleReset);
    return () => {
      window.removeEventListener("pageshow", handleReset);
      window.removeEventListener("focus", handleReset);
      document.removeEventListener("visibilitychange", handleReset);
    };
  }, []);

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

  // 1-Click Google Sign-In with auto-unfreeze protection
  const handleGoogleSignIn = async () => {
    setMsg({ text: "", type: "info" });
    setGoogleBusy(true);

    const resetTimer = setTimeout(() => {
      setGoogleBusy(false);
    }, 6000);

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/login?next=${encodeURIComponent(nextUrl || "/")}`
          : undefined;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            prompt: "select_account",
            access_type: "offline",
          },
        },
      });

      if (error) {
        clearTimeout(resetTimer);
        setGoogleBusy(false);
        setMsg({ text: error.message, type: "error" });
      }
    } catch (err: unknown) {
      clearTimeout(resetTimer);
      setGoogleBusy(false);
      setMsg({
        text: (err as Error).message || "Google sign-in could not be opened. Please try again.",
        type: "error",
      });
    }
  };

  // Email & Password Auth (Primary)
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: "", type: "info" });
    setBusy(true);

    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        setMsg({ text: "Signed in successfully!", type: "success" });
        await handleRedirectAfterLogin();
      } else {
        const emailRedirectTo =
          typeof window !== "undefined"
            ? `${window.location.origin}/login?next=${encodeURIComponent(nextUrl || "/")}`
            : undefined;

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo,
          },
        });
        if (error) throw error;

        if (data.session) {
          setMsg({ text: "Account created and signed in!", type: "success" });
          await handleRedirectAfterLogin();
        } else {
          setMsg({
            text: `Verification email sent to ${email}. Please check your inbox and click the link to activate your account.`,
            type: "success",
          });
        }
      }
    } catch (err: unknown) {
      setMsg({ text: (err as Error).message || "Authentication error", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // OTP Login Flow (Secondary alternative)
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: "", type: "info" });
    setBusy(true);

    try {
      const emailRedirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/login?next=${encodeURIComponent(nextUrl || "/")}`
          : undefined;

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo,
        },
      });
      if (error) throw error;

      setOtpSent(true);
      setMsg({
        text: `6-digit login code sent to ${email}! Enter it below to sign in.`,
        type: "success",
      });
    } catch (err: unknown) {
      setMsg({ text: (err as Error).message || "Could not send OTP", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: "", type: "info" });
    setBusy(true);

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: "email",
      });
      if (error) throw error;

      setMsg({ text: "Code verified! Signing you in…", type: "success" });
      await handleRedirectAfterLogin();
    } catch (err: unknown) {
      setMsg({
        text: (err as Error).message || "Invalid or expired code. Please request a new one.",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAdmin(false);
    setMsg({ text: "Signed out successfully", type: "info" });
  };

  return (
    <div className="min-h-screen bg-[#F4F6FB] flex flex-col justify-between text-slate-900">
      {/* ── Top Navbar ── */}
      <header className="border-b border-white/10 bg-[#0A1128] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 py-3.5">
          <Link href="/" className="flex items-center gap-1.5 font-black text-lg">
            <span className="text-[#FFB800]">◆</span>
            <span>{ORG_NAME}</span>
          </Link>
          <Link
            href="/"
            className="text-xs font-bold text-slate-300 hover:text-white transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      {/* ── Centered Card ── */}
      <div className="w-full max-w-sm mx-auto px-4 py-12">
        <div className="rounded-3xl border border-slate-200/90 bg-white p-7 shadow-xl">
          {/* Logo & Header */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-1.5 text-xl font-black text-slate-900 tracking-tight">
              <span className="text-[#FFB800]">◆</span>
              <span>{ORG_NAME}</span>
            </div>
            <p className="text-slate-500 text-xs mt-1">Player &amp; Host Esports Portal</p>
          </div>

          {user ? (
            /* Signed-in state */
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <p className="text-[10px] uppercase font-black text-emerald-800 tracking-wider mb-0.5">
                  Logged In As
                </p>
                <p className="font-bold text-sm text-slate-900 truncate">{user}</p>
                {isAdmin && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-[10px] font-black text-amber-900 uppercase">
                    <span>👑</span> Owner / Admin Access
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="w-full text-center rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-4 py-3 text-xs block transition-colors shadow-sm"
                  >
                    ⚡ Open Admin Dashboard
                  </Link>
                )}
                <Link
                  href="/profile"
                  className="w-full text-center rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black px-4 py-3 text-xs block transition-colors shadow-sm"
                >
                  My Tournaments &amp; IDP →
                </Link>
                <Link
                  href="/"
                  className="w-full text-center rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold px-4 py-2.5 text-xs block transition-colors"
                >
                  Browse Lobbies
                </Link>
                <button
                  onClick={signOut}
                  className="w-full rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 py-2.5 text-xs font-semibold transition-colors mt-1"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            /* Authentication form */
            <div className="space-y-4">
              {/* 1. Top Google Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleBusy}
                className="w-full py-3 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 transition-all flex items-center justify-center gap-2.5 text-xs sm:text-sm font-bold text-slate-800 shadow-sm disabled:opacity-80 cursor-pointer"
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
              <div className="flex items-center gap-3 text-slate-400 my-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[10px] uppercase tracking-wider font-bold">or email</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {/* 2. PRIMARY: Email & Password */}
              {authMethod === "password" && (
                <form onSubmit={handlePasswordSubmit} className="space-y-3">
                  <div className="text-left mb-1">
                    <p className="text-xs font-black text-slate-900 uppercase tracking-wider">
                      {mode === "in" ? "Sign In with Password" : "Create an Account"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {mode === "in"
                        ? "Enter your email & password to continue"
                        : "Enter password to receive confirmation email"}
                    </p>
                  </div>

                  <input
                    type="email"
                    required
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors placeholder:text-slate-400"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Password (8+ characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors placeholder:text-slate-400"
                  />

                  <button
                    disabled={busy}
                    className="w-full rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] px-4 py-3 font-black text-xs sm:text-sm text-slate-950 disabled:opacity-50 transition-colors shadow-md shadow-amber-500/20 cursor-pointer"
                  >
                    {busy
                      ? "Please wait…"
                      : mode === "in"
                      ? "Sign In →"
                      : "Create Account & Send Verification →"}
                  </button>

                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setMode(mode === "in" ? "up" : "in");
                        setMsg({ text: "", type: "info" });
                      }}
                      className="text-xs text-slate-600 hover:text-slate-900 transition-colors"
                    >
                      {mode === "in" ? (
                        <>
                          Don&apos;t have an account?{" "}
                          <span className="text-blue-600 font-bold underline">Sign up</span>
                        </>
                      ) : (
                        <>
                          Already have an account?{" "}
                          <span className="text-blue-600 font-bold underline">Sign in</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Subtle Alternative Option: Sign in with OTP */}
                  <div className="pt-2 border-t border-slate-100 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMethod("otp");
                        setOtpSent(false);
                        setOtpCode("");
                        setMsg({ text: "", type: "info" });
                      }}
                      className="text-xs text-slate-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-1 mx-auto cursor-pointer"
                    >
                      <span>⚡</span>
                      <span>
                        {mode === "in"
                          ? "Can't remember password? Sign in with OTP instead"
                          : "Prefer code? Continue with OTP instead"}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              {/* 3. SECONDARY: OTP Login Flow */}
              {authMethod === "otp" && (
                <div className="space-y-3">
                  <div className="text-left mb-1">
                    <p className="text-xs font-black text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
                      <span>⚡</span> One-Time Code (OTP) Login
                    </p>
                    <p className="text-[11px] text-slate-500">
                      We will send a 6-digit login code to your email
                    </p>
                  </div>

                  {!otpSent ? (
                    <form onSubmit={handleSendOtp} className="space-y-3">
                      <input
                        type="email"
                        required
                        placeholder="Enter your email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={busy || !email.trim()}
                        className="w-full py-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-xs sm:text-sm disabled:opacity-50 transition-all shadow-md"
                      >
                        {busy ? "Sending Code…" : "Send 6-Digit Code →"}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyOtp} className="space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Code sent to:</span>
                        <span className="font-bold text-slate-900 truncate max-w-[170px]">{email}</span>
                      </div>
                      <input
                        type="text"
                        required
                        autoFocus
                        maxLength={8}
                        placeholder="Enter 6-digit code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ""))}
                        className="w-full rounded-xl border border-blue-400 bg-slate-50 px-4 py-2.5 text-center text-lg font-mono font-black tracking-widest text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={busy || otpCode.length < 6}
                        className="w-full py-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-xs sm:text-sm disabled:opacity-50 transition-all shadow-md"
                      >
                        {busy ? "Verifying…" : "Verify & Sign In →"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOtpSent(false);
                          setOtpCode("");
                        }}
                        className="text-xs text-slate-400 hover:text-slate-800 transition-colors text-center w-full block"
                      >
                        ← Resend code or change email
                      </button>
                    </form>
                  )}

                  <div className="pt-2 text-center border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMethod("password");
                        setMsg({ text: "", type: "info" });
                      }}
                      className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      ← Back to Password login
                    </button>
                  </div>
                </div>
              )}

              {/* Feedback messages */}
              {msg.text && (
                <p
                  className={`text-xs rounded-xl p-3 font-semibold leading-relaxed ${
                    msg.type === "error"
                      ? "text-red-700 bg-red-50 border border-red-200"
                      : msg.type === "success"
                      ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                      : "text-amber-800 bg-amber-50 border border-amber-200"
                  }`}
                >
                  {msg.text}
                </p>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Need help?{" "}
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-700 hover:underline font-bold"
          >
            WhatsApp Support
          </a>
        </p>
      </div>

      <footer className="text-center py-4 text-xs text-slate-400 border-t border-slate-200 bg-white">
        © 2026 {ORG_NAME}. All rights reserved.
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#FFB800]" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
