"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { MatchIDPSection } from "@/components/MatchIDPSection";
import Link from "next/link";

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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-5 w-2/3 rounded-lg skeleton" />
          <div className="h-3 w-1/3 rounded skeleton" />
        </div>
        <div className="h-6 w-20 rounded-full skeleton" />
      </div>
      <div className="h-16 rounded-xl skeleton" />
      <div className="h-12 rounded-xl skeleton" />
    </div>
  );
}

function RegistrationCard({ reg }: { reg: Registration }) {
  const isConfirmed = reg.status.toLowerCase() === "confirmed";

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4 shadow-sm">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-black text-slate-800">
              Slot #{reg.slot_number}
            </span>
            <span className="text-xs font-bold text-slate-500">
              Team: <strong className="text-slate-900">{reg.team_name}</strong>
            </span>
          </div>
          <h3 className="text-lg font-black text-slate-900 leading-snug">{reg.event_title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{toIST(reg.starts_at)} IST</p>
        </div>

        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-black tracking-wider border ${
            isConfirmed
              ? "border-emerald-300 bg-emerald-100 text-emerald-800"
              : "border-amber-300 bg-amber-100 text-amber-800"
          }`}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function MyTournamentsPage() {
  const [mode, setMode] = useState<SearchMode>("utr");
  const [utrInput, setUtrInput] = useState("");
  const [waInput, setWaInput] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authWhatsapp, setAuthWhatsapp] = useState<string | null>(null);

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [results, setResults] = useState<Registration[] | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
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

  const performLookup = useCallback(
    async (utr: string | null, whatsapp: string | null) => {
      setLoading(true);
      setLookupError(null);
      setResults(null);

      const { data, error } = await supabase.rpc("lookup_my_tournaments", {
        p_utr: utr ?? null,
        p_whatsapp: whatsapp ?? null,
      });

      setLoading(false);

      if (error) {
        const msg = error.message ?? "";
        if (msg.includes("invalid_utr")) {
          setLookupError("Invalid UTR — it must be a 12-digit number.");
        } else if (msg.includes("user_not_found")) {
          setLookupError("No registrations found for this reference.");
        } else {
          setLookupError("Could not retrieve credentials. Please verify your details.");
        }
        return;
      }

      let rows = (data as Registration[]) ?? [];
      
      // Strict Payment Verification Gate: Check payments table status
      if (utr && rows.length > 0) {
        try {
          const { data: pay } = await supabase
            .from("payments")
            .select("status")
            .eq("utr", utr)
            .maybeSingle();
          if (pay && pay.status !== "approved") {
            rows = rows.map((r) => ({ ...r, status: "pending_verification" }));
          }
        } catch {
          // ignore lookup error
        }
      }

      rows.sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
      setResults(rows);
    },
    []
  );

  // Check URL query parameter (e.g. ?q=... or ?utr=...)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const q = urlParams.get("q") || urlParams.get("utr");
      if (q) {
        const cleaned = q.replace(/\D/g, "");
        if (cleaned.length === 12) {
          setMode("utr");
          setUtrInput(cleaned);
          performLookup(cleaned, null);
        } else if (cleaned.length === 10) {
          setMode("whatsapp");
          setWaInput(cleaned);
          performLookup(null, "91" + cleaned);
        }
      }
    }
  }, [performLookup]);

  // Auto-lookup if user has registered WhatsApp in metadata
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (authWhatsapp && !autoLoaded.current) {
      autoLoaded.current = true;
      performLookup(null, authWhatsapp);
    }
  }, [authWhatsapp, performLookup]);

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

  return (
    <div className="min-h-screen bg-[#F4F6FB] flex flex-col text-slate-900 pb-20">
      {/* ── Navbar ── */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0A1128] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 py-3.5">
          <Link href="/" className="flex items-center gap-1.5 font-black text-lg">
            <span className="text-[#FFB800]">◆</span>
            <span>{ORG_NAME}</span>
          </Link>

          <nav className="flex items-center gap-4 text-xs sm:text-sm font-semibold">
            <Link href="/" className="text-slate-300 hover:text-white transition-colors">
              Home
            </Link>
            {userEmail ? (
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white truncate max-w-[150px]">
                {userEmail}
              </span>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-[#FFB800] hover:bg-[#F59E0B] px-3.5 py-1 text-xs font-black text-slate-950"
              >
                Sign In
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {/* ── Title Banner ── */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            <span>🔑 LIVE 3-MATCH IDP PORTAL</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Find Your Room Credentials
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
            Enter your 12-digit UPI UTR or WhatsApp number to unlock your 3-Match Room ID,
            Password &amp; Official Lobby WhatsApp Group.
          </p>
        </div>

        {/* ── Lookup Form Card ── */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl space-y-5">
          {/* Mode Toggle */}
          <div className="flex rounded-2xl bg-slate-100 p-1">
            <button
              onClick={() => {
                setMode("utr");
                setFieldError(null);
              }}
              className={`flex-1 rounded-xl py-2.5 text-xs sm:text-sm font-bold transition-all ${
                mode === "utr"
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Search by UTR
            </button>
            <button
              onClick={() => {
                setMode("whatsapp");
                setFieldError(null);
              }}
              className={`flex-1 rounded-xl py-2.5 text-xs sm:text-sm font-bold transition-all ${
                mode === "whatsapp"
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Search by WhatsApp
            </button>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {mode === "utr" ? (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  12-Digit UTR Number
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={utrInput}
                  onChange={(e) => {
                    setUtrInput(e.target.value.replace(/\D/g, "").slice(0, 12));
                    if (fieldError) setFieldError(null);
                  }}
                  placeholder="e.g. 542198012345"
                  maxLength={12}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 font-mono text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors"
                />
                <p className="text-[11px] text-slate-500">
                  Found on your GPay / PhonePe / Paytm payment receipt.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  10-Digit WhatsApp Number
                </label>
                <div className="flex items-center">
                  <span className="flex h-[42px] items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-100 px-3.5 text-sm font-bold text-slate-600">
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={waInput}
                    onChange={(e) => {
                      setWaInput(e.target.value.replace(/\D/g, "").slice(0, 10));
                      if (fieldError) setFieldError(null);
                    }}
                    placeholder="7565432121"
                    maxLength={10}
                    className="flex-1 rounded-r-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 font-mono text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Number entered during tournament checkout.
                </p>
              </div>
            )}

            {fieldError && (
              <p className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-600">
                {fieldError}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-sm transition-all shadow-md shadow-amber-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                  <span>Fetching credentials…</span>
                </>
              ) : (
                "Unlock My 3-Match IDP & WhatsApp Group →"
              )}
            </button>
          </form>
        </div>

        {/* ── Lookup Error ── */}
        {lookupError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-700 font-semibold flex items-start gap-2">
            <span>⚠️</span>
            <div>
              <p>{lookupError}</p>
              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}?text=Hi+Apex+Esports,+I+need+help+finding+my+slot.`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 font-bold underline mt-1 inline-block"
              >
                Chat with host on WhatsApp →
              </a>
            </div>
          </div>
        )}

        {/* ── Skeletons while Loading ── */}
        {loading && (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* ── Results ── */}
        {!loading && results !== null && (
          <div className="space-y-5">
            {results.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center space-y-3 shadow-sm">
                <span className="text-4xl">🔍</span>
                <h3 className="text-lg font-black text-slate-900">No active bookings found</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  We couldn&apos;t find an active registration with this reference. If you recently paid, please allow up to 2 minutes or reach out to WhatsApp support.
                </p>
                <div className="pt-2 flex justify-center gap-3">
                  <Link
                    href="/"
                    className="rounded-xl bg-[#FFB800] text-slate-950 font-bold px-5 py-2 text-xs"
                  >
                    Browse Tournaments
                  </Link>
                  <a
                    href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-slate-300 text-slate-700 font-bold px-4 py-2 text-xs hover:bg-slate-50"
                  >
                    WhatsApp Support
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-black text-slate-900 uppercase tracking-wider">
                    Your Registered Lobbies ({results.length})
                  </h2>
                  <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full font-bold">
                    ✓ Verified
                  </span>
                </div>

                {results.map((reg) => (
                  <RegistrationCard key={reg.registration_id} reg={reg} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
