"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { MatchIDPSection } from "@/components/MatchIDPSection";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Registration = {
  registration_id: string;
  event_id: string;
  event_title: string;
  starts_at: string;
  idp_times: string | null;
  start_times: string | null;
  room_id: string | null;
  room_password: string | null;
  whatsapp_group_link: string | null;
  team_name: string;
  slot_number: number;
  status: string;
  amount_paise: number;
  registered_at: string;
};

type SearchMode = "utr" | "whatsapp";

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useCopyToClipboard
// ─────────────────────────────────────────────────────────────────────────────

function useCopyToClipboard(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return [copied, copy];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const rupees = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

const toIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

const registeredAt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Individual copy button that manages its own copied state */
function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopyToClipboard();
  return (
    <button
      onClick={() => copy(text)}
      className={
        "ml-2 shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-all duration-200 " +
        (copied
          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
          : "border-white/15 bg-white/5 text-white/50 hover:border-white/30 hover:text-white")
      }
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

/** Monospace credential row with copy button */
function CredRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] border border-white/[0.07] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">{label}</p>
        <p className="font-mono tracking-widest text-emerald-300 text-sm break-all">{value}</p>
      </div>
      <CopyButton text={value} />
    </div>
  );
}

/** Pulse skeleton card while loading */
function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0E1118] p-5 animate-pulse space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-5 w-2/3 rounded-lg bg-white/10" />
          <div className="h-3 w-1/3 rounded bg-white/5" />
        </div>
        <div className="h-6 w-20 rounded-full bg-white/10" />
      </div>
      <div className="h-14 rounded-xl bg-white/5" />
      <div className="h-10 rounded-xl bg-white/5" />
      <div className="h-10 rounded-xl bg-white/5" />
    </div>
  );
}

/** IDP Times display box */
function IdpTimesBox({
  idpTimes,
  startTimes,
}: {
  idpTimes: string;
  startTimes: string | null;
}) {
  const idpRows = idpTimes.split("\n").filter(Boolean);
  const startRows = startTimes ? startTimes.split("\n").filter(Boolean) : [];

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-amber-400/80 font-semibold mb-1">
        IDP Schedule
      </p>
      {idpRows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-[10px] text-amber-500/60 font-semibold w-16 shrink-0 mt-0.5">
            IDP {i + 1}
          </span>
          <span className="font-mono text-xs text-white/70 break-all">{row}</span>
        </div>
      ))}
      {startRows.map((row, i) => (
        <div key={`s${i}`} className="flex items-start gap-2">
          <span className="text-[10px] text-emerald-500/60 font-semibold w-16 shrink-0 mt-0.5">
            Start {i + 1}
          </span>
          <span className="font-mono text-xs text-white/70 break-all">{row}</span>
        </div>
      ))}
    </div>
  );
}

