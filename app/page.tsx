"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type EventRow = {
  id: string;
  kind: "scrim" | "tournament" | "league";
  title: string;
  mode: string | null;
  maps: string[];
  starts_at: string;
  entry_fee_paise: number;
  early_bird_fee_paise: number | null;
  early_bird_slots: number | null;
  prize_pool_paise: number;
  max_slots: number;
  filled_slots: number;
  idp_times: string | null;
  start_times: string | null;
  is_published?: boolean;
  status: string;
  prize_distribution?: {
    first?: number;
    second?: number;
    third?: number;
    fourth?: number;
  } | null;
};

type PublicReg = {
  event_id: string;
  team_name: string;
  masked_whatsapp: string;
  status: string;
  created_at: string;
};

type FilterKind = "all" | "scrim" | "tournament" | "league";
type SortMode = "soon" | "prize_desc" | "fee_asc";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const rupees = (p: number) =>
  "₹" + Math.round(p / 100).toLocaleString("en-IN");

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

function slotState(maxSlots: number, realFilled: number, startsAt?: string, status?: string, clientNow?: number) {
  const isStarted = startsAt && clientNow ? new Date(startsAt).getTime() <= clientNow : false;
  const isLive = status === "live" || isStarted;

  if (status === "completed") return { label: "COMPLETED", color: "#6b7280", left: 0, closed: true };
  if (status === "cancelled") return { label: "CANCELLED", color: "#ef4444", left: 0, closed: true };
  if (isLive) return { label: "🔴 LIVE NOW", color: "#38bdf8", left: 0, closed: true };

  const left = maxSlots - realFilled;
  if (left <= 0) return { label: "FULL · SOLD OUT", color: "#ef4444", left: 0, closed: true };
  if (left <= 3) return { label: `LAST ${left} SLOTS`, color: "#f59e0b", left, closed: false };
  if (realFilled / maxSlots >= 0.7)
    return { label: "FILLING FAST", color: "#f59e0b", left, closed: false };
  return { label: "OPEN", color: "#10b981", left, closed: false };
}

function calculateDefaultPrizes(totalRupees: number) {
  if (totalRupees <= 0) return { first: 0, second: 0, third: 0, fourth: 0 };
  if (totalRupees === 600) {
    return { first: 350, second: 150, third: 70, fourth: 30 };
  }
  if (totalRupees === 1000) {
    return { first: 550, second: 250, third: 130, fourth: 70 };
  }
  if (totalRupees === 1200) {
    return { first: 650, second: 320, third: 150, fourth: 80 };
  }
  if (totalRupees === 1500) {
    return { first: 800, second: 400, third: 200, fourth: 100 };
  }
  if (totalRupees === 20000) {
    return { first: 10000, second: 5000, third: 3000, fourth: 2000 };
  }
  const first = Math.round(totalRupees * 0.55);
  const second = Math.round(totalRupees * 0.25);
  const third = Math.round(totalRupees * 0.12);
  const fourth = Math.max(0, totalRupees - first - second - third);
  return { first, second, third, fourth };
}

// ─────────────────────────────────────────────────────────────────────────────
// Design constants
// ─────────────────────────────────────────────────────────────────────────────

const KIND_CONFIG: Record<
  string,
  { label: string; cls: string }
> = {
  scrim: {
    label: "SCRIM",
    cls: "text-sky-400 bg-sky-500/10 border-sky-500/30",
  },
  tournament: {
    label: "TOURNAMENT",
    cls: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  },
  league: {
    label: "LEAGUE",
    cls: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  },
};

const MAP_COLORS: Record<string, string> = {
  Erangel: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  Miramar: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  Rondo: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  Sanhok: "text-sky-400 bg-sky-500/10 border-sky-500/30",
  Livik: "text-pink-400 bg-pink-500/10 border-pink-500/30",
  Vikendi: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-[#0E1118] p-5">
      <div className="flex justify-between gap-3">
        <div className="flex flex-col gap-2 flex-1">
          <div className="h-3 w-20 rounded skeleton" />
          <div className="h-4 w-3/4 rounded skeleton" />
          <div className="h-3 w-1/3 rounded skeleton" />
        </div>
        <div className="h-5 w-16 rounded-full skeleton shrink-0" />
      </div>
      <div className="flex gap-2">
        <div className="h-5 w-16 rounded-md skeleton" />
        <div className="h-5 w-16 rounded-md skeleton" />
      </div>
      <div className="h-14 rounded-xl skeleton" />
      <div className="h-2 rounded-full skeleton" />
      <div className="h-11 rounded-xl skeleton" />
    </div>
  );
}

