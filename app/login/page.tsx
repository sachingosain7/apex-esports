"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { Suspense } from "react";

function LoginForm() {
  const params = useSearchParams();
  const nextUrl = params.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [msg, setMsg] = useState<{ text: string; type: "error" | "info" }>({
    text: "",
    type: "info",
  });
  const [busy, setBusy] = useState(false);
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
  }, []);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setMsg({ text: "", type: "info" });

    if (mode === "up") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      setBusy(false);
      if (error) return setMsg({ text: error.message, type: "error" });
      if (!data.session)
        return setMsg({
          text: "Account created! Check your email to confirm, then sign in.",
          type: "info",
        });
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

    let redirect =
      nextUrl && nextUrl.startsWith("/") && !nextUrl.startsWith("//")
        ? nextUrl
        : null;

    if (!redirect) {
      // Check if user has an admin role
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

    setBusy(false);
    window.location.href = redirect || "/";
  }

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

        <div className="rounded-2xl border border-white/[0.08] bg-[#0E1118] p-7 shadow-2xl">
          {/* Logo */}
          <div className="mb-6">
            <span className="text-2xl font-extrabold tracking-widest">
              {ORG_NAME.split(" ")[0]}{" "}
              <span className="text-emerald-400">
                {ORG_NAME.split(" ").slice(1).join(" ")}
              </span>
            </span>
          </div>

          {user ? (
            /* Signed-in state */
            <div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 mb-5">
                <p className="text-xs text-white/50 mb-0.5">Signed in as</p>
                <p className="font-semibold text-sm truncate">{user}</p>
                {isAdmin && (
                  <span className="mt-2 inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                    ⚡ Admin Access Active
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
                  className="w-full text-center rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-sm text-black hover:bg-emerald-400 transition-colors"
                >
                  My Bookings &amp; Credentials →
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
            /* Auth form */
            <form onSubmit={submit} className="flex flex-col gap-4">
              <p className="text-white/60 text-sm -mt-2">
                {mode === "in"
                  ? "Sign in to book and manage your lobbies"
                  : "Create a free account to get started"}
              </p>

              <div className="flex flex-col gap-3">
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
              </div>

              <button
                disabled={busy}
                className="rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-sm text-black hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy
                  ? "Please wait…"
                  : mode === "in"
                  ? "Sign in →"
                  : "Create account →"}
              </button>

              {msg.text && (
                <p
                  className={`text-xs rounded-lg px-3 py-2 ${
                    msg.type === "error"
                      ? "text-red-400 bg-red-500/10 border border-red-500/20"
                      : "text-amber-400 bg-amber-500/10 border border-amber-500/20"
                  }`}
                >
                  {msg.text}
                </p>
              )}

              <div className="flex items-center gap-3 text-white/20">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <button
                type="button"
                onClick={() => {
                  setMode(mode === "in" ? "up" : "in");
                  setMsg({ text: "", type: "info" });
                }}
                className="text-sm text-white/50 hover:text-white transition-colors text-center"
              >
                {mode === "in"
                  ? "New here? Create a free account"
                  : "Already have an account? Sign in"}
              </button>
            </form>
          )}
        </div>

        {/* Support link */}
        <p className="mt-5 text-center text-xs text-white/30">
          Need help?{" "}
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-500 hover:text-emerald-400 transition-colors"
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
