"use client";

import { supabase } from "@/lib/supabase";
import {
  ORG_NAME,
  UPI_ID,
  UPI_PAYEE_NAME,
  SUPPORT_WHATSAPP,
  SLOT_HOLD_SECONDS,
} from "@/lib/config";
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

type Phase = "details" | "paying" | "pending_verification" | "confirmed";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatINR(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

function extractErrorMessage(err: unknown): string {
  if (!err) return "An unknown error occurred. Please try again.";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.trim().length > 0) return obj.message;
    if (typeof obj.error_description === "string") return obj.error_description;
    if (typeof obj.details === "string" && obj.details.trim().length > 0) return obj.details;
    if (typeof obj.hint === "string" && obj.hint.trim().length > 0) return `${obj.message || "Error"}: ${obj.hint}`;
    try {
      const s = JSON.stringify(err);
      if (s && s !== "{}") return s;
    } catch {}
  }
  return "Could not process request. Please check your connection and try again.";
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
// Step Indicator
// ─────────────────────────────────────────────

function StepIndicator({ phase }: { phase: Phase }) {
  let step = 1;
  if (phase === "paying") step = 2;
  else if (phase === "pending_verification") step = 2;
  else if (phase === "confirmed") step = 3;

  const steps = [
    { num: 1, label: "Your team" },
    {
      num: 2,
      label: phase === "pending_verification" ? "Verifying UTR" : "Pay entry",
    },
    { num: 3, label: "Get room details" },
  ];

  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-3 mb-6 flex-wrap">
      {steps.map((s, i) => {
        const active = s.num === step;
        const done = s.num < step || (s.num === 2 && phase === "confirmed");

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
                  active
                    ? "bg-slate-950 text-white"
                    : done
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-300 text-slate-600"
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
// Phase A — Details (With Auto-Save in LocalStorage)
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

const LOCAL_STORAGE_TEAM_KEY = "apex_saved_team_name";
const LOCAL_STORAGE_WA_KEY = "apex_saved_whatsapp";

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
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);
  const [showAutoSavedBadge, setShowAutoSavedBadge] = useState(false);

  // Auto-load saved team details on mount
  useEffect(() => {
    try {
      const savedTeam = localStorage.getItem(LOCAL_STORAGE_TEAM_KEY);
      const savedWa = localStorage.getItem(LOCAL_STORAGE_WA_KEY);
      if (savedTeam) setTeamName(savedTeam);
      if (savedWa) setWhatsapp(savedWa);
      if (savedTeam || savedWa) {
        setHasAutoLoaded(true);
      }
    } catch {
      // LocalStorage unavailable
    }
  }, []);

  const handleTeamNameChange = (val: string) => {
    setTeamName(val);
    setShowAutoSavedBadge(true);
    try {
      localStorage.setItem(LOCAL_STORAGE_TEAM_KEY, val);
    } catch {}
  };

  const handleWhatsappChange = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    setWhatsapp(digits);
    setShowAutoSavedBadge(true);
    try {
      localStorage.setItem(LOCAL_STORAGE_WA_KEY, digits);
    } catch {}
  };

  const handleClearSaved = () => {
    setTeamName("");
    setWhatsapp("");
    setHasAutoLoaded(false);
    setShowAutoSavedBadge(false);
    try {
      localStorage.removeItem(LOCAL_STORAGE_TEAM_KEY);
      localStorage.removeItem(LOCAL_STORAGE_WA_KEY);
    } catch {}
  };

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
      {/* Auto-save notification pill */}
      {(hasAutoLoaded || showAutoSavedBadge) && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs text-emerald-800 font-semibold shadow-xs">
          <span className="flex items-center gap-1.5">
            <span>💾</span>
            <span>Progress auto-saved — no need to re-type on reload</span>
          </span>
          <button
            type="button"
            onClick={handleClearSaved}
            className="text-[11px] font-bold text-slate-500 hover:text-rose-600 underline cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}

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
            <label className="text-xs font-bold text-slate-700">Team name</label>
            <input
              type="text"
              required
              value={teamName}
              onChange={(e) => handleTeamNameChange(e.target.value)}
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

          {/* WhatsApp Number Input */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">WhatsApp number</label>
            <div className="flex items-center">
              <span className="flex h-[42px] items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-100 px-3.5 text-sm font-bold text-slate-600">
                +91
              </span>
              <input
                type="tel"
                required
                value={whatsapp}
                onChange={(e) => handleWhatsappChange(e.target.value)}
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
              Your 3-Match IDP &amp; WhatsApp group link are sent here after admin verification.
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
// Phase B — Scan & Pay (ONLY QR, NO PERSONAL NAMES)
// ─────────────────────────────────────────────

interface PhaseBProps {
  order: OrderResult;
  events: EvSummary[];
  teamName: string;
  onSubmitted: (utr: string) => void;
  onBack: () => void;
}

function PhaseBPaying({ order, events, teamName, onSubmitted, onBack }: PhaseBProps) {
  const [utr, setUtr] = useState("");
  const [utrTouched, setUtrTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [screenshotData, setScreenshotData] = useState<string | null>(null);

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

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Screenshot image size must be under 5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setScreenshotData(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = useCallback(async () => {
    if (!utrValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. Submit UTR to hold slot
      let submitted = false;
      try {
        const { data, error: rpcError } = await supabase.rpc("submit_order_utr", {
          p_order_id: order.order_id,
          p_utr: utr,
        });
        if (!rpcError && data?.success) {
          submitted = true;
        }
      } catch {
        // fallback
      }

      // If RPC failed or wasn't found, ensure payments table record
      if (!submitted) {
        const { error: payErr } = await supabase.from("payments").insert({
          order_id: order.order_id,
          utr: utr,
          amount_paise: order.total_paise,
          status: "pending_verification",
          screenshot_url: screenshotData || null,
        });
        if (payErr && !payErr.message?.includes("duplicate")) {
          // If insert fails because screenshot_url column doesn't exist yet, retry without screenshot_url
          await supabase.from("payments").insert({
            order_id: order.order_id,
            utr: utr,
            amount_paise: order.total_paise,
            status: "pending_verification",
          });
        }

        // Update registrations to pending_approval
        await supabase
          .from("registrations")
          .update({ status: "pending_approval" })
          .eq("order_id", order.order_id);

        await supabase
          .from("orders")
          .update({ status: "submitted" })
          .eq("id", order.order_id);
      }

      // Save screenshot in local store for host view & persistence
      if (screenshotData) {
        try {
          localStorage.setItem(`apex_payment_ss_${utr}`, screenshotData);
        } catch {}
      }

      onSubmitted(utr);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      if (msg.includes("duplicate_utr") || msg.includes("duplicate key")) {
        setError("This UTR has already been submitted. Contact WhatsApp host if you already paid.");
      } else if (msg.includes("order_expired")) {
        setError("Your slot hold expired. Please go back and pick your slot again.");
      } else {
        setError(msg || "Could not submit payment reference.");
      }
      setSubmitting(false);
    }
  }, [utr, utrValid, submitting, order.order_id, order.total_paise, screenshotData, onSubmitted]);

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
      {/* 3 Step Instructions */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2 text-xs text-slate-700">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
            1
          </span>
          <span>Scan the QR code below with any UPI app (GPay, PhonePe, Paytm, BHIM).</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
            2
          </span>
          <span>Pay exactly {formatINR(order.total_paise)} before the countdown expires.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
            3
          </span>
          <span>Paste the 12-digit UTR below for Admin verification.</span>
        </div>
      </div>

      {/* Registrations summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
          Your reservation
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
            <span className="font-black font-mono text-slate-900">
              {formatINR(effectiveFee(ev))}
            </span>
          </div>
        ))}
      </div>

      {/* Payment QR Code Card (ONLY CLEAN QR, NO PERSONAL DETAILS) */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md flex flex-col items-center gap-4 text-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            AMOUNT TO PAY
          </p>
          <p className="text-3xl font-black text-slate-900 font-mono tracking-tight mt-0.5">
            {formatINR(order.total_paise)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Official UPI Payment QR · Valid for 5 minutes
          </p>
        </div>

        {/* Square Clean QR Matrix */}
        <div className="rounded-2xl bg-white p-3 border-2 border-slate-900/10 shadow-inner inline-flex items-center justify-center">
          <img
            src="/payment-qr.png"
            alt="Apex Esports Payment QR Code"
            className="w-52 h-52 sm:w-60 sm:h-60 object-contain rounded-xl"
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
            className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 hover:bg-slate-50 shadow-xs shrink-0 cursor-pointer"
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
            After completing the UPI payment, copy the 12-digit UTR from your app and paste it below:
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

        {/* Screenshot Upload for Instant Verification */}
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <span>📸</span>
              <span>Upload Payment Screenshot (Optional · Speeds up Approval)</span>
            </span>
            {screenshotData && (
              <button
                type="button"
                onClick={() => setScreenshotData(null)}
                className="text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>

          {screenshotData ? (
            <div className="flex items-center gap-2.5 bg-white p-2 rounded-lg border border-slate-200">
              <img
                src={screenshotData}
                alt="Payment proof"
                className="h-10 w-10 object-cover rounded-md border border-slate-200"
              />
              <span className="text-xs text-emerald-700 font-extrabold">Screenshot ready for Admin check ✓</span>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*"
              onChange={handleScreenshotChange}
              className="block w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
            />
          )}
        </div>

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
              <span>Submitting UTR…</span>
            </>
          ) : (
            "Submit 12-Digit UTR for Verification →"
          )}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase Pending Verification (Strict Gate Before IDP & Group Link)
// ─────────────────────────────────────────────

interface PhasePendingProps {
  utr: string;
  orderId: string;
  events: EvSummary[];
  teamName: string;
  onApproved: () => void;
}

function PhasePendingVerification({
  utr,
  orderId,
  events,
  teamName,
  onApproved,
}: PhasePendingProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Awaiting verification by Admin or Owner…");
  const [isRejected, setIsRejected] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      // 1. Try public RPC check_payment_status
      const { data: rpcData } = await supabase.rpc("check_payment_status", {
        p_utr: utr,
      });

      if (rpcData && rpcData.found) {
        if (rpcData.status === "approved") {
          onApproved();
          return;
        }
        if (rpcData.status === "rejected") {
          setIsRejected(true);
          setStatusMessage("Payment rejected by host. Please contact support.");
          return;
        }
      }

      // 2. Direct fallback on payments table
      const { data: pay } = await supabase
        .from("payments")
        .select("status")
        .eq("utr", utr)
        .maybeSingle();

      if (pay) {
        if (pay.status === "approved") {
          onApproved();
          return;
        }
        if (pay.status === "rejected") {
          setIsRejected(true);
          setStatusMessage("Payment rejected by host. Please contact support.");
          return;
        }
      }

      // 3. Fallback on registrations table
      const { data: regs } = await supabase
        .from("registrations")
        .select("status")
        .eq("order_id", orderId);

      if (regs && regs.length > 0 && regs.every((r) => r.status === "confirmed")) {
        onApproved();
        return;
      }

      setStatusMessage("Awaiting verification by Admin or Owner…");
    } catch {
      // ignore network hiccup during polling
    } finally {
      setIsChecking(false);
    }
  }, [utr, orderId, onApproved]);

  // Set up auto-poll every 3.5s + Supabase Realtime channel
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 3500);

    // Realtime postgres listener on payments row
    const channel = supabase
      .channel(`payment-status-${utr}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `utr=eq.${utr}`,
        },
        (payload: { new?: { status?: string } }) => {
          if (payload.new?.status === "approved") {
            onApproved();
          } else if (payload.new?.status === "rejected") {
            setIsRejected(true);
            setStatusMessage("Payment rejected by host.");
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [checkStatus, utr, onApproved]);

  return (
    <div className="space-y-6 text-center">
      {/* Pending Animated Status Card */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="w-16 h-16 rounded-3xl bg-amber-100 text-amber-700 flex items-center justify-center text-3xl font-black shadow-md">
            ⏳
          </div>
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500" />
          </span>
        </div>

        <h2 className="text-2xl font-black text-slate-900">UTR Submitted for Verification</h2>
        <p className="text-xs sm:text-sm text-slate-600 max-w-md">
          Your payment reference has been recorded for Team:{" "}
          <strong className="text-slate-900">{teamName}</strong>.
        </p>

        <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-300 px-3.5 py-1 text-xs font-mono font-bold text-amber-900">
          <span>UTR: {utr}</span>
          <span className="text-amber-500">·</span>
          <span>{isRejected ? "REJECTED" : "PENDING APPROVAL"}</span>
        </div>
      </div>

      {/* Strict Security Gate Box */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-left space-y-3.5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔒</span>
          <div>
            <h3 className="text-sm font-black text-amber-950 uppercase tracking-wider">
              Room Details &amp; WhatsApp Group Locked
            </h3>
            <p className="text-xs text-amber-800">
              Only approved payments receive official match credentials.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-white border border-amber-200 p-4 space-y-2 text-xs text-slate-700">
          <p className="font-semibold leading-relaxed">
            Both the <strong>Platform Owner</strong> and <strong>Admins</strong> have been notified
            of your submission. Once they review your transaction:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-slate-600 font-medium">
            <li>This screen will automatically update to <strong>Verified</strong>.</li>
            <li>Your Official Lobby WhatsApp Group Link will be unlocked.</li>
            <li>Your 3-Match Room ID &amp; Password schedule will be revealed.</li>
          </ul>
        </div>
      </div>

      {/* Real-time sync & manual refresh button */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600 glow-pulse shrink-0" />
          <p className="text-xs font-bold text-slate-700 truncate">{statusMessage}</p>
        </div>

        <button
          type="button"
          onClick={checkStatus}
          disabled={isChecking}
          className="rounded-xl bg-white border border-slate-300 hover:bg-slate-100 px-4 py-2 text-xs font-black text-slate-900 transition-colors shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
        >
          {isChecking ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
              <span>Checking…</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>Check Status Now</span>
            </>
          )}
        </button>
      </div>

      {/* Host WhatsApp support button for fast approvals */}
      <div className="space-y-2 pt-2">
        <a
          href={`https://wa.me/91${SUPPORT_WHATSAPP}?text=Hi+Host,+I+submitted+my+UTR:+${utr}+for+Team:+${encodeURIComponent(
            teamName
          )}.+Please+approve+my+payment.`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs sm:text-sm transition-colors shadow-md"
        >
          <span>💬</span>
          <span>Need Instant Approval? WhatsApp Host (+91 {SUPPORT_WHATSAPP})</span>
        </a>

        <Link
          href="/"
          className="inline-block text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors pt-2"
        >
          ← Return to Home (Your UTR is safe &amp; pending)
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase C — Success (Unlocked After Admin / Owner Approval)
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
        <h2 className="text-2xl font-black text-slate-900">Payment Approved &amp; Slot Locked!</h2>
        <p className="text-xs sm:text-sm text-slate-600">
          Verified by Admin for Team: <strong className="text-slate-900">{teamName}</strong>
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
          href={`/my-tournaments?utr=${utr}`}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] py-3.5 text-sm font-black text-slate-950 transition-colors shadow-md"
        >
          <span>🔑</span>
          <span>View 3-Match IDP Live on Website →</span>
        </Link>
        <Link
          href="/"
          onClick={() => {
            try {
              localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
            } catch {}
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          ← Return to Home (Book Another Lobby)
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Inner Page Component
// ─────────────────────────────────────────────

const ACTIVE_SESSION_STORAGE_KEY = "apex_active_booking_session";

function RegisterContent() {
  const searchParams = useSearchParams();
  const eventParam = searchParams.get("e") || searchParams.get("event") || searchParams.get("resume") || "";

  const [phase, setPhase] = useState<Phase>("details");
  const [events, setEvents] = useState<EvSummary[]>([]);
  const [unavailableEvents, setUnavailableEvents] = useState<EvSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [teamName, setTeamName] = useState("");
  const [submittedUtr, setSubmittedUtr] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("/register");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.pathname + window.location.search);
    }
  }, []);

  // Restore active booking session across browser reloads
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.utr && (parsed.phase === "pending_verification" || parsed.phase === "confirmed")) {
          setSubmittedUtr(parsed.utr);
          if (parsed.order_id) {
            setOrder({
              order_id: parsed.order_id,
              expires_at: parsed.expires_at,
              total_paise: parsed.total_paise,
            });
          }
          if (parsed.team_name) setTeamName(parsed.team_name);
          setPhase(parsed.phase);
        } else if (parsed.order_id && parsed.phase === "paying") {
          const isExpired = new Date(parsed.expires_at).getTime() < Date.now();
          if (!isExpired) {
            setOrder({
              order_id: parsed.order_id,
              expires_at: parsed.expires_at,
              total_paise: parsed.total_paise,
            });
            if (parsed.team_name) setTeamName(parsed.team_name);
            setPhase("paying");
          } else {
            localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
          }
        }
      }
    } catch {}
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
    let rawIds = eventParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawIds.length === 0) {
      try {
        const saved = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.event_ids) && parsed.event_ids.length > 0) {
            rawIds = parsed.event_ids;
          }
        }
      } catch {}
    }

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
        let orderId: string | null = null;
        let expiresAt: string | null = null;
        let totalPaise: number = events.reduce((acc, ev) => acc + effectiveFee(ev), 0);

        // Strategy 1: Try canonical create_order RPC
        try {
          const { data: ordData, error: ordError } = await supabase.rpc("create_order", {
            p_whatsapp: whatsapp.startsWith("+91") ? whatsapp : `+91${whatsapp}`,
            p_events: events.map((ev) => ev.id),
            p_teams: events.map(() => team),
          });
          if (!ordError && ordData) {
            const d = ordData as { order_id?: string; id?: string; expires_at?: string; total_paise?: number };
            orderId = d.order_id || d.id || null;
            expiresAt = d.expires_at || null;
            if (d.total_paise) totalPaise = d.total_paise;
          }
        } catch {
          // fallback to next strategy
        }

        // Strategy 2: Try create_registration_order RPC
        if (!orderId) {
          try {
            const { data: regData, error: regError } = await supabase.rpc("create_registration_order", {
              p_event_ids: events.map((e) => e.id),
              p_whatsapp: whatsapp,
              p_team_name: team,
            });
            if (!regError && regData) {
              const d = regData as { order_id?: string; id?: string; expires_at?: string; total_paise?: number };
              orderId = d.order_id || d.id || null;
              expiresAt = d.expires_at || null;
              if (d.total_paise) totalPaise = d.total_paise;
            }
          } catch {
            // fallback to next strategy
          }
        }

        // Strategy 3: Direct table insert fallback
        if (!orderId) {
          const generatedId =
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `ord_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

          const { data: insOrder, error: insOrderErr } = await supabase
            .from("orders")
            .insert({
              id: generatedId,
              whatsapp: whatsapp.startsWith("+91") ? whatsapp : `+91${whatsapp}`,
              total_paise: totalPaise,
              status: "pending",
              expires_at: expiry,
            })
            .select("id, expires_at, total_paise")
            .single();

          if (insOrderErr) {
            throw insOrderErr;
          }

          const regRows = events.map((ev) => ({
            order_id: generatedId,
            event_id: ev.id,
            whatsapp: whatsapp.startsWith("+91") ? whatsapp : `+91${whatsapp}`,
            team_name: team,
            status: "pending_payment",
            amount_paise: effectiveFee(ev),
          }));

          const { error: insRegErr } = await supabase.from("registrations").insert(regRows);
          if (insRegErr) {
            console.warn("Direct registrations insert warning:", insRegErr);
          }

          orderId = insOrder.id;
          expiresAt = insOrder.expires_at;
          totalPaise = insOrder.total_paise;
        }

        if (!orderId) {
          throw new Error("Unable to create slot reservation. Please try again.");
        }

        const newOrder = {
          order_id: orderId,
          expires_at: expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          total_paise: totalPaise,
        };
        setOrder(newOrder);
        setPhase("paying");

        try {
          localStorage.setItem(
            ACTIVE_SESSION_STORAGE_KEY,
            JSON.stringify({
              ...newOrder,
              team_name: team,
              phase: "paying",
              event_ids: events.map((e) => e.id),
            })
          );
        } catch {}

        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err: unknown) {
        setSubmitError(extractErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
    },
    [events, submitting]
  );

  const handleUtrSubmitted = useCallback((utr: string) => {
    setSubmittedUtr(utr);
    setPhase("pending_verification");
    try {
      const saved = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : {};
      localStorage.setItem(
        ACTIVE_SESSION_STORAGE_KEY,
        JSON.stringify({ ...parsed, utr, phase: "pending_verification" })
      );
    } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handlePaymentApproved = useCallback(() => {
    setPhase("confirmed");
    try {
      const saved = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : {};
      localStorage.setItem(
        ACTIVE_SESSION_STORAGE_KEY,
        JSON.stringify({ ...parsed, phase: "confirmed" })
      );
    } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleBack = useCallback(() => {
    setPhase("details");
    setOrder(null);
    setSubmittedUtr("");
    setSubmitError(null);
    try {
      localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    } catch {}
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
                onSubmitted={handleUtrSubmitted}
                onBack={handleBack}
              />
            )}

            {phase === "pending_verification" && order && (
              <PhasePendingVerification
                utr={submittedUtr}
                orderId={order.order_id}
                events={events}
                teamName={teamName}
                onApproved={handlePaymentApproved}
              />
            )}

            {phase === "confirmed" && (
              <PhaseCSuccess
                utr={submittedUtr}
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
