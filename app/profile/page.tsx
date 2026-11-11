"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type RegStatus = "pending_payment" | "confirmed" | "cancelled";

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
    cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  },
  pending_payment: {
    label: "PENDING PAYMENT",
    cls: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  },
  cancelled: {
    label: "CANCELLED",
    cls: "text-red-400 bg-red-500/10 border-red-500/30",
  },
};

const KIND_CONFIG: Record<string, string> = {
  scrim: "text-sky-400 bg-sky-500/10 border-sky-500/30",
  tournament: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  league: "text-orange-400 bg-orange-500/10 border-orange-500/30",
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useCopyToClipboard
// ─────────────────────────────────────────────────────────────────────────────

function useCopyToClipboard(resetMs = 2000): [string | null, (text: string, key: string) => void] {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedKey(null), resetMs);
    });
  }, [resetMs]);

  return [copiedKey, copy];
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration Card
// ─────────────────────────────────────────────────────────────────────────────

function RegCard({
  reg,
  clientNow,
}: {
  reg: MyRegistration;
  clientNow: number;
}) {
  const [copiedKey, copy] = useCopyToClipboard();
  const sc = STATUS_CONFIG[reg.status] ?? STATUS_CONFIG.cancelled;
  const kc = KIND_CONFIG[reg.event_kind] ?? KIND_CONFIG.scrim;
  const isUpcoming = clientNow > 0 ? new Date(reg.event_starts_at).getTime() > clientNow : true;
  const isPending = reg.status === "pending_payment";
  const isConfirmed = reg.status === "confirmed";
  const orderExpired =
    reg.order_expires_at && clientNow > 0
      ? new Date(reg.order_expires_at).getTime() < clientNow
      : false;

  function CopyBtn({ value, label, copyKey }: { value: string; label: string; copyKey: string }) {
    const isCopied = copiedKey === copyKey;
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#06070B] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">
            {label}
          </p>
          <p className="font-mono font-bold text-emerald-300 tracking-widest text-sm truncate">
            {value}
          </p>
        </div>
        <button
          onClick={() => copy(value, copyKey)}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            isCopied
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "border border-white/10 text-white/50 hover:text-white hover:border-white/20"
          }`}
        >
          {isCopied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border bg-[#0E1118] p-5 flex flex-col gap-4 ${
        reg.status === "cancelled"
          ? "border-white/[0.04] opacity-60"
          : reg.status === "confirmed"
          ? "border-white/[0.08]"
          : "border-amber-500/20"
      }`}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${kc}`}
            >
              {reg.event_kind}
            </span>
            {isUpcoming && isConfirmed && (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[10px] text-emerald-400 font-medium">
                Upcoming
              </span>
            )}
          </div>
          <h3 className="font-bold text-base leading-tight">{reg.event_title}</h3>
          <p className="text-xs text-white/40 mt-0.5">
            {when(reg.event_starts_at)} IST
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider ${sc.cls}`}
        >
          {sc.label}
        </span>
      </div>

      {/* ── Team / Amount ── */}
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-white/[0.03] border border-white/[0.04] px-4 py-3">
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">
            Team
          </p>
          <p className="font-semibold text-sm truncate">{reg.team_name}</p>
        </div>
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">
            Amount Paid
          </p>
          <p className="font-bold text-sm text-emerald-400">
            {reg.amount_paise === 0 ? "Free" : rupees(reg.amount_paise)}
          </p>
        </div>
      </div>

      {/* ── Pending payment warning ── */}
      {isPending && !orderExpired && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 text-xs text-amber-400">
          <span className="text-base -mt-0.5">⏳</span>
          <div>
            <p className="font-semibold">Payment pending</p>
            <p className="text-amber-400/70 mt-0.5">
              Your slot is held.{" "}
              {reg.order_id && (
                <a
                  href={`/register?resume=${reg.order_id}`}
                  className="underline underline-offset-2 hover:text-amber-300 transition-colors"
                >
                  Complete payment →
                </a>
              )}
            </p>
          </div>
        </div>
      )}
      {isPending && orderExpired && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs text-red-400">
          <span className="text-base -mt-0.5">❌</span>
          <p>Slot hold expired. Register again to book a new slot.</p>
        </div>
      )}

      {/* ── UTR ── */}
      {reg.utr && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#06070B] px-4 py-3">
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">
              UTR Reference
            </p>
            <p className="font-mono font-bold text-sm tracking-widest">{reg.utr}</p>
          </div>
          <button
            onClick={() => copy(reg.utr!, `utr-${reg.id}`)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              copiedKey === `utr-${reg.id}`
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "border border-white/10 text-white/50 hover:text-white hover:border-white/20"
            }`}
          >
            {copiedKey === `utr-${reg.id}` ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}

      {/* ── IDP Times ── */}
      {(reg.event_idp_times || reg.event_start_times) && (
        <div className="rounded-xl border border-white/[0.06] bg-[#06070B] px-4 py-3 font-mono text-xs space-y-1.5">
          {reg.event_idp_times && (
            <div className="flex items-start gap-2">
              <span className="text-white/40 shrink-0 w-20">IDP Time</span>
              <span className="text-white/80">{reg.event_idp_times}</span>
            </div>
          )}
          {reg.event_start_times && (
            <div className="flex items-start gap-2">
              <span className="text-white/40 shrink-0 w-20">Start Time</span>
              <span className="text-white/80">{reg.event_start_times}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Room credentials (confirmed only) ── */}
      {isConfirmed && (
        <div className="flex flex-col gap-2">
          {reg.event_room_id ? (
            <>
              <CopyBtn
                value={reg.event_room_id}
                label="Room ID"
                copyKey={`room-${reg.id}`}
              />
              {reg.event_room_password && (
                <CopyBtn
                  value={reg.event_room_password}
                  label="Room Password"
                  copyKey={`pass-${reg.id}`}
                />
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#06070B] px-4 py-3 text-xs text-amber-400/80">
              <span>⏳</span>
              <span>
                Room ID &amp; Password will appear here and on WhatsApp before
                match time.
              </span>
            </div>
          )}

          {reg.event_whatsapp_group_link ? (
            <a
              href={reg.event_whatsapp_group_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-green-600/15 border border-green-500/25 px-4 py-3 text-sm font-semibold text-green-400 hover:bg-green-600/25 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Join IDP WhatsApp Group
            </a>
          ) : (
            <div className="rounded-xl border border-white/[0.06] px-4 py-3 text-xs text-white/30 text-center">
              IDP group link coming soon
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-white/20 mt-auto">
        Booked {new Date(reg.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

type TabFilter = "all" | "upcoming" | "past" | "pending";

export default function ProfilePage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [regs, setRegs] = useState<MyRegistration[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");

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
      if (email) loadRegistrations();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRegistrations = useCallback(async () => {
    // Fetch registrations with joined event + order data
    const { data: regData, error: regErr } = await supabase
      .from("registrations")
      .select(`
        id,
        team_name,
        whatsapp,
        amount_paise,
        status,
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
          start_times
        ),
        orders:order_id (
          status,
          expires_at
        )
      `)
      .order("created_at", { ascending: false });

    if (regErr) {
      setErr(regErr.message);
      return;
    }

    // Fetch UTRs for all orders in one go
    const orderIds = (regData ?? [])
      .map((r) => (r as unknown as { order_id: string }).order_id)
      .filter(Boolean);

    let utrMap: Record<string, string> = {};
    if (orderIds.length > 0) {
      const { data: payData } = await supabase
        .from("payments")
        .select("order_id, utr")
        .in("order_id", orderIds);
      (payData ?? []).forEach((p) => {
        utrMap[p.order_id] = p.utr;
      });
    }

    // Flatten nested joins
    const flat: MyRegistration[] = (regData ?? []).map((r) => {
      const ev = (r as unknown as { events: Record<string, unknown> }).events ?? {};
      const ord = (r as unknown as { orders: Record<string, unknown> }).orders ?? {};
      return {
        id: r.id,
        team_name: r.team_name,
        whatsapp: r.whatsapp,
        amount_paise: r.amount_paise,
        status: r.status as RegStatus,
        created_at: r.created_at,
        event_id: r.event_id,
        order_id: r.order_id,
        event_title: (ev.title as string) ?? "Unknown Event",
        event_kind: (ev.kind as string) ?? "scrim",
        event_starts_at: (ev.starts_at as string) ?? "",
        event_room_id: (ev.room_id as string | null) ?? null,
        event_room_password: (ev.room_password as string | null) ?? null,
        event_whatsapp_group_link: (ev.whatsapp_group_link as string | null) ?? null,
        event_idp_times: (ev.idp_times as string | null) ?? null,
        event_start_times: (ev.start_times as string | null) ?? null,
        order_expires_at: (ord.expires_at as string | null) ?? null,
        order_status: (ord.status as string) ?? "",
        utr: utrMap[r.order_id] ?? null,
      };
    });

    setRegs(flat);
  }, []);

  const [clientNow, setClientNow] = useState<number>(0);
  useEffect(() => {
    setClientNow(Date.now());
  }, []);

  const filtered = (regs ?? []).filter((r) => {
    if (tab === "upcoming") {
      if (!clientNow) return r.status === "confirmed";
      return r.status === "confirmed" && new Date(r.event_starts_at).getTime() > clientNow;
    }
    if (tab === "past") {
      if (!clientNow) return false;
      return r.status === "confirmed" && new Date(r.event_starts_at).getTime() <= clientNow;
    }
    if (tab === "pending") return r.status === "pending_payment";
    return true;
  });

  const orgParts = ORG_NAME.split(" ");

  const TABS: { key: TabFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "upcoming", label: "Upcoming" },
    { key: "pending", label: "Pending" },
    { key: "past", label: "Past" },
  ];

  if (!userEmail) {
    return (
      <div className="min-h-screen bg-[#06070B] flex items-center justify-center px-5 text-white">
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-4">🔒</p>
          <h1 className="text-xl font-bold mb-2">Sign in to view your profile</h1>
          <p className="text-white/40 text-sm mb-6">
            Access your booking history, room details, and UTR references.
          </p>
          <a
            href="/login?next=/profile"
            className="inline-block rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-sm text-black hover:bg-emerald-400 transition-colors"
          >
            Sign in →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#06070B] text-white">
      {/* ── Background ── */}
      <div className="fixed inset-0 pointer-events-none tactical-grid" aria-hidden="true" />
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 left-1/4 w-[600px] h-[600px] bg-emerald-500/[0.03] rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-purple-600/[0.03] rounded-full blur-3xl" />
      </div>

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#06070B]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 py-4 gap-4">
          <a href="/" className="text-lg font-extrabold tracking-widest shrink-0">
            {orgParts[0]}{" "}
            <span className="text-emerald-400">{orgParts.slice(1).join(" ")}</span>
          </a>
          <nav className="flex items-center gap-3 sm:gap-5 text-sm text-white/60">
            {isAdmin && (
              <a
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-3 py-1.5 text-xs font-bold text-amber-400 hover:bg-amber-500/25 transition-all shadow-sm"
              >
                <span>⚡</span>
                <span>Admin Panel</span>
              </a>
            )}
            <a href="/" className="hover:text-white transition-colors hidden sm:inline">
              Lobbies
            </a>
            <a href="/my-tournaments" className="hover:text-white transition-colors hidden sm:inline">
              Room Details
            </a>
            <span className="text-xs rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-400 max-w-[160px] truncate hidden sm:inline">
              {userEmail}
            </span>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
              className="text-xs text-white/40 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-4 sm:px-6 py-10">
        {/* ── Page heading ── */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold mb-1">
            My Bookings
          </h1>
          <p className="text-white/40 text-sm">
            All your registered lobbies, room credentials, and payment references.
          </p>
        </div>

        {/* ── Error ── */}
        {err && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load registrations: {err}
          </div>
        )}

        {/* ── Tabs ── */}
        {regs && regs.length > 0 && (
          <div className="mb-6 flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] max-w-full overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const count =
                t.key === "all"
                  ? regs.length
                  : t.key === "upcoming"
                  ? regs.filter(
                      (r) =>
                        r.status === "confirmed" &&
                        (!clientNow || new Date(r.event_starts_at).getTime() > clientNow)
                    ).length
                  : t.key === "pending"
                  ? regs.filter((r) => r.status === "pending_payment").length
                  : regs.filter(
                      (r) =>
                        r.status === "confirmed" &&
                        clientNow > 0 &&
                        new Date(r.event_starts_at).getTime() <= clientNow
                    ).length;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all duration-150 flex items-center gap-1.5 ${
                    tab === t.key
                      ? "bg-emerald-500 text-black shadow"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {t.label}
                  {count > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-bold ${
                        tab === t.key
                          ? "bg-black/20 text-black/70"
                          : "bg-white/10 text-white/50"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {regs === null && !err && (
          <div className="grid gap-5 sm:grid-cols-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/[0.06] bg-[#0E1118] p-5 flex flex-col gap-4"
              >
                <div className="h-4 w-2/3 rounded skeleton" />
                <div className="h-3 w-1/3 rounded skeleton" />
                <div className="h-14 rounded-xl skeleton" />
                <div className="h-11 rounded-xl skeleton" />
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {regs !== null && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">🎮</p>
            <h3 className="text-lg font-bold mb-2">
              {tab === "all"
                ? "No bookings yet"
                : `No ${tab} bookings`}
            </h3>
            <p className="text-white/40 text-sm mb-6">
              {tab === "all"
                ? "Browse open lobbies and register your team."
                : "Switch to 'All' to see your complete history."}
            </p>
            {tab === "all" && (
              <a
                href="/"
                className="inline-block rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-sm text-black hover:bg-emerald-400 transition-colors"
              >
                Browse Lobbies →
              </a>
            )}
          </div>
        )}

        {/* ── Registration cards ── */}
        {filtered.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            {filtered.map((r) => (
              <RegCard key={r.id} reg={r} clientNow={clientNow} />
            ))}
          </div>
        )}

        {/* ── Support footer ── */}
        {regs !== null && regs.length > 0 && (
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-white/30">
            <span>Missing a room ID or need help?</span>
            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP}?text=Hi+Apex+Esports+support,+I+need+help+with+my+registration.`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-green-400 hover:text-green-300 transition-colors font-medium"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp Support
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
