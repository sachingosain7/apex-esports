"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type UserRole = "owner" | "moderator" | "finance";
type AdminTab = "generator" | "lobbies" | "payments" | "roles";

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
  { id: "generator", label: "Bulk Generator", icon: "⚡", roles: ["owner", "moderator"] },
  { id: "lobbies", label: "Live Lobbies & IDP", icon: "🎮", roles: ["owner", "moderator"] },
  { id: "payments", label: "Payments & UTR", icon: "💳", roles: ["owner", "moderator", "finance"] },
  { id: "roles", label: "Role Manager", icon: "🛡", roles: ["owner"] },
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
    emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
    gray: "bg-white/5 text-white/50 border-white/10",
    purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  }[color];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {text}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: "emerald" | "amber" | "red" | "gray" | "purple" }> = {
    open: { label: "Open", color: "emerald" },
    live: { label: "Live Now", color: "emerald" },
    cancelled: { label: "Cancelled", color: "red" },
    completed: { label: "Completed", color: "gray" },
    pending_verification: { label: "Pending", color: "amber" },
    approved: { label: "Approved", color: "emerald" },
    rejected: { label: "Rejected", color: "red" },
    moderator: { label: "Moderator", color: "purple" },
    owner: { label: "Owner", color: "emerald" },
    finance: { label: "Finance", color: "amber" },
  };
  const cfg = map[status] ?? { label: status, color: "gray" as const };
  return <Badge text={cfg.label} color={cfg.color} />;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
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
      <div className="bg-[#0E1118] border border-white/[0.1] rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
        <p className="text-white/90 text-sm leading-relaxed mb-6 font-medium">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white/50 border border-white/10 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
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
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm font-semibold animate-in slide-in-from-bottom-4 duration-300 ${
        type === "success"
          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
          : "bg-red-500/20 border-red-500/40 text-red-300"
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
  const roomId = event.room_id || "NOT SET";
  const roomPass = event.room_password || "NOT SET";
  const start = formatTimestamp(event.starts_at);
  const mapsStr = event.maps?.join(", ") || "Erangel";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const regUrl = `${origin}/register?event=${event.id}`;

  const idpMessage = `🔥 *${ORG_NAME.toUpperCase()} — ROOM CREDENTIALS* 🔥
━━━━━━━━━━━━━━━━━━━━
🎮 *Lobby:* ${event.title} (${event.mode || "Squad"})
⏰ *Match Time:* ${start} IST
📍 *Maps:* ${mapsStr}
${event.idp_times ? `⏱️ *IDP Schedule:* ${event.idp_times}` : ""}
${event.start_times ? `🚀 *Start Schedule:* ${event.start_times}` : ""}
━━━━━━━━━━━━━━━━━━━━
🆔 *ROOM ID:* \`${roomId}\`
🔑 *PASSWORD:* \`${roomPass}\`
━━━━━━━━━━━━━━━━━━━━
⚠️ *CRITICAL INSTRUCTIONS:*
1. Join strictly in your allotted slot number.
2. Mobile devices ONLY (No emulators or iPads allowed).
3. Match starts sharp at schedule time. Good luck & play fair!`;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-[#0E1118] border border-white/[0.1] rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📢</span>
            <h3 className="font-bold text-white text-base">WhatsApp Broadcast Notice</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Template Selector Tabs */}
        <div className="flex p-1 bg-black/40 border border-white/[0.08] rounded-xl gap-1">
          <button
            type="button"
            onClick={() => setTemplate("idp")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
              template === "idp"
                ? "bg-emerald-500 text-black shadow"
                : "text-white/50 hover:text-white"
            }`}
          >
            🔑 Room ID &amp; Password Notice
          </button>
          <button
            type="button"
            onClick={() => setTemplate("registration")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
              template === "registration"
                ? "bg-emerald-500 text-black shadow"
                : "text-white/50 hover:text-white"
            }`}
          >
            🚀 Registration Open Alert
          </button>
        </div>

        <p className="text-xs text-white/50">
          Ready to broadcast directly into your BGMI WhatsApp announcement groups:
        </p>

        <pre className="bg-[#06070B] border border-white/[0.08] rounded-xl p-4 text-xs font-mono text-emerald-300/90 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed select-all">
          {activeMessage}
        </pre>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={handleCopy}
            className="flex-1 py-3 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-black hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2"
          >
            <span>📋</span> Copy {template === "idp" ? "IDP Notice" : "Registration Alert"}
          </button>
          {event.whatsapp_group_link && (
            <a
              href={event.whatsapp_group_link}
              target="_blank"
              rel="noopener noreferrer"
              className="py-3 rounded-xl border border-green-500/30 bg-green-500/10 px-4 text-xs font-bold text-green-400 hover:bg-green-500/20 transition-colors flex items-center justify-center gap-2"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-[#0E1118] border border-white/[0.1] rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <span>👥</span>
              <span>Registered Squads — {event.title}</span>
            </h3>
            <p className="text-xs text-white/40 mt-0.5">
              {teams.length} / {event.max_slots} slots taken
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-sm">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <Spinner />
          ) : teams.length === 0 ? (
            <div className="text-center py-12 text-white/30 text-xs">
              No squads registered for this lobby yet.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {teams.map((t, idx) => (
                <div
                  key={t.registration_id || t.created_at + idx}
                  className="flex items-center justify-between gap-3 py-3 px-2 hover:bg-white/[0.02] rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-emerald-400 w-8">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{t.team_name}</p>
                      <p className="text-xs text-white/40 font-mono">
                        +91 {t.whatsapp}
                        {t.utr ? ` · UTR: ${t.utr}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.status === "confirmed"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
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
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors flex items-center gap-1"
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

        <div className="pt-3 border-t border-white/[0.06] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold border border-white/10 hover:bg-white/5 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0E1118] border border-emerald-500/30 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
                <span>💾</span>
                <span>Save Setup as Automated Preset</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="text-white/40 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">
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
                  className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white"
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
                      <label className="block text-xs font-semibold text-white/70 mb-1">
                        Preset Name
                      </label>
                      <input
                        value={presetNameInput}
                        onChange={(e) => setPresetNameInput(e.target.value)}
                        placeholder="e.g. Daily 5 Lobbies (1-11 PM)"
                        className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white placeholder-white/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-white/70 mb-1">
                        Emoji
                      </label>
                      <input
                        value={presetBadgeInput}
                        onChange={(e) => setPresetBadgeInput(e.target.value)}
                        className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-center text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-white/70 mb-1">
                      Short Description (Optional)
                    </label>
                    <input
                      value={presetDescInput}
                      onChange={(e) => setPresetDescInput(e.target.value)}
                      placeholder="e.g. Standard 2-hour daily esports matches"
                      className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white placeholder-white/30"
                    />
                  </div>
                </>
              )}

              {/* Current Settings Summary */}
              <div className="p-3.5 bg-black/40 border border-white/[0.06] rounded-xl text-xs space-y-1.5 text-white/70">
                <p className="font-bold text-emerald-400">Values to be saved:</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <span>Kind: <strong className="text-white uppercase">{kind}</strong></span>
                  <span>Mode: <strong className="text-white">{mode}</strong></span>
                  <span>Lobbies: <strong className="text-white">{previewLobbies.length}</strong></span>
                  <span>First Match: <strong className="text-white">{firstTime} IST</strong></span>
                  <span>Maps: <strong className="text-white">{selectedMaps.join(", ")}</strong></span>
                  <span>Entry Fee: <strong className="text-white">₹{entryFee}</strong></span>
                  <span>Prize Pool: <strong className="text-white">₹{prizePool}</strong></span>
                  <span>Top 4: <strong className="text-white">{prizeFirst}/{prizeSecond}/{prizeThird}/{prizeFourth}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCurrentFormAsPreset}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-900/30"
              >
                {targetPresetIdToUpdate === "new" ? "💾 Save as New Preset" : "🔄 Overwrite Preset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: Paste from Saved Lobby ── */}
      {importLobbyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0E1118] border border-white/[0.1] rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="text-emerald-400 font-bold text-base flex items-center gap-1.5">
                  <span>📋</span> Paste Information from Saved Lobby
                </h3>
                <p className="text-xs text-white/40 mt-0.5">
                  Click any lobby to instantly auto-fill its maps, entry fee, prize pool &amp; schedule
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportLobbyModalOpen(false)}
                className="text-white/40 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <input
              value={importSearch}
              onChange={(e) => setImportSearch(e.target.value)}
              placeholder="Search saved lobbies by title, mode, or map…"
              className="bg-black/40 border border-white/[0.1] rounded-xl px-3.5 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-500"
            />

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loadingImport ? (
                <div className="py-12 text-center text-xs text-white/40">Loading saved lobbies…</div>
              ) : existingEventsForImport.length === 0 ? (
                <div className="py-12 text-center text-xs text-white/30">
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
                      className="p-3 bg-white/[0.02] border border-white/[0.06] hover:border-emerald-500/40 hover:bg-emerald-500/[0.04] rounded-xl flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-white truncate">{ev.title}</p>
                          <span className="text-[10px] uppercase font-bold text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10">
                            {ev.kind}
                          </span>
                          <span className="text-[10px] text-white/50">{ev.mode}</span>
                        </div>
                        <p className="text-[11px] text-white/40 mt-1">
                          Maps: {ev.maps?.join(", ") || "Erangel"} · Entry: ₹{Math.round(ev.entry_fee_paise / 100)} · Prize: ₹{Math.round(ev.prize_pool_paise / 100)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => importFromSavedLobby(ev)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 transition-colors shrink-0 shadow-sm"
                      >
                        📋 Paste
                      </button>
                    </div>
                  ))
              )}
            </div>

            <div className="pt-2 border-t border-white/[0.08] flex justify-end">
              <button
                type="button"
                onClick={() => setImportLobbyModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: Manage Presets ── */}
      {manageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0E1118] border border-white/[0.1] rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="text-white font-bold text-base flex items-center gap-1.5">
                  <span>⚙️</span> Manage Automated Esports Presets
                </h3>
                <p className="text-xs text-white/40 mt-0.5">
                  Update, apply, or delete 1-click presets saved in this browser
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageModalOpen(false)}
                className="text-white/40 hover:text-white text-sm"
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
                        ? "bg-emerald-500/[0.06] border-emerald-500/40"
                        : "bg-white/[0.02] border-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{p.badge}</span>
                          <span className="text-xs font-bold text-white">{p.name}</span>
                          {isActive && (
                            <span className="text-[10px] font-bold text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/15">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-white/50 mt-1">
                          {p.description || `${p.kind.toUpperCase()} · ${p.mode} · ₹${p.entryFee} Entry · ₹${p.prizePool} Prize`}
                        </p>
                        <p className="text-[10px] text-white/30 font-mono mt-0.5">
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
                          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
                          title="Apply this preset to the generator"
                        >
                          ⚡ Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => updateExistingPreset(p.id)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/[0.05] text-white/80 border border-white/10 hover:bg-white/10"
                          title="Overwrite this preset with current form state"
                        >
                          🔄 Overwrite
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePreset(p.id)}
                          className="px-2 py-1 rounded-lg text-xs text-red-400 hover:bg-red-500/20"
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

            <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between">
              <button
                type="button"
                onClick={resetToDefaultPresets}
                className="text-xs text-white/40 hover:text-white underline"
              >
                Reset to Standard Defaults
              </button>
              <button
                type="button"
                onClick={() => setManageModalOpen(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-white/[0.08] text-white hover:bg-white/15 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1-Click Automated Presets Bar */}
      <div className="bg-[#0E1118] border border-emerald-500/20 rounded-2xl p-5 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <span>⚡</span> Automated Esports Presets (1-Click Fill)
            </span>
            <p className="text-[11px] text-white/40 mt-0.5">
              Instant 1-click tournament tiers · Consistent timings, maps, fees &amp; prizes
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick Update Current Preset */}
            {activePreset && (
              <button
                type="button"
                onClick={() => updateExistingPreset(activePreset.id)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all flex items-center gap-1"
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
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-all flex items-center gap-1"
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
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.05] border border-white/10 text-white/80 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1"
              title="Load full settings from any previously saved live lobby"
            >
              <span>📋</span>
              <span>Paste from Saved Lobby</span>
            </button>

            {/* Manage Presets */}
            <button
              type="button"
              onClick={() => setManageModalOpen(true)}
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1"
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
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md ${
                  isActive
                    ? "bg-emerald-500/25 border border-emerald-500/60 text-emerald-300 ring-1 ring-emerald-500/40 shadow-emerald-950/60 scale-[1.02]"
                    : "bg-white/[0.04] border border-white/10 hover:border-emerald-500/40 hover:bg-emerald-500/10 text-white"
                }`}
              >
                <span>{p.badge}</span>
                <span>{p.name}</span>
                {isActive && <span className="text-[10px] text-emerald-400 font-bold">●</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setSubTab("quick")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
            subTab === "quick"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              : "text-white/40 border border-white/[0.08] hover:text-white/70"
          }`}
        >
          ⚡ Quick Generator
        </button>
        <button
          onClick={() => setSubTab("clone")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
            subTab === "clone"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              : "text-white/40 border border-white/[0.08] hover:text-white/70"
          }`}
        >
          📋 Clone From Date
        </button>
      </div>

      {subTab === "quick" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left / Middle — Generator Form */}
          <div className="lg:col-span-2 bg-[#0E1118] border border-white/[0.08] rounded-2xl p-6 space-y-5">
            {/* Kind & Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-widest">Kind</label>
                <div className="flex gap-2">
                  {(["scrim", "tournament", "league"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize transition-all duration-200 ${
                        kind === k
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-black/40 text-white/40 border border-white/[0.08] hover:text-white/60"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-widest">Mode</label>
                <input
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  placeholder="Squad / Duo / Solo"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>
            </div>

            {/* Maps selection */}
            <div>
              <label className="block text-xs text-white/40 mb-2 uppercase tracking-widest">Maps</label>
              <div className="flex flex-wrap gap-2">
                {ALL_MAPS.map((m) => (
                  <button
                    key={m}
                    onClick={() => toggleMap(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                      selectedMaps.includes(m)
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-black/40 text-white/40 border border-white/[0.08] hover:text-white/60"
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
                <label className="text-xs text-white/40 uppercase tracking-widest">Lobby Titles</label>
                <button
                  onClick={() => setUseManual(!useManual)}
                  className="text-xs text-emerald-400/80 hover:text-emerald-300 transition-colors"
                >
                  {useManual ? "Use Prefix + Count" : "Enter Custom Titles"}
                </button>
              </div>
              {useManual ? (
                <input
                  value={manualTitles}
                  onChange={(e) => setManualTitles(e.target.value)}
                  placeholder="L1, L2, L3, L4 (comma separated)"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-white/30 mb-1">Prefix</label>
                    <input
                      value={prefix}
                      onChange={(e) => setPrefix(e.target.value)}
                      placeholder="e.g. L"
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 mb-1">Count (1-10)</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={count}
                      onChange={(e) => setCount(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Timing */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-widest">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-widest">First Match</label>
                <input
                  type="time"
                  value={firstTime}
                  onChange={(e) => setFirstTime(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-widest">Interval</label>
                <div className="flex gap-1">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setIntervalVal(opt.value)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                        intervalVal === opt.value
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-black/40 text-white/40 border border-white/[0.08] hover:text-white/60"
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
                <label className="block text-xs text-white/40 mb-1 uppercase tracking-widest">Entry (₹)</label>
                <input
                  type="number"
                  value={entryFee}
                  onChange={(e) => setEntryFee(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1 uppercase tracking-widest">Prize Pool (₹)</label>
                <input
                  type="number"
                  value={prizePool}
                  onChange={(e) => autoCalculatePrizes(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1 uppercase tracking-widest">Early Bird (₹)</label>
                <input
                  type="number"
                  value={ebFee}
                  onChange={(e) => setEbFee(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1 uppercase tracking-widest">Max Slots</label>
                <input
                  type="number"
                  value={maxSlots}
                  onChange={(e) => setMaxSlots(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>
            </div>

            {/* Top 4 Prize Breakdown */}
            <div className="bg-black/40 border border-white/[0.08] rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <span>🏆</span> Top 4 Prize Pool Distribution (₹{prizePool} Total)
                </span>
                <button
                  type="button"
                  onClick={() => autoCalculatePrizes(prizePool)}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold underline"
                >
                  ⚡ Auto-Calculate Top 4
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">🥇 1st Place (₹)</label>
                  <input
                    type="number"
                    value={prizeFirst}
                    onChange={(e) => setPrizeFirst(e.target.value)}
                    className="w-full bg-[#0E1118] border border-amber-500/30 text-amber-300 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">🥈 2nd Place (₹)</label>
                  <input
                    type="number"
                    value={prizeSecond}
                    onChange={(e) => setPrizeSecond(e.target.value)}
                    className="w-full bg-[#0E1118] border border-slate-400/30 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">🥉 3rd Place (₹)</label>
                  <input
                    type="number"
                    value={prizeThird}
                    onChange={(e) => setPrizeThird(e.target.value)}
                    className="w-full bg-[#0E1118] border border-orange-500/30 text-orange-300 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">🏅 4th Place (₹)</label>
                  <input
                    type="number"
                    value={prizeFourth}
                    onChange={(e) => setPrizeFourth(e.target.value)}
                    className="w-full bg-[#0E1118] border border-emerald-500/30 text-emerald-300 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                  />
                </div>
              </div>
              <div className="text-[10px] text-white/40 flex justify-between">
                <span>Sum: ₹{(parseInt(prizeFirst) || 0) + (parseInt(prizeSecond) || 0) + (parseInt(prizeThird) || 0) + (parseInt(prizeFourth) || 0)}</span>
                <span className="text-emerald-400/70">Host can customize anytime</span>
              </div>
            </div>

            {/* IDP & Start Times with Auto-Calculate Button */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40 uppercase tracking-widest">Schedules</span>
                <button
                  type="button"
                  onClick={autoGenerateIDP}
                  className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                >
                  <span>⚡</span> Auto-Calculate IDP Times (-6m)
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-white/30 mb-1">IDP Times (free-form / pipe separated)</label>
                  <input
                    value={idpTimes}
                    onChange={(e) => setIdpTimes(e.target.value)}
                    placeholder="07:24 PM | 08:04 PM"
                    className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-white/30 mb-1">Start Times</label>
                  <input
                    value={startTimes}
                    onChange={(e) => setStartTimes(e.target.value)}
                    placeholder="07:30 PM | 08:10 PM"
                    className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Publish Immediately Toggle */}
            <div className="flex items-center justify-between p-3.5 bg-black/40 border border-white/[0.08] rounded-xl">
              <div>
                <p className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>{publishImmediately ? "🚀" : "🔒"}</span>
                  <span>Publish Status</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      publishImmediately
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {publishImmediately ? "PUBLISH LIVE" : "SAVE AS DRAFT"}
                  </span>
                </p>
                <p className="text-[11px] text-white/40 mt-0.5">
                  {publishImmediately
                    ? "Visible immediately to all players on homepage for registration"
                    : "Hidden from homepage, only visible in Admin Dashboard"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPublishImmediately(!publishImmediately)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  publishImmediately ? "bg-emerald-500" : "bg-white/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-black transition-transform ${
                    publishImmediately ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || previewLobbies.length === 0}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-emerald-900/20"
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
            <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest">Lobby Preview</h3>
                <span className="text-xs font-mono text-emerald-400">{previewLobbies.length} Generated</span>
              </div>

              {previewLobbies.length === 0 ? (
                <p className="text-white/20 text-sm text-center py-8">Configure form to preview</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {previewLobbies.map((l, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                    >
                      <div>
                        <p className="text-sm text-white font-semibold">{l.title}</p>
                        <p className="text-[11px] text-white/40">{selectedMaps.join(", ")}</p>
                      </div>
                      <span className="text-xs text-emerald-400 font-mono font-bold">{l.startTime} IST</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {createdIds.length > 0 && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 space-y-2">
                <p className="text-sm font-bold text-emerald-300">✓ {createdIds.length} Lobbies Created!</p>
                <p className="text-xs text-white/60">
                  They are now immediately live on the homepage for squads to book.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Clone Yesterday / Specific Date */
        <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-6 max-w-md space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white mb-1">Clone Previous Lobbies</h3>
            <p className="text-xs text-white/50">
              Duplicates all lobbies from the chosen date to today with 0 filled slots.
            </p>
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-2 uppercase tracking-widest">Source Date</label>
            <input
              type="date"
              value={cloneDate}
              onChange={(e) => setCloneDate(e.target.value)}
              className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-colors [color-scheme:dark]"
            />
          </div>
          <button
            onClick={handleClone}
            disabled={cloning}
            className="w-full py-3 rounded-xl font-bold text-sm bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40 transition-all duration-200"
          >
            {cloning ? "Cloning Lobbies…" : "📋 Clone to Today"}
          </button>
          {cloneCount !== null && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
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

function LiveLobbiesTab({ showToast }: { showToast: (m: string, t: "success" | "error") => void }) {
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0E1118] border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <span className="text-2xl">⚠️</span>
              <h3 className="font-bold text-base text-white">Delete Lobby Permanently</h3>
            </div>
            <p className="text-sm text-white/70">
              Are you sure you want to delete{" "}
              <strong className="text-white">"{deleteEventTarget.title}"</strong>? This will remove the lobby and all associated slot data.
            </p>
            {(regStats[deleteEventTarget.id]?.total || 0) > 0 && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-300">
                ⚠️ Warning: This lobby has {regStats[deleteEventTarget.id].total} registered squad(s).
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteEventTarget(null)}
                disabled={deletingId === deleteEventTarget.id}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-white/15 text-white/70 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteEvent}
                disabled={deletingId === deleteEventTarget.id}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-500 transition-colors shadow-lg shadow-red-900/40"
              >
                {deletingId === deleteEventTarget.id ? "Deleting…" : "🗑️ Yes, Delete Lobby"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1.5 p-1 bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-x-auto">
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
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                statusFilter === tab.id
                  ? "bg-emerald-500 text-black shadow-md shadow-emerald-900/30"
                  : "text-white/40 hover:text-white"
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
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition-all flex items-center gap-1.5 shrink-0"
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
          className="flex-1 bg-black/40 border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-white/20 text-sm">No lobbies found matching criteria.</div>
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
                className={`border rounded-2xl p-5 space-y-4 transition-all duration-200 ${
                  isPublished
                    ? "bg-[#0E1118] border-white/[0.08]"
                    : "bg-[#0A0D12] border-amber-500/20"
                }`}
              >
                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold text-base">{event.title}</span>
                      <StatusBadge status={event.status} />
                      <Badge text={event.kind} color="gray" />
                      {event.mode && <Badge text={event.mode} color="purple" />}
                      {/* Publish status badge */}
                      {isPublished ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          ● LIVE ON HOMEPAGE
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          🔒 UNPUBLISHED DRAFT
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/40 mt-1">
                      {formatTimestamp(event.starts_at)} IST · Maps: {event.maps?.join(", ")}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* 1-Click Publish / Unpublish Toggle */}
                    <button
                      onClick={() => togglePublish(event.id, isPublished)}
                      disabled={togglingPublish[event.id]}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
                        isPublished
                          ? "bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                          : "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25"
                      }`}
                      title={isPublished ? "Unpublish and hide from homepage" : "Publish live on homepage for registration"}
                    >
                      <span>{isPublished ? "👁️‍🗨️" : "🚀"}</span>
                      <span>{isPublished ? "Unpublish (Draft)" : "Publish Live"}</span>
                    </button>

                    {/* Squads roster button with real registration counts */}
                    <button
                      onClick={() => setRosterEvent(event)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.05] border border-white/10 hover:bg-white/10 text-white/90 transition-colors flex items-center gap-1.5"
                      title="View all registered teams"
                    >
                      <span>👥</span>
                      <span>Squads ({realSquads})</span>
                      {pendingSquads > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-500/30 text-amber-300">
                          +{pendingSquads} review
                        </span>
                      )}
                    </button>

                    {/* Direct registration link copy */}
                    <button
                      onClick={() => copyDirectLink(event.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] border border-white/[0.08] hover:bg-white/10 text-white/70 hover:text-white transition-colors flex items-center gap-1.5"
                      title="Copy direct registration URL"
                    >
                      <span>🔗</span> Link
                    </button>

                    {/* Broadcast WhatsApp */}
                    <button
                      onClick={() => setBroadcastEvent(event)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-500/10 border border-green-500/30 text-green-300 hover:bg-green-500/20 transition-colors flex items-center gap-1.5"
                    >
                      <span>📢</span> Broadcast
                    </button>

                    {/* 1-Click Duplicate */}
                    <button
                      onClick={() => handleDuplicateLobby(event)}
                      disabled={duplicating[event.id]}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.03] border border-white/[0.06] hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                      title="Duplicate this lobby"
                    >
                      <span>📑</span>
                    </button>

                    {/* Direct In-Place Edit Match Info Toggle */}
                    <button
                      onClick={() => updateDraft(event.id, "isEditingDetails", !draft.isEditingDetails)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                        draft.isEditingDetails
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "bg-white/[0.04] text-white/80 hover:text-white border border-white/10"
                      }`}
                      title="Edit title, date/time, maps, mode, kind, fee and prize directly"
                    >
                      <span>{draft.isEditingDetails ? "✕ Done" : "✏️ Edit Info"}</span>
                    </button>

                    {/* Delete Lobby Button */}
                    <button
                      onClick={() => setDeleteEventTarget(event)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors flex items-center gap-1"
                      title="Permanently delete this lobby"
                    >
                      <span>🗑️</span>
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* In-Place Full Match/Scrim Details Editor */}
                {draft.isEditingDetails && (
                  <div className="p-4 rounded-xl bg-black/60 border border-amber-500/30 space-y-3">
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                      <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                        <span>✏️</span> Edit Match &amp; Lobby Information
                      </span>
                      <span className="text-[10px] text-white/40">
                        Saved when clicking &quot;Push Updates to Players&quot;
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wider font-semibold">
                          Lobby / Tournament Title
                        </label>
                        <input
                          value={draft.title}
                          onChange={(e) => updateDraft(event.id, "title", e.target.value)}
                          placeholder="e.g. Apex 1-3 PM L1"
                          className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wider font-semibold">
                          Start Date &amp; Time (IST)
                        </label>
                        <input
                          type="datetime-local"
                          value={draft.starts_at}
                          onChange={(e) => updateDraft(event.id, "starts_at", e.target.value)}
                          className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white/90 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wider font-semibold">
                          Kind
                        </label>
                        <select
                          value={draft.kind}
                          onChange={(e) => updateDraft(event.id, "kind", e.target.value)}
                          className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-2.5 py-2 text-xs text-white"
                        >
                          <option value="scrim">Scrim</option>
                          <option value="tournament">Tournament</option>
                          <option value="league">League</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wider font-semibold">
                          Mode
                        </label>
                        <select
                          value={draft.mode}
                          onChange={(e) => updateDraft(event.id, "mode", e.target.value)}
                          className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-2.5 py-2 text-xs text-white"
                        >
                          <option value="Squad">Squad</option>
                          <option value="Duo">Duo</option>
                          <option value="Solo">Solo</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wider font-semibold">
                          Entry Fee (₹)
                        </label>
                        <input
                          type="number"
                          value={draft.entry_fee_paise}
                          onChange={(e) => updateDraft(event.id, "entry_fee_paise", e.target.value)}
                          className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wider font-semibold">
                          Total Prize Pool (₹)
                        </label>
                        <input
                          type="number"
                          value={draft.prize_pool_paise}
                          onChange={(e) => updateDraft(event.id, "prize_pool_paise", e.target.value)}
                          className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-white/50 mb-1.5 uppercase tracking-wider font-semibold">
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
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                isSelected
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                  : "bg-white/[0.04] text-white/40 border border-white/[0.06] hover:text-white"
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
                  <div className="flex justify-between items-center text-xs text-white/50 mb-1.5 flex-wrap gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-bold text-white">Registered Teams:</span>
                      <span className="font-mono text-emerald-400 font-bold text-sm">
                        {realSquads}
                      </span>
                      <span className="text-white/40">/ {event.max_slots} slots</span>
                    </span>
                    <span className="text-[11px] text-white/50 font-mono">
                      <span className="text-emerald-400">{confirmedSquads} confirmed</span>
                      {pendingSquads > 0 && (
                        <span className="text-amber-400"> · {pendingSquads} in review</span>
                      )}
                      <span> · {remainingSlots} remaining</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        fillPct >= 100 ? "bg-red-500" : fillPct >= 75 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.max(fillPct > 0 ? 3 : 0, fillPct)}%` }}
                    />
                  </div>
                </div>

                {/* IDP & Credentials Row (High Priority) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-black/40 border border-emerald-500/20 rounded-xl">
                  <div>
                    <label className="block text-[10px] text-emerald-400/80 mb-1 uppercase font-bold tracking-widest">
                      Room ID
                    </label>
                    <input
                      value={draft.room_id}
                      onChange={(e) => updateDraft(event.id, "room_id", e.target.value)}
                      placeholder="e.g. 5421980"
                      className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-emerald-300 font-mono tracking-wider focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-emerald-400/80 mb-1 uppercase font-bold tracking-widest">
                      Password
                    </label>
                    <input
                      value={draft.room_password}
                      onChange={(e) => updateDraft(event.id, "room_password", e.target.value)}
                      placeholder="e.g. apex77"
                      className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-emerald-300 font-mono tracking-wider focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-emerald-400/80 mb-1 uppercase font-bold tracking-widest">
                      WhatsApp Group Link
                    </label>
                    <input
                      value={draft.whatsapp_group_link}
                      onChange={(e) => updateDraft(event.id, "whatsapp_group_link", e.target.value)}
                      placeholder="https://chat.whatsapp.com/..."
                      className="w-full bg-[#0E1118] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white/80 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Schedules & Limits */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] text-white/30 mb-1 uppercase tracking-widest">IDP Times</label>
                    <input
                      value={draft.idp_times}
                      onChange={(e) => updateDraft(event.id, "idp_times", e.target.value)}
                      placeholder="07:24 PM"
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 mb-1 uppercase tracking-widest">Start Times</label>
                    <input
                      value={draft.start_times}
                      onChange={(e) => updateDraft(event.id, "start_times", e.target.value)}
                      placeholder="07:30 PM"
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 mb-1 uppercase tracking-widest">Max Slots</label>
                    <input
                      type="number"
                      value={draft.max_slots}
                      onChange={(e) => updateDraft(event.id, "max_slots", e.target.value)}
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/30 mb-1 uppercase tracking-widest">Status</label>
                    <select
                      value={draft.status}
                      onChange={(e) => handleStatusChange(event.id, e.target.value)}
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="open">Open</option>
                      <option value="live">Live Now</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                {/* Top 4 Prize Distribution Editor */}
                <div className="bg-black/40 border border-white/[0.08] rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <span>🏆</span> Top 4 Prize Pool Distribution (₹{draft.prize_pool_paise} Total)
                    </span>
                    <button
                      type="button"
                      onClick={() => autoCalcDraftPrize(event.id, parseInt(draft.prize_pool_paise) || 0)}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold underline"
                    >
                      ⚡ Auto-Calculate Top 4
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">🥇 1st Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_first}
                        onChange={(e) => updateDraft(event.id, "prize_first", e.target.value)}
                        className="w-full bg-[#0E1118] border border-amber-500/30 text-amber-300 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">🥈 2nd Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_second}
                        onChange={(e) => updateDraft(event.id, "prize_second", e.target.value)}
                        className="w-full bg-[#0E1118] border border-slate-400/30 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">🥉 3rd Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_third}
                        onChange={(e) => updateDraft(event.id, "prize_third", e.target.value)}
                        className="w-full bg-[#0E1118] border border-orange-500/30 text-orange-300 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">🏅 4th Place (₹)</label>
                      <input
                        type="number"
                        value={draft.prize_fourth}
                        onChange={(e) => updateDraft(event.id, "prize_fourth", e.target.value)}
                        className="w-full bg-[#0E1118] border border-emerald-500/30 text-emerald-300 text-xs px-2.5 py-1.5 rounded-lg font-bold"
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-white/40 flex justify-between">
                    <span>Sum: ₹{(parseInt(draft.prize_first) || 0) + (parseInt(draft.prize_second) || 0) + (parseInt(draft.prize_third) || 0) + (parseInt(draft.prize_fourth) || 0)}</span>
                    <span className="text-emerald-400/70">Shown in player Prize Pool popup</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-white/40">
                      ₹{draft.entry_fee_paise} entry · ₹{draft.prize_pool_paise} prize
                    </p>
                    <button
                      type="button"
                      onClick={() => setDeleteEventTarget(event)}
                      className="text-xs text-red-400/60 hover:text-red-400 transition-colors flex items-center gap-1 font-semibold"
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
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition-all flex items-center gap-1.5 shadow-sm"
                        title="Save all changes and publish live immediately"
                      >
                        <span>🚀</span>
                        <span>Save &amp; Publish Live</span>
                      </button>
                    )}
                    <button
                      onClick={() => saveEvent(event.id)}
                      disabled={draft.saving}
                      className="px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40 transition-all shadow-md"
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

  const loadPayments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_payments", {
      p_status: statusFilter,
    });
    if (error) {
      showToast(error.message, "error");
    } else {
      setPayments((data as PaymentRow[]) || []);
    }
    setLoading(false);
  }, [statusFilter, showToast]);

  useEffect(() => { loadPayments(); }, [loadPayments]);

  const handleVerify = async (utr: string, action: "approve" | "reject") => {
    setActing((prev) => ({ ...prev, [utr]: true }));
    try {
      const { error } = await supabase.rpc("admin_verify_payment", {
        p_utr: utr,
        p_action: action,
      });
      if (error) throw error;
      showToast(action === "approve" ? "Payment approved & verified!" : "Payment rejected & slot released", "success");
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

      {/* Filter Tabs + Mass Approve Action */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex gap-1.5 p-1 bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-x-auto">
          {STATUS_TABS.map((t) => (
            <button
              key={String(t.value)}
              onClick={() => setStatusFilter(t.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                statusFilter === t.value
                  ? "bg-emerald-500 text-black shadow"
                  : "text-white/40 hover:text-white"
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
            className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>⚡</span> {bulkApproving ? "Approving…" : `Approve All Pending (${pendingCount})`}
          </button>
        )}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by 12-digit UTR or WhatsApp number…"
        className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
      />

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/20 text-sm">No payment records found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.utr} className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-5 shadow-lg">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 min-w-0 flex-1">
                  {/* UTR + Status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-emerald-300 font-bold tracking-wider">{p.utr}</span>
                    <button
                      onClick={() => {
                        copyToClipboard(p.utr);
                        showToast("UTR copied!", "success");
                      }}
                      className="text-white/30 hover:text-white text-xs px-2 py-0.5 rounded bg-white/[0.05]"
                      title="Copy UTR"
                    >
                      Copy
                    </button>
                    <StatusBadge status={p.pay_status} />
                  </div>

                  {/* Amount */}
                  <p className="text-2xl font-extrabold text-white">₹{paiseToRupees(p.amount_paise)}</p>

                  {/* WhatsApp with 1-Click WhatsApp Button */}
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <span>Captain WhatsApp:</span>
                    <span className="font-mono text-white font-semibold">+91 {p.whatsapp}</span>
                    <a
                      href={`https://wa.me/91${p.whatsapp}?text=Hi+Captain,+regarding+your+Apex+Esports+payment+(UTR:+${p.utr})`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors flex items-center gap-1"
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

                  <p className="text-[11px] text-white/30">{formatTimestamp(p.created_at)}</p>
                </div>

                {/* Approve / Reject Actions */}
                {p.pay_status === "pending_verification" && (
                  <div className="flex sm:flex-col gap-2 shrink-0">
                    <button
                      onClick={() => handleVerify(p.utr, "approve")}
                      disabled={acting[p.utr]}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40 transition-all shadow-md"
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => setConfirmReject(p.utr)}
                      disabled={acting[p.utr]}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 transition-all"
                    >
                      ✗ Reject
                    </button>
                  </div>
                )}
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
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<"moderator" | "finance">("moderator");
  const [granting, setGranting] = useState(false);
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

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setGranting(true);
    try {
      const { error } = await supabase.rpc("admin_manage_role", {
        p_email: grantEmail.trim().toLowerCase(),
        p_role: grantRole,
        p_action: "grant",
      });
      if (error) throw error;
      showToast(`Granted ${grantRole} role to ${grantEmail}`, "success");
      setGrantEmail("");
      await loadRoles();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to grant role", "error");
    } finally {
      setGranting(false);
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
      showToast(`Revoked ${r.role} from ${r.email}`, "success");
      setConfirmRevoke(null);
      await loadRoles();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to revoke role", "error");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {confirmRevoke && (
        <ConfirmDialog
          message={`Revoke ${confirmRevoke.role} role from ${confirmRevoke.email}?`}
          onConfirm={() => handleRevoke(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}

      {/* Grant role form */}
      <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        <h3 className="font-bold text-white text-base">Grant Team Member Access</h3>
        <p className="text-xs text-white/50">
          Assign moderator or finance permissions to another team member using their signup email.
        </p>

        <form onSubmit={handleGrant} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            required
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="member@gmail.com"
            className="flex-1 bg-black/40 border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
          />
          <select
            value={grantRole}
            onChange={(e) => setGrantRole(e.target.value as "moderator" | "finance")}
            className="bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="moderator">Moderator</option>
            <option value="finance">Finance</option>
          </select>
          <button
            type="submit"
            disabled={granting}
            className="px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40 transition-all shrink-0"
          >
            {granting ? "Granting…" : "Grant Role"}
          </button>
        </form>
      </div>

      {/* Existing roles */}
      <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        <h3 className="font-bold text-white text-base">Active Admin Roles</h3>
        {loading ? (
          <Spinner />
        ) : roles.length === 0 ? (
          <p className="text-xs text-white/30 py-6 text-center">No secondary roles granted yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {roles.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-semibold text-white">{r.email}</p>
                  <p className="text-xs text-white/30">{formatTimestamp(r.granted_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={r.role} />
                  {r.role !== "owner" && (
                    <button
                      onClick={() => setConfirmRevoke(r)}
                      className="text-xs text-red-400 hover:text-red-300 font-semibold"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
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

      if (roles.includes("owner") || roles.includes("moderator")) {
        setActiveTab("generator");
      } else if (roles.includes("finance")) {
        setActiveTab("payments");
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
        const pending = (pays || []).filter((p) => p.status === "pending_verification").length;

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
      <div className="min-h-screen bg-[#06070B] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (userRoles.length === 0) {
    return (
      <div className="min-h-screen bg-[#06070B] flex items-center justify-center p-4">
        <div className="bg-[#0E1118] border border-white/[0.08] rounded-2xl p-10 text-center max-w-sm w-full">
          <div className="text-5xl mb-4">🚫</div>
          <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-white/40 text-sm mb-6 leading-relaxed">
            You do not have administrative privileges. Contact the platform owner to get assigned a role.
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-white/10 text-white hover:bg-white/15 transition-colors"
          >
            Return to Lobbies
          </button>
        </div>
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) => t.roles.some((r) => userRoles.includes(r)));

  const renderTab = () => {
    switch (activeTab) {
      case "generator": return <BulkGeneratorTab showToast={showToast} />;
      case "lobbies": return <LiveLobbiesTab showToast={showToast} />;
      case "payments": return <PaymentsTab showToast={showToast} />;
      case "roles": return <RoleManagerTab showToast={showToast} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#06070B] text-white flex flex-col lg:flex-row">
      {/* Background layers */}
      <div className="pointer-events-none fixed inset-0 tactical-grid opacity-60" />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-48 -left-48 w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="absolute -bottom-48 -right-48 w-[500px] h-[500px] rounded-full bg-purple-500/6 blur-3xl" />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed left-0 top-0 bottom-0 z-50 w-64 bg-[#0E1118] border-r border-white/[0.08] flex flex-col transition-transform duration-200 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="px-6 py-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 glow-pulse" />
            <span className="text-xs font-bold text-white/50 uppercase tracking-widest">Command Center</span>
          </div>
          <p className="text-white font-extrabold text-base tracking-wider">{ORG_NAME}</p>
        </div>

        <nav className="flex-1 py-5 px-3 space-y-1.5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left relative ${
                activeTab === tab.id
                  ? "bg-emerald-500 text-black shadow-lg shadow-emerald-900/30"
                  : "text-white/50 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
              </div>
              {tab.id === "payments" && metrics.pendingPayments > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                    activeTab === tab.id ? "bg-black/30 text-black" : "bg-amber-500/20 text-amber-300"
                  }`}
                >
                  {metrics.pendingPayments}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Back to Site link */}
        <div className="p-4 border-t border-white/[0.06] space-y-3">
          <a
            href="/"
            className="w-full block text-center py-2 rounded-xl text-xs font-semibold border border-white/10 hover:bg-white/5 text-white/60 hover:text-white transition-colors"
          >
            ← View Public Site
          </a>
          <div className="px-2">
            <p className="text-[11px] text-white/30 truncate">{userEmail}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {userRoles.map((r) => (
                <StatusBadge key={r} status={r} />
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="lg:ml-64 flex-1 min-h-screen flex flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-[#06070B]/85 backdrop-blur-md border-b border-white/[0.06] px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-white/40 hover:text-white p-1"
            >
              ☰
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-white">
                {TABS.find((t) => t.id === activeTab)?.label}
              </h1>
              <p className="text-[11px] text-white/40 hidden sm:block">
                Apex Esports Production Management Panel
              </p>
            </div>
          </div>

          {/* Quick Stats Pill Strip */}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4 text-xs font-semibold px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div>
                <span className="text-white/40">Active Lobbies: </span>
                <span className="text-emerald-400 font-bold">{metrics.activeLobbies}</span>
              </div>
              <div className="w-px h-3 bg-white/10" />
              <div>
                <span className="text-white/40">Squads Locked: </span>
                <span className="text-white font-bold">{metrics.lockedSquads}</span>
              </div>
              <div className="w-px h-3 bg-white/10" />
              <div>
                <span className="text-white/40">Revenue: </span>
                <span className="text-emerald-400 font-bold">₹{metrics.totalRevenue.toLocaleString("en-IN")}</span>
              </div>
            </div>

            <a
              href="/"
              className="text-xs text-white/40 hover:text-white transition-colors"
            >
              Exit Dashboard
            </a>
          </div>
        </header>

        {/* Dashboard Workspace */}
        <main className="flex-1 px-4 sm:px-8 py-8 max-w-7xl w-full mx-auto">
          {renderTab()}
        </main>
      </div>
    </div>
  );
}
