"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { extractLobbyLabel } from "@/lib/matchIdp";
import { PublicPointsTableModal } from "@/components/PublicPointsTableModal";

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
  whatsapp_group_link?: string | null;
  top_teams?: {
    first?: string;
    second?: string;
    third?: string;
    fourth?: string;
  } | null;
  final_points_table_url?: string | null;
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
  slot_number?: number;
  is_slot_list_published?: boolean;
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

function parseMatch3IdpTime(startsAt?: string, idpTimes?: string | null): number | null {
  if (!startsAt || !idpTimes) return null;
  const parts = idpTimes.split("|").map((s) => s.trim());
  if (parts.length >= 3) {
    const m3Str = parts[2];
    const match = m3Str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const meridiem = match[3]?.toUpperCase();
      if (meridiem === "PM" && hours < 12) hours += 12;
      if (meridiem === "AM" && hours === 12) hours = 0;

      const d = new Date(startsAt);
      d.setHours(hours, minutes, 0, 0);
      return d.getTime();
    }
  }
  return null;
}

function slotState(
  maxSlots: number,
  realFilled: number,
  startsAt?: string,
  status?: string,
  clientNow?: number,
  idpTimes?: string | null
) {
  if (status === "completed") return { label: "COMPLETED", color: "#64748B", bg: "#F1F5F9", left: 0, closed: true };
  if (status === "cancelled") return { label: "CANCELLED", color: "#DC2626", bg: "#FEE2E2", left: 0, closed: true };

  const startTimeMs = startsAt ? new Date(startsAt).getTime() : 0;
  const isStarted = startTimeMs > 0 && clientNow ? startTimeMs <= clientNow : false;

  // Rule: Match 3 IDP is released ~60m after lobby start (or exact Match 3 IDP time).
  // Exactly 20 minutes after Match 3 IDP, the lobby automatically closes & status changes from "LIVE NOW" to "COMPLETED"!
  const m3IdpTimeMs = parseMatch3IdpTime(startsAt, idpTimes);
  const isConcluded =
    (m3IdpTimeMs && clientNow ? clientNow >= m3IdpTimeMs + (20 * 60 * 1000) : false) ||
    (startTimeMs > 0 && clientNow ? clientNow >= startTimeMs + (80 * 60 * 1000) : false);

  if (isConcluded) {
    return { label: "COMPLETED", color: "#64748B", bg: "#F1F5F9", left: 0, closed: true };
  }

  const isLive = status === "live" || isStarted;
  if (isLive) return { label: "🔴 LIVE NOW", color: "#DC2626", bg: "#FEE2E2", left: 0, closed: true };

  const left = maxSlots - realFilled;
  if (left <= 0) return { label: "FULL · SOLD OUT", color: "#64748B", bg: "#F1F5F9", left: 0, closed: true };
  if (left <= 3) return { label: `LAST ${left} SLOTS`, color: "#D97706", bg: "#FEF3C7", left, closed: false };
  if (realFilled / maxSlots >= 0.7)
    return { label: "FILLING FAST", color: "#D97706", bg: "#FEF3C7", left, closed: false };
  return { label: "OPEN", color: "#059669", bg: "#ECFDF5", left, closed: false };
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
// Design constants (Vibrant, high-contrast, clean modern esports palette)
// ─────────────────────────────────────────────────────────────────────────────

const KIND_BADGES: Record<string, { label: string; cls: string }> = {
  scrim: {
    label: "SCRIM",
    cls: "bg-blue-50 text-blue-700 border-blue-200",
  },
  tournament: {
    label: "TOURNAMENT",
    cls: "bg-purple-50 text-purple-700 border-purple-200",
  },
  league: {
    label: "MAJOR LEAGUE",
    cls: "bg-amber-50 text-amber-800 border-amber-300",
  },
};

const MAP_BADGES: Record<string, string> = {
  Erangel: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Miramar: "bg-amber-50 text-amber-800 border-amber-200",
  Rondo: "bg-indigo-50 text-indigo-800 border-indigo-200",
  Sanhok: "bg-sky-50 text-sky-800 border-sky-200",
  Livik: "bg-pink-50 text-pink-800 border-pink-200",
  Vikendi: "bg-cyan-50 text-cyan-800 border-cyan-200",
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-3.5 sm:p-5 shadow-sm w-full min-w-0 max-w-full overflow-hidden">
      <div className="flex justify-between gap-3 min-w-0 w-full">
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="h-3.5 w-24 rounded skeleton" />
          <div className="h-5 w-3/4 rounded skeleton" />
          <div className="h-3.5 w-1/3 rounded skeleton" />
        </div>
        <div className="h-6 w-20 rounded-full skeleton shrink-0" />
      </div>
      <div className="h-14 rounded-xl skeleton w-full" />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full min-w-0">
        <div className="h-16 rounded-xl skeleton" />
        <div className="h-16 rounded-xl skeleton" />
      </div>
      <div className="h-11 rounded-xl skeleton w-full" />
    </div>
  );
}

/**
 * 3-Match Timetable Schedule Box
 */