function IDPBox({
  idpTimes,
  startTimes,
  title,
}: {
  idpTimes: string | null;
  startTimes: string | null;
  title?: string;
}) {
  const lobbyTag = title?.match(/\b(L[1-9][0-9]?)\b/i)?.[1]?.toUpperCase() || "Lobby";
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#080B11] p-3 space-y-2 text-xs font-mono">
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-1.5 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1 font-sans">
          <span>⚡</span>
          <span>3 Matches · 3 Room IDPs</span>
        </span>
        <span className="text-[10px] text-white/50 font-semibold flex items-center gap-1 font-sans">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 glow-pulse" />
          {lobbyTag} Group
        </span>
      </div>
      {idpTimes && (
        <div className="flex items-center gap-2.5">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-sky-500/15 text-sky-400 border border-sky-500/30 shrink-0">
            IDP
          </span>
          <span className="text-white/80 font-medium truncate">{idpTimes}</span>
        </div>
      )}
      {startTimes && (
        <div className="flex items-center gap-2.5">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
            START
          </span>
          <span className="text-white/80 font-medium truncate">{startTimes}</span>
        </div>
      )}
      <div className="pt-1 flex items-start gap-1.5 text-[10px] text-emerald-400/90 font-sans leading-relaxed">
        <span className="text-emerald-400 font-bold">📲</span>
        <span>
          Host provides dedicated <strong>{lobbyTag} WhatsApp Group</strong> link &amp; drops IDP 15m before each match.
        </span>
      </div>
    </div>
  );
}

