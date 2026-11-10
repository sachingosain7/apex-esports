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

function isAvailable(ev: EvSummary): boolean {
  const isStarted = new Date(ev.starts_at).getTime() <= Date.now();
  return ev.status === "open" && !isStarted && ev.filled_slots < ev.max_slots && ev.is_published !== false;
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
// Sub-components
// ─────────────────────────────────────────────

function TacticalGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "60px 60px",
      }}
    />
  );
}

function AmbientGlows() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07]"
        style={{
          background:
            "radial-gradient(circle, #10B981 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-0 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full opacity-[0.06]"
        style={{
          background:
            "radial-gradient(circle, #7C3AED 0%, transparent 70%)",
        }}
      />
    </>
  );
}

function StepIndicator({ phase }: { phase: Phase }) {
  const step = phase === "details" ? 1 : phase === "paying" ? 2 : 3;
  const labels = ["Details", "Payment", "Confirmed"];
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {labels.map((label, i) => {
        const num = i + 1;
        const done = num < step;
        const active = num === step;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors duration-200 ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                    ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500"
                    : "bg-white/5 text-white/30"
                }`}
              >
                {done ? (
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  num
                )}
              </div>
              <span
                className={`text-[10px] font-medium ${
                  active ? "text-emerald-400" : done ? "text-white/50" : "text-white/20"
                }`}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className={`mb-4 h-px w-8 transition-colors duration-200 ${
                  done ? "bg-emerald-500" : "bg-white/10"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase A — Details
// ─────────────────────────────────────────────

interface PhaseAProps {
  events: EvSummary[];
  unavailable: EvSummary[];
  loading: boolean;
  fetchError: string | null;
  onSubmit: (whatsapp: string, teamName: string) => Promise<void>;
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

  const whatsappValid = /^[6-9][0-9]{9}$/.test(whatsapp);
  const teamNameValid = teamName.trim().length >= 2 && teamName.trim().length <= 40;
  const canSubmit = whatsappValid && teamNameValid && events.length > 0 && !submitting;

  const totalPaise = events.reduce((acc, ev) => acc + effectiveFee(ev), 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
        <p className="text-sm text-white/40">Loading events…</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center text-sm text-red-400">
        {fetchError}
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center gap-5 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
          <svg
            className="h-7 w-7 text-white/50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-white">Sign in to continue</p>
          <p className="mt-1 text-sm text-white/40">
            You need to be signed in to register for tournaments.
          </p>
        </div>
        <Link
          href={`/login?next=${encodeURIComponent(currentUrl)}`}
          className="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-emerald-400"
        >
          Sign in to continue →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Selected events */}
      {events.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
            Selected Events
          </h2>
          {events.map((ev) => {
            const fee = effectiveFee(ev);
            const isEarlyBird =
              ev.early_bird_fee_paise !== null &&
              ev.early_bird_slots !== null &&
              ev.filled_slots < ev.early_bird_slots;
            const slotsLeft = ev.max_slots - ev.filled_slots;
            const fillingFast =
              slotsLeft <= Math.ceil(ev.max_slots * 0.2);
            return (
              <div
                key={ev.id}
                className="rounded-xl border border-white/[0.08] bg-[#06070B] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-semibold text-white">{ev.title}</p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {formatDate(ev.starts_at)}
                    </p>
                    {fillingFast && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        {slotsLeft} slots left
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-emerald-400">{formatINR(fee)}</p>
                    {isEarlyBird && (
                      <p className="text-xs text-white/30 line-through">
                        {formatINR(ev.entry_fee_paise)}
                      </p>
                    )}
                    {isEarlyBird && (
                      <span className="text-[10px] font-semibold text-amber-400">
                        Early Bird
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-6 text-center text-sm text-white/30">
          No valid events selected. Go back and pick tournaments.
        </div>
      )}

      {/* Unavailable events */}
      {unavailable.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30">
            Not Available
          </h2>
          {unavailable.map((ev) => {
            const isStarted = new Date(ev.starts_at).getTime() <= Date.now();
            const reason = isStarted
              ? "Match already started"
              : ev.status !== "open"
              ? "Registrations closed"
              : "Tournament full · Sold out";
            const badge = isStarted ? "Started" : ev.status !== "open" ? "Closed" : "Full";

            return (
              <div
                key={ev.id}
                className="flex items-center justify-between rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3 opacity-50"
              >
                <div>
                  <p className="text-sm text-white/50 line-through">{ev.title}</p>
                  <p className="text-xs text-white/30">{reason}</p>
                </div>
                <span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-400">
                  {badge}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      {events.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSubmit(whatsapp, teamName);
          }}
          className="flex flex-col gap-4"
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
            Your Details
          </h2>

          {/* Team Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-white/70">
              Team / Player Name
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, teamName: true }))}
              placeholder="e.g. Storm Riders"
              maxLength={40}
              className={`rounded-xl border bg-[#06070B] px-4 py-3 text-sm text-white outline-none transition-colors duration-200 placeholder:text-white/20 ${
                touched.teamName && !teamNameValid
                  ? "border-red-500/60 focus:border-red-400"
                  : teamNameValid
                  ? "border-emerald-500/60 focus:border-emerald-400"
                  : "border-white/10 focus:border-emerald-400"
              }`}
            />
            {touched.teamName && !teamNameValid && (
              <p className="text-xs text-red-400">
                Team name must be 2–40 characters.
              </p>
            )}
          </div>

          {/* WhatsApp */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-white/70">
              WhatsApp Number
            </label>
            <div className="flex items-center gap-0">
              <span className="flex h-[46px] items-center rounded-l-xl border border-r-0 border-white/10 bg-white/5 px-3 text-sm text-white/50">
                +91
              </span>
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) =>
                  setWhatsapp(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
                onBlur={() => setTouched((t) => ({ ...t, whatsapp: true }))}
                placeholder="9876543210"
                inputMode="numeric"
                maxLength={10}
                className={`flex-1 rounded-r-xl border bg-[#06070B] px-4 py-3 text-sm text-white outline-none transition-colors duration-200 placeholder:text-white/20 ${
                  touched.whatsapp && !whatsappValid
                    ? "border-red-500/60 focus:border-red-400"
                    : whatsappValid
                    ? "border-emerald-500/60 focus:border-emerald-400"
                    : "border-white/10 focus:border-emerald-400"
                }`}
              />
            </div>
            {touched.whatsapp && !whatsappValid && (
              <p className="text-xs text-red-400">
                Enter a valid 10-digit Indian mobile number.
              </p>
            )}
            <p className="text-xs text-white/30">
              Room codes will be sent here via WhatsApp.
            </p>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <span className="text-sm text-white/60">
              Total ({events.length} event{events.length !== 1 ? "s" : ""})
            </span>
            <span className="text-lg font-bold text-white">
              {formatINR(totalPaise)}
            </span>
          </div>

          {submitError && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-bold text-white transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                Holding your slot…
              </>
            ) : (
              "Hold My Slot →"
            )}
          </button>
        </form>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Countdown hook
// ─────────────────────────────────────────────

function useCountdown(expiresAt: string | null): number {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!expiresAt) return SLOT_HOLD_SECONDS;
    return Math.max(
      0,
      Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
    );
  });

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
// Phase B — UPI Payment
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
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const secondsLeft = useCountdown(order.expires_at);
  const expired = secondsLeft === 0;
  const upiUri = buildUpiUri(order.total_paise);

  const utrValid = /^\d{12}$/.test(utr);
  const utrError = utrTouched && utr.length > 0 && !utrValid;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(UPI_ID).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
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
      if (!data?.success) {
        throw new Error(data?.error ?? "Unknown error");
      }
      onSuccess(data.utr ?? utr);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("invalid_utr")) {
        setError("Invalid UTR number. Please double-check and try again.");
      } else if (msg.includes("duplicate_utr")) {
        setError(
          "This UTR has already been used. Contact support if you paid."
        );
      } else if (msg.includes("order_expired")) {
        setError(
          "Your slot hold has expired. Please go back and register again."
        );
      } else {
        setError(`Something went wrong: ${msg}`);
      }
      setSubmitting(false);
    }
  }, [utr, utrValid, submitting, order.order_id, onSuccess]);

  const timerColor =
    secondsLeft < 60
      ? "text-red-400"
      : secondsLeft < 180
      ? "text-amber-400"
      : "text-emerald-400";

  if (expired) {
    return (
      <div className="flex flex-col items-center gap-5 py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
          <span className="text-3xl">⚠️</span>
        </div>
        <div>
          <p className="text-base font-semibold text-red-400">Slot hold expired</p>
          <p className="mt-1 text-sm text-white/40">
            Your 10-minute hold has ended. Please go back and register again.
          </p>
        </div>
        <button
          onClick={onBack}
          className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/10"
        >
          ← Back to Details
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Timer */}
      <div className="flex flex-col items-center gap-1 rounded-xl border border-white/[0.08] bg-[#06070B] px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
          Slot held for
        </p>
        <p
          className={`font-mono text-4xl font-bold tabular-nums transition-colors duration-500 ${timerColor}`}
        >
          {formatCountdown(secondsLeft)}
        </p>
        <p className="text-xs text-white/30">
          Complete payment before the timer runs out
        </p>
      </div>

      {/* Order Summary */}
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
          Order Summary
        </h2>
        {events.map((ev) => (
          <div
            key={ev.id}
            className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#06070B] px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-white">{ev.title}</p>
              <p className="text-xs text-white/40">Team: {teamName}</p>
            </div>
            <p className="text-sm font-bold text-emerald-400">
              {formatINR(effectiveFee(ev))}
            </p>
          </div>
        ))}
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <span className="text-sm font-semibold text-white/80">Total to Pay</span>
          <span className="text-xl font-bold text-emerald-400">
            {formatINR(order.total_paise)}
          </span>
        </div>
      </div>

      {/* UPI QR */}
      <div className="flex flex-col items-center gap-4 rounded-xl border border-white/[0.08] bg-[#06070B] p-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
          Scan &amp; Pay
        </h2>
        <div className="rounded-xl bg-[#0E1118] p-4 ring-1 ring-white/[0.08]">
          <QRCode
            value={upiUri}
            size={200}
            bgColor="#0E1118"
            fgColor="#FFFFFF"
          />
        </div>
        <p className="text-center text-xs text-white/40">
          Scan with any UPI app — PhonePe, GPay, Paytm, BHIM
        </p>

        {/* UPI ID row */}
        <div className="flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <p className="flex-1 truncate font-mono text-sm text-white/70">
            {UPI_ID}
          </p>
          <button
            onClick={handleCopy}
            className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:bg-white/10"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>

        {/* Open UPI app button */}
        <a
          href={upiUri}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-white transition-colors duration-200 hover:bg-emerald-400"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          Pay {formatINR(order.total_paise)} via UPI App
        </a>
      </div>

      {/* UTR Input */}
      <div className="flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-[#06070B] p-5">
        <div>
          <h2 className="font-semibold text-white">Enter Payment Reference</h2>
          <p className="mt-1 text-xs text-white/40">
            After payment, enter your 12-digit UPI Reference Number (UTR)
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            maxLength={12}
            value={utr}
            onChange={(e) => {
              setUtr(e.target.value.replace(/\D/g, "").slice(0, 12));
              setError(null);
            }}
            onBlur={() => setUtrTouched(true)}
            placeholder="e.g. 123456789012"
            className={`rounded-xl border bg-[#06070B] px-4 py-3 font-mono text-sm text-white outline-none transition-colors duration-200 placeholder:font-sans placeholder:text-white/20 ${
              utrError
                ? "border-red-500/60 focus:border-red-400"
                : utrValid
                ? "border-emerald-500/60 focus:border-emerald-400"
                : "border-white/10 focus:border-emerald-400"
            }`}
          />
          {utrError && (
            <p className="text-xs text-red-400">
              UTR must be exactly 12 digits.
            </p>
          )}
          {utrValid && (
            <p className="text-xs text-emerald-400">✓ Looks good!</p>
          )}
        </div>

        {error && (
          <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          onClick={handleConfirm}
          disabled={!utrValid || submitting}
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-white transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              Verifying…
            </>
          ) : (
            "Confirm Payment →"
          )}
        </button>

        <p className="text-center text-xs text-white/30">
          Find your UTR in your UPI app under payment history.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase C — Success
// ─────────────────────────────────────────────

function PhaseCSuccess({ utr }: { utr: string }) {
  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center">
      {/* Emerald check */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-emerald-500/10" />
        <div className="absolute inset-2 rounded-full bg-emerald-500/10" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 ring-2 ring-emerald-500/50">
          <svg
            className="h-7 w-7 text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-white">Payment Received! 🎉</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Your slot is confirmed. Our team will verify your UTR and send room
          details to your WhatsApp.
        </p>
      </div>

      {/* UTR display */}
      <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <p className="text-xs text-white/40">Reference Number</p>
        <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
          {utr}
        </p>
      </div>

      {/* CTA Buttons */}
      <div className="flex w-full flex-col gap-3">
        <Link
          href="/my-tournaments"
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-white transition-colors duration-200 hover:bg-emerald-400"
        >
          View My Tournaments →
        </Link>
        <a
          href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(
            `Hi! I just registered on ${ORG_NAME}. My UTR is ${utr}. Please confirm my slot.`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/10"
        >
          <svg
            className="h-4 w-4 text-emerald-400"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.561 4.14 1.535 5.874L.057 23.885a.5.5 0 00.611.611l6.012-1.479A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.019-1.378l-.36-.214-3.729.917.933-3.618-.235-.372A9.818 9.818 0 012.182 12C2.182 6.569 6.569 2.182 12 2.182c5.431 0 9.818 4.387 9.818 9.818 0 5.431-4.387 9.818-9.818 9.818z" />
          </svg>
          Need help? Chat on WhatsApp
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Inner Page (needs useSearchParams)
// ─────────────────────────────────────────────

function RegisterPageInner() {
  const searchParams = useSearchParams();
  const rawIds = searchParams.get("e") ?? "";
  const eventIds = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [phase, setPhase] = useState<Phase>("details");
  const [events, setEvents] = useState<EvSummary[]>([]);
  const [unavailableEvents, setUnavailableEvents] = useState<EvSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("");

  const [order, setOrder] = useState<OrderResult | null>(null);
  const [teamName, setTeamName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedUtr, setConfirmedUtr] = useState("");

  // Capture URL for redirect
  useEffect(() => {
    setCurrentUrl(window.location.href);
  }, []);

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Fetch events
  useEffect(() => {
    if (eventIds.length === 0) {
      setLoading(false);
      setFetchError("No events specified. Please go back and select tournaments.");
      return;
    }
    setLoading(true);
    setFetchError(null);
    supabase
      .from("events")
      .select(
        "id, title, starts_at, entry_fee_paise, early_bird_fee_paise, early_bird_slots, max_slots, filled_slots, status, is_published"
      )
      .in("id", eventIds)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          setFetchError(`Failed to load events: ${error.message}`);
          return;
        }
        const all = (data ?? []) as EvSummary[];
        setEvents(all.filter(isAvailable));
        setUnavailableEvents(all.filter((ev) => !isAvailable(ev)));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawIds]);

  const handleHoldSlot = useCallback(
    async (whatsapp: string, name: string) => {
      setSubmitting(true);
      setSubmitError(null);
      setTeamName(name);
      try {
        const { data, error } = await supabase.rpc("create_order", {
          p_whatsapp: `+91${whatsapp}`,
          p_events: events.map((ev) => ev.id),
          p_teams: events.map(() => name),
        });
        if (error) throw error;
        if (!data) throw new Error("No order data returned.");
        setOrder(data as OrderResult);
        setPhase("paying");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setSubmitError(`Could not hold your slot: ${msg}`);
      } finally {
        setSubmitting(false);
      }
    },
    [events]
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
    <main
      className="relative min-h-screen overflow-x-hidden"
      style={{ background: "#06070B" }}
    >
      <TacticalGrid />
      <AmbientGlows />

      <div className="relative z-10 mx-auto max-w-lg px-4 pb-20 pt-6">
        {/* Back link */}
        {phase === "details" && (
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors duration-200 hover:text-white/70"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to home
          </Link>
        )}
        {phase === "paying" && (
          <button
            onClick={handleBack}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors duration-200 hover:text-white/70"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0E1118] p-6">
          {/* Header */}
          <div className="mb-6">
            {phase !== "confirmed" && (
              <StepIndicator phase={phase} />
            )}
            <h1 className="text-xl font-bold text-white">
              {phase === "details"
                ? "Register for Tournament"
                : phase === "paying"
                ? "Complete Payment"
                : "Registration Complete"}
            </h1>
            <p className="mt-1 text-sm text-white/40">
              {phase === "details"
                ? `${ORG_NAME} · Secure your spot now`
                : phase === "paying"
                ? "Pay via UPI to confirm your slot"
                : "Welcome to the tournament!"}
            </p>
          </div>

          {/* Phase content */}
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

          {phase === "confirmed" && <PhaseCSuccess utr={confirmedUtr} />}
        </div>

        {/* Footer */}
        {phase !== "confirmed" && (
          <p className="mt-6 text-center text-xs text-white/20">
            Need help?{" "}
            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-500/60 transition-colors duration-200 hover:text-emerald-400"
            >
              Contact {ORG_NAME} support
            </a>
          </p>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────
// Default Export — Suspense wrapper (required for useSearchParams)
// ─────────────────────────────────────────────

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <main
          className="flex min-h-screen items-center justify-center"
          style={{ background: "#06070B" }}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
            <p className="text-sm text-white/40">Loading registration…</p>
          </div>
        </main>
      }
    >
      <RegisterPageInner />
    </Suspense>
  );
}