function MatchScheduleBox({
  idpTimes,
  startTimes,
  title,
}: {
  idpTimes: string | null;
  startTimes: string | null;
  title: string;
}) {
  const lobbyTag = extractLobbyLabel(title);
  const idp = idpTimes?.trim() || "15m before each match";
  const starts = startTimes?.trim() || "Starting per schedule";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 sm:p-3 space-y-2 min-w-0 w-full overflow-hidden">
      <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-bold text-slate-700 gap-1.5 min-w-0">
        <span className="uppercase tracking-wider flex items-center gap-1.5 min-w-0 truncate">
          <span>🎯</span>
          <span className="truncate">Match Schedule (3 Matches)</span>
        </span>
        <span className="text-[9px] sm:text-[10px] text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded font-mono shrink-0 whitespace-nowrap">
          3 IDPs
        </span>
      </div>

      <div className="grid grid-cols-1 gap-1.5 font-mono text-[10px] sm:text-[11px] min-w-0">
        {/* IDP Times */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 w-full">
          <span className="shrink-0 rounded bg-blue-100 text-blue-800 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-wider whitespace-nowrap">
            IDP
          </span>
          <span className="text-slate-700 truncate font-semibold min-w-0 tracking-tight" title={idp}>
            {idp}
          </span>
        </div>

        {/* Start Times */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 w-full">
          <span className="shrink-0 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-wider whitespace-nowrap">
            START
          </span>
          <span className="text-slate-700 truncate font-semibold min-w-0 tracking-tight" title={starts}>
            {starts}
          </span>
        </div>
      </div>

      {/* Lobby WhatsApp Group Notice */}
      <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-emerald-800 bg-emerald-50/90 border border-emerald-200 rounded-lg px-2 sm:px-2.5 py-1.5 min-w-0 w-full">
        <svg className="w-3.5 h-3.5 fill-[#25D366] shrink-0" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        </svg>
        <span className="truncate min-w-0">
          IDP group link provided for <strong>{lobbyTag}</strong>. Register to get access.
        </span>
      </div>
    </div>
  );
}

/**
 * Top 4 Prize Distribution Modal
 */
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto no-scrollbar bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 mb-1.5">
              <span>🏆 GUARANTEED CASH PRIZES</span>
            </div>
            <h3 className="text-xl font-black text-slate-900">{event.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Top 4 Squad Payout Breakdown</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Total Prize Pool Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-4 text-white flex items-center justify-between shadow-lg shadow-blue-500/20">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-blue-200">
              Total Guaranteed Pool
            </p>
            <p className="text-3xl font-black font-mono tracking-tight text-white">
              ₹{totalRupees.toLocaleString("en-IN")}
            </p>
          </div>
          <span className="text-4xl">💰</span>
        </div>

        {/* Payout breakdown cards */}
        <div className="space-y-2">
          {/* 1st Place */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-50/70 border border-amber-200">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 font-black text-base flex items-center justify-center border border-amber-300">
                🥇
              </span>
              <div>
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span>#1 Champion</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 font-extrabold">
                    WINNER
                  </span>
                </p>
                <p className="text-[10px] text-slate-500">Direct UPI Transfer</p>
              </div>
            </div>
            <span className="text-xl font-black font-mono text-amber-700">
              ₹{first.toLocaleString("en-IN")}
            </span>
          </div>

          {/* 2nd Place */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-slate-200 text-slate-700 font-black text-sm flex items-center justify-center">
                🥈
              </span>
              <div>
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">#2 Runner-Up</p>
                <p className="text-[10px] text-slate-500">2nd Position Payout</p>
              </div>
            </div>
            <span className="text-base font-black font-mono text-slate-800">
              ₹{second.toLocaleString("en-IN")}
            </span>
          </div>

          {/* 3rd Place */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-orange-100 text-orange-800 font-black text-sm flex items-center justify-center">
                🥉
              </span>
              <div>
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">#3 3rd Place</p>
                <p className="text-[10px] text-slate-500">3rd Position Payout</p>
              </div>
            </div>
            <span className="text-base font-black font-mono text-orange-700">
              ₹{third.toLocaleString("en-IN")}
            </span>
          </div>

          {/* 4th Place */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 font-black text-sm flex items-center justify-center">
                🏅
              </span>
              <div>
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">#4 4th Place</p>
                <p className="text-[10px] text-slate-500">4th Position Payout</p>
              </div>
            </div>
            <span className="text-base font-black font-mono text-emerald-700">
              ₹{fourth.toLocaleString("en-IN")}
            </span>
          </div>
        </div>

        {/* Verification notice */}
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-[11px] text-blue-900 leading-relaxed flex items-start gap-2">
          <span className="text-blue-600 mt-0.5">⚡</span>
          <span>
            Prizes are disbursed directly to winning captains via UPI within <strong>30 minutes</strong> of match finish after screenshot verification.
          </span>
        </div>

        {/* CTA Button */}
        <button
          onClick={() => {
            onClose();
            onJoin();
          }}
          className="w-full py-3.5 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-sm transition-all shadow-md shadow-amber-500/20"
        >
          Select Lobby &amp; Compete for ₹{totalRupees.toLocaleString("en-IN")}
        </button>
      </div>
    </div>
  );
}

/**
 * Registered Teams Accordion Component
 */
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
    <div className="rounded-xl border border-slate-200/90 overflow-hidden bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span>👥</span>
          <span>Registered teams</span>
          <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px] font-extrabold font-mono">
            {eventRegs.length}
          </span>
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 max-h-52 overflow-y-auto divide-y divide-slate-100 bg-slate-50/50">
          {eventRegs.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400 italic text-center">
              No teams registered yet. Be the first squad!
            </p>
          ) : (
            eventRegs.map((r, i) => {
              // Savage Esports phone masking: Show first 6 digits, hide last 4 with XXXX
              let cleanPhone = r.masked_whatsapp || "";
              const digits = cleanPhone.replace(/\D/g, "");
              if (digits.length >= 10) {
                const last10 = digits.slice(-10);
                cleanPhone = `+91 ${last10.slice(0, 6)}XXXX`;
              } else if (cleanPhone.includes("•")) {
                cleanPhone = cleanPhone.replace(/•+/g, "XXXX");
              } else if (!cleanPhone.includes("X")) {
                cleanPhone = cleanPhone.slice(0, Math.max(3, cleanPhone.length - 4)) + "XXXX";
              }

              const isPaid = r.status === "confirmed";

              return (
                <div
                  key={r.created_at + i}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-white transition-colors"
                >
                  {/* Left: Savage Esports stacked layout (Team Name on top, Number with XX underneath) */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">
                      {r.team_name}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 font-semibold tracking-wide">
                      {cleanPhone}
                    </p>
                  </div>

                  {/* Right: Slot badge (if published) OR "Paid & Slot Assigned" badge */}
                  <div className="shrink-0 text-right">
                    {r.is_slot_list_published ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black bg-indigo-50 border border-indigo-200 text-indigo-900 font-mono shadow-2xs">
                        <span>🎯</span>
                        <span>Slot #{r.slot_number || i + 5}</span>
                      </span>
                    ) : isPaid ? (
                      <div className="flex flex-col items-end">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <span>✓</span>
                          <span>Paid &amp; Assigned</span>
                        </span>
                        <span className="text-[9px] text-slate-400 font-medium mt-0.5">
                          Slot # releases with IDP
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                        <span>⏳</span>
                        <span>In Verification</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * EventCard — The centerpiece of the new vibrant UI
 */
function EventCard({
  e,
  selected,
  onToggle,
  onViewPrize,
  onViewPointsImage,
  regs,
  clientNow,
}: {
  e: EventRow;
  selected: boolean;
  onToggle: () => void;
  onViewPrize: (e: EventRow) => void;
  onViewPointsImage?: (url: string) => void;
  regs: PublicReg[];
  clientNow: number;
}) {
  const eventRegs = regs.filter((r) => r.event_id === e.id);
  const activeRegs = eventRegs.filter(
    (r) => r.status !== "cancelled" && r.status !== "rejected"
  );
  const confirmedCount = eventRegs.filter((r) => r.status === "confirmed").length;
  const realFilled = Math.max(e.filled_slots || 0, activeRegs.length);
  const slotsLeft = Math.max(0, e.max_slots - realFilled);
  const s = slotState(e.max_slots, realFilled, e.starts_at, e.status, clientNow, e.idp_times);
  const pct = Math.min(100, Math.round((realFilled / e.max_slots) * 100));

  const earlyBirdRemaining =
    e.early_bird_slots != null
      ? Math.max(0, e.early_bird_slots - confirmedCount)
      : null;
  const showEarlyBird =
    e.early_bird_fee_paise != null &&
    earlyBirdRemaining != null &&
    earlyBirdRemaining > 0;

  const effectiveFee = showEarlyBird ? e.early_bird_fee_paise! : e.entry_fee_paise;
  const kindBadge = KIND_BADGES[e.kind] || KIND_BADGES.scrim;

  return (
    <div
      className={`flex flex-col gap-3 sm:gap-3.5 rounded-2xl border bg-white p-3.5 sm:p-5 transition-all duration-200 w-full min-w-0 max-w-full overflow-hidden ${
        selected
          ? "border-amber-400 ring-2 ring-amber-400/30 shadow-xl"
          : "border-slate-200/90 hover:border-slate-300 hover:shadow-lg shadow-sm"
      }`}
    >
      {/* ── Top Badge Row ── */}
      <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span
            className={`rounded-md border px-2 py-0.5 text-[10px] font-black tracking-wider uppercase shrink-0 ${kindBadge.cls}`}
          >
            {kindBadge.label}
          </span>
          {e.mode && (
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 uppercase shrink-0">
              {e.mode}
            </span>
          )}
        </div>

        {/* Status Pill (Live Now / Open / Filling Fast / Sold out) */}
        <span
          className="rounded-full px-2 sm:px-2.5 py-0.5 text-[9px] sm:text-[10px] font-black tracking-wider border shrink-0 whitespace-nowrap"
          style={{
            color: s.color,
            background: s.bg,
            borderColor: `${s.color}33`,
          }}
        >
          {s.label}
        </span>
      </div>

      {/* ── Title & Timing ── */}
      <div className="min-w-0">
        <h3 className="text-base sm:text-lg font-black text-slate-900 leading-snug truncate" title={e.title}>
          {e.title}
        </h3>
        <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">
          {when(e.starts_at)} IST
        </p>
      </div>

      {/* ── Map Badges ── */}
      {e.maps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {e.maps.map((m) => (
            <span
              key={m}
              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                MAP_BADGES[m] || "bg-slate-100 text-slate-700 border-slate-200"
              }`}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      {/* ── Match Schedule & WhatsApp Link Box (3 Matches) ── */}
      <MatchScheduleBox
        idpTimes={e.idp_times}
        startTimes={e.start_times}
        title={e.title}
      />

      {/* ── High Contrast Prize Pool & Entry Fee ── */}
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 min-w-0 w-full">
        {/* Prize Pool */}
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onViewPrize(e);
          }}
          className="rounded-xl bg-blue-50/80 border border-blue-200/90 p-2.5 sm:p-3 text-left hover:bg-blue-100/70 transition-colors group cursor-pointer min-w-0 overflow-hidden"
          title="Click to view Top 4 Prize Distribution"
        >
          <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-extrabold text-blue-700 uppercase tracking-wider mb-0.5 gap-1 min-w-0">
            <span className="truncate">🏆 PRIZE POOL</span>
            <span className="text-[9px] underline text-blue-600 font-bold group-hover:text-blue-800 shrink-0">
              Top 4 ↗
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-black text-blue-700 font-mono tracking-tight truncate">
            {rupees(e.prize_pool_paise)}
          </p>
        </button>

        {/* Entry Fee */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 sm:p-3 flex flex-col justify-between min-w-0 overflow-hidden">
          <span className="text-[9px] sm:text-[10px] font-extrabold text-slate-500 uppercase tracking-wider truncate">
            ENTRY FEE
          </span>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <p className="text-lg sm:text-2xl font-black text-slate-900 font-mono truncate">
              {effectiveFee === 0 ? "Free" : rupees(effectiveFee)}
            </p>
            {showEarlyBird && e.entry_fee_paise > 0 && (
              <p className="text-xs text-slate-400 line-through shrink-0">
                {rupees(e.entry_fee_paise)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Slot Progress Bar ── */}
      <div className="min-w-0 w-full">
        <div className="flex items-center justify-between mb-1.5 text-xs gap-2 min-w-0">
          <span className="text-slate-600 font-bold text-[11px] sm:text-xs truncate min-w-0">
            <span className="text-slate-900 font-black">{realFilled}</span> of{" "}
            {e.max_slots} slots filled
          </span>
          {slotsLeft > 0 ? (
            <span className="font-extrabold text-[11px] sm:text-xs shrink-0 whitespace-nowrap" style={{ color: s.color }}>
              {slotsLeft} left
            </span>
          ) : (
            <span className="text-slate-400 font-bold text-[11px] sm:text-xs uppercase shrink-0 whitespace-nowrap">
              Sold out
            </span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full transition-all duration-700 bg-gradient-to-r from-blue-600 to-indigo-600"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ── Registered Teams Collapsible ── */}
      <TeamRoster eventId={e.id} regs={regs} />

      {/* ── Official Top 4 Winners & Points Table (When Concluded) ── */}
      {(Boolean(e.top_teams?.first) || Boolean(e.final_points_table_url)) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 space-y-2 text-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-950 flex items-center gap-1">
              <span>👑</span>
              <span>Official Top 4 Winners</span>
            </span>
            <span className="text-[9px] bg-amber-200 text-amber-900 font-extrabold px-1.5 py-0.2 rounded-full">
              Results Out
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {e.top_teams?.first && (
              <div className="bg-white rounded-lg border border-amber-200 px-2 py-1 flex items-center gap-1.5 truncate">
                <span className="font-bold text-amber-600">🥇</span>
                <span className="font-bold text-slate-900 truncate">{e.top_teams.first}</span>
              </div>
            )}
            {e.top_teams?.second && (
              <div className="bg-white rounded-lg border border-slate-200 px-2 py-1 flex items-center gap-1.5 truncate">
                <span className="font-bold text-slate-500">🥈</span>
                <span className="font-bold text-slate-800 truncate">{e.top_teams.second}</span>
              </div>
            )}
            {e.top_teams?.third && (
              <div className="bg-white rounded-lg border border-slate-200 px-2 py-1 flex items-center gap-1.5 truncate">
                <span className="font-bold text-amber-700">🥉</span>
                <span className="font-bold text-slate-800 truncate">{e.top_teams.third}</span>
              </div>
            )}
            {e.top_teams?.fourth && (
              <div className="bg-white rounded-lg border border-slate-200 px-2 py-1 flex items-center gap-1.5 truncate">
                <span className="font-bold text-slate-400">4th</span>
                <span className="font-bold text-slate-800 truncate">{e.top_teams.fourth}</span>
              </div>
            )}
          </div>

          {e.final_points_table_url && onViewPointsImage && (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onViewPointsImage(e.final_points_table_url!);
              }}
              className="w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <span>📊</span>
              <span>View Official Points Table</span>
            </button>
          )}
        </div>
      )}

      {/* ── Action Button (Radiant Gold Select / Dark Navy Selected) ── */}
      {s.closed ? (
        <span className="mt-auto rounded-xl bg-slate-100 border border-slate-200 px-4 py-3 min-h-[44px] flex items-center justify-center text-center text-xs font-bold uppercase tracking-wider text-slate-400 cursor-not-allowed">
          {s.label === "🔴 LIVE NOW"
            ? "🔴 Match In Progress · Closed"
            : s.label === "COMPLETED"
            ? "🏁 Match Completed"
            : s.label === "CANCELLED"
            ? "❌ Match Cancelled"
            : "Registration closed"}
        </span>
      ) : (
        <button
          onClick={onToggle}
          className={`mt-auto rounded-xl px-4 py-3 min-h-[44px] flex items-center justify-center text-sm font-black transition-all duration-150 cursor-pointer ${
            selected
              ? "bg-[#0F172A] text-white hover:bg-slate-800 shadow-md"
              : "bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 shadow-md shadow-amber-500/20"
          }`}
        >
          {selected ? "Selected ✓" : "Select lobby"}
        </button>
      )}
    </div>
  );
}

/**
 * UTR Room Finder Modal
 */
function UtrLookupModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    window.location.href = `/my-tournaments?q=${encodeURIComponent(query.trim())}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-lg">
              🔍
            </span>
            <div>
              <h3 className="text-lg font-black text-slate-900">Find My Room Credentials</h3>
              <p className="text-xs text-slate-500">Retrieve 3-Match IDP using UTR or Phone</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-500 hover:text-slate-800"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSearch} className="space-y-3 pt-2">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              12-Digit UTR Number or WhatsApp Phone:
            </label>
            <input
              type="text"
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 542198012345 or 9876543210"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-mono text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-colors"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-sm transition-all shadow-md"
          >
            Fetch 3-Match IDP &amp; WhatsApp Group →
          </button>
        </form>

        <p className="text-[11px] text-slate-500 text-center">
          Need quick help?{" "}
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-600 font-bold hover:underline"
          >
            Contact Host on WhatsApp
          </a>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Home Page Component
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
  const [utrModalOpen, setUtrModalOpen] = useState(false);
  const [pointsModalOpen, setPointsModalOpen] = useState(false);
  const [pointsImageModal, setPointsImageModal] = useState<string | null>(null);
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

  // ── Load events ──
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
      const published = ((data as EventRow[]) || []).filter(
        (e) => e.is_published !== false && (e.status === "open" || e.status === "live")
      );
      setEvents(published);
    }
  }, []);

  // ── Load public registrations (Supabase RPC + Direct table + localStorage Fallback) ──
  const loadRegs = useCallback(async () => {
    let combined: PublicReg[] = [];

    // 1. Try get_public_registrations RPC
    try {
      const { data, error } = await supabase.rpc("get_public_registrations");
      if (!error && data && Array.isArray(data)) {
        combined = [...(data as PublicReg[])];
      }
    } catch {}

    // 2. Direct Supabase query fallback on registrations
    if (combined.length === 0) {
      try {
        const { data: directData } = await supabase
          .from("registrations")
          .select("event_id, team_name, whatsapp, status, created_at");
        if (directData && Array.isArray(directData)) {
          combined = directData.map((r: {
            event_id: string;
            team_name: string;
            whatsapp: string | null;
            status: string;
            created_at: string;
          }) => ({
            event_id: r.event_id,
            team_name: r.team_name,
            masked_whatsapp: r.whatsapp && r.whatsapp.length >= 6
              ? r.whatsapp.slice(0, 3) + "••••" + r.whatsapp.slice(-3)
              : "••••••",
            status: r.status,
            created_at: r.created_at,
          }));
        }
      } catch {}
    }

    // 3. Hydrate from localStorage submissions (apex_all_submissions + active session)
    try {
      if (typeof window !== "undefined") {
        const localRaw = localStorage.getItem("apex_all_submissions");
        const activeRaw = localStorage.getItem("apex_active_booking_session");
        const allLocal: Array<Record<string, unknown>> = [];
        if (localRaw) {
          try { allLocal.push(...JSON.parse(localRaw)); } catch {}
        }
        if (activeRaw) {
          try { allLocal.push(JSON.parse(activeRaw)); } catch {}
        }

        for (const sub of allLocal) {
          const squadName =
            (sub.teamName as string) ||
            (Array.isArray(sub.team_names) ? (sub.team_names as string[])[0] : null) ||
            "Registered Team";

          const rawEvents: Array<{ id?: string; event_id?: string; title?: string }> =
            Array.isArray(sub.events) && (sub.events as Array<{ id?: string }>).length > 0
              ? (sub.events as Array<{ id?: string; title?: string }>)
              : Array.isArray(sub.event_titles) && (sub.event_titles as string[]).length > 0
              ? (sub.event_titles as string[]).map((t) => ({ title: t }))
              : [{ title: "Apex Scrims Lobby" }];

          for (const ev of rawEvents) {
            let evId = ev.id || ev.event_id;
            if (!evId && ev.title && events) {
              const matchedEv = events.find((e) => e.title.toLowerCase().trim() === ev.title?.toLowerCase().trim());
              if (matchedEv) evId = matchedEv.id;
            }
            if (!evId && events && events.length > 0) {
              evId = events[0].id;
            }
            if (!evId) continue;

            const alreadyPresent = combined.some(
              (c) => c.event_id === evId && c.team_name?.trim().toLowerCase() === squadName.trim().toLowerCase()
            );
            if (!alreadyPresent) {
              const rawWa = ((sub.whatsapp || sub.phone || "") as string).replace(/\D/g, "");
              const isApproved = sub.pay_status === "approved" || sub.status === "confirmed";
              combined.push({
                event_id: evId,
                team_name: squadName,
                masked_whatsapp: rawWa.length >= 6
                  ? rawWa.slice(0, 3) + "••••" + rawWa.slice(-3)
                  : "••••••",
                status: isApproved ? "confirmed" : "pending_approval",
                created_at: (sub.submittedAt as string) || (sub.created_at as string) || new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch {}

    setRegs(combined);
  }, []);

  useEffect(() => {
    loadEvents();
    loadRegs();
    const ch = supabase
      .channel("apex-realtime-public-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        loadEvents();
        loadRegs();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "registrations" }, () => {
        loadEvents();
        loadRegs();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
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
    if (sort === "prize_desc") return b.prize_pool_paise - a.prize_pool_paise;
    if (sort === "fee_asc") return a.entry_fee_paise - b.entry_fee_paise;
    return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
  });

  const scrims = sorted.filter((e) => e.kind !== "league");
  const leagues = sorted.filter((e) => e.kind === "league");

  const totalLocked = regs.filter((r) => r.status === "confirmed").length;

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
      const earlyRemaining =
        e.early_bird_slots != null
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
    { key: "league", label: "Open leagues" },
  ];

  return (
    <div className="min-h-screen bg-[#0A1128] text-slate-900 flex flex-col w-full max-w-full overflow-x-hidden">
      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 1. Header / Navbar (Deep Midnight Navy) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0A1128]/95 backdrop-blur-md text-white w-full">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3 sm:px-6 py-3 sm:py-4 gap-2 sm:gap-4 w-full">
          {/* Brand Logo */}
          <a href="/" className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-xl font-black tracking-tight shrink min-w-0">
            <span className="text-[#FFB800] text-lg sm:text-xl shrink-0">◆</span>
            <span className="truncate">{ORG_NAME}</span>
          </a>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-slate-300">
            <a href="#tournaments" className="hover:text-white transition-colors">
              Tournaments
            </a>
            <a href="#leagues" className="hover:text-white transition-colors">
              Leagues
            </a>
            <a href="/my-tournaments" className="hover:text-white transition-colors flex items-center gap-1">
              <span>🔑</span>
              <span>Room ID &amp; Password</span>
            </a>
            <button
              onClick={() => setUtrModalOpen(true)}
              className="hover:text-[#FFB800] transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>🔍</span>
              <span>Find My Room (UTR)</span>
            </button>
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Quick Room ID pill on mobile */}
            <a
              href="/my-tournaments"
              className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-bold text-white hover:bg-white/20 transition-all shrink-0"
              title="View 3-Match IDP & Room Credentials"
            >
              <span>🔑</span>
              <span className="hidden xs:inline">Room ID</span>
            </a>

            {/* Quick Admin pill */}
            {isAdmin && (
              <a
                href="/admin"
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-bold text-amber-300 hover:bg-amber-500/30 transition-all shrink-0"
                title="Open Admin Dashboard"
              >
                <span>⚡</span>
                <span className="hidden xs:inline">Admin</span>
              </a>
            )}

            {/* Desktop user profile & sign out */}
            {userEmail ? (
              <div className="hidden sm:flex items-center gap-2">
                <a
                  href="/profile"
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white font-medium hover:bg-white/20 transition-colors max-w-[140px] truncate"
                  title={userEmail}
                >
                  {userEmail}
                </a>
                <button
                  onClick={async () => {
                    await supabase.auth.signOut();
                    window.location.reload();
                  }}
                  className="text-xs text-rose-300 hover:text-rose-100 font-bold px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 transition-colors"
                  title="Sign out of account"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <a
                href="/login"
                className="rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] px-3 sm:px-4 py-1.5 text-xs font-black text-slate-950 transition-colors hidden sm:inline-block shadow-sm"
              >
                Sign In
              </a>
            )}

            {/* 3-Dash Shortcut Window Button (☰) - Always visible for quick shortcuts & Sign Out */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 p-2 sm:px-3 sm:py-1.5 text-xs font-black text-white transition-all shadow-sm cursor-pointer shrink-0"
              aria-label="Open shortcut menu"
              title="Open shortcut window & account menu"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span className="hidden md:inline font-bold text-slate-200">Menu</span>
            </button>
          </div>
        </div>
      </header>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 2. Slide-over Right Shortcut Window Drawer */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="fixed inset-0" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-full max-w-[320px] sm:max-w-[350px] h-full bg-[#0A1128] border-l border-white/10 p-5 shadow-2xl flex flex-col justify-between overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-200 z-10 text-white">
            <div className="space-y-4">
              {/* Drawer Top Header */}
              <div className="flex items-center justify-between pb-3.5 border-b border-white/10">
                <div className="flex items-center gap-2 font-black text-lg">
                  <span className="text-[#FFB800] text-xl">◆</span>
                  <span>{ORG_NAME}</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-full w-8 h-8 flex items-center justify-center bg-white/10 text-slate-300 hover:text-white hover:bg-white/20 transition-colors"
                  aria-label="Close menu"
                >
                  ✕
                </button>
              </div>

              {/* ── User Account Box & Prominent Sign Out ── */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
                {userEmail ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#FFB800] text-slate-950 font-black text-base flex items-center justify-center shrink-0 shadow-md">
                        {userEmail.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Signed In</span>
                          {isAdmin ? (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-black bg-amber-400/20 text-amber-300 border border-amber-400/40">
                              ADMIN
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-black bg-emerald-400/20 text-emerald-300 border border-emerald-400/40">
                              CAPTAIN
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-white truncate" title={userEmail}>
                          {userEmail}
                        </p>
                      </div>
                    </div>

                    {/* Prominent High-Visibility Sign Out Button */}
                    <button
                      onClick={async () => {
                        await supabase.auth.signOut();
                        window.location.reload();
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 hover:text-white font-black text-xs flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
                    >
                      <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      <span>Sign Out / Switch Account</span>
                    </button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-300">You are browsing as Guest.</p>
                    <a
                      href="/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className="w-full py-2.5 px-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition-all"
                    >
                      <span>⚡</span>
                      <span>Sign In / Register →</span>
                    </a>
                  </div>
                )}
              </div>

              {/* ── Shortcuts Menu ── */}
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-3 pt-2">
                  Quick Shortcuts
                </p>
                <nav className="flex flex-col gap-1 text-sm font-semibold">
                  <a
                    href="#tournaments"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-200 transition-colors"
                  >
                    <span className="text-base">🎮</span>
                    <span>Open Tournaments &amp; Scrims</span>
                  </a>
                  <a
                    href="#leagues"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-200 transition-colors"
                  >
                    <span className="text-base">🏆</span>
                    <span>Major Leagues</span>
                  </a>
                  <a
                    href="/my-tournaments"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-blue-500/15 text-blue-300 border border-blue-500/30 transition-colors"
                  >
                    <span className="text-base">🔑</span>
                    <span>3-Match IDP &amp; Credentials</span>
                  </a>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setUtrModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-200 text-left font-semibold transition-colors cursor-pointer"
                  >
                    <span className="text-base">🔍</span>
                    <span>Find My Room (UTR Search)</span>
                  </button>
                  <a
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 text-slate-200 transition-colors"
                  >
                    <span className="text-base">📋</span>
                    <span>My Bookings &amp; Teams</span>
                  </a>
                  <a
                    href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 text-emerald-400 transition-colors"
                  >
                    <span className="text-base">💬</span>
                    <span>WhatsApp Support (+91 {SUPPORT_WHATSAPP})</span>
                  </a>
                  {isAdmin && (
                    <a
                      href="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 transition-colors"
                    >
                      <span className="text-base">⚡</span>
                      <span>Admin Command Dashboard</span>
                    </a>
                  )}
                </nav>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="pt-4 border-t border-white/10 text-[11px] text-slate-400 space-y-1">
              <p className="font-semibold text-slate-300">Apex Esports India</p>
              <p>Official 3-Match BGMI Tournaments &amp; Instant UPI Payouts.</p>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 3. Hero Section (Deep Navy with High-Energy Esports Headline) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A1128] text-white pt-8 pb-12 sm:pt-16 sm:pb-20 relative overflow-hidden hero-grid">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 relative z-10">
          <div className="max-w-3xl">
            {/* Live Squads locked pill */}
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3.5 py-1 text-xs sm:text-sm font-bold text-[#FFB800] mb-4">
              <span className="w-2 h-2 rounded-full bg-[#FFB800] glow-pulse shrink-0" />
              <span>
                {totalLocked > 0
                  ? `${totalLocked} squads already locked in today`
                  : "Daily Scrims & Tournaments Live"}
              </span>
            </div>

            {/* Headline matching Savage reference */}
            <h1 className="text-3xl sm:text-6xl font-black tracking-tight leading-[1.1] text-white">
              Pick a match.
              <br />
              <span className="text-[#FFB800]">Lock your squad.</span>
            </h1>

            <p className="mt-4 text-sm sm:text-lg text-slate-300 leading-relaxed max-w-2xl font-normal">
              Custom-room 3-match tournaments and daily leagues with guaranteed cash prizes.
              Register your team, pay the entry fee via instant UPI QR, and we provide your
              individual lobby WhatsApp group &amp; 3-Match IDP live.
            </p>

            {/* CTAs */}
            <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#tournaments"
                className="rounded-full bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black px-6 sm:px-7 py-3 text-sm sm:text-base transition-all shadow-lg shadow-amber-500/20"
              >
                See tournaments
              </a>
              <a
                href="#leagues"
                className="rounded-full bg-white/10 hover:bg-white/15 text-white font-bold px-6 py-3 text-sm sm:text-base border border-white/20 transition-all"
              >
                See leagues
              </a>
              <button
                type="button"
                onClick={() => setUtrModalOpen(true)}
                className="rounded-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-bold px-5 py-3 text-xs sm:text-sm border border-blue-500/40 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>🔍</span>
                <span>Paid? Get Room Details</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 4. Main Content Area (Crisp Light Canvas `#F4F6FB` - Exactly like Reference) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <main className="bg-[#F4F6FB] flex-1 py-6 sm:py-12 pb-36 sm:pb-28 border-t border-slate-200 w-full max-w-full overflow-x-hidden">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 space-y-6 sm:space-y-8 w-full min-w-0">
          {/* Error Banner */}
          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              Could not load lobbies: {err}
            </div>
          )}

          {/* ── Filter Tabs & Search Bar ── */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between w-full min-w-0">
            {/* Filter Pills */}
            <div className="flex gap-2 p-1 rounded-2xl bg-slate-200/80 overflow-x-auto no-scrollbar min-w-0">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`shrink-0 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-all duration-150 ${
                    filter === f.key
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Search Input & Sort */}
            <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
              <div className="relative flex-1 min-w-0 sm:w-60">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
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
                  placeholder="Search lobby, map, time…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-blue-600 transition-colors shadow-sm min-w-0"
                />
              </div>

              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 outline-none focus:border-blue-600 transition-colors shadow-sm shrink-0"
              >
                <option value="soon">Starting Soon</option>
                <option value="prize_desc">Prize: High → Low</option>
                <option value="fee_asc">Entry: Low → High</option>
              </select>
            </div>
          </div>

          {/* ────────────────────────────────────────────────────────────────── */}
          {/* Section: Open Tournaments / Scrims */}
          {/* ────────────────────────────────────────────────────────────────── */}
          <section id="tournaments" className="scroll-mt-24 space-y-4 min-w-0 w-full">
            <div className="flex items-center justify-between gap-3 min-w-0 w-full flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">
                  Open tournaments
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 font-medium truncate">
                  3 Matches per lobby · Room ID &amp; Password released 15m before match
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPointsModalOpen(true)}
                  className="rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <span>📊</span>
                  <span>Points Table &amp; Results</span>
                </button>
                {events && scrims.length > 0 && (
                  <span className="rounded-full bg-blue-100 text-blue-800 px-2.5 sm:px-3 py-0.5 text-xs font-black shrink-0 whitespace-nowrap">
                    {scrims.length} open
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 w-full min-w-0 max-w-full">
              {!events && !err
                ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
                : scrims.map((e) => (
                    <EventCard
                      key={e.id}
                      e={e}
                      selected={sel.includes(e.id)}
                      onToggle={() => toggle(e.id)}
                      onViewPrize={setPrizeModalEvent}
                      onViewPointsImage={setPointsImageModal}
                      regs={regs}
                      clientNow={clientNow}
                    />
                  ))}
            </div>

            {events && scrims.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                <p className="text-3xl mb-2">🎮</p>
                <p className="text-slate-600 font-bold">No open scrims right now</p>
                <p className="text-slate-400 text-xs mt-1">Host is adding fresh lobbies shortly.</p>
              </div>
            )}
          </section>

          {/* ────────────────────────────────────────────────────────────────── */}
          {/* Section: Open Leagues (from Reference Screenshot 4) */}
          {/* ────────────────────────────────────────────────────────────────── */}
          <section id="leagues" className="scroll-mt-24 space-y-4 pt-6 min-w-0 w-full">
            <div className="flex items-center justify-between gap-3 min-w-0 w-full">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">
                  Open leagues
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 font-medium truncate">
                  Multi-day major tournaments with large prize pools &amp; finals streaming
                </p>
              </div>
              {events && leagues.length > 0 && (
                <span className="rounded-full bg-amber-100 text-amber-900 px-2.5 sm:px-3 py-0.5 text-xs font-black shrink-0 whitespace-nowrap">
                  {leagues.length} active
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 w-full min-w-0 max-w-full">
              {!events && !err
                ? Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
                : leagues.map((e) => (
                    <EventCard
                      key={e.id}
                      e={e}
                      selected={sel.includes(e.id)}
                      onToggle={() => toggle(e.id)}
                      onViewPrize={setPrizeModalEvent}
                      onViewPointsImage={setPointsImageModal}
                      regs={regs}
                      clientNow={clientNow}
                    />
                  ))}
            </div>

            {events && leagues.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <p className="text-2xl mb-1">🏆</p>
                <p className="text-slate-700 font-bold text-sm">No active leagues right now</p>
                <p className="text-slate-400 text-xs mt-0.5">Next season announcement dropping soon!</p>
              </div>
            )}
          </section>

          {/* ────────────────────────────────────────────────────────────────── */}
          {/* Section: "Paid but didn't get room details?" (Reference Screenshot 3) */}
          {/* ────────────────────────────────────────────────────────────────── */}
          <section className="pt-6">
            <div className="rounded-3xl bg-[#0D1836] text-white p-6 sm:p-8 shadow-xl border border-blue-900/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <span className="w-12 h-12 rounded-2xl bg-[#FFB800] text-slate-950 font-black text-2xl flex items-center justify-center shrink-0 shadow-md shadow-amber-500/20">
                  ?
                </span>
                <div className="space-y-2">
                  <h3 className="text-xl sm:text-2xl font-black text-white">
                    Paid but didn&apos;t get room details?
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl">
                    No stress. Your payment is safe. Enter your 12-digit UTR or WhatsApp number
                    and we&apos;ll show your 3-match room details instantly.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300 font-semibold pt-1">
                    <span>① Open payment app &amp; copy 12-digit UTR</span>
                    <span>② Paste it on the next page</span>
                    <span>③ Get 3-Match IDP &amp; WhatsApp Group</span>
                  </div>
                  <p className="text-xs text-slate-400 pt-1">
                    Still stuck? WhatsApp support:{" "}
                    <a
                      href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#FFB800] font-bold hover:underline"
                    >
                      +91 {SUPPORT_WHATSAPP}
                    </a>
                  </p>
                </div>
              </div>

              <div className="shrink-0 w-full md:w-auto">
                <button
                  type="button"
                  onClick={() => setUtrModalOpen(true)}
                  className="w-full md:w-auto rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black px-6 py-3.5 text-sm transition-all shadow-md shadow-amber-500/20 cursor-pointer"
                >
                  Get my room details
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 5. Sticky Multi-Lobby Floating Bar (Reference Screenshot 5) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {sel.length > 0 && (
        <div
          ref={checkoutRef}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-[#0A1128]/98 backdrop-blur-xl slide-up shadow-2xl text-white"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2.5 sm:gap-4 px-3 sm:px-6 py-3 sm:py-4">
            <div className="min-w-0 flex-1">
              <p className="font-black text-xs sm:text-base text-white truncate">
                {sel.length} {sel.length === 1 ? "lobby" : "lobbies"} selected
              </p>
              <p className="text-[11px] sm:text-sm text-slate-300">
                Total entry:{" "}
                <span className="font-black text-[#FFB800] font-mono">
                  {totalFee === 0 ? "Free" : rupees(totalFee)}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setPicked([])}
                className="rounded-xl border border-white/20 hover:border-white/40 px-3 py-2 text-xs sm:text-sm font-semibold hover:bg-white/10 text-slate-300 transition-colors cursor-pointer"
              >
                Clear
              </button>
              <a
                href={"/register?e=" + sel.join(",")}
                className="rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 px-4 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-black transition-all shadow-lg shadow-amber-500/25 shrink-0"
              >
                Register selected →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 6. Footer (Deep Midnight Navy with Clean Structure) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <footer className="bg-[#070E1E] text-slate-400 pt-12 pb-16 border-t border-slate-800 text-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {/* Col 1: Brand */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 font-black text-base text-white">
              <span className="text-[#FFB800]">◆</span>
              <span>{ORG_NAME}</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Custom-room tournaments with guaranteed cash prizes. Register your team, pay
              the entry fee, and get your 3-match room details on WhatsApp.
            </p>
          </div>

          {/* Col 2: Quick Links */}
          <div className="space-y-2.5">
            <p className="text-white font-bold text-xs uppercase tracking-wider">Quick links</p>
            <ul className="space-y-1.5">
              <li>
                <a href="#tournaments" className="hover:text-white transition-colors">
                  Open tournaments
                </a>
              </li>
              <li>
                <a href="/register" className="hover:text-white transition-colors">
                  Register your team
                </a>
              </li>
              <li>
                <a href="/my-tournaments" className="hover:text-white transition-colors">
                  Room ID &amp; Password
                </a>
              </li>
              <li>
                <button
                  onClick={() => setUtrModalOpen(true)}
                  className="hover:text-[#FFB800] transition-colors text-left"
                >
                  Paid but no room details?
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Need Help */}
          <div className="space-y-2.5">
            <p className="text-white font-bold text-xs uppercase tracking-wider">Need help?</p>
            <p className="leading-relaxed">
              Payments are 100% verified UPI.
              <br />
              Room details &amp; lobby links are sent on WhatsApp and updated live on the site.
            </p>
            <p className="text-white font-semibold pt-1">
              WhatsApp: +91 {SUPPORT_WHATSAPP}
            </p>
          </div>

          {/* Col 4: Platform Rules */}
          <div className="space-y-2.5">
            <p className="text-white font-bold text-xs uppercase tracking-wider">Fair Play</p>
            <p className="leading-relaxed">
              Mobile devices ONLY. No emulators or tablets permitted. Guaranteed UPI payouts within 30 minutes of final match completion.
            </p>
            {isAdmin && (
              <a href="/admin" className="inline-block text-amber-400 hover:underline font-bold">
                Admin Panel →
              </a>
            )}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-500">
          <p>© 2026 {ORG_NAME}. All rights reserved.</p>
          <a href="#" className="hover:text-white transition-colors font-semibold">
            Back to top ↑
          </a>
        </div>
      </footer>

      {/* Floating WhatsApp Support Pill - Smoothly moves above the dock when lobbies are selected so it NEVER overlaps checkout! */}
      <a
        href={`https://wa.me/${SUPPORT_WHATSAPP}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`fixed right-4 sm:right-6 z-30 rounded-full bg-[#25D366] hover:bg-[#20ba59] text-black font-extrabold px-3.5 sm:px-4 py-2 sm:py-2.5 text-xs flex items-center gap-2 shadow-2xl transition-all duration-200 cursor-pointer ${
          sel.length > 0 ? "bottom-24 sm:bottom-28" : "bottom-5 sm:bottom-6"
        }`}
        title="Chat with WhatsApp Support"
      >
        <svg className="w-4 h-4 fill-black shrink-0" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        </svg>
        <span className="font-black">Support</span>
      </a>

      {/* Top 4 Prize Distribution Modal */}
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

      {/* UTR Room Finder Modal */}
      {utrModalOpen && (
        <UtrLookupModal onClose={() => setUtrModalOpen(false)} />
      )}

      {/* Points Table & Results Modal */}
      {pointsModalOpen && (
        <PublicPointsTableModal onClose={() => setPointsModalOpen(false)} />
      )}

      {/* High-Res Final Points Table Screenshot Lightbox */}
      {pointsImageModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 sm:p-5 animate-in fade-in"
          onClick={() => setPointsImageModal(null)}
        >
          <div
            className="bg-white rounded-3xl p-4 sm:p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📊</span>
                <h3 className="font-black text-slate-900 text-base sm:text-lg">Official Match Results &amp; Points Table</h3>
              </div>
              <button
                onClick={() => setPointsImageModal(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 font-bold flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-950/5 p-1 flex items-center justify-center">
              <img
                src={pointsImageModal}
                alt="Official Final Points Table"
                className="w-full h-auto rounded-xl object-contain max-h-[75vh]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
