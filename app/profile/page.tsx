"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { MatchIDPSection } from "@/components/MatchIDPSection";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type RegStatus = "pending_payment" | "pending_verification" | "confirmed" | "cancelled";

type MyRegistration = {
  id: string;
  team_name: string;
  whatsapp: string;
  amount_paise: number;
  status: RegStatus;
  created_at: string;
  event_id: string;
  order_id: string;
  // joined from events
  event_title: string;
  event_kind: string;
  event_starts_at: string;
  event_room_id: string | null;
  event_room_password: string | null;
  event_whatsapp_group_link: string | null;
  event_idp_times: string | null;
  event_start_times: string | null;
  // joined from orders
  order_expires_at: string | null;
  order_status: string;
  // joined from payments
  utr: string | null;
  slot_number?: number;
  is_slot_list_published?: boolean;
};

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

const STATUS_CONFIG: Record<
  string,
  { label: string; cls: string }
> = {
  confirmed: {
    label: "CONFIRMED",
    cls: "text-emerald-800 bg-emerald-100 border-emerald-300",
  },
  pending_verification: {
    label: "PENDING APPROVAL",
    cls: "text-amber-800 bg-amber-100 border-amber-300",
  },
  pending_payment: {
    label: "PENDING PAYMENT",
    cls: "text-amber-800 bg-amber-100 border-amber-300",
  },
  cancelled: {
    label: "CANCELLED",
    cls: "text-red-800 bg-red-100 border-red-300",
  },
};