/** Full registration card */
function RegistrationCard({ reg }: { reg: Registration }) {
  const isConfirmed = reg.status.toLowerCase() === "confirmed";

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0E1118] p-5 space-y-4 transition-all duration-200 hover:border-white/[0.14]">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {/* Slot badge */}
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white/60">
              Slot #{reg.slot_number}
            </span>
          </div>
          <h3 className="text-base font-bold leading-tight">{reg.event_title}</h3>
          <p className="text-xs text-white/50 mt-0.5">{toIST(reg.starts_at)} IST</p>
          <p className="text-sm font-semibold text-emerald-400 mt-1">{reg.team_name}</p>
        </div>

        {/* Status badge */}
        <span
          className={
            "shrink-0 rounded-full px-3 py-1 text-[10px] font-bold tracking-wider " +
            (isConfirmed
              ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border border-amber-500/40 bg-amber-500/10 text-amber-400")
          }
        >
          {isConfirmed ? "CONFIRMED" : "PENDING"}
        </span>
      </div>

      {/* ── 3-Match IDP & Lobby WhatsApp Group Section ── */}
      <MatchIDPSection
        title={reg.event_title}
        roomId={reg.room_id}
        roomPassword={reg.room_password}
        whatsappGroupLink={reg.whatsapp_group_link}
        idpTimes={reg.idp_times}
        startTimes={reg.start_times}
        slotNumber={reg.slot_number}
        isConfirmed={isConfirmed}
      />

      {/* ── Footer meta ── */}
      <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
        <p className="text-[11px] text-white/30">
          Paid: <span className="text-white/50 font-medium">{rupees(reg.amount_paise)}</span>
        </p>
        <p className="text-[11px] text-white/30">
          Registered: <span className="text-white/50">{registeredAt(reg.registered_at)}</span>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function MyTournamentsPage() {
  // ── Auth
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authWhatsapp, setAuthWhatsapp] = useState<string | null>(null);

  // ── Form state
  const [mode, setMode] = useState<SearchMode>("utr");
  const [utrInput, setUtrInput] = useState("");
  const [waInput, setWaInput] = useState(""); // 10-digit part only

  // ── Validation errors
  const [fieldError, setFieldError] = useState<string | null>(null);

  // ── Lookup state
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [results, setResults] = useState<Registration[] | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Collect auth session
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
      // Try to get whatsapp from user metadata
      const meta = data.user?.user_metadata;
      if (meta?.whatsapp) setAuthWhatsapp(meta.whatsapp as string);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_ev, session) => {
      setUserEmail(session?.user?.email ?? null);
      const meta = session?.user?.user_metadata;
      if (meta?.whatsapp) setAuthWhatsapp(meta.whatsapp as string);
      else setAuthWhatsapp(null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Auto-lookup when auth whatsapp is available
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (authWhatsapp && !autoLoaded.current) {
      autoLoaded.current = true;
      performLookup(null, authWhatsapp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authWhatsapp]);

  // ── Core lookup function
  const performLookup = useCallback(
    async (utr: string | null, whatsapp: string | null) => {
      setLoading(true);
      setLookupError(null);
      setResults(null);
      setHasSearched(true);

      const { data, error } = await supabase.rpc("lookup_my_tournaments", {
        p_utr: utr ?? null,
        p_whatsapp: whatsapp ?? null,
      });

      setLoading(false);

      if (error) {
        const msg = error.message ?? "";
        if (msg.includes("provide_utr_or_whatsapp")) {
          setLookupError("Please provide your UTR or WhatsApp number.");
        } else if (msg.includes("invalid_utr")) {
          setLookupError("Invalid UTR — it must be a 12-digit number.");
        } else if (msg.includes("user_not_found")) {
          setLookupError("No account found for this UTR / WhatsApp number.");
        } else {
          setLookupError("Something went wrong. Please try again or contact support.");
        }
        return;
      }

      const rows = (data as Registration[]) ?? [];
      // Sort: upcoming first (ascending starts_at)
      rows.sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
      setResults(rows);
    },
    []
  );

  // ── Validate & submit
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFieldError(null);

      if (mode === "utr") {
        const cleaned = utrInput.replace(/\D/g, "");
        if (cleaned.length !== 12) {
          setFieldError("UTR must be exactly 12 digits.");
          return;
        }
        await performLookup(cleaned, null);
      } else {
        const cleaned = waInput.replace(/\D/g, "");
        if (cleaned.length !== 10) {
          setFieldError("Please enter a valid 10-digit WhatsApp number.");
          return;
        }
        await performLookup(null, "91" + cleaned);
      }
    },
    [mode, utrInput, waInput, performLookup]
  );

  // ── Live UTR validation
  const handleUtrChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 12);
    setUtrInput(digits);
    if (fieldError) setFieldError(null);
  };

  // ── Live WA validation
  const handleWaChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    setWaInput(digits);
    if (fieldError) setFieldError(null);
  };

  const switchMode = (m: SearchMode) => {
    setMode(m);
    setFieldError(null);
    setLookupError(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-[#06070B] text-white overflow-x-hidden">
      {/* ── Tactical grid background ── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* ── Ambient glows ── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 0% 0%, rgba(16,185,129,0.06) 0%, transparent 70%), radial-gradient(ellipse 50% 35% at 100% 100%, rgba(139,92,246,0.05) 0%, transparent 70%)",
        }}
      />

      {/* ── Navbar ── */}
      <header className="relative z-10 sticky top-0 border-b border-white/[0.08] bg-[#06070B]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          {/* Logo / home link */}
          <a
            href="/"
            className="text-xl font-extrabold tracking-wider hover:opacity-80 transition-opacity duration-200"
          >
            APEX <span className="text-emerald-400">ESPORTS</span>
          </a>

          <nav className="flex items-center gap-4 text-sm">
            <a
              href="/"
              className="flex items-center gap-1.5 text-white/50 hover:text-white transition-colors duration-200"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z"
                  clipRule="evenodd"
                />
              </svg>
              Home
            </a>

            {userEmail ? (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400 font-medium">
                {userEmail}
              </span>
            ) : (
              <a
                href="/login"
                className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400 transition-colors duration-200"
              >
                Sign in
              </a>
            )}
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-2xl px-5 pb-32">
        {/* ── Hero ── */}
        <section className="pt-14 pb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-xs text-emerald-300 mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {ORG_NAME} · My Tournaments
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight">
            🏆 My Tournaments
          </h1>
          <p className="mt-4 text-base text-white/50 max-w-sm mx-auto leading-relaxed">
            Paid already? Enter your 12-digit UTR or registered WhatsApp number to unlock your Room ID, Password &amp; IDP Group Link.
          </p>
        </section>

        {/* ── Lookup Card ── */}
        <section className="mb-10">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0E1118] p-6 shadow-2xl shadow-black/40">
            {/* Mode toggle */}
            <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1 mb-6">
              <button
                onClick={() => switchMode("utr")}
                className={
                  "flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all duration-200 " +
                  (mode === "utr"
                    ? "bg-emerald-500 text-black shadow-lg"
                    : "text-white/50 hover:text-white")
                }
              >
                Search by UTR
              </button>
              <button
                onClick={() => switchMode("whatsapp")}
                className={
                  "flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all duration-200 " +
                  (mode === "whatsapp"
                    ? "bg-emerald-500 text-black shadow-lg"
                    : "text-white/50 hover:text-white")
                }
              >
                Search by WhatsApp
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {mode === "utr" ? (
                <div>
                  <label
                    htmlFor="utr-input"
                    className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2"
                  >
                    UTR Number
                  </label>
                  <input
                    id="utr-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={utrInput}
                    onChange={(e) => handleUtrChange(e.target.value)}
                    placeholder="12-digit UTR (e.g. 123456789012)"
                    maxLength={12}
                    autoComplete="off"
                    className={
                      "w-full rounded-xl border bg-white/[0.04] px-4 py-3.5 text-sm font-mono tracking-wider placeholder-white/20 outline-none transition-all duration-200 " +
                      (fieldError
                        ? "border-red-500/60 focus:border-red-400 focus:ring-2 focus:ring-red-500/20"
                        : utrInput.length === 12
                        ? "border-emerald-500/50 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                        : "border-white/[0.08] focus:border-white/20 focus:ring-2 focus:ring-white/5")
                    }
                  />
                  {/* Character counter */}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-white/30">
                      {utrInput.length > 0 && utrInput.length < 12
                        ? `${12 - utrInput.length} more digit${12 - utrInput.length === 1 ? "" : "s"} needed`
                        : utrInput.length === 12
                        ? "✓ Looks good"
                        : "Enter the 12-digit UTR from your payment receipt"}
                    </span>
                    <span
                      className={
                        "text-[11px] font-mono " +
                        (utrInput.length === 12 ? "text-emerald-400" : "text-white/30")
                      }
                    >
                      {utrInput.length}/12
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="wa-input"
                    className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2"
                  >
                    WhatsApp Number
                  </label>
                  <div
                    className={
                      "flex items-center rounded-xl border bg-white/[0.04] transition-all duration-200 " +
                      (fieldError
                        ? "border-red-500/60 focus-within:ring-2 focus-within:ring-red-500/20"
                        : waInput.length === 10
                        ? "border-emerald-500/50 focus-within:ring-2 focus-within:ring-emerald-500/20"
                        : "border-white/[0.08] focus-within:border-white/20 focus-within:ring-2 focus-within:ring-white/5")
                    }
                  >
                    <span className="shrink-0 pl-4 pr-2 text-sm font-semibold text-white/40 select-none border-r border-white/[0.08] py-3.5">
                      +91
                    </span>
                    <input
                      id="wa-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={waInput}
                      onChange={(e) => handleWaChange(e.target.value)}
                      placeholder="10-digit number"
                      maxLength={10}
                      autoComplete="tel"
                      className="flex-1 bg-transparent px-3 py-3.5 text-sm font-mono tracking-wider placeholder-white/20 outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-white/30">
                      {waInput.length > 0 && waInput.length < 10
                        ? `${10 - waInput.length} more digit${10 - waInput.length === 1 ? "" : "s"} needed`
                        : waInput.length === 10
                        ? "✓ Looks good"
                        : "Number used during registration"}
                    </span>
                    <span
                      className={
                        "text-[11px] font-mono " +
                        (waInput.length === 10 ? "text-emerald-400" : "text-white/30")
                      }
                    >
                      {waInput.length}/10
                    </span>
                  </div>
                </div>
              )}

              {/* Inline field error */}
              {fieldError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-4 h-4 shrink-0"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {fieldError}
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Searching…
                  </>
                ) : (
                  "Find My Registrations →"
                )}
              </button>
            </form>
          </div>
        </section>

        {/* ── Lookup error ── */}
        {lookupError && (
          <div className="mb-8 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5 text-red-400 shrink-0 mt-0.5"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-400 mb-0.5">Lookup failed</p>
              <p className="text-xs text-red-300/70">{lookupError}</p>
              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}?text=Hi+Apex+Esports+support,+I+need+help+finding+my+registration.`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                Contact support on WhatsApp →
              </a>
            </div>
          </div>
        )}

        {/* ── Loading skeletons ── */}
        {loading && (
          <section className="space-y-4 mb-10">
            {[0, 1].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </section>
        )}

        {/* ── Results ── */}
        {!loading && results !== null && (
          <section className="space-y-5 mb-10">
            {results.length === 0 ? (
              /* Empty state */
              <div className="rounded-2xl border border-white/[0.08] bg-[#0E1118] p-10 text-center">
                <div className="text-5xl mb-4">🎮</div>
                <h3 className="text-lg font-bold text-white/80 mb-2">
                  No registrations found
                </h3>
                <p className="text-sm text-white/40 max-w-xs mx-auto leading-relaxed mb-6">
                  No confirmed registrations found for this UTR / WhatsApp number. If you registered recently, please allow a few minutes for confirmation.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <a
                    href="/"
                    className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold hover:bg-white/5 transition-colors duration-200"
                  >
                    Browse tournaments
                  </a>
                  <a
                    href={`https://wa.me/${SUPPORT_WHATSAPP}?text=Hi+Apex+Esports+support,+I+can't+find+my+registration.`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl bg-green-500/15 border border-green-500/30 px-5 py-2.5 text-sm font-semibold text-green-400 hover:bg-green-500/25 transition-colors duration-200"
                  >
                    Contact support
                  </a>
                </div>
              </div>
            ) : (
              <>
                {/* Results header */}
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-bold">
                    Your Registrations
                  </h2>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                    {results.length} found
                  </span>
                </div>

                {results.map((reg) => (
                  <RegistrationCard key={reg.registration_id} reg={reg} />
                ))}
              </>
            )}
          </section>
        )}

        {/* ── Info tip (before any search) ── */}
        {!hasSearched && !loading && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center text-xs text-white/30 leading-relaxed">
            Your room ID and IDP group link will appear here once the organiser has shared them. Room details are typically released 30–60 minutes before the match.
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.06] py-8 text-center text-xs text-white/20">
        © 2026 {ORG_NAME}. All rights reserved.
      </footer>

      {/* ── WhatsApp Support floating button ── */}
      <a
        href={`https://wa.me/${SUPPORT_WHATSAPP}?text=Hi+Apex+Esports+support`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="WhatsApp Support"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 shadow-xl shadow-green-900/40 hover:bg-green-400 hover:scale-105 active:scale-95 transition-all duration-200"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-7 h-7 text-white"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>
    </div>
  );
}
