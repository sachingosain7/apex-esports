"use client";

import { supabase } from "@/lib/supabase";
import {
  ORG_NAME,
  UPI_ID,
  UPI_PAYEE_NAME,
  SUPPORT_WHATSAPP,
  SLOT_HOLD_SECONDS,
} from "@/lib/config";
import QRCode from "react-qr-code";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { extractLobbyLabel } from "@/lib/matchIdp";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type EvSummary = {
  id: string;
  title: string;
  starts_at: string;
  entry_fee_paise: number;
  early_bird_fee_paise: number | null;
  early_bird_slots: number | null;
  max_slots: number;
  filled_slots: number;
  status: string;
  whatsapp_group_link?: string | null;
  is_published?: boolean;
};

type OrderResult = {
  order_id: string;
  expires_at: string;
  total_paise: number;
};

type Phase = "details" | "paying" | "confirmed";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatINR(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function effectiveFee(ev: EvSummary): number {
  if (
    ev.early_bird_fee_paise !== null &&
    ev.early_bird_slots !== null &&
    ev.filled_slots < ev.early_bird_slots
  ) {
    return ev.early_bird_fee_paise;
  }
  return ev.entry_fee_paise;
}

function isEventBookable(ev: EvSummary): boolean {
  const isStarted = new Date(ev.starts_at).getTime() <= Date.now();
  return (
    ev.status === "open" &&
    !isStarted &&
    ev.filled_slots < ev.max_slots &&
    ev.is_published !== false
  );
}

function buildUpiUri(total_paise: number): string {
  return (
    `upi://pay?pa=${encodeURIComponent(UPI_ID)}` +
    `&pn=${encodeURIComponent(UPI_PAYEE_NAME)}` +
    `&am=${(total_paise / 100).toFixed(2)}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent("Apex Esports Registration")}`
  );
}

// ─────────────────────────────────────────────
// Step Indicator (Styled like Savage Reference)
// ─────────────────────────────────────────────

function StepIndicator({ phase }: { phase: Phase }) {
  const step = phase === "details" ? 1 : phase === "paying" ? 2 : 3;
  const steps = [
    { num: 1, label: "Your team" },
    { num: 2, label: "Pay entry" },
    { num: 3, label: "Get room details" },
  ];

  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-3 mb-6 flex-wrap">
      {steps.map((s, i) => {
        const active = s.num === step;
        const done = s.num < step;

        return (
          <div key={s.num} className="flex items-center gap-1.5 sm:gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                active
                  ? "bg-[#FFB800] text-slate-950 shadow-sm"
                  : done
                  ? "bg-slate-200 text-slate-800"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black ${
                  active ? "bg-slate-950 text-white" : done ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-600"
                }`}
              >
                {done ? "✓" : s.num}
              </span>
              <span>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <span className="text-slate-300 text-xs font-bold">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase A — Details (Matching Reference Screenshot 6 & 7)
// ─────────────────────────────────────────────

interface PhaseAProps {
  events: EvSummary[];
  unavailable: EvSummary[];
  loading: boolean;
  fetchError: string | null;
  onSubmit: (whatsapp: string, teamName: string) => void;
  submitting: boolean;
  submitError: string | null;
  isLoggedIn: boolean;
  currentUrl: string;
}

function PhaseADetails({
  events,
  unavailable,
  loading,
  fetchError,
  onSubmit,
  submitting,
  submitError,
  isLoggedIn,
  currentUrl,
}: PhaseAProps) {
  const [whatsapp, setWhatsapp] = useState("");
  const [teamName, setTeamName] = useState("");
  const [touched, setTouched] = useState({ whatsapp: false, teamName: false });
  const [clientNow, setClientNow] = useState(0);

  useEffect(() => {
    setClientNow(Date.now());
  }, []);

  const whatsappValid = /^[6-9][0-9]{9}$/.test(whatsapp);
  const teamNameValid = teamName.trim().length >= 2 && teamName.trim().length <= 40;
  const canSubmit = whatsappValid && teamNameValid && events.length > 0 && !submitting;

  const totalPaise = events.reduce((acc, ev) => acc + effectiveFee(ev), 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-[#FFB800]" />
        <p className="text-sm text-slate-500 font-medium">Loading tournament details…</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-700">
        {fetchError}
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-[#D97706] text-2xl font-black">
          👤
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-900">Sign in to register</h2>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            Sign in to lock your team slot and view your live 3-Match IDP.
          </p>
        </div>
        <Link
          href={`/login?next=${encodeURIComponent(currentUrl)}`}
          className="rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] px-6 py-3 text-sm font-black text-slate-950 transition-colors shadow-md"
        >
          Sign In to Continue →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(whatsapp, teamName);
        }}
        className="space-y-6"
      >
        {/* Section 1: Your team */}
        <div className="space-y-3.5">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-slate-900 text-white font-black text-xs flex items-center justify-center">
              1
            </span>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">
              Your team
            </h2>
          </div>

          {/* Team Name Input */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">
              Team name
            </label>
            <input
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, teamName: true }))}
              placeholder="e.g. Jojo esports"
              maxLength={40}
              className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-400 ${
                touched.teamName && !teamNameValid
                  ? "border-red-400 focus:border-red-500"
                  : "border-slate-300 focus:border-blue-600"
              }`}
            />
            {touched.teamName && !teamNameValid && (
              <p className="text-[11px] text-red-500 font-medium">
                Team name must be between 2 and 40 characters.
              </p>
            )}
          </div>

          {/* WhatsApp Number Input with +91 box */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">
              WhatsApp number
            </label>
            <div className="flex items-center">
              <span className="flex h-[42px] items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-100 px-3.5 text-sm font-bold text-slate-600">
                +91
              </span>
              <input
                type="tel"
                required
                value={whatsapp}
                onChange={(e) =>
                  setWhatsapp(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
                onBlur={() => setTouched((t) => ({ ...t, whatsapp: true }))}
                placeholder="7565432121"
                inputMode="numeric"
                maxLength={10}
                className={`flex-1 rounded-r-xl border bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-400 ${
                  touched.whatsapp && !whatsappValid
                    ? "border-red-400 focus:border-red-500"
                    : "border-slate-300 focus:border-blue-600"
                }`}
              />
            </div>
            {touched.whatsapp && !whatsappValid && (
              <p className="text-[11px] text-red-500 font-medium">
                Enter a valid 10-digit Indian mobile number.
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              We send your 3-match room details and WhatsApp group link to this number.
            </p>
          </div>
        </div>

        {/* Section 2: Your lobbies */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-slate-900 text-white font-black text-xs flex items-center justify-center">
                2
              </span>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                Your lobbies ({events.length})
              </h2>
            </div>
            <Link href="/" className="text-xs font-bold text-blue-600 hover:underline">
              Change selection
            </Link>
          </div>

          <div className="space-y-2">
            {events.map((ev) => {
              const fee = effectiveFee(ev);
              const slotsLeft = ev.max_slots - ev.filled_slots;
              return (
                <div
                  key={ev.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 text-sm truncate">{ev.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDate(ev.starts_at)}</p>
                    <p className="text-[11px] text-blue-600 font-bold mt-1">
                      {slotsLeft} slots left
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-slate-900 font-mono">
                      {formatINR(fee)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total summary */}
          <div className="flex items-center justify-between rounded-xl bg-blue-50/80 border border-blue-200 p-3.5">
            <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">
              Total Entry Fee
            </span>
            <span className="text-xl font-black text-blue-700 font-mono">
              {formatINR(totalPaise)}
            </span>
          </div>
        </div>

        {submitError && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-600">
            {submitError}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-3.5 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-sm transition-all shadow-md shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
        >
          {submitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
              <span>Holding your slot…</span>
            </>
          ) : (
            `Continue to payment (${formatINR(totalPaise)})`
          )}
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────
// Countdown hook
// ─────────────────────────────────────────────

function useCountdown(expiresAt: string | null): number {
  const [secondsLeft, setSecondsLeft] = useState<number>(SLOT_HOLD_SECONDS);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return secondsLeft;
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────
// Phase B — Scan & Pay (Matching Reference Screenshot 8 & 9)
// ─────────────────────────────────────────────

interface PhaseBProps {
  order: OrderResult;
  events: EvSummary[];
  teamName: string;
  onSuccess: (utr: string) => void;
  onBack: () => void;
}

function PhaseBPaying({ order, events, teamName, onSuccess, onBack }: PhaseBProps) {
  const [utr, setUtr] = useState("");
  const [utrTouched, setUtrTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const secondsLeft = useCountdown(order.expires_at);
  const expired = secondsLeft === 0;
  const upiUri = buildUpiUri(order.total_paise);
  const utrValid = /^\d{12}$/.test(utr);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(UPI_ID).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!utrValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("submit_order_utr", {
        p_order_id: order.order_id,
        p_utr: utr,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error ?? "Verification error");
      onSuccess(data.utr ?? utr);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate_utr")) {
        setError("This UTR has already been submitted. Contact WhatsApp host if you paid.");
      } else if (msg.includes("order_expired")) {
        setError("Your slot hold expired. Please go back and pick your slot again.");
      } else {
        setError(msg || "Could not verify payment reference.");
      }
      setSubmitting(false);
    }
  }, [utr, utrValid, submitting, order.order_id, onSuccess]);

  if (expired) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <span className="text-4xl">⏱️</span>
        <h2 className="text-lg font-black text-red-600">Slot hold expired</h2>
        <p className="text-xs text-slate-500">
          Your reservation expired. Return to the tournament list to re-select your lobby.
        </p>
        <button
          onClick={onBack}
          className="rounded-xl bg-slate-900 text-white font-bold px-5 py-2.5 text-xs"
        >
          ← Return to Tournament List
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Real-time sync notice */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 font-semibold flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-600 glow-pulse" />
        <span>Waiting for your payment... this page updates automatically.</span>
      </div>

      {/* 3 Step Instructions */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2 text-xs text-slate-700">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
            1
          </span>
          <span>Scan with any UPI app (GPay, PhonePe, Paytm, BHIM)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
            2
          </span>
          <span>Pay exactly {formatINR(order.total_paise)} within 5 minutes. Do not pay twice.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
            3
          </span>
          <span>Enter 12-digit UTR below to get your Room ID &amp; Password.</span>
        </div>
      </div>

      {/* Registrations summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
          Your registrations
        </p>
        {events.map((ev, i) => (
          <div key={ev.id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">
                {i + 1}
              </span>
              <div>
                <p className="font-bold text-slate-900">{teamName}</p>
                <p className="text-slate-500 text-[11px]">{ev.title}</p>
              </div>
            </div>
            <span className="font-black font-mono text-slate-900">{formatINR(effectiveFee(ev))}</span>
          </div>
        ))}
      </div>

      {/* Scan & Pay Card (Matching Screenshot 9) */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md flex flex-col items-center gap-4 text-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            AMOUNT TO PAY
          </p>
          <p className="text-3xl font-black text-slate-900 font-mono tracking-tight mt-0.5">
            {formatINR(order.total_paise)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Paying to <strong>{ORG_NAME}</strong> · QR valid for 5 minutes
          </p>
        </div>

        {/* QR Code Container */}
        <div className="rounded-2xl bg-white p-4 border-2 border-slate-900/10 shadow-inner relative">
          <QRCode
            value={upiUri}
            size={190}
            bgColor="#FFFFFF"
            fgColor="#0F172A"
          />
        </div>

        {/* Live Timer Pill */}
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-mono font-bold text-amber-800">
          <span>QR expires in:</span>
          <span className="font-black text-sm">{formatCountdown(secondsLeft)}</span>
        </div>

        {/* UPI ID Row */}
        <div className="w-full flex items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5">
          <p className="font-mono text-xs text-slate-700 truncate">{UPI_ID}</p>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 hover:bg-slate-50 shadow-xs shrink-0"
          >
            {copied ? "Copied ✓" : "Copy UPI"}
          </button>
        </div>

        {/* 1-Tap UPI Apps */}
        <a
          href={upiUri}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs sm:text-sm transition-colors shadow-md shadow-blue-500/20"
        >
          Open UPI App (GPay / PhonePe / Paytm) →
        </a>
      </div>

      {/* Enter 12-Digit UTR */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
        <div>
          <h3 className="text-sm font-black text-slate-900">Enter Payment Reference (UTR)</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            After paying in your UPI app, copy the 12-digit UTR and paste it here:
          </p>
        </div>

        <input
          type="text"
          inputMode="numeric"
          maxLength={12}
          value={utr}
          onChange={(e) => setUtr(e.target.value.replace(/\D/g, "").slice(0, 12))}
          onBlur={() => setUtrTouched(true)}
          placeholder="e.g. 542198012345"
          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 font-mono text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors"
        />

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-600">
            {error}
          </p>
        )}

        <button
          onClick={handleConfirm}
          disabled={!utrValid || submitting}
          className="w-full py-3.5 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-sm transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
        >
          {submitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
              <span>Verifying UTR Reference…</span>
            </>
          ) : (
            "Verify UTR & Get 3-Match IDP →"
          )}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase C — Success (3-Match IDP & Lobby WhatsApp Group)
// ─────────────────────────────────────────────

interface PhaseCProps {
  utr: string;
  events: EvSummary[];
  teamName: string;
}

function PhaseCSuccess({ utr, events, teamName }: PhaseCProps) {
  return (
    <div className="space-y-6 text-center">
      {/* Success Badge */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl font-black shadow-md">
          ✓
        </div>
        <h2 className="text-2xl font-black text-slate-900">Payment Verified &amp; Slot Locked!</h2>
        <p className="text-xs sm:text-sm text-slate-600">
          Slot reserved for Team: <strong className="text-slate-900">{teamName}</strong>
        </p>
        <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 font-mono text-xs font-bold text-slate-600">
          UTR: {utr}
        </span>
      </div>

      {/* ── Where will IDP be given Box ── */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 text-left space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl">📍</span>
          <div>
            <h3 className="text-sm font-black text-emerald-950 uppercase tracking-wider">
              Where will your Room ID &amp; Password be given?
            </h3>
            <p className="text-xs text-emerald-800">
              Host releases credentials 15 minutes before every match.
            </p>
          </div>
        </div>

        {/* Step 1: Join Lobby WhatsApp Group */}
        <div className="rounded-xl bg-white border border-emerald-200/80 p-4 space-y-2.5">
          <p className="text-xs font-black text-slate-900">
            1. Join your Official Lobby WhatsApp Group:
          </p>
          <div className="space-y-2">
            {events.map((ev) => {
              const label = extractLobbyLabel(ev.title);
              return ev.whatsapp_group_link ? (
                <a
                  key={ev.id}
                  href={ev.whatsapp_group_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-extrabold text-xs sm:text-sm py-2.5 px-4 transition-all shadow-md"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span>📲</span>
                    <span className="truncate">Join Official {label} WhatsApp Group</span>
                  </span>
                  <span className="text-[10px] bg-black/20 px-2 py-0.5 rounded text-black font-mono shrink-0">
                    {label} Group ↗
                  </span>
                </a>
              ) : (
                <div
                  key={ev.id}
                  className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs text-slate-500 flex items-center justify-between"
                >
                  <span>{label}: Group link will be shared by host</span>
                  <span className="text-[10px] text-amber-600 font-bold">Pending Host</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 2: 3 Matches IDP Schedule */}
        <div className="rounded-xl bg-white border border-emerald-200/80 p-4 space-y-2">
          <p className="text-xs font-black text-slate-900">
            2. 3 Matches = 3 Separate Room IDPs:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
              <p className="font-bold text-blue-700">🎮 Match 1</p>
              <p className="text-[10px] text-slate-500">IDP dropped 15m before</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
              <p className="font-bold text-blue-700">🎮 Match 2</p>
              <p className="text-[10px] text-slate-500">IDP dropped 15m before</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
              <p className="font-bold text-blue-700">🎮 Match 3</p>
              <p className="text-[10px] text-slate-500">IDP dropped 15m before</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action links */}
      <div className="space-y-2.5">
        <Link
          href="/my-tournaments"
          className="flex items-center justify-center gap-2 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] py-3.5 text-sm font-black text-slate-950 transition-colors shadow-md"
        >
          <span>🔑</span>
          <span>View 3-Match IDP Live on Website →</span>
        </Link>
        <Link
          href="/"
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          ← Return to Home
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Inner Page Component
// ─────────────────────────────────────────────

function RegisterContent() {
  const searchParams = useSearchParams();
  const eventParam = searchParams.get("e") || searchParams.get("event") || "";

  const [phase, setPhase] = useState<Phase>("details");
  const [events, setEvents] = useState<EvSummary[]>([]);
  const [unavailableEvents, setUnavailableEvents] = useState<EvSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [teamName, setTeamName] = useState("");
  const [confirmedUtr, setConfirmedUtr] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("/register");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsLoggedIn(Boolean(data.user));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_ev, session) => {
      setIsLoggedIn(Boolean(session?.user));
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const rawIds = eventParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawIds.length === 0) {
      setLoading(false);
      setFetchError("No tournaments selected. Please choose a lobby from the homepage.");
      return;
    }

    setLoading(true);
    setFetchError(null);

    supabase
      .from("events")
      .select(
        "id, title, starts_at, entry_fee_paise, early_bird_fee_paise, early_bird_slots, max_slots, filled_slots, status, is_published, whatsapp_group_link"
      )
      .in("id", rawIds)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          setFetchError(error.message);
          return;
        }
        const rows = (data as EvSummary[]) || [];
        const bookable = rows.filter(isEventBookable);
        const nonBookable = rows.filter((ev) => !isEventBookable(ev));
        setEvents(bookable);
        setUnavailableEvents(nonBookable);
      });
  }, [eventParam]);

  const handleHoldSlot = useCallback(
    async (whatsapp: string, team: string) => {
      if (events.length === 0 || submitting) return;
      setSubmitting(true);
      setSubmitError(null);
      setTeamName(team);

      try {
        const { data, error } = await supabase.rpc("create_registration_order", {
          p_event_ids: events.map((e) => e.id),
          p_whatsapp: whatsapp,
          p_team_name: team,
        });

        if (error) throw error;
        if (!data?.order_id) throw new Error("Order creation failed.");

        setOrder({
          order_id: data.order_id,
          expires_at: data.expires_at,
          total_paise: data.total_paise,
        });
        setPhase("paying");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err: unknown) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [events, submitting]
  );

  const handlePaymentSuccess = useCallback((utr: string) => {
    setConfirmedUtr(utr);
    setPhase("confirmed");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleBack = useCallback(() => {
    setPhase("details");
    setOrder(null);
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F6FB] flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0A1128] text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5">
          <Link href="/" className="flex items-center gap-1.5 font-black text-lg">
            <span className="text-[#FFB800]">◆</span>
            <span>{ORG_NAME}</span>
          </Link>
          <Link
            href="/"
            className="text-xs font-bold text-slate-300 hover:text-white transition-colors"
          >
            ← Back to tournaments
          </Link>
        </div>
      </header>

      {/* Main Registration Content */}
      <main className="flex-1 py-8 sm:py-12 px-4">
        <div className="max-w-xl mx-auto space-y-6">
          <StepIndicator phase={phase} />

          {/* White Card Container */}
          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl">
            {phase === "details" && (
              <PhaseADetails
                events={events}
                unavailable={unavailableEvents}
                loading={loading}
                fetchError={fetchError}
                onSubmit={handleHoldSlot}
                submitting={submitting}
                submitError={submitError}
                isLoggedIn={isLoggedIn}
                currentUrl={currentUrl}
              />
            )}

            {phase === "paying" && order && (
              <PhaseBPaying
                order={order}
                events={events}
                teamName={teamName}
                onSuccess={handlePaymentSuccess}
                onBack={handleBack}
              />
            )}

            {phase === "confirmed" && (
              <PhaseCSuccess
                utr={confirmedUtr}
                events={events}
                teamName={teamName}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-300 border-t-[#FFB800]" />
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