function PrizeModal({
  event,
  onClose,
  onJoin,
}: {
  event: EventRow;
  onClose: () => void;
  onJoin: () => void;
}) {
  const totalRupees = Math.round(event.prize_pool_paise / 100);
  const dist = event.prize_distribution || calculateDefaultPrizes(totalRupees);
  const first = dist.first ?? Math.round(totalRupees * 0.55);
  const second = dist.second ?? Math.round(totalRupees * 0.25);
  const third = dist.third ?? Math.round(totalRupees * 0.12);
  const fourth = dist.fourth ?? Math.max(0, totalRupees - first - second - third);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[88vh] overflow-y-auto no-scrollbar bg-[#0D111A] border border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 mb-1.5">
              <span>🏆 OFFICIAL PRIZE POOL</span>
            </div>
            <h3 className="text-xl font-black text-white">{event.title}</h3>
            <p className="text-xs text-white/50 mt-0.5">Top 4 Squad Payout Breakdown</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Total Prize Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-emerald-500/20 via-teal-500/10 to-transparent border border-emerald-500/40 p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">Total Guaranteed Pool</p>
            <p className="text-3xl font-black text-emerald-300 font-mono tracking-tight">₹{totalRupees.toLocaleString("en-IN")}</p>
          </div>
          <span className="text-4xl">💰</span>
        </div>

        {/* Top 4 Cards Grid */}
        <div className="space-y-2.5">
          {/* 1st Place */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent border border-amber-500/40">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-300 font-black text-base flex items-center justify-center border border-amber-500/40 shadow-inner">
                🥇
              </span>
              <div>
                <p className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span>#1 Champion</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-300 font-bold">WINNER</span>
                </p>
                <p className="text-[10px] text-white/40">Winner Trophy + Direct UPI Transfer</p>
              </div>
            </div>
            <span className="text-xl font-black font-mono text-amber-300">
              ₹{first.toLocaleString("en-IN")}
            </span>
          </div>

          {/* 2nd Place */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-slate-400/20">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-xl bg-slate-400/20 text-slate-200 font-black text-sm flex items-center justify-center border border-slate-400/30">
                🥈
              </span>
              <div>
                <p className="text-xs font-bold text-white uppercase tracking-wider">#2 Runner-Up</p>
                <p className="text-[10px] text-white/40">2nd Position Payout</p>
              </div>
            </div>
            <span className="text-base font-black font-mono text-slate-200">
              ₹{second.toLocaleString("en-IN")}
            </span>
          </div>

          {/* 3rd Place */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-orange-500/20">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-xl bg-orange-500/20 text-orange-300 font-black text-sm flex items-center justify-center border border-orange-500/30">
                🥉
              </span>
              <div>
                <p className="text-xs font-bold text-white uppercase tracking-wider">#3 3rd Place</p>
                <p className="text-[10px] text-white/40">3rd Position Payout</p>
              </div>
            </div>
            <span className="text-base font-black font-mono text-orange-300">
              ₹{third.toLocaleString("en-IN")}
            </span>
          </div>

          {/* 4th Place */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-emerald-500/20">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-300 font-black text-sm flex items-center justify-center border border-emerald-500/30">
                🏅
              </span>
              <div>
                <p className="text-xs font-bold text-white uppercase tracking-wider">#4 4th Place</p>
                <p className="text-[10px] text-white/40">4th Position Payout</p>
              </div>
            </div>
            <span className="text-base font-black font-mono text-emerald-300">
              ₹{fourth.toLocaleString("en-IN")}
            </span>
          </div>
        </div>

        {/* Verification and payout note */}
        <div className="rounded-xl bg-black/40 border border-white/[0.06] p-3 text-[11px] text-white/50 leading-relaxed flex items-start gap-2">
          <span className="text-emerald-400 mt-0.5">⚡</span>
          <span>
            Prizes are disbursed directly to the winning team captain's UPI ID within <strong>30 minutes</strong> of match completion with official screenshot verification.
          </span>
        </div>

        {/* CTA Button */}
        <button
          onClick={() => {
            onClose();
            onJoin();
          }}
          className="w-full py-3.5 rounded-xl bg-emerald-500 text-black font-extrabold text-sm hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-900/30"
        >
          Claim Slot &amp; Compete for ₹{totalRupees.toLocaleString("en-IN")}
        </button>
      </div>
    </div>
  );
}

function TeamRoster({
  eventId,
  regs,
}: {
  eventId: string;
  regs: PublicReg[];
}) {
  const [open, setOpen] = useState(false);
  const eventRegs = regs.filter((r) => r.event_id === eventId);

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white/70 hover:text-white hover:bg-white/[0.03] transition-colors"
      >
        <span className="flex items-center gap-2">
          <span>👥</span>
          <span>Registered Teams ({eventRegs.length})</span>
        </span>
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] max-h-48 overflow-y-auto">
          {eventRegs.length === 0 ? (
            <p className="px-4 py-3 text-xs text-white/30 italic">
              No teams registered yet. Be the first!
            </p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {eventRegs.map((r, i) => (
                <div
                  key={r.created_at + i}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-white/30 w-6 shrink-0">#{i + 1}</span>
                    <span className="font-medium truncate">{r.team_name}</span>
                    <span className="text-white/30 font-mono shrink-0">
                      {r.masked_whatsapp}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      r.status === "confirmed"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {r.status === "confirmed" ? "LOCKED" : "HOLD"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({
  e,
  selected,
  onToggle,
  onViewPrize,
  regs,
  clientNow,
}: {
  e: EventRow;
  selected: boolean;
  onToggle: () => void;
  onViewPrize: (e: EventRow) => void;
  regs: PublicReg[];
  clientNow: number;
}) {
  const eventRegs = regs.filter((r) => r.event_id === e.id);
  const confirmedCount = eventRegs.filter((r) => r.status === "confirmed").length;
  const pendingCount = eventRegs.filter((r) => r.status === "pending_payment").length;

  // Real team count calculated strictly from actual live registrations (no dummy data)
  const realFilled = confirmedCount + pendingCount;
  const slotsLeft = Math.max(0, e.max_slots - realFilled);
  const s = slotState(e.max_slots, realFilled, e.starts_at, e.status, clientNow);
  const pct = Math.min(100, Math.round((realFilled / e.max_slots) * 100));

  const earlyBirdRemaining =
    e.early_bird_slots != null
      ? Math.max(0, e.early_bird_slots - confirmedCount)
      : null;
  const showEarlyBird =
    e.early_bird_fee_paise != null &&
    earlyBirdRemaining != null &&
    earlyBirdRemaining > 0;

  const effectiveFee = showEarlyBird
    ? e.early_bird_fee_paise!
    : e.entry_fee_paise;

  const kc = KIND_CONFIG[e.kind] ?? KIND_CONFIG.scrim;

  return (
    <div
      className={`flex flex-col gap-3.5 sm:gap-4 rounded-2xl border bg-[#0E1118] p-4 sm:p-5 transition-all duration-200 ${
        selected
          ? "border-emerald-400 shadow-lg shadow-emerald-900/20"
          : "border-white/[0.08] hover:border-white/[0.15] hover:scale-[1.01]"
      }`}
    >
      {/* ── Early Bird Banner ── */}
      {showEarlyBird && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-400 font-medium -mb-1">
          <span>🐦</span>
          <span>
            Early Bird {rupees(e.early_bird_fee_paise!)} · {earlyBirdRemaining}{" "}
            {earlyBirdRemaining === 1 ? "slot" : "slots"} left, then{" "}
            {rupees(e.entry_fee_paise)}
          </span>
        </div>
      )}

      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider ${kc.cls}`}
            >
              {kc.label}
            </span>
            {e.mode && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50 font-medium uppercase">
                {e.mode}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold leading-tight">{e.title}</h3>
          <p className="text-xs text-white/40 mt-0.5">{when(e.starts_at)} IST</p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider"
          style={{
            color: s.color,
            border: `1px solid ${s.color}44`,
            background: `${s.color}18`,
          }}
        >
          {s.label}
        </span>
      </div>

      {/* ── Map badges ── */}
      {e.maps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {e.maps.map((m) => (
            <span
              key={m}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                MAP_COLORS[m] ?? "text-white/50 bg-white/5 border-white/10"
              }`}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      {/* ── IDP & Start Time box ── */}
      <IDPBox idpTimes={e.idp_times} startTimes={e.start_times} title={e.title} />

      {/* ── Prize / fee with Clickable Prize Pool ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onViewPrize(e);
          }}
          className="group rounded-2xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent border border-emerald-500/30 p-3 sm:p-3.5 text-left hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-900/20 transition-all cursor-pointer relative overflow-hidden"
          title="Click to view Top 4 Prize Distribution"
        >
          <div className="flex items-center justify-between text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-1">
            <span className="flex items-center gap-1">
              <span>🏆</span> PRIZE POOL
            </span>
            <span className="text-[9px] underline group-hover:text-emerald-300 font-semibold text-emerald-400/90">
              Top 4 ↗
            </span>
          </div>
          <p className="text-lg sm:text-xl font-black text-emerald-300 font-mono tracking-tight group-hover:text-emerald-200">
            {rupees(e.prize_pool_paise)}
          </p>
          <p className="text-[10px] text-white/40 mt-0.5">Click for Top 4 Payouts</p>
        </button>

        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-3 sm:p-3.5 flex flex-col justify-between">
          <span className="text-[10px] text-white/40 uppercase tracking-wider font-bold">
            ENTRY FEE
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <p
              className={`text-lg sm:text-xl font-black font-mono ${
                showEarlyBird ? "text-amber-400" : "text-white"
              }`}
            >
              {effectiveFee === 0 ? "Free" : rupees(effectiveFee)}
            </p>
            {showEarlyBird && e.entry_fee_paise > 0 && (
              <p className="text-xs text-white/30 line-through">
                {rupees(e.entry_fee_paise)}
              </p>
            )}
          </div>
          <p className="text-[10px] text-white/40">per squad</p>
        </div>
      </div>

      {/* ── Real-Time Squad Progress ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-extrabold text-white text-sm">
              {realFilled}
            </span>
            <span className="text-white/40">/ {e.max_slots} squads</span>
            {pendingCount > 0 && (
              <span className="text-[10px] text-amber-400 font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                {confirmedCount} locked · {pendingCount} in checkout
              </span>
            )}
          </div>
          {slotsLeft > 0 ? (
            <span className="font-bold text-xs" style={{ color: s.color }}>
              {slotsLeft} slots left
            </span>
          ) : (
            <span className="text-red-400 font-bold text-xs uppercase tracking-wider">
              Sold out
            </span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: s.color }}
          />
        </div>
      </div>

      {/* ── Registered Teams accordion ── */}
      <TeamRoster eventId={e.id} regs={regs} />

      {/* ── CTA ── */}
      {s.closed ? (
        <span className="mt-auto rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3 min-h-[44px] flex items-center justify-center text-center text-xs font-bold uppercase tracking-wider text-white/50">
          {s.label === "🔴 LIVE NOW"
            ? "🔴 Match In Progress · Closed"
            : s.label === "COMPLETED"
            ? "🏁 Match Completed"
            : s.label === "CANCELLED"
            ? "❌ Match Cancelled"
            : "🚫 Slots Full · Sold Out"}
        </span>
      ) : (
        <button
          onClick={onToggle}
          className={`mt-auto rounded-xl px-4 py-3 min-h-[44px] flex items-center justify-center text-sm font-semibold transition-all duration-150 ${
            selected
              ? "bg-emerald-500 text-black hover:bg-emerald-400 shadow-md shadow-emerald-900/30"
              : "border border-white/[0.12] hover:bg-white/5 hover:border-white/20 text-white"
          }`}
        >
          {selected ? "✓  Selected" : "Select Lobby"}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [regs, setRegs] = useState<PublicReg[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [sort, setSort] = useState<SortMode>("soon");
  const [search, setSearch] = useState("");
  const [prizeModalEvent, setPrizeModalEvent] = useState<EventRow | null>(null);
  const [clientNow, setClientNow] = useState<number>(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const checkoutRef = useRef<HTMLDivElement>(null);

  // ── Auth state & Client Time ──
  useEffect(() => {
    setClientNow(Date.now());
    async function checkAuthUser(u: { id: string; email?: string | null } | null) {
      if (!u) {
        setUserEmail(null);
        setIsAdmin(false);
        return;
      }
      setUserEmail(u.email ?? null);
      const { data: roles } = await supabase
        .from("admin_roles")
        .select("role")
        .eq("user_id", u.id);
      setIsAdmin((roles && roles.length > 0) ?? false);
    }

    supabase.auth.getUser().then(({ data }) => checkAuthUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_ev, session) => checkAuthUser(session?.user ?? null)
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Load events (published and active only) ──
  const loadEvents = useCallback(async () => {
    try {
      await supabase.rpc("auto_update_lobby_statuses");
    } catch {
      // ignore
    }
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("starts_at", { ascending: true });
    if (error) setErr(error.message);
    else {
      setErr(null);
      // Filter out unpublished lobbies: only show is_published !== false and status in ('open', 'live')
      const published = ((data as EventRow[]) || []).filter(
        (e) => e.is_published !== false && (e.status === "open" || e.status === "live")
      );
      setEvents(published);
    }
  }, []);

  // ── Load public registrations (with fallback to direct query) ──
  const loadRegs = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_public_registrations");
      if (!error && data && Array.isArray(data)) {
        setRegs(data as PublicReg[]);
        return;
      }
      // Fallback direct query if RPC is not created yet
      const { data: directData } = await supabase
        .from("registrations")
        .select("event_id, team_name, whatsapp, status, created_at");
      if (directData) {
        setRegs(
          directData.map((r: { event_id: string; team_name: string; whatsapp: string | null; status: string; created_at: string }) => ({
            event_id: r.event_id,
            team_name: r.team_name,
            masked_whatsapp: r.whatsapp ? r.whatsapp.slice(0, 3) + "••••" + r.whatsapp.slice(-3) : "",
            status: r.status,
            created_at: r.created_at,
          }))
        );
      }
    } catch {
      // Ignore fallback errors
    }
  }, []);

  useEffect(() => {
    loadEvents();
    loadRegs();
    // Real-time synchronization listening on BOTH events AND registrations tables
    const ch = supabase
      .channel("apex-realtime-public-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => {
          loadEvents();
          loadRegs();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "registrations" },
        () => {
          loadEvents();
          loadRegs();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadEvents, loadRegs]);

  // ── Derived data ──
  const filtered = (events ?? []).filter((e) => {
    if (filter !== "all" && e.kind !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        (e.mode ?? "").toLowerCase().includes(q) ||
        e.maps.some((m) => m.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "prize_desc")
      return b.prize_pool_paise - a.prize_pool_paise;
    if (sort === "fee_asc")
      return a.entry_fee_paise - b.entry_fee_paise;
    return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
  });

  const scrims = sorted.filter((e) => e.kind !== "league");
  const leagues = sorted.filter((e) => e.kind === "league");

  const totalLocked = regs.filter((r) => r.status === "confirmed").length;
  const totalHeld = regs.filter((r) => r.status === "pending_payment").length;

  // Strip picks that became full, closed, or started based on real active team count & match timing
  const sel = picked.filter((id) =>
    (events ?? []).some((e) => {
      if (e.id !== id) return false;
      const count = regs.filter((r) => r.event_id === e.id).length;
      const isStarted = clientNow > 0 && new Date(e.starts_at).getTime() <= clientNow;
      const isClosed = e.status !== "open" || isStarted || e.max_slots - count <= 0;
      return !isClosed;
    })
  );
  const totalFee = (events ?? [])
    .filter((e) => sel.includes(e.id))
    .reduce((s, e) => {
      const confirmedForEvent = regs.filter(
        (r) => r.event_id === e.id && r.status === "confirmed"
      ).length;
      const earlyRemaining = e.early_bird_slots != null
        ? Math.max(0, e.early_bird_slots - confirmedForEvent)
        : 0;
      const fee =
        e.early_bird_fee_paise != null && earlyRemaining > 0
          ? e.early_bird_fee_paise
          : e.entry_fee_paise;
      return s + fee;
    }, 0);

  function toggle(id: string) {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 10) return cur;
      return [...cur, id];
    });
  }

  const FILTERS: { key: FilterKind; label: string }[] = [
    { key: "all", label: "All" },
    { key: "scrim", label: "Daily Scrims" },
    { key: "tournament", label: "Tournaments" },
    { key: "league", label: "Major Leagues" },
  ];

  const orgParts = ORG_NAME.split(" ");
  const orgFirst = orgParts[0];
  const orgRest = orgParts.slice(1).join(" ");

  // Total prize pool across all open events
  const totalPrize = (events ?? []).reduce(
    (s, e) => s + e.prize_pool_paise,
    0
  );

  return (
    <div
      className="min-h-screen bg-[#06070B] text-white pb-24 sm:pb-12"
    >
      {/* ── Fixed background layers ── */}
      <div
        className="fixed inset-0 pointer-events-none tactical-grid"
        aria-hidden="true"
      />
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 left-1/4 w-[600px] h-[600px] bg-emerald-500/[0.04] rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-purple-600/[0.04] rounded-full blur-3xl" />
      </div>

      {/* ── Sticky Navbar ── */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#06070B]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3.5 sm:px-6 py-3 sm:py-4 gap-2 sm:gap-4">
          <a href="/" className="flex items-center gap-1.5 text-base sm:text-xl font-extrabold tracking-widest shrink-0">
            <span>{orgFirst}</span>{" "}
            <span className="text-emerald-400">{orgRest}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 glow-pulse sm:hidden" />
          </a>

          {/* Desktop navigation */}
          <nav className="hidden sm:flex items-center gap-5 text-sm text-white/60">
            <a href="#scrims" className="hover:text-white transition-colors">
              Scrims
            </a>
            <a href="#leagues" className="hover:text-white transition-colors">
              Leagues
            </a>
            <a
              href="/my-tournaments"
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <span>🔑</span>
              <span>Room ID &amp; Password</span>
            </a>
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Quick mobile Room ID badge */}
            <a
              href="/my-tournaments"
              className="sm:hidden inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all"
            >
              <span>🔑</span>
              <span>Room ID</span>
            </a>

            {isAdmin && (
              <a
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs font-bold text-amber-400 hover:bg-amber-500/25 transition-all shadow-sm"
              >
                <span>⚡</span>
                <span className="hidden sm:inline">Admin Panel</span>
              </a>
            )}

            {userEmail ? (
              <div className="flex items-center gap-2">
                <a
                  href="/profile"
                  className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400 font-medium hover:bg-emerald-500/20 transition-colors hidden sm:inline-flex max-w-[160px] truncate"
                  title="My Bookings & Profile"
                >
                  {userEmail}
                </a>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut();
                    window.location.reload();
                  }}
                  className="text-xs text-white/40 hover:text-white transition-colors hidden sm:inline"
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <a
                href="/login"
                className="rounded-lg bg-emerald-500 px-3 sm:px-4 py-1 sm:py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition-colors hidden sm:inline-block"
              >
                Sign in
              </a>
            )}

            {/* Mobile Hamburger toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="sm:hidden rounded-xl border border-white/10 bg-white/[0.04] p-1.5 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Open navigation menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Slide-over Mobile Navigation Drawer ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="fixed inset-0"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-full max-w-[280px] h-full bg-[#0A0D14] border-l border-white/[0.08] p-5 shadow-2xl flex flex-col justify-between overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-200 z-10">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
                <div>
                  <span className="text-base font-black tracking-wider uppercase text-white">
                    {orgFirst} <span className="text-emerald-400">{orgRest}</span>
                  </span>
                  <p className="text-[10px] text-white/40">Player &amp; Host Portal</p>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-full w-7 h-7 flex items-center justify-center bg-white/5 text-white/60 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Navigation links */}
              <nav className="flex flex-col gap-1 pt-4">
                <a
                  href="#scrims"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-sm font-semibold text-white/80 hover:text-white transition-colors"
                >
                  <span className="text-base">🎮</span>
                  <span>Daily Scrims</span>
                </a>
                <a
                  href="#leagues"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-sm font-semibold text-white/80 hover:text-white transition-colors"
                >
                  <span className="text-base">🏆</span>
                  <span>Major Leagues</span>
                </a>
                <a
                  href="/my-tournaments"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 text-sm font-semibold text-emerald-400 transition-colors"
                >
                  <span className="text-base">🔑</span>
                  <span>Room ID &amp; Password</span>
                </a>
                <a
                  href="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-sm font-semibold text-white/80 hover:text-white transition-colors"
                >
                  <span className="text-base">📋</span>
                  <span>My Bookings</span>
                </a>
                <a
                  href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-sm font-semibold text-green-400 hover:text-green-300 transition-colors"
                >
                  <span className="text-base">💬</span>
                  <span>WhatsApp Support</span>
                </a>
                {isAdmin && (
                  <a
                    href="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm font-semibold text-amber-400 transition-colors"
                  >
                    <span className="text-base">⚡</span>
                    <span>Admin Dashboard</span>
                  </a>
                )}
              </nav>
            </div>

            {/* Bottom Account Controls */}
            <div className="pt-4 border-t border-white/[0.08]">
              {userEmail ? (
                <div className="space-y-2.5">
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2.5">
                    <p className="text-[10px] uppercase font-bold text-emerald-400">Signed In</p>
                    <p className="text-xs font-semibold text-white truncate mt-0.5">{userEmail}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await supabase.auth.signOut();
                      window.location.reload();
                    }}
                    className="w-full py-2 rounded-xl border border-white/15 text-xs font-semibold text-white/50 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <a
                  href="/login"
                  className="w-full py-2.5 rounded-xl bg-emerald-500 text-black font-extrabold text-xs flex items-center justify-center gap-2 hover:bg-emerald-400 transition-colors shadow-md shadow-emerald-900/30"
                >
                  Sign In / Create Account →
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="relative mx-auto max-w-6xl px-3.5 sm:px-6">
        {/* ── Hero ── */}
        <section className="pt-5 pb-6 sm:py-20">
          {/* Live squad counter based on real registrations */}
          <div className="mb-3 sm:mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-3 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 glow-pulse shrink-0" />
            {totalLocked > 0 ? (
              <span>
                <strong>{totalLocked}</strong> squads locked in today
                {totalHeld > 0 && (
                  <span className="text-white/50 text-[10px] sm:text-xs">
                    {" "}· {totalHeld} holding slots
                  </span>
                )}
              </span>
            ) : (
              <span>
                Daily Scrims &amp; Tournaments Open · Claim Slot #1
              </span>
            )}
          </div>

          <h1 className="max-w-2xl text-2xl sm:text-6xl font-black leading-tight sm:leading-[1.1] tracking-tight">
            Your next lobby{" "}
            <span className="text-emerald-400">is waiting.</span>
          </h1>
          <p className="mt-2 sm:mt-5 max-w-xl text-xs sm:text-lg text-white/50 leading-relaxed">
            Daily scrims, tournaments and leagues with real cash prizes.
            Book a slot in under a minute.
          </p>

          <div className="mt-4 sm:mt-8 flex flex-wrap gap-2.5 sm:gap-3">
            <a
              href="#scrims"
              className="rounded-xl bg-emerald-500 px-4 sm:px-6 py-2.5 sm:py-3 font-semibold text-black hover:bg-emerald-400 transition-colors text-xs sm:text-base shadow-md shadow-emerald-900/20"
            >
              Browse Scrims
            </a>
            <a
              href="#leagues"
              className="rounded-xl border border-white/15 px-4 sm:px-6 py-2.5 sm:py-3 font-semibold hover:bg-white/5 transition-colors text-xs sm:text-base"
            >
              View Leagues
            </a>
            <a
              href="/my-tournaments"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 sm:px-5 py-2.5 sm:py-3 font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors text-xs sm:text-base flex items-center gap-1.5"
            >
              <span>🔑</span>
              <span>Room ID &amp; Password</span>
            </a>
          </div>

          {/* Quick stats grid: 2 columns on mobile, 4 on desktop */}
          {events && events.length > 0 && (
            <div className="mt-5 sm:mt-10 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
              {[
                { label: "Active Lobbies", value: events.length.toString(), icon: "🎮" },
                {
                  label: "Squads Locked",
                  value: totalLocked.toString(),
                  icon: "👥",
                },
                {
                  label: "Total Prize Pool",
                  value: rupees(totalPrize),
                  icon: "💰",
                },
                {
                  label: "Entry From",
                  value:
                    events.some((e) => e.entry_fee_paise === 0)
                      ? "Free"
                      : rupees(
                          Math.min(...events.map((e) => e.entry_fee_paise))
                        ),
                  icon: "⚡",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2.5 sm:p-4 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between text-white/40 mb-1">
                    <span className="text-[10px] sm:text-xs uppercase font-bold tracking-wider">{stat.label}</span>
                    <span className="text-xs sm:text-sm">{stat.icon}</span>
                  </div>
                  <p className="text-lg sm:text-2xl font-black text-white font-mono">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Error banner ── */}
        {err && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load events: {err}
          </div>
        )}

        {/* ── Filter & Search Bar ── */}
        <div className="mb-6 sm:mb-8 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Filter tabs with smooth mobile horizontal swipe */}
          <div className="flex gap-1.5 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-x-auto no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-xl px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold transition-all duration-150 ${
                  filter === f.key
                    ? "bg-emerald-500 text-black shadow-md shadow-emerald-900/20"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search + Sort side-by-side on mobile */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-52">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search lobbies…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-[#0E1118] pl-9 pr-3 py-2 text-xs sm:text-sm outline-none focus:border-emerald-500 transition-colors placeholder:text-white/25"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="rounded-xl border border-white/[0.08] bg-[#0E1118] px-2.5 sm:px-3 py-2 text-xs sm:text-sm outline-none focus:border-emerald-500 transition-colors text-white/70 shrink-0"
            >
              <option value="soon">Starting Soon</option>
              <option value="prize_desc">Prize: High → Low</option>
              <option value="fee_asc">Entry: Low → High</option>
            </select>
          </div>
        </div>

        {/* ── Scrims Section ── */}
        <section id="scrims" className="scroll-mt-24 pb-16">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl sm:text-2xl font-bold">Daily Scrims</h2>
            {events && scrims.length > 0 && (
              <span className="text-sm text-white/30 font-medium">
                {scrims.length} open
              </span>
            )}
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {!events && !err
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)
              : scrims.map((e) => (
                  <EventCard
                    key={e.id}
                    e={e}
                    selected={sel.includes(e.id)}
                    onToggle={() => toggle(e.id)}
                    onViewPrize={setPrizeModalEvent}
                    regs={regs}
                    clientNow={clientNow}
                  />
                ))}
          </div>
          {events && scrims.length === 0 && (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">🎮</p>
              <p className="text-white/40 text-sm">
                No open scrims right now — check back soon.
              </p>
            </div>
          )}
        </section>

        {/* ── Leagues Section ── */}
        <section id="leagues" className="scroll-mt-24 pb-16">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl sm:text-2xl font-bold">Major Leagues</h2>
            {events && leagues.length > 0 && (
              <span className="text-sm text-white/30 font-medium">
                {leagues.length} open
              </span>
            )}
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {!events && !err
              ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} />)
              : leagues.map((e) => (
                  <EventCard
                    key={e.id}
                    e={e}
                    selected={sel.includes(e.id)}
                    onToggle={() => toggle(e.id)}
                    onViewPrize={setPrizeModalEvent}
                    regs={regs}
                    clientNow={clientNow}
                  />
                ))}
          </div>
          {events && leagues.length === 0 && (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">🏆</p>
              <p className="text-white/40 text-sm">
                No open leagues right now — check back soon.
              </p>
            </div>
          )}
        </section>

        {/* ── Room Lookup card (above footer) ── */}
        <section className="pb-20">
          <div className="rounded-2xl border border-white/[0.06] bg-[#0E1118] p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div>
              <h3 className="text-lg font-bold mb-1">Already paid?</h3>
              <p className="text-sm text-white/50">
                Enter your 12-digit UTR or WhatsApp number to get your Room ID,
                Password &amp; IDP Group Link.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <a
                href="/my-tournaments"
                className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black hover:bg-emerald-400 transition-colors whitespace-nowrap"
              >
                Get Room Details →
              </a>
              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/5 transition-colors whitespace-nowrap text-center"
              >
                💬 WhatsApp Support
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06] py-8 text-center text-sm text-white/25 flex flex-col items-center gap-2">
        <p>© 2026 {ORG_NAME}. All rights reserved.</p>
        <div className="flex flex-wrap justify-center gap-4 text-xs text-white/40">
          <a href="/my-tournaments" className="hover:text-white transition-colors">My Tournaments</a>
          <a href="/profile" className="hover:text-white transition-colors">My Bookings</a>
          <a href="/admin" className="hover:text-amber-400 transition-colors">Admin Dashboard</a>
        </div>
      </footer>

      {/* ── Sticky Checkout Dock ── */}
      {sel.length > 0 && (
        <div
          ref={checkoutRef}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-emerald-500/30 bg-[#0E1118]/98 backdrop-blur-xl slide-up shadow-2xl"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3.5 sm:px-6 py-3 sm:py-4">
            <div className="min-w-0">
              <p className="font-extrabold text-xs sm:text-base truncate">
                {sel.length}{" "}
                {sel.length === 1 ? "lobby" : "lobbies"} selected
              </p>
              <p className="text-[11px] sm:text-sm text-white/50 truncate">
                Total:{" "}
                <span className="font-bold text-emerald-400 font-mono">
                  {totalFee === 0 ? "Free" : rupees(totalFee)}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setPicked([])}
                className="rounded-xl border border-white/15 px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold hover:bg-white/5 transition-colors"
              >
                Clear
              </button>
              <a
                href={"/register?e=" + sel.join(",")}
                className="rounded-xl bg-emerald-500 px-3.5 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-extrabold text-black hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-900/40"
              >
                Register &amp; Pay →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Navigation Dock (App Dock) ── */}
      {sel.length === 0 && (
        <nav
          aria-label="Mobile Bottom Navigation"
          className="sm:hidden fixed inset-x-0 bottom-0 z-30 bg-[#090C14]/95 backdrop-blur-xl border-t border-white/[0.08] px-2 py-1.5 flex items-center justify-around shadow-2xl"
        >
          <a
            href="#scrims"
            className="flex flex-col items-center gap-0.5 text-[10px] font-semibold text-white/60 hover:text-emerald-400 py-1 px-3 transition-colors"
          >
            <span className="text-base">🎮</span>
            <span>Scrims</span>
          </a>
          <a
            href="#leagues"
            className="flex flex-col items-center gap-0.5 text-[10px] font-semibold text-white/60 hover:text-emerald-400 py-1 px-3 transition-colors"
          >
            <span className="text-base">🏆</span>
            <span>Leagues</span>
          </a>
          <a
            href="/my-tournaments"
            className="flex flex-col items-center gap-0.5 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 py-1 px-3 transition-colors"
          >
            <span className="text-base">🔑</span>
            <span>Room ID</span>
          </a>
          <a
            href={userEmail ? "/profile" : "/login"}
            className="flex flex-col items-center gap-0.5 text-[10px] font-semibold text-white/60 hover:text-white py-1 px-3 transition-colors"
          >
            <span className="text-base">👤</span>
            <span>{userEmail ? "Account" : "Sign In"}</span>
          </a>
        </nav>
      )}

      {/* ── Top 4 Prize Distribution Modal ── */}
      {prizeModalEvent && (
        <PrizeModal
          event={prizeModalEvent}
          onClose={() => setPrizeModalEvent(null)}
          onJoin={() => {
            toggle(prizeModalEvent.id);
            setPrizeModalEvent(null);
          }}
        />
      )}
    </div>
  );
}
