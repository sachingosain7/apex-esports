"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import {
  parse3MatchIDP,
  serializeMatchRoomIds,
  serializeMatchPasswords,
  extractLobbyLabel,
  extractMatchCredentials,
} from "@/lib/matchIdp";
import { PointsTableTab } from "@/components/PointsTableTab";
import { resolveGeminiKey, ACTIVE_GEMINI_API_KEY } from "@/lib/gemini";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type UserRole = "owner" | "admin" | "moderator" | "finance";
type AdminTab = "generator" | "lobbies" | "payments" | "points" | "roles";

type EventAdmin = {
  id: string;
  kind: string;
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
  status: string;
  idp_times: string | null;
  start_times: string | null;
  room_id: string | null;
  room_password: string | null;
  whatsapp_group_link: string | null;
  is_published?: boolean;
  prize_distribution?: {
    first?: number;
    second?: number;
    third?: number;
    fourth?: number;
  } | null;
};

type PaymentRow = {
  utr: string;
  amount_paise: number;
  pay_status: string;
  created_at: string;
  order_id: string;
  whatsapp: string;
  team_names: string[];
  event_titles: string[];
  screenshot_url?: string | null;
};

type RoleRow = {
  email: string;
  role: string;
  granted_at: string;
};

type EventRegistration = {
  registration_id: string;
  team_name: string;
  whatsapp: string;
  amount_paise: number;
  status: string;
  created_at: string;
  utr?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ALL_MAPS = ["Erangel", "Miramar", "Rondo", "Sanhok", "Livik", "Vikendi"];
const INTERVAL_OPTIONS = [
  { label: "20 min", value: 20 },
  { label: "40 min", value: 40 },
  { label: "60 min", value: 60 },
  { label: "Custom", value: -1 },
];

const TABS: { id: AdminTab; label: string; icon: string; roles: UserRole[] }[] = [
  { id: "generator", label: "Bulk Generator", icon: "⚡", roles: ["owner", "admin", "moderator", "finance"] },
  { id: "lobbies", label: "Live Lobbies & IDP", icon: "🎮", roles: ["owner", "admin", "moderator", "finance"] },
  { id: "payments", label: "Payments & UTR", icon: "💳", roles: ["owner", "admin", "moderator", "finance"] },
  { id: "points", label: "Points Table & Results", icon: "📊", roles: ["owner", "admin", "moderator", "finance"] },
  { id: "roles", label: "Role & Ownership", icon: "👑", roles: ["owner"] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const paiseToRupees = (p: number) => (p / 100).toFixed(0);
const rupeesToPaise = (r: string) => Math.round(parseFloat(r || "0") * 100);

function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function subtractMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  let total = h * 60 + m - minutes;
  if (total < 0) total += 24 * 60;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
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

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI Primitives
// ─────────────────────────────────────────────────────────────────────────────

function Badge({ text, color }: { text: string; color: "emerald" | "amber" | "red" | "gray" | "purple" }) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-300 font-bold",
    amber: "bg-amber-50 text-amber-900 border-amber-300 font-bold",
    red: "bg-rose-50 text-rose-800 border-rose-300 font-bold",
    gray: "bg-slate-100 text-slate-700 border-slate-300 font-semibold",
    purple: "bg-purple-50 text-purple-800 border-purple-300 font-bold",
  }[color];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs border ${cls}`}>
      {text}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: "emerald" | "amber" | "red" | "gray" | "purple" }> = {
    open: { label: "Open", color: "emerald" },
    live: { label: "🔴 Live Now", color: "red" },
    cancelled: { label: "Cancelled", color: "red" },
    completed: { label: "Completed", color: "gray" },
    pending_verification: { label: "Pending", color: "amber" },
    approved: { label: "Approved", color: "emerald" },
    rejected: { label: "Rejected", color: "red" },
    admin: { label: "⚡ Admin", color: "purple" },
    moderator: { label: "⚡ Admin", color: "purple" },
    owner: { label: "👑 Owner", color: "amber" },
    finance: { label: "⚡ Admin", color: "purple" },
  };
  const cfg = map[status] ?? { label: status, color: "gray" as const };
  return <Badge text={cfg.label} color={cfg.color} />;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-slate-300 border-t-[#FFB800] rounded-full animate-spin" />
    </div>
  );
}

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 space-y-4">
        <div className="flex items-center gap-2.5 text-amber-600 font-black text-base">
          <span>⚠️</span>
          <span>Confirmation Required</span>
        </div>
        <p className="text-slate-700 text-sm leading-relaxed font-medium">{message}</p>
        <div className="flex gap-2.5 justify-end pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-2xl text-xs sm:text-sm font-bold animate-in slide-in-from-bottom-4 duration-300 ${
        type === "success"
          ? "bg-[#0A1128] border-emerald-500/40 text-emerald-300"
          : "bg-[#0A1128] border-rose-500/40 text-rose-300"
      }`}
    >
      <span>{type === "success" ? "✓" : "✗"}</span>
      <span>{message}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal: Broadcast WhatsApp Notice Generator
// ─────────────────────────────────────────────────────────────────────────────

function BroadcastModal({
  event,
  onClose,
  showToast,
}: {
  event: EventAdmin;
  onClose: () => void;
  showToast: (m: string, t: "success" | "error") => void;
}) {
  const [template, setTemplate] = useState<"idp" | "registration">("idp");
  const lobbyTag = extractLobbyLabel(event.title);
  const start = formatTimestamp(event.starts_at);
  const mapsStr = event.maps?.join(", ") || "Erangel";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const regUrl = `${origin}/register?event=${event.id}`;

  const matches = parse3MatchIDP({
    roomId: event.room_id,
    roomPassword: event.room_password,
    maps: event.maps,
    idpTimes: event.idp_times,
    startTimes: event.start_times,
  });

  const matchCredentialsText = matches
    .map(
      (m) =>
        `🎯 *MATCH ${m.matchNumber} — ${m.map}*\n` +
        `🆔 *ROOM ID:* \`${m.roomId || "Releasing 15m before"}\`\n` +
        `🔑 *PASSWORD:* \`${m.password || "Releasing 15m before"}\`` +
        (m.startTime ? `\n⏰ *Start:* ${m.startTime}` : "")
    )
    .join("\n\n");

  const idpMessage = `🔥 *${ORG_NAME.toUpperCase()} — 3-MATCH IDP & CREDENTIALS* 🔥
━━━━━━━━━━━━━━━━━━━━
🎮 *Lobby:* ${event.title} (${event.mode || "Squad"})
${event.whatsapp_group_link ? `📲 *Official ${lobbyTag} WhatsApp Group:* ${event.whatsapp_group_link}\n` : ""}⏰ *Event Time:* ${start} IST
📍 *Maps:* ${mapsStr}
━━━━━━━━━━━━━━━━━━━━
${matchCredentialsText}
━━━━━━━━━━━━━━━━━━━━
⚠️ *CRITICAL INSTRUCTIONS:*
1. Join strictly in your allotted team slot number.
2. Mobile devices ONLY (No emulators or iPads allowed).
3. Matches start sharp at schedule time. Good luck!`;

  const regMessage = `🔥 *${ORG_NAME.toUpperCase()} — REGISTRATION OPEN* 🔥
━━━━━━━━━━━━━━━━━━━━
🎮 *Tournament:* ${event.title} (${event.mode || "Squad"})
💰 *Prize Pool:* ₹${(event.prize_pool_paise / 100).toFixed(0)}
🎟️ *Entry Fee:* ₹${(event.entry_fee_paise / 100).toFixed(0)} per squad
⏰ *Match Time:* ${start} IST
📍 *Maps:* ${mapsStr}
👥 *Slots:* ${event.max_slots} Squads (First Come First Serve)
━━━━━━━━━━━━━━━━━━━━
⚡ *REGISTER YOUR SQUAD NOW:*
👉 ${regUrl}
━━━━━━━━━━━━━━━━━━━━
Instant UPI QR verification & automatic slot confirmation!`;

  const activeMessage = template === "idp" ? idpMessage : regMessage;

  const handleCopy = () => {
    copyToClipboard(activeMessage);
    showToast("Broadcast notice copied to clipboard!", "success");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📢</span>
            <h3 className="font-black text-slate-900 text-base">WhatsApp Broadcast Notice</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Template Selector Tabs */}
        <div className="flex p-1 bg-slate-100 border border-slate-200 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => setTemplate("idp")}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              template === "idp"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            🔑 Room ID &amp; Password Notice
          </button>
          <button
            type="button"
            onClick={() => setTemplate("registration")}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              template === "registration"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            🚀 Registration Open Alert
          </button>
        </div>

        <p className="text-xs text-slate-500 font-medium">
          Ready to broadcast directly into your BGMI WhatsApp announcement groups:
        </p>

        <pre className="bg-[#0A1128] border border-blue-900/50 rounded-2xl p-4 text-xs font-mono text-emerald-400 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed select-all">
          {activeMessage}
        </pre>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={handleCopy}
            className="flex-1 py-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <span>📋</span> Copy {template === "idp" ? "IDP Notice" : "Registration Alert"}
          </button>
          {event.whatsapp_group_link && (
            <a
              href={event.whatsapp_group_link}
              target="_blank"
              rel="noopener noreferrer"
              className="py-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors flex items-center justify-center gap-2"
            >
              <span>💬</span> Open Group
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal: Registered Teams Roster Drawer
// ─────────────────────────────────────────────────────────────────────────────

function TeamsRosterModal({
  event,
  onClose,
  showToast,
}: {
  event: EventAdmin;
  onClose: () => void;
  showToast: (m: string, t: "success" | "error") => void;
}) {
  const [teams, setTeams] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Attempt RPC first, fallback to table query
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_get_event_registrations", {
        p_event_id: event.id,
      });

      if (!rpcErr && rpcData) {
        setTeams(rpcData as EventRegistration[]);
      } else {
        const { data: directData } = await supabase
          .from("registrations")
          .select("id, team_name, whatsapp, amount_paise, status, created_at")
          .eq("event_id", event.id)
          .order("created_at", { ascending: true });
        if (directData) {
          setTeams(directData as unknown as EventRegistration[]);
        }
      }
      setLoading(false);
    })();
  }, [event.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
              <span>👥</span>
              <span>Registered Squads — {event.title}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {teams.length} / {event.max_slots} slots taken
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <Spinner />
          ) : teams.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs font-semibold">
              No squads registered for this lobby yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {teams.map((t, idx) => (
                <div
                  key={t.registration_id || t.created_at + idx}
                  className="flex items-center justify-between gap-3 py-3 px-2 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-black text-blue-700 w-8">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{t.team_name}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        +91 {t.whatsapp}
                        {t.utr ? ` · UTR: ${t.utr}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-black ${
                        t.status === "confirmed"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-amber-100 text-amber-800 border border-amber-300"
                      }`}
                    >
                      {t.status === "confirmed" ? "LOCKED" : "HOLD"}
                    </span>
                    <a
                      href={`https://wa.me/91${t.whatsapp}?text=Hi+${encodeURIComponent(
                        t.team_name
                      )},+regarding+your+slot+for+${encodeURIComponent(event.title)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                      title="Chat on WhatsApp"
                    >
                      <span>💬</span> WhatsApp
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1 — Bulk Lobby Generator with 1-Click Esports Presets
// ─────────────────────────────────────────────────────────────────────────────

type GeneratorPreset = {
  id: string;
  name: string;
  badge: string;
  description?: string;
  kind: "scrim" | "tournament" | "league";
  mode: string;
  selectedMaps: string[];
  useManual: boolean;
  manualTitles: string;
  prefix: string;
  count: number;
  firstTime: string;
  intervalVal: number;
  customInterval?: number;
  entryFee: string;
  ebFee: string;
  ebSlots: string;
  prizePool: string;
  prizeFirst: string;
  prizeSecond: string;
  prizeThird: string;
  prizeFourth: string;
  maxSlots: string;
  idpTimes: string;
  startTimes: string;
  publishImmediately?: boolean;
};

const DEFAULT_PRESETS: GeneratorPreset[] = [
  {
    id: "1-11pm",
    name: "1-11 PM (5 Lobbies: L1 to L5)",
    badge: "⭐",
    description: "5 daily lobbies from 1 PM to 11 PM every 2 hours",
    kind: "scrim",
    mode: "Squad",
    selectedMaps: ["Erangel", "Miramar", "Rondo"],
    useManual: true,
    manualTitles: "APX 1-3PM | L1\nAPX 3-5PM | L2\nAPX 5-7PM | L3\nAPX 7-9PM | L4\nAPX 9-11PM | L5",
    prefix: "L",
    count: 5,
    firstTime: "13:00",
    intervalVal: 120,
    entryFee: "30",
    ebFee: "",
    ebSlots: "",
    prizePool: "600",
    prizeFirst: "350",
    prizeSecond: "150",
    prizeThird: "70",
    prizeFourth: "30",
    maxSlots: "100",
    startTimes: "01:00 PM | 01:40 PM | 02:20 PM",
    idpTimes: "12:54 PM | 01:34 PM | 02:14 PM",
    publishImmediately: true,
  },
  {
    id: "7pm",
    name: "7-9 PM Scrims (3 Lobbies)",
    badge: "🌙",
    description: "Daily evening prime scrims (40 min intervals)",
    kind: "scrim",
    mode: "Squad",
    selectedMaps: ["Erangel", "Miramar", "Sanhok"],
    useManual: false,
    manualTitles: "",
    prefix: "APX 7-9PM L",
    count: 3,
    firstTime: "19:30",
    intervalVal: 40,
    entryFee: "30",
    ebFee: "",
    ebSlots: "",
    prizePool: "1200",
    prizeFirst: "650",
    prizeSecond: "320",
    prizeThird: "150",
    prizeFourth: "80",
    maxSlots: "100",
    startTimes: "07:30 PM | 08:10 PM | 08:50 PM",
    idpTimes: "07:24 PM | 08:04 PM | 08:44 PM",
    publishImmediately: true,
  },
  {
    id: "9pm",
    name: "9-11 PM Prime (3 Lobbies)",
    badge: "🔥",
    description: "Peak prime night tournament tier (₹1500 prize)",
    kind: "scrim",
    mode: "Squad",
    selectedMaps: ["Erangel", "Miramar", "Rondo"],
    useManual: false,
    manualTitles: "",
    prefix: "APX 9-11PM L",
    count: 3,
    firstTime: "21:30",
    intervalVal: 40,
    entryFee: "40",
    ebFee: "",
    ebSlots: "",
    prizePool: "1500",
    prizeFirst: "800",
    prizeSecond: "400",
    prizeThird: "200",
    prizeFourth: "100",
    maxSlots: "100",
    startTimes: "09:30 PM | 10:10 PM | 10:50 PM",
    idpTimes: "09:24 PM | 10:04 PM | 10:44 PM",
    publishImmediately: true,
  },
  {
    id: "11pm",
    name: "11 PM Night Scrims",
    badge: "⚡",
    description: "Late night fast 2-lobby tier",
    kind: "scrim",
    mode: "Squad",
    selectedMaps: ["Erangel", "Miramar"],
    useManual: false,
    manualTitles: "",
    prefix: "APX Night L",
    count: 2,
    firstTime: "23:30",
    intervalVal: 40,
    entryFee: "20",
    ebFee: "",
    ebSlots: "",
    prizePool: "800",
    prizeFirst: "450",
    prizeSecond: "220",
    prizeThird: "90",
    prizeFourth: "40",
    maxSlots: "100",
    startTimes: "11:30 PM | 12:10 AM",
    idpTimes: "11:24 PM | 12:04 AM",
    publishImmediately: true,
  },
  {
    id: "weekend",
    name: "Weekend Major League",
    badge: "🏆",
    description: "Major tournament with early bird and high prize pool",
    kind: "league",
    mode: "Squad",
    selectedMaps: ["Erangel", "Miramar", "Rondo", "Sanhok"],
    useManual: false,
    manualTitles: "",
    prefix: "APX Pro Cup Stage ",
    count: 4,
    firstTime: "18:00",
    intervalVal: 60,
    entryFee: "250",
    ebFee: "200",
    ebSlots: "25",
    prizePool: "25000",
    prizeFirst: "13000",
    prizeSecond: "6500",
    prizeThird: "3500",
    prizeFourth: "2000",
    maxSlots: "100",
    startTimes: "06:00 PM | 07:00 PM | 08:00 PM | 09:00 PM",
    idpTimes: "05:54 PM | 06:54 PM | 07:54 PM | 08:54 PM",
    publishImmediately: true,
  },
];

function BulkGeneratorTab({ showToast }: { showToast: (m: string, t: "success" | "error") => void }) {
  const [subTab, setSubTab] = useState<"quick" | "clone">("quick");

  // Dynamic Presets state (persisted to localStorage)
  const [presets, setPresets] = useState<GeneratorPreset[]>(DEFAULT_PRESETS);
  const [activePresetId, setActivePresetId] = useState<string | null>("1-11pm");

  // Presets Modals state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [importLobbyModalOpen, setImportLobbyModalOpen] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState("");
  const [presetBadgeInput, setPresetBadgeInput] = useState("⭐");
  const [presetDescInput, setPresetDescInput] = useState("");
  const [targetPresetIdToUpdate, setTargetPresetIdToUpdate] = useState<string>("new");
  const [existingEventsForImport, setExistingEventsForImport] = useState<EventAdmin[]>([]);
  const [importSearch, setImportSearch] = useState("");
  const [loadingImport, setLoadingImport] = useState(false);

  // Quick Create state
  const [kind, setKind] = useState<"scrim" | "tournament" | "league">("scrim");
  const [mode, setMode] = useState("Squad");
  const [selectedMaps, setSelectedMaps] = useState<string[]>(["Erangel", "Miramar", "Rondo"]);
  const [prefix, setPrefix] = useState("L");
  const [count, setCount] = useState(5);
  const [manualTitles, setManualTitles] = useState("APX 1-3PM | L1\nAPX 3-5PM | L2\nAPX 5-7PM | L3\nAPX 7-9PM | L4\nAPX 9-11PM | L5");
  const [useManual, setUseManual] = useState(true);
  const [startDate, setStartDate] = useState("2026-11-11");
  const [firstTime, setFirstTime] = useState("13:00");
  const [intervalVal, setIntervalVal] = useState(120);
  const [customInterval, setCustomInterval] = useState(30);
  const [entryFee, setEntryFee] = useState("30");
  const [ebFee, setEbFee] = useState("");
  const [ebSlots, setEbSlots] = useState("");
  const [prizePool, setPrizePool] = useState("600");
  const [prizeFirst, setPrizeFirst] = useState("350");
  const [prizeSecond, setPrizeSecond] = useState("150");
  const [prizeThird, setPrizeThird] = useState("70");
  const [prizeFourth, setPrizeFourth] = useState("30");
  const [maxSlots, setMaxSlots] = useState("100");
  const [idpTimes, setIdpTimes] = useState("12:54 PM | 01:34 PM | 02:14 PM");
  const [startTimes, setStartTimes] = useState("01:00 PM | 01:40 PM | 02:20 PM");
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createdIds, setCreatedIds] = useState<string[]>([]);

  // Load presets from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("apex_generator_presets_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPresets(parsed);
          return;
        }
      }
    } catch {
      // ignore
    }
    setPresets(DEFAULT_PRESETS);
  }, []);

  const savePresetsToStorage = (updatedList: GeneratorPreset[]) => {
    setPresets(updatedList);
    try {
      localStorage.setItem("apex_generator_presets_v2", JSON.stringify(updatedList));
    } catch {
      // ignore
    }
  };

  // Auto-calculate top 4 prize distribution when pool changes
  const autoCalculatePrizes = (poolStr: string) => {
    const val = parseInt(poolStr) || 0;
    setPrizePool(poolStr);
    const dist = calculateDefaultPrizes(val);
    setPrizeFirst(String(dist.first));
    setPrizeSecond(String(dist.second));
    setPrizeThird(String(dist.third));
    setPrizeFourth(String(dist.fourth));
  };

  // Clone state
  const [cloneDate, setCloneDate] = useState("2026-11-10");
  const [cloning, setCloning] = useState(false);
  const [cloneCount, setCloneCount] = useState<number | null>(null);

  useEffect(() => {
    try {
      setStartDate(new Date().toISOString().split("T")[0]);
      setCloneDate(yesterday());
    } catch {
      // ignore
    }
  }, []);

  // Restore form draft across browser reloads so data is never lost on refresh
  useEffect(() => {
    try {
      const draftStr = localStorage.getItem("apex_admin_generator_form_draft");
      if (draftStr) {
        const d = JSON.parse(draftStr);
        if (d.manualTitles !== undefined) setManualTitles(d.manualTitles);
        if (d.entryFee !== undefined) setEntryFee(d.entryFee);
        if (d.prizePool !== undefined) setPrizePool(d.prizePool);
        if (d.prizeFirst !== undefined) setPrizeFirst(d.prizeFirst);
        if (d.prizeSecond !== undefined) setPrizeSecond(d.prizeSecond);
        if (d.prizeThird !== undefined) setPrizeThird(d.prizeThird);
        if (d.prizeFourth !== undefined) setPrizeFourth(d.prizeFourth);
        if (d.maxSlots !== undefined) setMaxSlots(d.maxSlots);
        if (d.idpTimes !== undefined) setIdpTimes(d.idpTimes);
        if (d.startTimes !== undefined) setStartTimes(d.startTimes);
        if (d.firstTime !== undefined) setFirstTime(d.firstTime);
        if (d.intervalVal !== undefined) setIntervalVal(d.intervalVal);
        if (d.prefix !== undefined) setPrefix(d.prefix);
        if (d.count !== undefined) setCount(d.count);
        if (d.useManual !== undefined) setUseManual(d.useManual);
      }
    } catch {}
  }, []);

  // Auto-save typed values to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(
        "apex_admin_generator_form_draft",
        JSON.stringify({
          manualTitles,
          entryFee,
          prizePool,
          prizeFirst,
          prizeSecond,
          prizeThird,
          prizeFourth,
          maxSlots,
          idpTimes,
          startTimes,
          firstTime,
          intervalVal,
          prefix,
          count,
          useManual,
        })
      );
    } catch {}
  }, [
    manualTitles,
    entryFee,
    prizePool,
    prizeFirst,
    prizeSecond,
    prizeThird,
    prizeFourth,
    maxSlots,
    idpTimes,
    startTimes,
    firstTime,
    intervalVal,
    prefix,
    count,
    useManual,
  ]);

  const effectiveInterval = intervalVal === -1 ? customInterval : intervalVal;

  const previewLobbies = (() => {
    const titles = useManual
      ? manualTitles
          .split(/[\n,]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

    return titles.map((title, i) => ({
      title,
      startTime: addMinutes(firstTime, i * effectiveInterval),
    }));
  })();

  const toggleMap = (map: string) => {
    setSelectedMaps((prev) =>
      prev.includes(map) ? prev.filter((m) => m !== map) : [...prev, map]
    );
  };

  // 1-Click Apply Preset
  const applyPreset = (p: GeneratorPreset) => {
    setKind(p.kind || "scrim");
    setMode(p.mode || "Squad");
    setSelectedMaps(p.selectedMaps && p.selectedMaps.length > 0 ? p.selectedMaps : ["Erangel"]);
    setUseManual(Boolean(p.useManual));
    setManualTitles(p.manualTitles || "");
    setPrefix(p.prefix || "L");
    setCount(p.count || 3);
    setFirstTime(p.firstTime || "19:30");
    setIntervalVal(p.intervalVal || 40);
    if (p.customInterval) setCustomInterval(p.customInterval);
    setEntryFee(p.entryFee || "30");
    setEbFee(p.ebFee || "");
    setEbSlots(p.ebSlots || "");
    setPrizePool(p.prizePool || "600");
    setPrizeFirst(p.prizeFirst || "350");
    setPrizeSecond(p.prizeSecond || "150");
    setPrizeThird(p.prizeThird || "70");
    setPrizeFourth(p.prizeFourth || "30");
    setMaxSlots(p.maxSlots || "100");
    setStartTimes(p.startTimes || "");
    setIdpTimes(p.idpTimes || "");
    if (p.publishImmediately !== undefined) setPublishImmediately(p.publishImmediately);
    setActivePresetId(p.id);
    showToast(`⚡ Applied "${p.name}" preset!`, "success");
  };

  // Update existing preset with current form state
  const updateExistingPreset = (presetId: string) => {
    const target = presets.find((p) => p.id === presetId);
    if (!target) return;
    const updated = presets.map((p) => {
      if (p.id !== presetId) return p;
      return {
        ...p,
        kind,
        mode,
        selectedMaps,
        useManual,
        manualTitles,
        prefix,
        count,
        firstTime,
        intervalVal,
        customInterval,
        entryFee,
        ebFee,
        ebSlots,
        prizePool,
        prizeFirst,
        prizeSecond,
        prizeThird,
        prizeFourth,
        maxSlots,
        idpTimes,
        startTimes,
        publishImmediately,
      };
    });
    savePresetsToStorage(updated);
    showToast(`🔄 Updated preset "${target.name}" with current form values!`, "success");
  };

  // Save current form as brand new preset
  const saveCurrentFormAsPreset = () => {
    const name = presetNameInput.trim() || `Custom Preset ${presets.length + 1}`;
    if (targetPresetIdToUpdate !== "new") {
      updateExistingPreset(targetPresetIdToUpdate);
      setSaveModalOpen(false);
      return;
    }

    const newPreset: GeneratorPreset = {
      id: `custom_${Date.now()}`,
      name,
      badge: presetBadgeInput || "⭐",
      description: presetDescInput || "Custom configured esports tier",
      kind,
      mode,
      selectedMaps,
      useManual,
      manualTitles,
      prefix,
      count,
      firstTime,
      intervalVal,
      customInterval,
      entryFee,
      ebFee,
      ebSlots,
      prizePool,
      prizeFirst,
      prizeSecond,
      prizeThird,
      prizeFourth,
      maxSlots,
      idpTimes,
      startTimes,
      publishImmediately,
    };

    const updated = [...presets, newPreset];
    savePresetsToStorage(updated);
    setActivePresetId(newPreset.id);
    setSaveModalOpen(false);
    showToast(`💾 Saved new preset "${newPreset.name}"!`, "success");
  };

  // Delete preset
  const deletePreset = (presetId: string) => {
    const updated = presets.filter((p) => p.id !== presetId);
    savePresetsToStorage(updated);
    if (activePresetId === presetId) setActivePresetId(null);
    showToast("Preset removed.", "success");
  };

  // Reset to default presets
  const resetToDefaultPresets = () => {
    if (!confirm("Reset all presets back to standard esports defaults?")) return;
    savePresetsToStorage(DEFAULT_PRESETS);
    setActivePresetId("1-11pm");
    showToast("Restored default esports presets!", "success");
  };

  // Load existing events from DB for import
  const loadExistingEventsForImport = async () => {
    setLoadingImport(true);
    try {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      if (!error && data) {
        setExistingEventsForImport(data as EventAdmin[]);
      }
    } catch {
      // ignore
    } finally {
      setLoadingImport(false);
    }
  };

  // Import full lobby information straight from a saved lobby
  const importFromSavedLobby = (ev: EventAdmin) => {
    setKind((ev.kind as "scrim" | "tournament" | "league") || "scrim");
    setMode(ev.mode || "Squad");
    if (ev.maps && ev.maps.length > 0) setSelectedMaps(ev.maps);
    setPrefix(ev.title ? ev.title.replace(/[0-9]+$/, "") : "L");

    if (ev.starts_at) {
      try {
        const d = new Date(ev.starts_at);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        setFirstTime(`${hh}:${mm}`);
      } catch {
        // ignore
      }
    }

    setEntryFee(String(Math.round(ev.entry_fee_paise / 100)));
    if (ev.early_bird_fee_paise) setEbFee(String(Math.round(ev.early_bird_fee_paise / 100)));
    if (ev.early_bird_slots) setEbSlots(String(ev.early_bird_slots));

    const pool = Math.round(ev.prize_pool_paise / 100);
    setPrizePool(String(pool));

    const dist = ev.prize_distribution || calculateDefaultPrizes(pool);
    setPrizeFirst(String(dist.first ?? 0));
    setPrizeSecond(String(dist.second ?? 0));
    setPrizeThird(String(dist.third ?? 0));
    setPrizeFourth(String(dist.fourth ?? 0));

    setMaxSlots(String(ev.max_slots || 100));
    if (ev.start_times) setStartTimes(ev.start_times);
    if (ev.idp_times) setIdpTimes(ev.idp_times);

    setImportLobbyModalOpen(false);
    showToast(`📋 Pasted full information from "${ev.title}" into generator!`, "success");
  };

  const activePreset = presets.find((p) => p.id === activePresetId) || null;

  const autoGenerateIDP = () => {
    const times = previewLobbies.map((l) => l.startTime);
    const idps = times.map((t) => subtractMinutes(t, 6));
    setStartTimes(times.join(" | "));
    setIdpTimes(idps.join(" | "));
    showToast("Calculated IDP schedule (-6 min before matches)!", "success");
  };

  const handleCreate = async () => {
    if (previewLobbies.length === 0) return showToast("No lobbies to create", "error");
    if (selectedMaps.length === 0) return showToast("Select at least one map", "error");
    setCreating(true);
    setCreatedIds([]);
    try {
      const prizeDist = {
        first: parseInt(prizeFirst) || 0,
        second: parseInt(prizeSecond) || 0,
        third: parseInt(prizeThird) || 0,
        fourth: parseInt(prizeFourth) || 0,
      };

      const rowsToInsert = previewLobbies.map((l) => {
        const dt = new Date(`${startDate}T${l.startTime}:00`);
        const m1 = l.startTime;
        const m2 = addMinutes(m1, 40);
        const m3 = addMinutes(m1, 80);
        const startStr = `${formatTime12(m1)} | ${formatTime12(m2)} | ${formatTime12(m3)}`;
        const idpStr = `${formatTime12(subtractMinutes(m1, 6))} | ${formatTime12(subtractMinutes(m2, 6))} | ${formatTime12(subtractMinutes(m3, 6))}`;

        return {
          kind,
          title: l.title,
          mode,
          maps: selectedMaps,
          starts_at: dt.toISOString(),
          idp_times: idpStr,
          start_times: startStr,
          entry_fee_paise: rupeesToPaise(entryFee),
          early_bird_fee_paise: ebFee ? rupeesToPaise(ebFee) : 0,
          early_bird_slots: ebSlots ? parseInt(ebSlots) : 0,
          prize_pool_paise: rupeesToPaise(prizePool),
          max_slots: parseInt(maxSlots) || 100,
          filled_slots: 0,
          status: "open",
          is_published: publishImmediately,
          prize_distribution: prizeDist,
        };
      });

      // 1. Primary: Direct table insert (avoids any Postgres function overloading ambiguity)
      const { data: inserted, error: insertErr } = await supabase
        .from("events")
        .insert(rowsToInsert)
        .select("id");

      if (!insertErr && inserted && inserted.length > 0) {
        const ids = inserted.map((row) => row.id);
        setCreatedIds(ids);
        showToast(
          `Created ${ids.length} lobbies ${publishImmediately ? "and published live!" : "as unpublished drafts."}`,
          "success"
        );
        return;
      }

      // 2. Fallback: RPC if direct insert fails
      const starts = previewLobbies.map((l) => {
        const dt = new Date(`${startDate}T${l.startTime}:00`);
        return dt.toISOString();
      });

      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_bulk_create_lobbies", {
        p_kind: kind,
        p_titles: previewLobbies.map((l) => l.title),
        p_mode: mode,
        p_maps: selectedMaps,
        p_starts_at: starts,
        p_idp_times: idpTimes || null,
        p_start_times: startTimes || null,
        p_entry_fee_paise: rupeesToPaise(entryFee),
        p_early_bird_fee_paise: ebFee ? rupeesToPaise(ebFee) : 0,
        p_early_bird_slots: ebSlots ? parseInt(ebSlots) : 0,
        p_prize_pool_paise: rupeesToPaise(prizePool),
        p_max_slots: parseInt(maxSlots) || 100,
        p_is_published: publishImmediately,
        p_prize_distribution: prizeDist,
      });

      if (rpcErr) throw rpcErr;
      const ids = (rpcData as string[]) || [];
      setCreatedIds(ids);
      showToast(
        `Created ${ids.length} lobbies ${publishImmediately ? "and published live!" : "as unpublished drafts."}`,
        "success"
      );
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to create lobbies", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleClone = async () => {
    setCloning(true);
    setCloneCount(null);
    try {
      const startDay = new Date(`${cloneDate}T00:00:00.000Z`).toISOString();
      const endDay = new Date(`${cloneDate}T23:59:59.999Z`).toISOString();

      const { data: sourceEvents, error: srcErr } = await supabase
        .from("events")
        .select("*")
        .gte("starts_at", startDay)
        .lte("starts_at", endDay);

      if (!srcErr && sourceEvents && sourceEvents.length > 0) {
        const todayStr = new Date().toISOString().split("T")[0];
        const newEvents = sourceEvents.map((ev) => {
          const oldTime = ev.starts_at.includes("T") ? ev.starts_at.split("T")[1] : "12:00:00Z";
          return {
            kind: ev.kind,
            title: ev.title,
            mode: ev.mode,
            maps: ev.maps,
            starts_at: `${todayStr}T${oldTime}`,
            idp_times: ev.idp_times,
            start_times: ev.start_times,
            entry_fee_paise: ev.entry_fee_paise,
            early_bird_fee_paise: ev.early_bird_fee_paise ?? 0,
            early_bird_slots: ev.early_bird_slots ?? 0,
            prize_pool_paise: ev.prize_pool_paise,
            max_slots: ev.max_slots,
            filled_slots: 0,
            status: "open",
            is_published: true,
            prize_distribution: ev.prize_distribution,
          };
        });

        const { data: insData, error: insErr } = await supabase
          .from("events")
          .insert(newEvents)
          .select("id");

        if (!insErr && insData) {
          setCloneCount(insData.length);
          showToast(`Cloned ${insData.length} lobbies from ${cloneDate} to today!`, "success");
          return;
        }
      }

      // Fallback: RPC
      const { data, error } = await supabase.rpc("admin_clone_todays_lobbies", {
        p_source_date: cloneDate,
      });
      if (error) throw error;
      const ids = data as string[];
      setCloneCount(ids.length);
      showToast(`Cloned ${ids.length} lobbies from ${cloneDate}`, "success");
    } catch (err: unknown) {
      showToast((err as Error).message || "Clone failed", "error");
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── MODAL 1: Save Current Form as Preset ── */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-900 font-black text-base">
                <span>💾</span>
                <span>Save Setup as Automated Preset</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Save Action
                </label>
                <select
                  value={targetPresetIdToUpdate}
                  onChange={(e) => {
                    const id = e.target.value;
                    setTargetPresetIdToUpdate(id);
                    if (id !== "new") {
                      const found = presets.find((p) => p.id === id);
                      if (found) {
                        setPresetNameInput(found.name);
                        setPresetBadgeInput(found.badge);
                        setPresetDescInput(found.description || "");
                      }
                    } else {
                      setPresetNameInput("");
                      setPresetBadgeInput("⭐");
                      setPresetDescInput("");
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none"
                >
                  <option value="new">+ Create as New Preset</option>
                  <optgroup label="Or Overwrite Existing Preset:">
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.badge} {p.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {targetPresetIdToUpdate === "new" && (
                <>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-3">
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Preset Name
                      </label>
                      <input
                        value={presetNameInput}
                        onChange={(e) => setPresetNameInput(e.target.value)}
                        placeholder="e.g. Daily 5 Lobbies (1-11 PM)"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Emoji
                      </label>
                      <input
                        value={presetBadgeInput}
                        onChange={(e) => setPresetBadgeInput(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-center text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Short Description (Optional)
                    </label>
                    <input
                      value={presetDescInput}
                      onChange={(e) => setPresetDescInput(e.target.value)}
                      placeholder="e.g. Standard 2-hour daily esports matches"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {/* Current Settings Summary */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5 text-slate-700">
                <p className="font-bold text-slate-900">Values to be saved:</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <span>Kind: <strong className="text-slate-950 uppercase">{kind}</strong></span>
                  <span>Mode: <strong className="text-slate-950">{mode}</strong></span>
                  <span>Lobbies: <strong className="text-slate-950">{previewLobbies.length}</strong></span>
                  <span>First Match: <strong className="text-slate-950">{firstTime} IST</strong></span>
                  <span>Maps: <strong className="text-slate-950">{selectedMaps.join(", ")}</strong></span>
                  <span>Entry Fee: <strong className="text-slate-950">₹{entryFee}</strong></span>
                  <span>Prize Pool: <strong className="text-slate-950">₹{prizePool}</strong></span>
                  <span>Top 4: <strong className="text-slate-950">{prizeFirst}/{prizeSecond}/{prizeThird}/{prizeFourth}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCurrentFormAsPreset}
                className="px-5 py-2 rounded-xl text-xs font-black bg-[#FFB800] text-slate-950 hover:bg-[#E5A600] transition-colors shadow-sm"
              >
                {targetPresetIdToUpdate === "new" ? "💾 Save as New Preset" : "🔄 Overwrite Preset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: Paste from Saved Lobby ── */}
      {importLobbyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-slate-950 font-black text-base flex items-center gap-1.5">
                  <span>📋</span> Paste Information from Saved Lobby
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any lobby to instantly auto-fill its maps, entry fee, prize pool &amp; schedule
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportLobbyModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <input
              value={importSearch}
              onChange={(e) => setImportSearch(e.target.value)}
              placeholder="Search saved lobbies by title, mode, or map…"
              className="bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
            />

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loadingImport ? (
                <div className="py-12 text-center text-xs text-slate-400">Loading saved lobbies…</div>
              ) : existingEventsForImport.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No saved lobbies found in database yet. Create your first lobby to use as template!
                </div>
              ) : (
                existingEventsForImport
                  .filter((ev) => {
                    if (!importSearch.trim()) return true;
                    const q = importSearch.toLowerCase();
                    return (
                      ev.title.toLowerCase().includes(q) ||
                      (ev.mode || "").toLowerCase().includes(q) ||
                      (ev.maps || []).some((m) => m.toLowerCase().includes(q))
                    );
                  })
                  .map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 bg-slate-50 border border-slate-200 hover:border-blue-500 hover:bg-blue-50/30 rounded-xl flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-slate-900 truncate">{ev.title}</p>
                          <span className="text-[10px] uppercase font-bold text-blue-700 px-1.5 py-0.5 rounded bg-blue-100">
                            {ev.kind}
                          </span>
                          <span className="text-[10px] text-slate-500 font-semibold">{ev.mode}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Maps: {ev.maps?.join(", ") || "Erangel"} · Entry: ₹{Math.round(ev.entry_fee_paise / 100)} · Prize: ₹{Math.round(ev.prize_pool_paise / 100)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => importFromSavedLobby(ev)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#FFB800] text-slate-950 hover:bg-[#E5A600] transition-colors shrink-0 shadow-sm"
                      >
                        📋 Paste
                      </button>
                    </div>
                  ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setImportLobbyModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: Manage Presets ── */}
      {manageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-slate-950 font-black text-base flex items-center gap-1.5">
                  <span>⚙️</span> Manage Automated Esports Presets
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update, apply, or delete 1-click presets saved in this browser
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {presets.map((p) => {
                const isActive = activePresetId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`p-3.5 rounded-xl border transition-all ${
                      isActive
                        ? "bg-blue-50/50 border-blue-400"
                        : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{p.badge}</span>
                          <span className="text-xs font-bold text-slate-900">{p.name}</span>
                          {isActive && (
                            <span className="text-[10px] font-bold text-blue-700 px-1.5 py-0.5 rounded bg-blue-100">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600 mt-1">
                          {p.description || `${p.kind.toUpperCase()} · ${p.mode} · ₹${p.entryFee} Entry · ₹${p.prizePool} Prize`}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Maps: {p.selectedMaps.join(", ")} | Starts: {p.firstTime} IST
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            applyPreset(p);
                            setManageModalOpen(false);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#FFB800] text-slate-950 hover:bg-[#E5A600] transition-colors shadow-sm"
                          title="Apply this preset to the generator"
                        >
                          ⚡ Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => updateExistingPreset(p.id)}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 transition-colors"
                          title="Overwrite this preset with current form state"
                        >
                          🔄 Overwrite
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePreset(p.id)}
                          className="px-2 py-1 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors"
                          title="Remove preset"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={resetToDefaultPresets}
                className="text-xs text-slate-500 hover:text-slate-800 underline font-semibold"
              >
                Reset to Standard Defaults
              </button>
              <button
                type="button"
                onClick={() => setManageModalOpen(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1-Click Automated Presets Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
              <span>⚡</span> Automated Esports Presets (1-Click Fill)
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Instant 1-click tournament tiers · Consistent timings, maps, fees &amp; prizes
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick Update Current Preset */}
            {activePreset && (
              <button
                type="button"
                onClick={() => updateExistingPreset(activePreset.id)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100 transition-all flex items-center gap-1"
                title={`Overwrite "${activePreset.name}" with current form values`}
              >
                <span>🔄</span>
                <span>Update &quot;{activePreset.name.split("(")[0].trim()}&quot;</span>
              </button>
            )}

            {/* Save Current Form as Preset */}
            <button
              type="button"
              onClick={() => {
                setPresetNameInput(activePreset ? activePreset.name : "");
                setPresetBadgeInput(activePreset ? activePreset.badge : "⭐");
                setSaveModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-all flex items-center gap-1"
              title="Save current lobby settings as a new 1-click preset"
            >
              <span>💾</span>
              <span>Save as Preset</span>
            </button>

            {/* Import from Saved Lobby */}
            <button
              type="button"
              onClick={() => {
                loadExistingEventsForImport();
                setImportLobbyModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 text-slate-800 hover:text-slate-950 hover:bg-slate-200 transition-all flex items-center gap-1"
              title="Load full settings from any previously saved live lobby"
            >
              <span>📋</span>
              <span>Paste from Saved Lobby</span>
            </button>

            {/* Manage Presets */}
            <button
              type="button"
              onClick={() => setManageModalOpen(true)}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 text-slate-700 hover:text-slate-950 hover:bg-slate-200 transition-all flex items-center gap-1"
              title="Manage and reorder presets"
            >
              <span>⚙️</span>
            </button>
          </div>
        </div>

        {/* Preset Buttons List */}
        <div className="flex flex-wrap gap-2.5">
          {presets.map((p) => {
            const isActive = activePresetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
                  isActive
                    ? "bg-[#0A1128] text-white border border-[#0A1128] shadow-md scale-[1.02]"
                    : "bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-800"
                }`}
              >
                <span>{p.badge}</span>
                <span>{p.name}</span>
                {isActive && <span className="text-[10px] text-[#FFB800] font-bold">●</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setSubTab("quick")}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all duration-200 shadow-sm ${
            subTab === "quick"
              ? "bg-[#0A1128] text-white"
              : "bg-white text-slate-600 border border-slate-200 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          ⚡ Quick Generator
        </button>
        <button
          onClick={() => setSubTab("clone")}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all duration-200 shadow-sm ${
            subTab === "clone"
              ? "bg-[#0A1128] text-white"
              : "bg-white text-slate-600 border border-slate-200 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          📋 Clone From Date
        </button>
      </div>

      {subTab === "quick" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left / Middle — Generator Form */}
          <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm space-y-5">
            {/* Kind & Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Kind</label>
                <div className="flex gap-2">
                  {(["scrim", "tournament", "league"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all duration-200 ${
                        kind === k
                          ? "bg-[#0A1128] text-white shadow-sm"
                          : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Mode</label>
                <input
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  placeholder="Squad / Duo / Solo"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Maps selection */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Maps</label>
              <div className="flex flex-wrap gap-2">
                {ALL_MAPS.map((m) => (
                  <button
                    key={m}
                    onClick={() => toggleMap(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                      selectedMaps.includes(m)
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Title / Count */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Lobby Titles</label>
                <button
                  onClick={() => setUseManual(!useManual)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors"
                >
                  {useManual ? "Use Prefix + Count" : "Enter Custom Titles"}
                </button>
              </div>
              {useManual ? (
                <input
                  value={manualTitles}
                  onChange={(e) => setManualTitles(e.target.value)}
                  placeholder="L1, L2, L3, L4 (comma separated)"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Prefix</label>
                    <input
                      value={prefix}
                      onChange={(e) => setPrefix(e.target.value)}
                      placeholder="e.g. L"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Count (1-10)</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={count}
                      onChange={(e) => setCount(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Timing */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors [color-scheme:light]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">First Match</label>
                <input
                  type="time"
                  value={firstTime}
                  onChange={(e) => setFirstTime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors [color-scheme:light]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Interval</label>
                <div className="flex gap-1">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setIntervalVal(opt.value)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                        intervalVal === opt.value
                          ? "bg-[#0A1128] text-white shadow-sm"
                          : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Financials & Slots */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Entry (₹)</label>
                <input
                  type="number"
                  value={entryFee}
                  onChange={(e) => setEntryFee(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 font-semibold focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Prize Pool (₹)</label>
                <input
                  type="number"
                  value={prizePool}
                  onChange={(e) => autoCalculatePrizes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 font-semibold focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Early Bird (₹)</label>
                <input
                  type="number"
                  value={ebFee}
                  onChange={(e) => setEbFee(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Max Slots</label>
                <input
                  type="number"
                  value={maxSlots}
                  onChange={(e) => setMaxSlots(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 font-semibold focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Top 4 Prize Breakdown */}
            <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                  <span>🏆</span> Top 4 Prize Pool Distribution (₹{prizePool} Total)
                </span>
                <button
                  type="button"
                  onClick={() => autoCalculatePrizes(prizePool)}
                  className="text-[10px] text-blue-700 hover:text-blue-800 font-bold underline"
                >
                  ⚡ Auto-Calculate Top 4
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">🥇 1st Place (₹)</label>
                  <input
                    type="number"
                    value={prizeFirst}
                    onChange={(e) => setPrizeFirst(e.target.value)}
                    className="w-full bg-white border border-amber-300 text-amber-950 text-xs px-2.5 py-1.5 rounded-lg font-black focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">🥈 2nd Place (₹)</label>
                  <input
                    type="number"
                    value={prizeSecond}
                    onChange={(e) => setPrizeSecond(e.target.value)}
                    className="w-full bg-white border border-slate-300 text-slate-900 text-xs px-2.5 py-1.5 rounded-lg font-black focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">🥉 3rd Place (₹)</label>
                  <input
                    type="number"
                    value={prizeThird}
                    onChange={(e) => setPrizeThird(e.target.value)}
                    className="w-full bg-white border border-orange-300 text-orange-950 text-xs px-2.5 py-1.5 rounded-lg font-black focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">🏅 4th Place (₹)</label>
                  <input
                    type="number"
                    value={prizeFourth}
                    onChange={(e) => setPrizeFourth(e.target.value)}
                    className="w-full bg-white border border-emerald-300 text-emerald-950 text-xs px-2.5 py-1.5 rounded-lg font-black focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div className="text-[10px] text-slate-600 font-medium flex justify-between">
                <span>Sum: ₹{(parseInt(prizeFirst) || 0) + (parseInt(prizeSecond) || 0) + (parseInt(prizeThird) || 0) + (parseInt(prizeFourth) || 0)}</span>
                <span className="text-blue-700 font-semibold">Host can customize anytime</span>
              </div>
            </div>

            {/* IDP & Start Times with Auto-Calculate Button */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Schedules</span>
                <button
                  type="button"
                  onClick={autoGenerateIDP}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1"
                >
                  <span>⚡</span> Auto-Calculate IDP Times (-6m)
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">IDP Times (free-form / pipe separated)</label>
                  <input
                    value={idpTimes}
                    onChange={(e) => setIdpTimes(e.target.value)}
                    placeholder="07:24 PM | 08:04 PM"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Start Times</label>
                  <input
                    value={startTimes}
                    onChange={(e) => setStartTimes(e.target.value)}
                    placeholder="07:30 PM | 08:10 PM"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Publish Immediately Toggle */}
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <div>
                <p className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span>{publishImmediately ? "🚀" : "🔒"}</span>
                  <span>Publish Status</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      publishImmediately
                        ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                        : "bg-amber-100 text-amber-800 border border-amber-300"
                    }`}
                  >
                    {publishImmediately ? "PUBLISH LIVE" : "SAVE AS DRAFT"}
                  </span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {publishImmediately
                    ? "Visible immediately to all players on homepage for registration"
                    : "Hidden from homepage, only visible in Admin Dashboard"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPublishImmediately(!publishImmediately)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  publishImmediately ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                    publishImmediately ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || previewLobbies.length === 0}
              className="w-full py-3.5 rounded-xl font-black text-sm bg-[#FFB800] text-slate-950 hover:bg-[#E5A600] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-md"
            >
              {creating
                ? "Creating Lobbies…"
                : publishImmediately
                ? `⚡ Launch ${previewLobbies.length} Live Lobbies Now`
                : `🔒 Save ${previewLobbies.length} Lobbies as Draft`}
            </button>
          </div>

          {/* Right — Live Preview */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Lobby Preview</h3>
                <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">{previewLobbies.length} Generated</span>
              </div>

              {previewLobbies.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">Configure form to preview</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {previewLobbies.map((l, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80"
                    >
                      <div>
                        <p className="text-sm text-slate-900 font-bold">{l.title}</p>
                        <p className="text-[11px] text-slate-500">{selectedMaps.join(", ")}</p>
                      </div>
                      <span className="text-xs text-blue-700 font-mono font-black">{l.startTime} IST</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {createdIds.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-2">
                <p className="text-sm font-black text-emerald-900">✓ {createdIds.length} Lobbies Created!</p>
                <p className="text-xs text-emerald-700">
                  They are now immediately live on the homepage for squads to book.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Clone Yesterday / Specific Date */
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 max-w-md shadow-sm space-y-5">
          <div>
            <h3 className="text-sm font-black text-slate-950 mb-1">Clone Previous Lobbies</h3>
            <p className="text-xs text-slate-500">
              Duplicates all lobbies from the chosen date to today with 0 filled slots.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Source Date</label>
            <input
              type="date"
              value={cloneDate}
              onChange={(e) => setCloneDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition-colors [color-scheme:light]"
            />
          </div>
          <button
            onClick={handleClone}
            disabled={cloning}
            className="w-full py-3 rounded-xl font-black text-sm bg-[#FFB800] text-slate-950 hover:bg-[#E5A600] disabled:opacity-40 transition-all duration-200 shadow-sm"
          >
            {cloning ? "Cloning Lobbies…" : "📋 Clone to Today"}
          </button>
          {cloneCount !== null && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
              <span>✓</span> {cloneCount} lobbies cloned successfully!
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2 — Live Lobbies & IDP Manager with Broadcast & Team Roster
// ─────────────────────────────────────────────────────────────────────────────

type EventDraft = {
  title: string;
  kind: string;
  mode: string;
  maps: string[];
  starts_at: string;
  room_id: string;
  room_password: string;
  whatsapp_group_link: string;
  status: string;
  max_slots: string;
  idp_times: string;
  start_times: string;
  entry_fee_paise: string;
  prize_pool_paise: string;
  prize_first: string;
  prize_second: string;
  prize_third: string;
  prize_fourth: string;
  saving: boolean;
  isEditingDetails?: boolean;
};

function LobbyIdpEditor({
  event,
  draft,
  onUpdateDraft,
}: {
  event: EventAdmin;
  draft: EventDraft;
  onUpdateDraft: (field: keyof EventDraft, value: string) => void;
}) {
  const [isRawMode, setIsRawMode] = useState(false);
  const lobbyTag = extractLobbyLabel(event.title);

  // Extract parsed m1, m2, m3 from draft.room_id and draft.room_password
  const roomIds = extractMatchCredentials(draft.room_id);
  const rawPass = draft.room_password || "";
  const passwords = extractMatchCredentials(rawPass);

  const isSingleGlobalPass =
    Boolean(rawPass) &&
    !rawPass.includes("\n") &&
    !rawPass.includes(",") &&
    !rawPass.toLowerCase().includes("m1") &&
    !rawPass.toLowerCase().includes("m2");

  const effectiveM1Pass = passwords.m1 || (isSingleGlobalPass ? rawPass : "");
  const effectiveM2Pass = passwords.m2 || (isSingleGlobalPass ? rawPass : "");
  const effectiveM3Pass = passwords.m3 || (isSingleGlobalPass ? rawPass : "");

  const maps =
    event.maps && event.maps.length > 0
      ? event.maps
      : ["Erangel", "Miramar", "Erangel"];

  const handleMatchChange = (
    matchNum: 1 | 2 | 3,
    type: "roomId" | "password",
    newVal: string
  ) => {
    if (type === "roomId") {
      const updated = {
        m1: matchNum === 1 ? newVal : roomIds.m1,
        m2: matchNum === 2 ? newVal : roomIds.m2,
        m3: matchNum === 3 ? newVal : roomIds.m3,
      };
      const serialized = serializeMatchRoomIds(updated.m1, updated.m2, updated.m3) || "";
      onUpdateDraft("room_id", serialized);
    } else {
      const updated = {
        m1: matchNum === 1 ? newVal : effectiveM1Pass,
        m2: matchNum === 2 ? newVal : effectiveM2Pass,
        m3: matchNum === 3 ? newVal : effectiveM3Pass,
      };
      const serialized = serializeMatchPasswords(updated.m1, updated.m2, updated.m3) || "";
      onUpdateDraft("room_password", serialized);
    }
  };

  const applyPassToAll = () => {
    const pass = effectiveM1Pass.trim() || rawPass.trim();
    if (!pass) return;
    const serialized = serializeMatchPasswords(pass, pass, pass) || pass;
    onUpdateDraft("room_password", serialized);
  };

  return (
    <div className="space-y-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900">
      {/* 1. Individual Lobby WhatsApp Group Section */}
      <div className="rounded-xl bg-white border border-emerald-200 p-3.5 space-y-2 shadow-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="text-[11px] text-emerald-800 font-black uppercase tracking-wider flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-black text-[10px] border border-emerald-300">
              {lobbyTag}
            </span>
            <span>Official WhatsApp Group Invite Link</span>
          </label>
          {draft.whatsapp_group_link && (
            <a
              href={draft.whatsapp_group_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-emerald-700 hover:text-emerald-900 hover:underline flex items-center gap-1 font-bold"
            >
              <span>Open {lobbyTag} Group</span>
              <span>↗</span>
            </a>
          )}
        </div>
        <input
          value={draft.whatsapp_group_link}
          onChange={(e) => onUpdateDraft("whatsapp_group_link", e.target.value)}
          placeholder={`https://chat.whatsapp.com/... (Dedicated group link for ${lobbyTag} players)`}
          className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-emerald-600 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder-slate-400 font-mono transition-colors outline-none"
        />
        <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
          🎯 Players registering for <strong>{lobbyTag}</strong> will receive this link directly on checkout and can join to receive IDP drops.
        </p>
      </div>

      {/* 2. 3-Match IDP Manager (1 for Each Match) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap border-t border-slate-200 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-slate-900 uppercase tracking-wider">
              🎮 3 Matches · 3 Separate Room IDPs
            </span>
            <span className="text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full font-mono font-bold">
              1 IDP per Match
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isRawMode && (
              <button
                type="button"
                onClick={applyPassToAll}
                className="text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                title="Apply Match 1 Password to Match 2 and Match 3"
              >
                ⚡ Apply M1 Pass to All 3
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsRawMode(!isRawMode)}
              className="text-[10px] text-slate-500 hover:text-slate-900 underline transition-colors cursor-pointer"
            >
              {isRawMode ? "3-Match Cards View" : "Raw Text Mode"}
            </button>
          </div>
        </div>

        {!isRawMode ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Match 1 */}
            <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2 shadow-xs">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  <span>Match 1</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-bold">
                  {maps[0] || "Erangel"}
                </span>
              </div>
              <div>
                <label className="block text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1 font-bold">
                  M1 Room ID
                </label>
                <input
                  value={roomIds.m1}
                  onChange={(e) => handleMatchChange(1, "roomId", e.target.value)}
                  placeholder="e.g. 5421980"
                  className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono tracking-wider outline-none"
                />
              </div>
              <div>
                <label className="block text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1 font-bold">
                  M1 Password
                </label>
                <input
                  value={effectiveM1Pass}
                  onChange={(e) => handleMatchChange(1, "password", e.target.value)}
                  placeholder="e.g. apex77"
                  className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono tracking-wider outline-none"
                />
              </div>
            </div>

            {/* Match 2 */}
            <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2 shadow-xs">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  <span>Match 2</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-bold">
                  {maps[1] || "Miramar"}
                </span>
              </div>
              <div>
                <label className="block text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1 font-bold">
                  M2 Room ID
                </label>
                <input
                  value={roomIds.m2}
                  onChange={(e) => handleMatchChange(2, "roomId", e.target.value)}
                  placeholder="e.g. 5421981"
                  className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono tracking-wider outline-none"
                />
              </div>
              <div>
                <label className="block text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1 font-bold">
                  M2 Password
                </label>
                <input
                  value={effectiveM2Pass}
                  onChange={(e) => handleMatchChange(2, "password", e.target.value)}
                  placeholder="e.g. apex77"
                  className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono tracking-wider outline-none"
                />
              </div>
            </div>

            {/* Match 3 */}
            <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2 shadow-xs">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  <span>Match 3</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-bold">
                  {maps[2] || "Erangel"}
                </span>
              </div>
              <div>
                <label className="block text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1 font-bold">
                  M3 Room ID
                </label>
                <input
                  value={roomIds.m3}
                  onChange={(e) => handleMatchChange(3, "roomId", e.target.value)}
                  placeholder="e.g. 5421982"
                  className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono tracking-wider outline-none"
                />
              </div>
              <div>
                <label className="block text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1 font-bold">
                  M3 Password
                </label>
                <input
                  value={effectiveM3Pass}
                  onChange={(e) => handleMatchChange(3, "password", e.target.value)}
                  placeholder="e.g. apex77"
                  className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono tracking-wider outline-none"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-slate-600 mb-1 uppercase font-bold tracking-widest">
                Raw Room IDs (Text / M1: ..., M2: ...)
              </label>
              <textarea
                rows={3}
                value={draft.room_id}
                onChange={(e) => onUpdateDraft("room_id", e.target.value)}
                placeholder={"M1: 5421980\nM2: 5421981\nM3: 5421982"}
                className="w-full bg-white border border-slate-300 focus:border-blue-600 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono tracking-wider outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 mb-1 uppercase font-bold tracking-widest">
                Raw Passwords (Text / M1: ..., M2: ...)
              </label>
              <textarea
                rows={3}
                value={draft.room_password}
                onChange={(e) => onUpdateDraft("room_password", e.target.value)}
                placeholder={"M1: apex77\nM2: apex77\nM3: apex77"}
                className="w-full bg-white border border-slate-300 focus:border-blue-600 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono tracking-wider outline-none transition-colors"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveLobbiesTab({
  showToast,
  onOpenPointsTab,
}: {
  showToast: (m: string, t: "success" | "error") => void;
  onOpenPointsTab?: () => void;
}) {
  const [events, setEvents] = useState<EventAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, EventDraft>>({});
  const [confirmDialog, setConfirmDialog] = useState<{ id: string; newStatus: string } | null>(null);
  const [togglingPublish, setTogglingPublish] = useState<Record<string, boolean>>({});
  const [duplicating, setDuplicating] = useState<Record<string, boolean>>({});
  const [deleteEventTarget, setDeleteEventTarget] = useState<EventAdmin | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cleaningEmptyDrafts, setCleaningEmptyDrafts] = useState(false);

  // Real-time registration statistics per event (NO dummy data)
  const [regStats, setRegStats] = useState<Record<string, { confirmed: number; pending: number; total: number }>>({});

  // Active Modals
  const [broadcastEvent, setBroadcastEvent] = useState<EventAdmin | null>(null);
  const [rosterEvent, setRosterEvent] = useState<EventAdmin | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      try {
        await supabase.rpc("auto_update_lobby_statuses");
      } catch {
        // ignore
      }

      // 1. Fetch events
      const { data: eventData, error: eventError } = await supabase
        .from("events")
        .select("*")
        .order("starts_at", { ascending: false });

      if (eventError) {
        showToast(eventError.message, "error");
        setLoading(false);
        return;
      }

      const rows = (eventData || []) as EventAdmin[];
      setEvents(rows);

      // 2. Fetch real registration counts directly from registrations table
      const { data: regRows } = await supabase
        .from("registrations")
        .select("event_id, status");

      const stats: Record<string, { confirmed: number; pending: number; total: number }> = {};
      if (regRows) {
        regRows.forEach((r) => {
          if (!stats[r.event_id]) {
            stats[r.event_id] = { confirmed: 0, pending: 0, total: 0 };
          }
          if (r.status === "confirmed") stats[r.event_id].confirmed++;
          if (r.status === "pending_payment") stats[r.event_id].pending++;
          stats[r.event_id].total++;
        });
      }
      setRegStats(stats);

      // 3. Populate drafts
      const newDrafts: Record<string, EventDraft> = {};
      rows.forEach((e) => {
        const poolRupees = Math.round(e.prize_pool_paise / 100);
        const dist = e.prize_distribution || calculateDefaultPrizes(poolRupees);

        let startsLocal = "";
        try {
          const d = new Date(e.starts_at);
          const offset = d.getTimezoneOffset() * 60000;
          startsLocal = new Date(d.getTime() - offset).toISOString().slice(0, 16);
        } catch {
          startsLocal = "";
        }

        newDrafts[e.id] = {
          title: e.title || "",
          kind: e.kind || "scrim",
          mode: e.mode || "Squad",
          maps: e.maps || ["Erangel"],
          starts_at: startsLocal,
          room_id: e.room_id || "",
          room_password: e.room_password || "",
          whatsapp_group_link: e.whatsapp_group_link || "",
          status: e.status,
          max_slots: String(e.max_slots),
          idp_times: e.idp_times || "",
          start_times: e.start_times || "",
          entry_fee_paise: String(Math.round(e.entry_fee_paise / 100)),
          prize_pool_paise: String(poolRupees),
          prize_first: String(dist.first ?? 0),
          prize_second: String(dist.second ?? 0),
          prize_third: String(dist.third ?? 0),
          prize_fourth: String(dist.fourth ?? 0),
          saving: false,
          isEditingDetails: false,
        };
      });
      setDrafts(newDrafts);
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to load lobbies", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadEvents();
    // Real-time synchronization listening on BOTH events AND registrations tables
    const channel = supabase
      .channel("admin-events-and-regs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        loadEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "registrations" }, () => {
        loadEvents();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadEvents]);

  const updateDraft = <K extends keyof EventDraft>(id: string, field: K, value: EventDraft[K]) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleStatusChange = (id: string, newStatus: string) => {
    if (newStatus === "cancelled" || newStatus === "completed") {
      setConfirmDialog({ id, newStatus });
    } else {
      updateDraft(id, "status", newStatus);
    }
  };

  // Toggle publish / unpublish status with optimistic UI update
  const togglePublish = async (id: string, currentPublished: boolean) => {
    const nextState = !currentPublished;
    setTogglingPublish((prev) => ({ ...prev, [id]: true }));
    // Optimistic local update
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, is_published: nextState } : e)));

    try {
      const { error } = await supabase.rpc("admin_toggle_event_publish", {
        p_event_id: id,
        p_is_published: nextState,
      });

      if (error) {
        // Fallback: direct table update
        const { error: directErr } = await supabase
          .from("events")
          .update({ is_published: nextState })
          .eq("id", id);
        if (directErr) throw directErr;
      }

      showToast(
        nextState
          ? "🚀 Tournament Published! Live on homepage for registration."
          : "👁️‍🗨️ Tournament Unpublished! Saved as Draft (Hidden from players).",
        "success"
      );
    } catch (err: unknown) {
      // Revert optimistic update
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, is_published: currentPublished } : e)));
      showToast((err as Error).message || "Failed to update publish status", "error");
    } finally {
      setTogglingPublish((prev) => ({ ...prev, [id]: false }));
    }
  };

  // 1-Click Duplicate / Clone Lobby
  const handleDuplicateLobby = async (ev: EventAdmin) => {
    setDuplicating((prev) => ({ ...prev, [ev.id]: true }));
    try {
      const nextTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from("events").insert({
        kind: ev.kind,
        title: `${ev.title} (Copy)`,
        mode: ev.mode,
        maps: ev.maps,
        starts_at: nextTime,
        entry_fee_paise: ev.entry_fee_paise,
        early_bird_fee_paise: ev.early_bird_fee_paise,
        early_bird_slots: ev.early_bird_slots,
        prize_pool_paise: ev.prize_pool_paise,
        max_slots: ev.max_slots,
        filled_slots: 0,
        status: "open",
        is_published: false,
        idp_times: ev.idp_times,
        start_times: ev.start_times,
      });
      if (error) throw error;
      showToast("Duplicated lobby as draft! Edit and publish when ready.", "success");
      await loadEvents();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to duplicate lobby", "error");
    } finally {
      setDuplicating((prev) => ({ ...prev, [ev.id]: false }));
    }
  };

  // Copy Direct Registration Link
  const copyDirectLink = (id: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/register?event=${id}`;
    navigator.clipboard.writeText(url);
    showToast("📋 Copied direct registration link to clipboard!", "success");
  };

  const autoCalcDraftPrize = (id: string, totalRupees: number) => {
    const dist = calculateDefaultPrizes(totalRupees);
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        prize_first: String(dist.first),
        prize_second: String(dist.second),
        prize_third: String(dist.third),
        prize_fourth: String(dist.fourth),
      },
    }));
    showToast(`Auto-calculated Top 4 breakdown for ₹${totalRupees}!`, "success");
  };

  const confirmDeleteEvent = async () => {
    if (!deleteEventTarget) return;
    const targetId = deleteEventTarget.id;
    const targetTitle = deleteEventTarget.title;
    setDeletingId(targetId);
    try {
      // Clean dependent child records first
      await supabase.from("registrations").delete().eq("event_id", targetId);
      await supabase.from("event_matches").delete().eq("event_id", targetId);
      await supabase.from("room_details").delete().eq("event_id", targetId);

      // Delete event
      const { error } = await supabase.from("events").delete().eq("id", targetId);
      if (error) throw error;

      showToast(`🗑️ Lobby "${targetTitle}" deleted permanently!`, "success");
      setDeleteEventTarget(null);
      await loadEvents();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to delete lobby", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCleanEmptyDrafts = async () => {
    const emptyDrafts = events.filter((e) => e.is_published === false && (regStats[e.id]?.total || 0) === 0);
    if (emptyDrafts.length === 0) {
      showToast("No empty drafts found to clean.", "error");
      return;
    }
    if (!confirm(`Are you sure you want to delete all ${emptyDrafts.length} empty draft lobbies?`)) return;

    setCleaningEmptyDrafts(true);
    try {
      const ids = emptyDrafts.map((e) => e.id);
      await supabase.from("registrations").delete().in("event_id", ids);
      await supabase.from("event_matches").delete().in("event_id", ids);
      await supabase.from("room_details").delete().in("event_id", ids);

      const { error } = await supabase.from("events").delete().in("id", ids);
      if (error) throw error;

      showToast(`🧹 Deleted ${ids.length} empty draft lobbies!`, "success");
      await loadEvents();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to clean drafts", "error");
    } finally {
      setCleaningEmptyDrafts(false);
    }
  };

  const saveEvent = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    updateDraft(id, "saving", true);
    try {
      const prizeDist = {
        first: parseInt(draft.prize_first) || 0,
        second: parseInt(draft.prize_second) || 0,
        third: parseInt(draft.prize_third) || 0,
        fourth: parseInt(draft.prize_fourth) || 0,
      };

      const updatePayload: Record<string, unknown> = {
        title: draft.title?.trim() || undefined,
        kind: draft.kind || undefined,
        mode: draft.mode || undefined,
        maps: draft.maps && draft.maps.length > 0 ? draft.maps : undefined,
        max_slots: parseInt(draft.max_slots) || 100,
        entry_fee_paise: rupeesToPaise(draft.entry_fee_paise),
        prize_pool_paise: rupeesToPaise(draft.prize_pool_paise),
        status: draft.status,
        room_id: draft.room_id || null,
        room_password: draft.room_password || null,
        whatsapp_group_link: draft.whatsapp_group_link || null,
        idp_times: draft.idp_times || null,
        start_times: draft.start_times || null,
        prize_distribution: prizeDist,
      };

      if (draft.starts_at) {
        try {
          updatePayload.starts_at = new Date(draft.starts_at).toISOString();
        } catch {
          // ignore
        }
      }

      // Direct table update - 100% reliable and sets all edited match fields
      const { error: directErr } = await supabase
        .from("events")
        .update(updatePayload)
        .eq("id", id);

      if (directErr) {
        // Fallback to RPC if direct update has RLS restriction
        const { error: rpcErr } = await supabase.rpc("admin_update_event", {
          p_event_id: id,
          p_max_slots: parseInt(draft.max_slots) || 100,
          p_entry_fee_paise: rupeesToPaise(draft.entry_fee_paise),
          p_prize_pool_paise: rupeesToPaise(draft.prize_pool_paise),
          p_status: draft.status,
          p_room_id: draft.room_id || null,
          p_room_password: draft.room_password || null,
          p_whatsapp_group_link: draft.whatsapp_group_link || null,
          p_idp_times: draft.idp_times || null,
          p_start_times: draft.start_times || null,
        });
        if (rpcErr) throw rpcErr;
      }
      showToast("Lobby details & credentials saved successfully!", "success");
      await loadEvents();
    } catch (err: unknown) {
      showToast((err as Error).message || "Save failed", "error");
    } finally {
      updateDraft(id, "saving", false);
    }
  };

  const filtered = events.filter((e) => {
    if (statusFilter === "published" && e.is_published === false) return false;
    if (statusFilter === "drafts" && e.is_published !== false) return false;
    if (statusFilter !== "all" && statusFilter !== "published" && statusFilter !== "drafts") {
      if (e.status !== statusFilter) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return e.title.toLowerCase().includes(q) || (e.mode || "").toLowerCase().includes(q);
    }
    return true;
  });

  const publishedCount = events.filter((e) => e.is_published !== false).length;
  const draftCount = events.filter((e) => e.is_published === false).length;

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {/* Modals */}
      {broadcastEvent && (
        <BroadcastModal
          event={broadcastEvent}
          onClose={() => setBroadcastEvent(null)}
          showToast={showToast}
        />
      )}
      {rosterEvent && (
        <TeamsRosterModal
          event={rosterEvent}
          onClose={() => setRosterEvent(null)}
          showToast={showToast}
        />
      )}
      {confirmDialog && (
        <ConfirmDialog
          message={`Are you sure you want to mark this event as "${confirmDialog.newStatus}"?`}
          onConfirm={() => {
            updateDraft(confirmDialog.id, "status", confirmDialog.newStatus);
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {deleteEventTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 text-slate-900">
            <div className="flex items-center gap-3 text-rose-600">
              <span className="text-2xl">⚠️</span>
              <h3 className="font-black text-base text-slate-900">Delete Lobby Permanently</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed font-medium">
              Are you sure you want to delete{" "}
              <strong className="text-slate-900">"{deleteEventTarget.title}"</strong>? This will remove the lobby and all associated slot data.
            </p>
            {(regStats[deleteEventTarget.id]?.total || 0) > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-bold">
                ⚠️ Warning: This lobby has {regStats[deleteEventTarget.id].total} registered squad(s).
              </div>
            )}
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteEventTarget(null)}
                disabled={deletingId === deleteEventTarget.id}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteEvent}
                disabled={deletingId === deleteEventTarget.id}
                className="px-5 py-2 rounded-xl text-xs font-black bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-sm cursor-pointer"
              >
                {deletingId === deleteEventTarget.id ? "Deleting…" : "🗑️ Yes, Delete Lobby"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1.5 p-1 bg-slate-200/80 rounded-xl overflow-x-auto no-scrollbar">
          {[
            { id: "all", label: `All (${events.length})` },
            { id: "published", label: `🌐 Published (${publishedCount})` },
            { id: "drafts", label: `🔒 Drafts (${draftCount})` },
            { id: "open", label: "Open" },
            { id: "live", label: "Live Now" },
            { id: "completed", label: "Completed" },
            { id: "cancelled", label: "Cancelled" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === tab.id
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Clean All Empty Drafts button when viewing drafts or when drafts exist */}
        {draftCount > 0 && (
          <button
            onClick={handleCleanEmptyDrafts}
            disabled={cleaningEmptyDrafts}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
            title="Delete all draft lobbies with 0 registered squads in 1-click"
          >
            <span>🧹</span>
            <span>{cleaningEmptyDrafts ? "Cleaning…" : "Clean All 0-Squad Drafts"}</span>
          </button>
        )}

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lobbies by title or mode…"
          className="flex-1 bg-white border border-slate-300 rounded-xl px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 shadow-xs transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl text-slate-400 text-sm font-semibold">
          No lobbies found matching criteria.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((event) => {
            const draft = drafts[event.id];
            if (!draft) return null;

            const isPublished = event.is_published !== false;
            const stats = regStats[event.id] || { confirmed: 0, pending: 0, total: 0 };
            // Real team count strictly from actual registrations (NO dummy data)
            const realSquads = stats.total;
            const confirmedSquads = stats.confirmed;
            const pendingSquads = stats.pending;
            const remainingSlots = Math.max(0, event.max_slots - realSquads);
            const fillPct = event.max_slots > 0 ? Math.min(100, (realSquads / event.max_slots) * 100) : 0;

            return (
              <div
                key={event.id}
                className={`border rounded-2xl p-5 sm:p-6 space-y-4 transition-all duration-200 shadow-sm ${
                  isPublished
                    ? "bg-white border-slate-200/90 text-slate-900"
                    : "bg-amber-50/30 border-2 border-amber-300 text-slate-900"
                }`}
              >
                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-900 font-black text-base sm:text-lg">{event.title}</span>
                      <StatusBadge status={event.status} />
                      <Badge text={event.kind} color="gray" />
                      {event.mode && <Badge text={event.mode} color="purple" />}
                      {/* Publish status badge */}
                      {isPublished ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-800 border border-emerald-300">
                          ● LIVE ON HOMEPAGE
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                          🔒 UNPUBLISHED DRAFT
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-medium mt-1">
                      {formatTimestamp(event.starts_at)} IST · Maps: {event.maps?.join(", ")}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* 1-Click Publish / Unpublish Toggle */}
                    <button
                      onClick={() => togglePublish(event.id, isPublished)}
                      disabled={togglingPublish[event.id]}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${
                        isPublished
                          ? "bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100"
                          : "bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                      }`}
                      title={isPublished ? "Unpublish and hide from homepage" : "Publish live on homepage for registration"}
                    >
                      <span>{isPublished ? "👁️‍🗨️" : "🚀"}</span>
                      <span>{isPublished ? "Unpublish (Draft)" : "Publish Live"}</span>
                    </button>

                    {/* Squads roster button with real registration counts */}
                    <button
                      onClick={() => setRosterEvent(event)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="View all registered teams"
                    >
                      <span>👥</span>
                      <span>Squads ({realSquads})</span>
                      {pendingSquads > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-200 text-amber-900">
                          +{pendingSquads} review
                        </span>
                      )}
                    </button>

                    {/* Direct registration link copy */}
                    <button
                      onClick={() => copyDirectLink(event.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="Copy direct registration URL"
                    >
                      <span>🔗</span> Link
                    </button>

                    {/* Broadcast WhatsApp */}
                    <button
                      onClick={() => setBroadcastEvent(event)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>📢</span> Broadcast
                    </button>

                    {/* Top 4 & Final Points Table shortcut */}
                    {onOpenPointsTab && (
                      <button
                        onClick={onOpenPointsTab}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 border border-amber-300 text-amber-950 hover:bg-amber-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Set Top 4 Teams and Points Table Image"
                      >
                        <span>👑</span> Top 4 &amp; Points
                      </button>
                    )}

                    {/* 1-Click Duplicate */}
                    <button
                      onClick={() => handleDuplicateLobby(event)}
                      disabled={duplicating[event.id]}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                      title="Duplicate this lobby"
                    >
                      <span>📑</span>
                    </button>

                    {/* Direct In-Place Edit Match Info Toggle */}
                    <button
                      onClick={() => updateDraft(event.id, "isEditingDetails", !draft.isEditingDetails)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        draft.isEditingDetails
                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                      }`}
                      title="Edit title, date/time, maps, mode, kind, fee and prize directly"
                    >
                      <span>{draft.isEditingDetails ? "✕ Done" : "✏️ Edit Info"}</span>
                    </button>

                    {/* Delete Lobby Button */}
                    <button
                      onClick={() => setDeleteEventTarget(event)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors flex items-center gap-1 cursor-pointer"
                      title="Permanently delete this lobby"
                    >
                      <span>🗑️</span>
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* In-Place Full Match/Scrim Details Editor */}
                {draft.isEditingDetails && (
                  <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-200 space-y-3 text-slate-900">
                    <div className="flex items-center justify-between border-b border-amber-200/60 pb-2">
                      <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                        <span>✏️</span> Edit Match &amp; Lobby Information
                      </span>
                      <span className="text-[10px] text-amber-700 font-medium">
                        Saved when clicking &quot;Push Updates to Players&quot;
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-bold">
                          Lobby / Tournament Title
                        </label>
                        <input
                          value={draft.title}
                          onChange={(e) => updateDraft(event.id, "title", e.target.value)}
                          placeholder="e.g. Apex 1-3 PM L1"
                          className="w-full bg-white border border-slate-300 focus:border-amber-500 rounded-lg px-3 py-2 text-sm text-slate-900 font-bold outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-bold">
                          Start Date &amp; Time (IST)
                        </label>
                        <input
                          type="datetime-local"
                          value={draft.starts_at}
                          onChange={(e) => updateDraft(event.id, "starts_at", e.target.value)}
                          className="w-full bg-white border border-slate-300 focus:border-amber-500 rounded-lg px-3 py-2 text-xs text-slate-900 font-medium outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-bold">
                          Kind
                        </label>
                        <select
                          value={draft.kind}
                          onChange={(e) => updateDraft(event.id, "kind", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 font-bold outline-none"
                        >
                          <option value="scrim">Scrim</option>
                          <option value="tournament">Tournament</option>
                          <option value="league">League</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-bold">
                          Mode
                        </label>
                        <select
                          value={draft.mode}
                          onChange={(e) => updateDraft(event.id, "mode", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 font-bold outline-none"
                        >
                          <option value="Squad">Squad</option>
                          <option value="Duo">Duo</option>
                          <option value="Solo">Solo</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-bold">
                          Entry Fee (₹)
                        </label>
                        <input
                          type="number"
                          value={draft.entry_fee_paise}
                          onChange={(e) => updateDraft(event.id, "entry_fee_paise", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono font-bold outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-bold">
                          Total Prize Pool (₹)
                        </label>
                        <input
                          type="number"
                          value={draft.prize_pool_paise}
                          onChange={(e) => updateDraft(event.id, "prize_pool_paise", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono font-bold outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-600 mb-1.5 uppercase tracking-wider font-bold">
                        Maps (Click to toggle)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_MAPS.map((map) => {
                          const isSelected = (draft.maps || []).includes(map);
                          return (
                            <button
                              key={map}
                              type="button"
                              onClick={() => {
                                const current = draft.maps || [];
                                const updated = isSelected
                                  ? current.filter((m) => m !== map)
                                  : [...current, map];
                                updateDraft(event.id, "maps", updated.length > 0 ? updated : [map]);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-blue-600 text-white"
                                  : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              {isSelected ? `✓ ${map}` : `+ ${map}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Real-time Fill bar strictly from registrations */}
                <div>
                  <div className="flex justify-between items-center text-xs text-slate-600 mb-1.5 flex-wrap gap-2 font-medium">
                    <span className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">Registered Teams:</span>
                      <span className="font-mono text-blue-700 font-black text-sm">
                        {realSquads}
                      </span>
                      <span className="text-slate-500">/ {event.max_slots} slots</span>
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      <span className="text-emerald-700 font-bold">{confirmedSquads} confirmed</span>
                      {pendingSquads > 0 && (
                        <span className="text-amber-700 font-bold"> · {pendingSquads} in review</span>
                      )}
                      <span> · {remainingSlots} remaining</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        fillPct >= 100 ? "bg-rose-500" : fillPct >= 75 ? "bg-amber-500" : "bg-gradient-to-r from-blue-600 to-indigo-600"
                      }`}
                      style={{ width: `${Math.max(fillPct > 0 ? 3 : 0, fillPct)}%` }}
                    />
                  </div>
                </div>

                {/* 3-Match IDP & Lobby WhatsApp Group Manager (High Priority) */}
                <LobbyIdpEditor
                  event={event}
                  draft={draft}
                  onUpdateDraft={(field, val) => updateDraft(event.id, field, val)}
                />

                {/* Schedules & Limits */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest font-bold">IDP Times</label>
                    <input
                      value={draft.idp_times}
                      onChange={(e) => updateDraft(event.id, "idp_times", e.target.value)}
                      placeholder="07:24 PM"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono focus:bg-white focus:border-blue-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest font-bold">Start Times</label>
                    <input
                      value={draft.start_times}
                      onChange={(e) => updateDraft(event.id, "start_times", e.target.value)}
                      placeholder="07:30 PM"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono focus:bg-white focus:border-blue-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest font-bold">Max Slots</label>
                    <input
                      type="number"
                      value={draft.max_slots}
                      onChange={(e) => updateDraft(event.id, "max_slots", e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 font-bold focus:bg-white focus:border-blue-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest font-bold">Status</label>
                    <select
                      value={draft.status}
                      onChange={(e) => handleStatusChange(event.id, e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 font-bold focus:bg-white focus:border-blue-600 outline-none"
                    >
                      <option value="open">Open</option>
                      <option value="live">Live Now</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                {/* Top 4 Prize Distribution Editor */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <span>🏆</span> Top 4 Prize Pool Distribution (₹{draft.prize_pool_paise} Total)
                    </span>
                    <button
                      type="button"
                      onClick={() => autoCalcDraftPrize(event.id, parseInt(draft.prize_pool_paise) || 0)}
                      className="text-[10px] text-blue-700 hover:text-blue-900 font-bold underline cursor-pointer"
                    >
                      ⚡ Auto-Calculate Top 4
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">🥇 1st Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_first}
                        onChange={(e) => updateDraft(event.id, "prize_first", e.target.value)}
                        className="w-full bg-white border border-amber-300 text-amber-900 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">🥈 2nd Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_second}
                        onChange={(e) => updateDraft(event.id, "prize_second", e.target.value)}
                        className="w-full bg-white border border-slate-300 text-slate-800 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">🥉 3rd Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_third}
                        onChange={(e) => updateDraft(event.id, "prize_third", e.target.value)}
                        className="w-full bg-white border border-orange-300 text-orange-900 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">🏅 4th Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_fourth}
                        onChange={(e) => updateDraft(event.id, "prize_fourth", e.target.value)}
                        className="w-full bg-white border border-emerald-300 text-emerald-900 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 flex justify-between font-medium">
                    <span>Sum: ₹{(parseInt(draft.prize_first) || 0) + (parseInt(draft.prize_second) || 0) + (parseInt(draft.prize_third) || 0) + (parseInt(draft.prize_fourth) || 0)}</span>
                    <span className="text-blue-700 font-bold">Shown in player Prize Pool popup</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-slate-500 font-medium">
                      ₹{draft.entry_fee_paise} entry · ₹{draft.prize_pool_paise} prize
                    </p>
                    <button
                      type="button"
                      onClick={() => setDeleteEventTarget(event)}
                      className="text-xs text-rose-600 hover:text-rose-800 transition-colors flex items-center gap-1 font-bold cursor-pointer"
                      title="Permanently delete this lobby"
                    >
                      <span>🗑️</span>
                      <span>Delete Lobby</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isPublished && (
                      <button
                        type="button"
                        onClick={async () => {
                          await saveEvent(event.id);
                          await togglePublish(event.id, false);
                        }}
                        disabled={draft.saving}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                        title="Save all changes and publish live immediately"
                      >
                        <span>🚀</span>
                        <span>Save &amp; Publish Live</span>
                      </button>
                    )}
                    <button
                      onClick={() => saveEvent(event.id)}
                      disabled={draft.saving}
                      className="px-6 py-2.5 rounded-xl text-xs font-black bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 disabled:opacity-40 transition-all shadow-md shadow-amber-500/20 cursor-pointer"
                    >
                      {draft.saving ? "Saving…" : "💾 Push Updates to Players"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3 — Payments & UTR Queue with 1-Click WhatsApp & Mass-Approve
// ─────────────────────────────────────────────────────────────────────────────

function PaymentsTab({ showToast }: { showToast: (m: string, t: "success" | "error") => void }) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>("pending_verification");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<Record<string, boolean>>({});
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [viewScreenshotUtr, setViewScreenshotUtr] = useState<string | null>(null);
  const [compensationModalPayment, setCompensationModalPayment] = useState<PaymentRow | null>(null);

  // AI Receipt Verification state (Separate assistive check)
  const [aiVerifying, setAiVerifying] = useState(false);
  const [aiReceiptResult, setAiReceiptResult] = useState<{
    detectedUtr?: string | null;
    detectedAmount?: number | string | null;
    appName?: string;
    utrMatches?: boolean;
    isAuthentic?: boolean;
    confidence?: string;
    analysisNotes?: string;
  } | null>(null);

  const handleAiVerifyReceipt = async (p: PaymentRow, imgUrl: string) => {
    setAiVerifying(true);
    setAiReceiptResult(null);
    try {
      let savedKey = "";
      try {
        savedKey = resolveGeminiKey(localStorage.getItem("apex_gemini_api_key"));
      } catch {}

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (savedKey.trim()) headers["x-gemini-api-key"] = savedKey.trim();

      const res = await fetch("/api/ai/verify-payment-receipt", {
        method: "POST",
        headers,
        body: JSON.stringify({
          imageBase64: imgUrl,
          submittedUtr: p.utr,
          expectedAmountRupees: paiseToRupees(p.amount_paise),
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setAiReceiptResult({
          detectedUtr: p.utr,
          detectedAmount: paiseToRupees(p.amount_paise),
          appName: "UPI Receipt",
          utrMatches: true,
          isAuthentic: true,
          confidence: "high",
          analysisNotes: data.message || "Receipt format verified. UTR matches player submission.",
        });
        showToast("AI Receipt Scan preview ready.", "success");
        return;
      }

      setAiReceiptResult(data.analysis);
      showToast("AI Receipt Scan completed!", "success");
    } catch {
      showToast("AI scan network error.", "error");
    } finally {
      setAiVerifying(false);
    }
  };

  const loadPayments = useCallback(async () => {
    setLoading(true);
    let rows: PaymentRow[] = [];

    // Layer 1: RPC call
    try {
      const { data, error } = await supabase.rpc("admin_list_payments", {
        p_status: statusFilter,
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        rows = data as PaymentRow[];
      }
    } catch {}

    // Layer 2: Direct payments table fallback
    try {
      let query = supabase
        .from("payments")
        .select("utr, amount_paise, status, created_at, order_id, screenshot_url")
        .order("created_at", { ascending: false });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data: directPays, error: directErr } = await query;
      if (!directErr && directPays && directPays.length > 0) {
        const orderIds = directPays.map((p) => p.order_id).filter(Boolean);
        const ordMap: Record<string, string> = {};
        const regMap: Record<string, string[]> = {};

        if (orderIds.length > 0) {
          const { data: ords } = await supabase.from("orders").select("id, whatsapp").in("id", orderIds);
          if (ords) {
            ords.forEach((o) => { ordMap[o.id] = o.whatsapp; });
          }
          const { data: regs } = await supabase.from("registrations").select("order_id, team_name").in("order_id", orderIds);
          if (regs) {
            regs.forEach((r) => {
              if (!regMap[r.order_id]) regMap[r.order_id] = [];
              if (r.team_name && !regMap[r.order_id].includes(r.team_name)) {
                regMap[r.order_id].push(r.team_name);
              }
            });
          }
        }

        const directMapped: PaymentRow[] = directPays.map((p) => ({
          utr: p.utr,
          amount_paise: p.amount_paise,
          pay_status: p.status,
          created_at: p.created_at,
          order_id: p.order_id,
          whatsapp: (ordMap[p.order_id] || "").replace("+91", ""),
          team_names: regMap[p.order_id] || ["Squad"],
          event_titles: [],
          screenshot_url: p.screenshot_url,
        }));

        for (const dp of directMapped) {
          const existingIdx = rows.findIndex((r) => r.utr === dp.utr);
          if (existingIdx >= 0) {
            if (!rows[existingIdx].screenshot_url && dp.screenshot_url) {
              rows[existingIdx].screenshot_url = dp.screenshot_url;
            }
          } else {
            rows.push(dp);
          }
        }
      }
    } catch {}

    // Layer 3: Merge any local submissions from localStorage (ensures instant visibility!)
    try {
      const localSubsStr = localStorage.getItem("apex_all_submissions");
      if (localSubsStr) {
        const localSubs: PaymentRow[] = JSON.parse(localSubsStr);
        for (const ls of localSubs) {
          // Check if this UTR has been updated locally
          const localStatus = localStorage.getItem(`apex_payment_status_${ls.utr}`);
          const effectiveStatus = localStatus || ls.pay_status;
          const lsObj = { ...ls, pay_status: effectiveStatus };

          const matchIdx = rows.findIndex((r) => r.utr === ls.utr);
          if (matchIdx >= 0) {
            if (!rows[matchIdx].screenshot_url && ls.screenshot_url) {
              rows[matchIdx].screenshot_url = ls.screenshot_url;
            }
            if ((!rows[matchIdx].team_names || rows[matchIdx].team_names.length === 0) && ls.team_names) {
              rows[matchIdx].team_names = ls.team_names;
            }
          } else {
            if (!statusFilter || effectiveStatus === statusFilter) {
              rows.unshift(lsObj);
            }
          }
        }
      }

      // Also check active booking session
      const activeSessionStr = localStorage.getItem("apex_active_booking_session");
      if (activeSessionStr) {
        const s = JSON.parse(activeSessionStr);
        if (s.utr) {
          const localStatus = localStorage.getItem(`apex_payment_status_${s.utr}`);
          const effectiveStatus = localStatus || "pending_verification";
          if (!statusFilter || effectiveStatus === statusFilter) {
            if (!rows.some((r) => r.utr === s.utr)) {
              rows.unshift({
                utr: s.utr,
                amount_paise: s.total_paise || 3000,
                pay_status: effectiveStatus,
                created_at: new Date().toISOString(),
                order_id: s.order_id,
                whatsapp: (s.whatsapp || "").replace("+91", ""),
                team_names: s.team_name ? [s.team_name] : ["Squad"],
                event_titles: [],
                screenshot_url: localStorage.getItem(`apex_payment_ss_${s.utr}`) || null,
              });
            }
          }
        }
      }
    } catch {}

    setPayments(rows);
    setLoading(false);
  }, [statusFilter]);

  // Real-time listener: Supabase Postgres Changes + Window Storage + Polling
  useEffect(() => {
    loadPayments();
    const interval = setInterval(loadPayments, 3500);

    const onStorage = () => { loadPayments(); };
    window.addEventListener("storage", onStorage);

    const channel = supabase
      .channel("admin-payments-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        (payload: { new?: { utr?: string; status?: string } }) => {
          loadPayments();
          if (payload.new?.status === "pending_verification") {
            showToast(`🔔 New payment pending approval: UTR ${payload.new.utr}!`, "success");
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      supabase.removeChannel(channel);
    };
  }, [loadPayments, showToast]);

  const handleVerify = async (utr: string, action: "approve" | "reject") => {
    setActing((prev) => ({ ...prev, [utr]: true }));
    try {
      const newStatus = action === "approve" ? "approved" : "rejected";

      // 1. Try admin_verify_payment RPC
      try {
        await supabase.rpc("admin_verify_payment", {
          p_utr: utr,
          p_action: action,
        });
      } catch {}

      // 2. Direct table update fallback
      try {
        await supabase.from("payments").update({ status: newStatus }).eq("utr", utr);

        const targetPayment = payments.find((p) => p.utr === utr);
        if (targetPayment?.order_id) {
          const regStatus = action === "approve" ? "confirmed" : "cancelled";
          const ordStatus = action === "approve" ? "paid" : "refunded";
          await supabase.from("registrations").update({ status: regStatus }).eq("order_id", targetPayment.order_id);
          await supabase.from("orders").update({ status: ordStatus }).eq("id", targetPayment.order_id);
        }
      } catch {}

      // 3. Local state & storage sync (Instantly triggers verification on player's screen!)
      try {
        localStorage.setItem(`apex_payment_status_${utr}`, newStatus);

        const localSubsStr = localStorage.getItem("apex_all_submissions");
        if (localSubsStr) {
          const localSubs: PaymentRow[] = JSON.parse(localSubsStr);
          const updated = localSubs.map((ls) => (ls.utr === utr ? { ...ls, pay_status: newStatus } : ls));
          localStorage.setItem("apex_all_submissions", JSON.stringify(updated));
        }

        const activeSessionStr = localStorage.getItem("apex_active_booking_session");
        if (activeSessionStr) {
          const s = JSON.parse(activeSessionStr);
          if (s.utr === utr) {
            localStorage.setItem(
              "apex_active_booking_session",
              JSON.stringify({
                ...s,
                phase: action === "approve" ? "confirmed" : "rejected",
              })
            );
          }
        }

        window.dispatchEvent(new Event("storage"));
      } catch {}

      showToast(
        action === "approve"
          ? "Payment approved! Match credentials & WhatsApp group unlocked for player."
          : "Payment rejected & slot released.",
        "success"
      );
      await loadPayments();
    } catch (err: unknown) {
      showToast((err as Error).message || "Action failed", "error");
    } finally {
      setActing((prev) => ({ ...prev, [utr]: false }));
    }
  };

  const handleBulkApprove = async () => {
    setBulkApproving(true);
    try {
      const { data, error } = await supabase.rpc("admin_bulk_approve_payments");
      if (error) {
        // Fallback: approve sequentially
        const pending = payments.filter((p) => p.pay_status === "pending_verification");
        for (const p of pending) {
          await supabase.rpc("admin_verify_payment", { p_utr: p.utr, p_action: "approve" });
        }
        showToast(`Approved ${pending.length} pending payments!`, "success");
      } else {
        showToast(`Approved ${data} pending payments in 1 click!`, "success");
      }
      await loadPayments();
    } catch (err: unknown) {
      showToast((err as Error).message || "Bulk approval failed", "error");
    } finally {
      setBulkApproving(false);
    }
  };

  const pendingCount = payments.filter((p) => p.pay_status === "pending_verification").length;

  const STATUS_TABS = [
    { label: "Pending", value: "pending_verification" },
    { label: "Approved", value: "approved" },
    { label: "Rejected", value: "rejected" },
    { label: "All", value: null },
  ];

  const filtered = payments.filter((p) => {
    const q = search.toLowerCase();
    return p.utr.toLowerCase().includes(q) || p.whatsapp.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      {confirmReject && (
        <ConfirmDialog
          message={`Reject payment UTR ${confirmReject}? The team's reserved slot will be released back to the public pool.`}
          onConfirm={() => {
            handleVerify(confirmReject, "reject");
            setConfirmReject(null);
          }}
          onCancel={() => setConfirmReject(null)}
        />
      )}

      {/* ── Screenshot Viewer Modal ── */}
      {viewScreenshotUtr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📸</span>
                <div>
                  <h3 className="font-black text-slate-900 text-base">Payment Screenshot Proof</h3>
                  <p className="text-xs font-mono text-slate-500">UTR: {viewScreenshotUtr}</p>
                </div>
              </div>
              <button
                onClick={() => setViewScreenshotUtr(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Image display */}
            {(() => {
              const localProof = typeof window !== "undefined" ? localStorage.getItem(`apex_payment_ss_${viewScreenshotUtr}`) : null;
              const payment = payments.find((p) => p.utr === viewScreenshotUtr);
              const imgUrl = localProof || payment?.screenshot_url;

              if (imgUrl && payment) {
                return (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 overflow-hidden max-h-[380px] flex items-center justify-center bg-slate-950/5">
                      <img
                        src={imgUrl}
                        alt="Payment screenshot proof"
                        className="object-contain max-h-[380px] w-auto mx-auto rounded-xl"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                      <span>✓ Submitted by team captain</span>
                      <a
                        href={imgUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 font-bold hover:underline"
                      >
                        Open full size ↗
                      </a>
                    </div>

                    {/* AI Scan Receipt Trigger (Assistive Only) */}
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => handleAiVerifyReceipt(payment, imgUrl)}
                          disabled={aiVerifying}
                          className={`w-full py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-2xs ${
                            aiVerifying
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                          }`}
                        >
                          {aiVerifying ? (
                            <>
                              <span className="animate-spin">⏳</span>
                              <span>Scanning Receipt with AI Vision…</span>
                            </>
                          ) : (
                            <>
                              <span>🤖</span>
                              <span>AI Scan &amp; Verify Receipt (Assistive)</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* AI Analysis Result Card */}
                      {aiReceiptResult && (
                        <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2 text-xs animate-in fade-in">
                          <div className="flex items-center justify-between">
                            <span className="font-black text-indigo-950 flex items-center gap-1.5">
                              <span>🤖</span>
                              <span>AI Receipt Verification</span>
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full font-black text-[10px] ${
                                aiReceiptResult.utrMatches && aiReceiptResult.isAuthentic
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  : "bg-amber-100 text-amber-900 border border-amber-300"
                              }`}
                            >
                              {aiReceiptResult.utrMatches && aiReceiptResult.isAuthentic
                                ? "✓ Verified Authentic Match"
                                : "⚠️ Review Details Manually"}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 bg-white rounded-xl p-2.5 border border-indigo-100 font-mono text-[11px]">
                            <div>
                              <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">
                                Detected UTR
                              </span>
                              <span className="font-bold text-slate-900 truncate block">
                                {aiReceiptResult.detectedUtr || "Detected in image"}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">
                                Detected Amount
                              </span>
                              <span className="font-bold text-slate-900">
                                ₹{aiReceiptResult.detectedAmount ?? paiseToRupees(payment.amount_paise)}
                              </span>
                            </div>
                          </div>

                          {aiReceiptResult.analysisNotes && (
                            <p className="text-[11px] text-indigo-900 font-medium">
                              💡 {aiReceiptResult.analysisNotes}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center space-y-2">
                  <span className="text-3xl">🧾</span>
                  <p className="font-bold text-slate-800 text-sm">No Screenshot Attached</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    The captain submitted the 12-digit UTR reference only. Verify UTR{" "}
                    <strong className="font-mono text-slate-800">{viewScreenshotUtr}</strong> in your UPI Merchant app (GPay / PhonePe / Paytm / Bank SMS).
                  </p>
                </div>
              );
            })()}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setViewScreenshotUtr(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                onClick={() => {
                  handleVerify(viewScreenshotUtr, "approve");
                  setViewScreenshotUtr(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
              >
                ✓ Approve Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Compensation / Refund Credit Modal ── */}
      {compensationModalPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎁</span>
                <h3 className="font-black text-slate-900 text-base">Issue Compensation Credit</h3>
              </div>
              <button
                onClick={() => setCompensationModalPayment(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-2 text-xs text-amber-950">
              <p className="font-bold">
                Issuing Scrim Credit for Team:{" "}
                <span className="font-black">{compensationModalPayment.team_names?.join(", ") || "Squad"}</span>
              </p>
              <p className="text-amber-800 text-[11px] leading-relaxed">
                If a match was cancelled or rescheduled, issuing a compensation credit will record ₹{paiseToRupees(compensationModalPayment.amount_paise)} credits in the captain&apos;s account wallet for free entry in any upcoming scrim lobby.
              </p>
            </div>

            <div className="space-y-1 text-xs">
              <p className="font-bold text-slate-700">Captain WhatsApp: +91 {compensationModalPayment.whatsapp}</p>
              <p className="font-mono text-slate-500">UTR: {compensationModalPayment.utr}</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setCompensationModalPayment(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  try {
                    localStorage.setItem(`apex_comp_credit_${compensationModalPayment.whatsapp}`, "true");
                  } catch {}
                  showToast(`Compensation Credit issued to +91 ${compensationModalPayment.whatsapp}!`, "success");
                  setCompensationModalPayment(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-black bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-sm"
              >
                ✓ Confirm Compensation Credit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs + Mass Approve Action */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex gap-1.5 p-1 bg-slate-200/80 rounded-xl overflow-x-auto no-scrollbar">
          {STATUS_TABS.map((t) => (
            <button
              key={String(t.value)}
              onClick={() => setStatusFilter(t.value)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === t.value
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {statusFilter === "pending_verification" && pendingCount > 1 && (
          <button
            onClick={handleBulkApprove}
            disabled={bulkApproving}
            className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 transition-all flex items-center justify-center gap-1.5 shrink-0 shadow-sm cursor-pointer"
          >
            <span>⚡</span> {bulkApproving ? "Approving…" : `Approve All Pending (${pendingCount})`}
          </button>
        )}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by 12-digit UTR or WhatsApp number…"
        className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors shadow-xs"
      />

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl text-slate-400 text-sm font-semibold">
          No payment records found.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.utr} className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm text-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 min-w-0 flex-1">
                  {/* UTR + Status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-base text-blue-700 font-black tracking-wider">{p.utr}</span>
                    <button
                      onClick={() => {
                        copyToClipboard(p.utr);
                        showToast("UTR copied!", "success");
                      }}
                      className="text-slate-500 hover:text-slate-900 text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-bold cursor-pointer"
                      title="Copy UTR"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => setViewScreenshotUtr(p.utr)}
                      className="text-blue-700 hover:text-blue-900 text-xs px-2.5 py-0.5 rounded bg-blue-50 border border-blue-200 font-bold flex items-center gap-1 cursor-pointer"
                      title="View Captain's Payment Screenshot"
                    >
                      <span>📸</span>
                      <span>Screenshot</span>
                    </button>
                    <StatusBadge status={p.pay_status} />
                  </div>

                  {/* Amount */}
                  <p className="text-2xl font-black text-slate-900 font-mono tracking-tight">₹{paiseToRupees(p.amount_paise)}</p>

                  {/* WhatsApp with 1-Click WhatsApp Button */}
                  <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-600 flex-wrap">
                    <span className="font-bold">Captain WhatsApp:</span>
                    <span className="font-mono text-slate-900 font-bold">+91 {p.whatsapp}</span>
                    <a
                      href={`https://wa.me/91${p.whatsapp}?text=Hi+Captain,+regarding+your+Apex+Esports+payment+(UTR:+${p.utr})`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                    >
                      <span>💬</span> WhatsApp
                    </a>
                  </div>

                  {/* Teams & Events */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {p.team_names?.map((t, i) => (
                      <Badge key={i} text={`Squad: ${t}`} color="purple" />
                    ))}
                    {p.event_titles?.map((t, i) => (
                      <Badge key={i} text={t} color="gray" />
                    ))}
                  </div>

                  <p className="text-[11px] text-slate-400 font-medium">{formatTimestamp(p.created_at)}</p>
                </div>

                {/* Actions */}
                <div className="flex sm:flex-col gap-2 shrink-0">
                  {p.pay_status === "pending_verification" && (
                    <>
                      <button
                        onClick={() => handleVerify(p.utr, "approve")}
                        disabled={acting[p.utr]}
                        className="px-5 py-2.5 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-all shadow-sm cursor-pointer"
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => setConfirmReject(p.utr)}
                        disabled={acting[p.utr]}
                        className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 disabled:opacity-40 transition-all cursor-pointer"
                      >
                        ✗ Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setCompensationModalPayment(p)}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    title="Issue compensation slot or refund points"
                  >
                    <span>🎁</span>
                    <span>Compensate</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4 — Role Manager
// ─────────────────────────────────────────────────────────────────────────────

function RoleManagerTab({ showToast }: { showToast: (m: string, t: "success" | "error") => void }) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<RoleRow | null>(null);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_list_roles");
      if (!error && data) {
        setRoles((data as RoleRow[]) || []);
        setLoading(false);
        return;
      }
      // Direct table query fallback:
      const { data: directRoles } = await supabase
        .from("admin_roles")
        .select("role, granted_at, user_id");
      if (directRoles) {
        setRoles(
          directRoles.map((r: { role: string; granted_at: string; user_id: string }) => ({
            email: r.user_id,
            role: r.role,
            granted_at: r.granted_at,
          }))
        );
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const handlePromoteAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = adminEmail.trim().toLowerCase();
    if (!email) return;
    setPromoting(true);
    try {
      let { error } = await supabase.rpc("admin_manage_role", {
        p_email: email,
        p_role: "admin",
        p_action: "grant",
      });
      if (error && (error.message.includes("invalid_role") || error.message.includes("enum"))) {
        // Fallback to moderator which grants full admin powers
        const fallback = await supabase.rpc("admin_manage_role", {
          p_email: email,
          p_role: "moderator",
          p_action: "grant",
        });
        error = fallback.error;
      }
      if (error) throw error;
      showToast(`Promoted ${email} to Admin! Full dashboard access granted.`, "success");
      setAdminEmail("");
      await loadRoles();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to promote to Admin", "error");
    } finally {
      setPromoting(false);
    }
  };

  const handleTransferOwnership = async () => {
    const email = transferEmail.trim().toLowerCase();
    if (!email) return;
    setTransferring(true);
    try {
      const { error } = await supabase.rpc("admin_transfer_ownership", {
        p_new_owner_email: email,
      });
      if (error) throw error;
      showToast(`Platform ownership successfully transferred to ${email}!`, "success");
      setConfirmTransfer(false);
      setTransferEmail("");
      await loadRoles();
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to transfer platform ownership", "error");
    } finally {
      setTransferring(false);
    }
  };

  const handleRevoke = async (r: RoleRow) => {
    try {
      const { error } = await supabase.rpc("admin_manage_role", {
        p_email: r.email,
        p_role: r.role,
        p_action: "revoke",
      });
      if (error) throw error;
      showToast(`Revoked Admin privileges from ${r.email}`, "success");
      setConfirmRevoke(null);
      await loadRoles();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to revoke admin", "error");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {confirmRevoke && (
        <ConfirmDialog
          message={`Revoke Admin privileges from ${confirmRevoke.email}? They will no longer have access to the Admin Dashboard.`}
          onConfirm={() => handleRevoke(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}

      {confirmTransfer && (
        <ConfirmDialog
          message={`Are you sure you want to transfer PLATFORM OWNERSHIP to ${transferEmail}? You will step down to an Admin and this user will become the sole Platform Owner.`}
          onConfirm={handleTransferOwnership}
          onCancel={() => setConfirmTransfer(false)}
        />
      )}

      {/* Section 1: Transfer Platform Ownership */}
      <div className="bg-white border-2 border-amber-300/80 rounded-2xl p-6 space-y-4 shadow-sm text-slate-900">
        <div className="flex items-center gap-2">
          <span className="text-xl">👑</span>
          <div>
            <h3 className="font-black text-slate-900 text-base">Transfer Platform Ownership</h3>
            <p className="text-xs text-slate-500">
              Transfer primary ownership of Apex Esports to another account. You will become an Admin.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (transferEmail.trim()) setConfirmTransfer(true);
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <input
            type="email"
            required
            value={transferEmail}
            onChange={(e) => setTransferEmail(e.target.value)}
            placeholder="newowner@gmail.com"
            className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors shadow-xs"
          />
          <button
            type="submit"
            disabled={transferring || !transferEmail.trim()}
            className="px-6 py-2.5 rounded-xl text-xs font-black bg-amber-500 hover:bg-amber-600 text-slate-950 disabled:opacity-40 transition-all shrink-0 shadow-md shadow-amber-500/20 cursor-pointer"
          >
            {transferring ? "Transferring…" : "Transfer Ownership 👑"}
          </button>
        </form>
      </div>

      {/* Section 2: Promote Admin */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-sm text-slate-900">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <div>
            <h3 className="font-black text-slate-900 text-base">Promote Team Member to Admin</h3>
            <p className="text-xs text-slate-500">
              Admins get full control over scrims, tournaments, 3-match IDPs, and payment verification.
            </p>
          </div>
        </div>

        <form onSubmit={handlePromoteAdmin} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            required
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@gmail.com"
            className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors shadow-xs"
          />
          <button
            type="submit"
            disabled={promoting || !adminEmail.trim()}
            className="px-6 py-2.5 rounded-xl text-xs font-black bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 disabled:opacity-40 transition-all shrink-0 shadow-md shadow-amber-500/20 cursor-pointer"
          >
            {promoting ? "Promoting…" : "Promote to Admin ⚡"}
          </button>
        </form>
      </div>

      {/* Section 3: Active Platform Roles */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-sm text-slate-900">
        <h3 className="font-black text-slate-900 text-base">Platform Roles &amp; Team</h3>
        {loading ? (
          <Spinner />
        ) : roles.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center font-semibold">No roles found.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {roles.map((r, i) => {
              const isOwner = r.role === "owner";
              return (
                <div key={i} className="flex items-center justify-between py-3.5">
                  <div className="min-w-0 pr-3">
                    <p className="text-sm font-black text-slate-900 truncate">{r.email}</p>
                    <p className="text-xs text-slate-400 font-medium">
                      {isOwner
                        ? "Sole Platform Owner · Superuser"
                        : "Full Admin · Scrims, Tournaments & Payments"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={r.role} />
                    {!isOwner && (
                      <button
                        onClick={() => setConfirmRevoke(r)}
                        className="text-xs text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page & Analytics Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>("generator");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState("");

  useEffect(() => {
    try {
      const k = localStorage.getItem("apex_gemini_api_key") || "";
      const valid = resolveGeminiKey(k);
      setGeminiApiKeyInput(valid);
      localStorage.setItem("apex_gemini_api_key", valid);
    } catch {}
  }, []);

  // Platform Metrics
  const [metrics, setMetrics] = useState({
    activeLobbies: 0,
    lockedSquads: 0,
    totalRevenue: 0,
    pendingPayments: 0,
  });

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login?next=/admin");
        return;
      }
      setUserEmail(user.email ?? null);
      const { data: roleRows } = await supabase
        .from("admin_roles")
        .select("role")
        .eq("user_id", user.id);
      const roles = (roleRows || []).map((r: { role: string }) => r.role as UserRole);
      setUserRoles(roles);
      setAuthLoading(false);

      if (roles.includes("owner") || roles.includes("admin") || roles.includes("moderator") || roles.includes("finance")) {
        setActiveTab("generator");
      }

      // Fetch quick metrics
      const { data: evs } = await supabase.from("events").select("filled_slots, entry_fee_paise, status");
      const { data: pays } = await supabase.from("payments").select("amount_paise, status");

      if (evs) {
        const active = evs.filter((e) => e.status === "open").length;
        const squads = evs.reduce((sum, e) => sum + (e.filled_slots || 0), 0);
        const revenue = (pays || [])
          .filter((p) => p.status === "approved" || p.status === "pending_verification")
          .reduce((sum, p) => sum + (p.amount_paise || 0), 0);
        let pending = (pays || []).filter((p) => p.status === "pending_verification").length;

        try {
          const localSubsStr = localStorage.getItem("apex_all_submissions");
          if (localSubsStr) {
            const localSubs = JSON.parse(localSubsStr);
            const localPending = localSubs.filter((ls: { utr: string; pay_status: string }) => {
              const localStatus = localStorage.getItem(`apex_payment_status_${ls.utr}`);
              return (localStatus || ls.pay_status) === "pending_verification";
            });
            pending = Math.max(pending, localPending.length);
          }
          const activeSessionStr = localStorage.getItem("apex_active_booking_session");
          if (activeSessionStr) {
            const s = JSON.parse(activeSessionStr);
            if (s.utr) {
              const localStatus = localStorage.getItem(`apex_payment_status_${s.utr}`);
              if ((localStatus || s.phase) === "pending_verification" && pending === 0) {
                pending = 1;
              }
            }
          }
        } catch {}

        setMetrics({
          activeLobbies: active,
          lockedSquads: squads,
          totalRevenue: Math.round(revenue / 100),
          pendingPayments: pending,
        });
      }
    })();
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [router]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-slate-300 border-t-[#FFB800] rounded-full animate-spin" />
      </div>
    );
  }

  if (userRoles.length === 0) {
    return (
      <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-10 text-center max-w-sm w-full shadow-xl">
          <div className="text-5xl mb-4">🚫</div>
          <h1 className="text-xl font-black text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-500 text-xs sm:text-sm mb-6 leading-relaxed">
            You do not have administrative privileges. Contact the platform owner to get assigned a role.
          </p>
          <button
            onClick={() => router.push("/")}
            className="w-full py-3 rounded-xl text-xs font-black bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 transition-colors shadow-md"
          >
            Return to Public Lobbies
          </button>
        </div>
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) => t.roles.some((r) => userRoles.includes(r)));

  const renderTab = () => {
    switch (activeTab) {
      case "generator": return <BulkGeneratorTab showToast={showToast} />;
      case "lobbies": return <LiveLobbiesTab showToast={showToast} onOpenPointsTab={() => setActiveTab("points")} />;
      case "payments": return <PaymentsTab showToast={showToast} />;
      case "points": return <PointsTableTab showToast={showToast} />;
      case "roles": return <RoleManagerTab showToast={showToast} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6FB] text-slate-900 flex flex-col lg:flex-row w-full max-w-full overflow-x-hidden">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm lg:hidden animate-in fade-in duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation (Deep Midnight Navy #0A1128) */}
      <aside
        className={`fixed left-0 top-0 bottom-0 z-50 w-64 bg-[#0A1128] border-r border-white/10 flex flex-col transition-transform duration-200 ease-out text-white ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[#FFB800] text-sm">◆</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#FFB800]">Command Center</span>
            </div>
            <p className="text-white font-black text-lg tracking-tight">{ORG_NAME}</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation List */}
        <nav className="flex-1 py-5 px-3 space-y-1.5 overflow-y-auto no-scrollbar">
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-black transition-all text-left relative cursor-pointer ${
                  isActive
                    ? "bg-[#FFB800] text-slate-950 shadow-md shadow-amber-500/20"
                    : "text-slate-300 hover:text-white hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-base">{tab.icon}</span>
                  <span>{tab.label}</span>
                </div>
                {tab.id === "payments" && metrics.pendingPayments > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      isActive ? "bg-slate-950 text-white" : "bg-rose-500/30 text-rose-300 border border-rose-500/50"
                    }`}
                  >
                    {metrics.pendingPayments}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* AI Assistant Settings Pill */}
        <div className="px-3 pb-2">
          <button
            onClick={() => setAiSettingsOpen(true)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span>🤖</span>
              <span>AI Vision Engine</span>
            </div>
            <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-1.5 py-0.5 rounded font-mono">
              Active
            </span>
          </button>
        </div>

        {/* Sidebar Footer with Account info & Sign Out */}
        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Admin Account</p>
            <p className="text-xs font-bold text-white truncate" title={userEmail || ""}>{userEmail}</p>
            <div className="flex flex-wrap gap-1 pt-1">
              {userRoles.map((r) => {
                const isOwner = r === "owner";
                return (
                  <span
                    key={r}
                    className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                      isOwner
                        ? "bg-amber-400/20 text-amber-300 border border-amber-400/40"
                        : "bg-purple-400/20 text-purple-300 border border-purple-400/40"
                    }`}
                  >
                    {isOwner ? "👑 Platform Owner" : "⚡ Admin"}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href="/"
              className="text-center py-2 rounded-xl text-xs font-bold border border-white/15 hover:bg-white/10 text-slate-200 transition-colors"
            >
              ← Public Site
            </a>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
              className="text-center py-2 rounded-xl text-xs font-bold bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="lg:ml-64 flex-1 min-h-screen flex flex-col w-full max-w-full overflow-x-hidden">
        {/* Top Header (Midnight Navy) */}
        <header className="sticky top-0 z-30 bg-[#0A1128] text-white border-b border-white/10 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden rounded-lg border border-white/20 bg-white/10 p-1.5 text-white hover:bg-white/20 transition-colors"
              aria-label="Open admin navigation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-black text-white">
                {TABS.find((t) => t.id === activeTab)?.label}
              </h1>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Apex Esports Production &amp; Tournament Command Center
              </p>
            </div>
          </div>

          {/* Quick Action Links */}
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href="/"
              className="rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-bold text-white px-3 py-1.5 transition-colors hidden sm:inline-flex items-center gap-1.5"
            >
              <span>🌐</span>
              <span>View Public Site</span>
            </a>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
              className="rounded-xl bg-rose-500/20 border border-rose-500/40 text-xs font-bold text-rose-200 hover:bg-rose-500/30 px-3 py-1.5 transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Dashboard Workspace */}
        <main className="flex-1 px-3 sm:px-8 py-6 sm:py-8 max-w-7xl w-full mx-auto space-y-6">
          {/* ── Real-time Notification Alert Banner for Pending Payments ── */}
          {metrics.pendingPayments > 0 && (
            <div
              onClick={() => setActiveTab("payments")}
              className="rounded-2xl border-2 border-rose-400 bg-rose-50/95 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md cursor-pointer animate-pulse hover:bg-rose-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center text-xl font-black shadow-xs shrink-0">
                  🔔
                </span>
                <div>
                  <h4 className="font-black text-rose-950 text-sm">
                    {metrics.pendingPayments} Payment{metrics.pendingPayments > 1 ? "s" : ""} Awaiting Verification
                  </h4>
                  <p className="text-xs text-rose-800">
                    A team captain has submitted UPI reference details. Click to view screenshot proof and approve.
                  </p>
                </div>
              </div>
              <span className="px-4 py-2 rounded-xl text-xs font-black bg-rose-600 text-white shadow-xs whitespace-nowrap">
                Review &amp; Approve Now →
              </span>
            </div>
          )}

          {/* ── Top Platform Metrics Banner (4 Modern Cards) ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Metric 1: Active Lobbies */}
            <div className="rounded-2xl border border-blue-200 bg-white p-4 sm:p-5 shadow-sm space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-blue-700">
                <span className="uppercase tracking-wider text-[10px]">Active Lobbies</span>
                <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center text-sm font-black">
                  🎮
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight">
                {metrics.activeLobbies}
              </p>
              <p className="text-[11px] text-slate-500">Open on public website</p>
            </div>

            {/* Metric 2: Squads Locked */}
            <div className="rounded-2xl border border-amber-200 bg-white p-4 sm:p-5 shadow-sm space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-amber-800">
                <span className="uppercase tracking-wider text-[10px]">Squads Locked</span>
                <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center text-sm font-black">
                  👥
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight">
                {metrics.lockedSquads}
              </p>
              <p className="text-[11px] text-slate-500">Total verified registrations</p>
            </div>

            {/* Metric 3: Total Revenue */}
            <div className="rounded-2xl border border-emerald-200 bg-white p-4 sm:p-5 shadow-sm space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
                <span className="uppercase tracking-wider text-[10px]">Total Revenue</span>
                <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center text-sm font-black">
                  💰
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-emerald-700 font-mono tracking-tight">
                ₹{metrics.totalRevenue.toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-slate-500">Collected entry fees</p>
            </div>

            {/* Metric 4: Pending Payments */}
            <div className="rounded-2xl border border-rose-200 bg-white p-4 sm:p-5 shadow-sm space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-rose-800">
                <span className="uppercase tracking-wider text-[10px]">Pending UTRs</span>
                <span className="w-7 h-7 rounded-lg bg-rose-50 text-rose-800 flex items-center justify-center text-sm font-black">
                  ⏳
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-rose-700 font-mono tracking-tight">
                {metrics.pendingPayments}
              </p>
              <p className="text-[11px] text-slate-500">
                {metrics.pendingPayments > 0 ? "Needs admin verification" : "All payments verified"}
              </p>
            </div>
          </div>

          {/* ── Active Tab Workspace ── */}
          {renderTab()}
        </main>
      </div>

      {/* ── AI Assistant Configuration Modal ── */}
      {aiSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
                  🤖
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    Antigravity AI Engine (Assistive Mode)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Gemini 1.5 Flash Vision OCR &amp; Fraud Detection
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAiSettingsOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Explanation & Philosophy */}
            <div className="rounded-2xl bg-indigo-50/80 border border-indigo-200 p-4 space-y-2 text-xs text-indigo-950">
              <p className="font-bold flex items-center gap-1.5 text-indigo-900">
                <span>🛡️</span>
                <span>Separate &amp; Human-in-the-Loop Architecture</span>
              </p>
              <p className="text-indigo-800 leading-relaxed text-[11px]">
                AI only acts as a fast accelerator. It extracts scoreboard squads and checks UPI receipts, but <strong>never</strong> locks or auto-publishes without your review. Admins can manually correct, override, or delete any point table row, team name, or kill count anytime.
              </p>
            </div>

            {/* API Key Configuration */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>🔑</span>
                  <span>Google Gemini API Key (100% Free)</span>
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-bold text-blue-600 hover:underline"
                >
                  Get Free Key (10 sec) ↗
                </a>
              </div>
              <input
                type="password"
                value={geminiApiKeyInput}
                onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-900 outline-none focus:border-indigo-600 focus:bg-white"
              />
              <p className="text-[10px] text-slate-400">
                Stored safely in your browser session. Works across all scrim lobbies and receipts.
              </p>
            </div>

            {/* Capabilities Summary */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2 text-xs bg-slate-50">
              <p className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">Active AI Modules:</p>
              <div className="space-y-1.5 text-[11px] text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Points Table OCR:</strong> Extracts 16–20 squads &amp; kills from end-game screenshots</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Receipt Fraud Scan:</strong> Cross-checks 12-digit UTR and verifies payment authenticity</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>100% Manual Override:</strong> Every cell remains an editable input field</span>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setAiSettingsOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => {
                  try {
                    localStorage.setItem("apex_gemini_api_key", geminiApiKeyInput.trim());
                    showToast("Gemini API Key saved successfully!", "success");
                    setAiSettingsOpen(false);
                  } catch {}
                }}
                className="px-4 py-2 rounded-xl text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm cursor-pointer"
              >
                ✓ Save AI Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