const KIND_CONFIG: Record<string, string> = {
  scrim: "text-blue-700 bg-blue-50 border-blue-200",
  tournament: "text-purple-700 bg-purple-50 border-purple-200",
  league: "text-amber-800 bg-amber-50 border-amber-200",
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex justify-between items-start">
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

function RegistrationCard({
  reg,
  onCancel,
  cancelling,
}: {
  reg: MyRegistration;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  const sc = STATUS_CONFIG[reg.status] ?? {
    label: reg.status.toUpperCase(),
    cls: "text-slate-600 bg-slate-100 border-slate-200",
  };

  const isConfirmed = reg.status === "confirmed";
  const isPending = reg.status === "pending_payment";
  const orderExpired =
    reg.order_expires_at != null &&
    new Date(reg.order_expires_at).getTime() < Date.now();

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm text-slate-900">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            {reg.is_slot_list_published ? (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-black text-indigo-900 font-mono shadow-2xs">
                🎯 Official Slot #{reg.slot_number || 5}
              </span>
            ) : (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-black text-emerald-800">
                ✓ Slot Assigned &amp; Paid (Slot # releases before match)
              </span>
            )}
            {reg.event_kind && (
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-black tracking-wider uppercase ${
                  KIND_CONFIG[reg.event_kind] ?? "text-slate-600 bg-slate-100 border-slate-200"
                }`}
              >
                {reg.event_kind}
              </span>
            )}
          </div>
          <h3 className="font-black text-base sm:text-lg text-slate-900 leading-snug">
            {reg.event_title}
          </h3>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            {when(reg.event_starts_at)} IST
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-black tracking-wider ${sc.cls}`}
        >
          {sc.label}
        </span>
      </div>

      {/* ── Team / Amount ── */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 border border-slate-200 p-3.5">
        <div>
          <p className="text-[10px] text-slate-500 uppercase font-extrabold tracking-wider mb-0.5">
            Team
          </p>
          <p className="font-bold text-sm text-slate-900 truncate">{reg.team_name}</p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 uppercase font-extrabold tracking-wider mb-0.5">
            Amount Paid
          </p>
          <p className="font-black text-sm text-blue-700 font-mono">
            {reg.amount_paise === 0 ? "Free" : rupees(reg.amount_paise)}
          </p>
        </div>
      </div>

      {/* ── Pending payment warning ── */}
      {isPending && !orderExpired && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <span className="text-base -mt-0.5">⏳</span>
          <div>
            <p className="font-bold">Payment pending</p>
            <p className="text-amber-800 mt-0.5">
              Your slot is temporarily held.{" "}
              {reg.order_id && (
                <a
                  href={`/register?resume=${reg.order_id}`}
                  className="underline font-bold text-amber-950 hover:text-black"
                >
                  Complete payment →
                </a>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Pending verification notice ── */}
      {reg.status === "pending_verification" && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <span className="text-base -mt-0.5">⏳</span>
          <div>
            <p className="font-bold">Payment verification pending</p>
            <p className="text-amber-800 mt-0.5">
              Your 12-digit UTR is awaiting approval from the Admin or Owner. Room credentials and the official WhatsApp group link will unlock automatically once approved.
            </p>
          </div>
        </div>
      )}

      {/* ── UTR ── */}
      {reg.utr && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div>
            <p className="text-[9px] text-slate-400 uppercase font-black tracking-wider mb-0.5">
              UTR Reference
            </p>
            <p className="font-mono font-bold text-xs sm:text-sm text-slate-900 tracking-wider">
              {reg.utr}
            </p>
          </div>
          <button
            onClick={() => copy(reg.utr!, `utr-${reg.id}`)}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              copiedKey === `utr-${reg.id}`
                ? "bg-emerald-600 text-white"
                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
            }`}
          >
            {copiedKey === `utr-${reg.id}` ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}

      {/* ── 3-Match IDP & Individual Lobby WhatsApp Group Section ── */}
      <MatchIDPSection
        title={reg.event_title}
        roomId={reg.event_room_id}
        roomPassword={reg.event_room_password}
        whatsappGroupLink={reg.event_whatsapp_group_link}
        idpTimes={reg.event_idp_times}
        startTimes={reg.event_start_times}
        isConfirmed={isConfirmed}
        teamName={reg.team_name}
        whatsapp={reg.whatsapp}
      />

      <p className="text-[11px] text-slate-400 mt-auto">
        Booked on {new Date(reg.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

type TabFilter = "all" | "upcoming" | "past" | "pending";

export default function ProfilePage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [regs, setRegs] = useState<MyRegistration[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");

  const loadRegistrations = useCallback(async () => {
    let regData: any[] = [];
    try {
      const { data, error } = await supabase
        .from("registrations")
        .select(`
          id,
          team_name,
          whatsapp,
          amount_paise,
          status,
          slot_number,
          created_at,
          event_id,
          order_id,
          events:event_id (
            title,
            kind,
            starts_at,
            room_id,
            room_password,
            whatsapp_group_link,
            idp_times,
            start_times,
            is_slot_list_published,
            slot_range_start,
            custom_slot_assignments
          ),
          orders:order_id (
            status,
            expires_at
          )
        `)
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        regData = data;
      } else {
        // Fallback: direct simple query without relational joins
        const { data: simpleData } = await supabase
          .from("registrations")
          .select("id, team_name, whatsapp, amount_paise, status, slot_number, created_at, event_id, order_id")
          .order("created_at", { ascending: false });
        if (simpleData) regData = simpleData;
      }
    } catch {
      // Non-blocking: continue to local hydration
    }

    const orderIds = (regData ?? [])
      .map((r) => (r as unknown as { order_id: string }).order_id)
      .filter(Boolean);

    let utrMap: Record<string, string> = {};
    let payStatusMap: Record<string, string> = {};
    if (orderIds.length > 0) {
      const { data: payData } = await supabase
        .from("payments")
        .select("order_id, utr, status")
        .in("order_id", orderIds);
      (payData ?? []).forEach((p) => {
        utrMap[p.order_id] = p.utr;
        payStatusMap[p.order_id] = p.status;
      });
    }

    const flat: MyRegistration[] = (regData ?? []).map((r, i) => {
      const ev = (r as unknown as { events: Record<string, unknown> }).events ?? {};
      const ord = (r as unknown as { orders: Record<string, unknown> }).orders ?? {};
      const payStatus = payStatusMap[r.order_id];
      let effectiveStatus = r.status as RegStatus;
      if (payStatus === "pending_verification") {
        effectiveStatus = "pending_verification";
      } else if (payStatus === "rejected") {
        effectiveStatus = "cancelled";
      }

      const customSlots = (ev.custom_slot_assignments as Record<string, number>) || {};
      const startSlot = (ev.slot_range_start as number) || 5;
      const computedSlot = r.slot_number || customSlots[r.id] || customSlots[r.team_name] || (startSlot + i);

      return {
        id: r.id,
        team_name: r.team_name,
        whatsapp: r.whatsapp,
        amount_paise: r.amount_paise,
        status: effectiveStatus,
        created_at: r.created_at,
        event_id: r.event_id,
        order_id: r.order_id,
        slot_number: computedSlot,
        is_slot_list_published: Boolean(ev.is_slot_list_published),
        event_title: (ev.title as string) ?? "Tournament",
        event_kind: (ev.kind as string) ?? "scrim",
        event_starts_at: (ev.starts_at as string) ?? new Date().toISOString(),
        event_room_id: (ev.room_id as string) ?? null,
        event_room_password: (ev.room_password as string) ?? null,
        event_whatsapp_group_link: (ev.whatsapp_group_link as string) ?? null,
        event_idp_times: (ev.idp_times as string) ?? null,
        event_start_times: (ev.start_times as string) ?? null,
        order_expires_at: (ord.expires_at as string) ?? null,
        order_status: (ord.status as string) ?? "pending",
        utr: utrMap[r.order_id] ?? null,
      };
    });

    // Hydrate & merge from local storage (apex_all_submissions + active session)
    try {
      if (typeof window !== "undefined") {
        const localRaw = localStorage.getItem("apex_all_submissions");
        const activeRaw = localStorage.getItem("apex_active_booking_session");
        const allSubs: Array<Record<string, unknown>> = [];
        if (localRaw) {
          try { allSubs.push(...JSON.parse(localRaw)); } catch {}
        }
        if (activeRaw) {
          try { allSubs.push(JSON.parse(activeRaw)); } catch {}
        }

        // Fetch live event titles/IDPs for any local event IDs
        const localEventIds = allSubs.flatMap((s) => {
          if (Array.isArray(s.events)) return (s.events as Array<{ id?: string }>).map((e) => e.id).filter(Boolean);
          if (Array.isArray(s.event_ids)) return (s.event_ids as string[]).filter(Boolean);
          return [];
        });

        let liveEventsMap = new Map<string, Record<string, unknown>>();
        if (localEventIds.length > 0) {
          try {
            const { data: evs } = await supabase.from("events").select("*").in("id", localEventIds);
            if (evs) liveEventsMap = new Map(evs.map((e) => [e.id, e]));
          } catch {}
        }

        for (const sub of allSubs) {
          const squadName =
            (sub.teamName as string) ||
            (sub.team_name as string) ||
            (Array.isArray(sub.team_names) ? (sub.team_names as string[])[0] : null) ||
            "Registered Squad";

          const rawEvents: Array<{ id?: string; event_id?: string; title?: string }> =
            Array.isArray(sub.events) && (sub.events as Array<{ id?: string }>).length > 0
              ? (sub.events as Array<{ id?: string; title?: string }>)
              : Array.isArray(sub.event_ids) && (sub.event_ids as string[]).length > 0
              ? (sub.event_ids as string[]).map((id) => ({ id, event_id: id }))
              : Array.isArray(sub.event_titles) && (sub.event_titles as string[]).length > 0
              ? (sub.event_titles as string[]).map((t) => ({ title: t }))
              : [{ title: "Apex Scrims Lobby" }];

          for (let i = 0; i < rawEvents.length; i++) {
            const ev = rawEvents[i];
            const evId = (ev.id || ev.event_id || "default") as string;
            const liveEv = liveEventsMap.get(evId);
            const utrVal = (sub.utr as string) || null;
            const phoneVal = (sub.phone || sub.whatsapp || "") as string;
            const isConfirmed = sub.pay_status === "approved" || sub.status === "confirmed";

            const exists = flat.some(
              (f) =>
                (f.event_id === evId && f.team_name.toLowerCase() === squadName.toLowerCase()) ||
                (utrVal && f.utr === utrVal)
            );

            if (!exists) {
              flat.push({
                id: `local-${i}-${sub.utr || Date.now()}`,
                team_name: squadName,
                whatsapp: phoneVal,
                amount_paise: (sub.amount_paise || sub.totalPaise || 3000) as number,
                status: isConfirmed ? "confirmed" : "pending_verification",
                created_at: (sub.submittedAt || sub.created_at || new Date().toISOString()) as string,
                event_id: evId,
                order_id: (sub.order_id as string) || "local-order",
                event_title: (liveEv?.title as string) || ev.title || "APEX | 1-3PM | L1",
                event_kind: (liveEv?.kind as string) || "scrim",
                event_starts_at: (liveEv?.starts_at as string) || new Date().toISOString(),
                event_room_id: isConfirmed ? ((liveEv?.room_id as string) || null) : null,
                event_room_password: isConfirmed ? ((liveEv?.room_password as string) || null) : null,
                event_whatsapp_group_link: isConfirmed ? ((liveEv?.whatsapp_group_link as string) || null) : null,
                event_idp_times: (liveEv?.idp_times as string) || "01:36 PM | 02:16 PM | 02:56 PM",
                event_start_times: (liveEv?.start_times as string) || "01:42 PM | 02:22 PM | 03:02 PM",
                order_expires_at: null,
                order_status: "submitted",
                utr: utrVal,
                slot_number: 5 + i,
                is_slot_list_published: Boolean(liveEv?.is_slot_list_published),
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("Local profile hydration error:", e);
    }

    setRegs(flat);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const email = data.user?.email ?? null;
      setUserEmail(email);
      if (data.user) {
        const { data: roles } = await supabase
          .from("admin_roles")
          .select("role")
          .eq("user_id", data.user.id);
        setIsAdmin((roles && roles.length > 0) ?? false);
      }
    });
    loadRegistrations();

    const handleSync = () => {
      loadRegistrations();
    };
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [loadRegistrations]);

  const filtered = (regs ?? []).filter((r) => {
    const isPast = new Date(r.event_starts_at).getTime() < Date.now();
    if (tab === "upcoming") return !isPast;
    if (tab === "past") return isPast;
    if (tab === "pending") return r.status === "pending_payment" || r.status === "pending_verification";
    return true;
  });

  const TABS: { key: TabFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past" },
    { key: "pending", label: "Pending" },
  ];

  if (!userEmail && (!regs || regs.length === 0)) {
    return (
      <div className="min-h-screen bg-[#F4F6FB] flex flex-col items-center justify-center p-4 text-center">
        <div className="max-w-md w-full rounded-3xl bg-white border border-slate-200 p-8 shadow-xl space-y-4">
          <span className="text-4xl">👤</span>
          <h1 className="text-xl font-black text-slate-900">Sign in to view your bookings</h1>
          <p className="text-xs text-slate-500">
            Sign in to view your registrations, 3-Match IDP, and WhatsApp groups.
          </p>
          <Link
            href="/login?next=/profile"
            className="w-full py-3 rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black text-sm block"
          >
            Sign In →
          </Link>
        </div>
      </div>
    );
  }

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
              Lobbies
            </Link>
            <Link href="/my-tournaments" className="text-slate-300 hover:text-white transition-colors">
              Find Room (UTR)
            </Link>
            {isAdmin && (
              <Link href="/admin" className="text-amber-300 font-bold hover:underline">
                ⚡ Admin
              </Link>
            )}
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900">My Bookings</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage your registered squads, 3-match custom rooms, and official lobby groups.
          </p>
        </div>

        {/* ── Wallet & Compensation Points Card ── */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎁</span>
              <h2 className="text-sm font-black text-amber-950 uppercase tracking-wider">
                Wallet &amp; Compensation Points
              </h2>
            </div>
            <p className="text-xs text-amber-800">
              Points issued for rescheduled matches or host cancellations are saved here and valid across all scrims.
            </p>
          </div>
          <div className="bg-white border border-amber-300 rounded-xl px-4 py-2 shrink-0 shadow-xs">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 block">Active Balance</span>
            <span className="text-base font-black text-amber-600 font-mono">₹0 Compensation</span>
          </div>
        </div>

        {err && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-600 font-bold">
            {err}
          </div>
        )}

        {/* Tab Filters */}
        <div className="flex gap-2 p-1 rounded-2xl bg-slate-200/80 max-w-md overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                tab === t.key
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* List of Bookings */}
        {regs === null ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center space-y-3 shadow-sm">
            <span className="text-4xl">🎮</span>
            <h3 className="text-base font-black text-slate-900">No bookings in this tab</h3>
            <p className="text-xs text-slate-500">Pick an open tournament from the home page to compete.</p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-block rounded-xl bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 font-black px-6 py-2.5 text-xs shadow-md"
              >
                Browse Tournaments
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {filtered.map((reg) => (
              <RegistrationCard
                key={reg.id}
                reg={reg}
                onCancel={() => {}}
                cancelling={false}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
