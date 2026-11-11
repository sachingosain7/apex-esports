"use client";

import { useCallback, useState } from "react";
import { parse3MatchIDP, extractLobbyLabel, SingleMatchIDP } from "@/lib/matchIdp";

interface MatchIDPSectionProps {
  title: string;
  roomId: string | null | undefined;
  roomPassword: string | null | undefined;
  whatsappGroupLink: string | null | undefined;
  maps?: string[] | null;
  idpTimes?: string | null | undefined;
  startTimes?: string | null | undefined;
  slotNumber?: number | null;
  isConfirmed?: boolean;
  teamName?: string | null;
  whatsapp?: string | null;
}

export function MatchIDPSection({
  title,
  roomId,
  roomPassword,
  whatsappGroupLink,
  maps,
  idpTimes,
  startTimes,
  slotNumber,
  isConfirmed = true,
  teamName,
  whatsapp,
}: MatchIDPSectionProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  }, []);

  const lobbyLabel = extractLobbyLabel(title);
  const matches: SingleMatchIDP[] = parse3MatchIDP({
    roomId,
    roomPassword,
    maps,
    idpTimes,
    startTimes,
  });

  const hasAnyRoomReady = matches.some((m) => m.isAvailable);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm text-slate-900">
      {/* ── Lobby Identifier & Where IDP is Given Banner ── */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 sm:p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-emerald-600 px-2.5 py-0.5 text-xs font-black tracking-wider text-white uppercase">
              {lobbyLabel}
            </span>
            <span className="text-xs sm:text-sm font-black text-emerald-950">
              3 Matches · 3 Separate Custom Rooms
            </span>
          </div>
          {slotNumber != null && (
            <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-0.5 text-xs font-mono font-black text-emerald-800">
              Your Slot: #{slotNumber}
            </span>
          )}
        </div>

        {/* Individual Lobby WhatsApp Group Button */}
        {isConfirmed ? (
          whatsappGroupLink ? (
            <a
              href={whatsappGroupLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-extrabold text-xs sm:text-sm py-2.5 px-4 transition-all shadow-md mt-1 cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0 fill-black" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              </svg>
              <span>👉 Join Official {lobbyLabel} WhatsApp Group</span>
            </a>
          ) : (
            <div className="rounded-lg bg-white border border-emerald-200 px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
              <span>ℹ️</span>
              <span>Host will assign the {lobbyLabel} WhatsApp Group link shortly before match.</span>
            </div>
          )
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 text-xs text-amber-900 flex items-center gap-2 font-bold">
            <span>🔒</span>
            <span>{lobbyLabel} WhatsApp Group link is locked until your payment is verified by Admin/Owner.</span>
          </div>
        )}

        {/* Clear Explanation for where IDP will be given */}
        <div className="pt-1 flex items-start gap-1.5 text-xs text-emerald-900 leading-relaxed">
          <span className="font-black text-emerald-800">📍 Where IDP is given:</span>
          <span>
            {isConfirmed ? (
              <>
                Host shares Room ID &amp; Password in your <strong>{lobbyLabel} WhatsApp Group</strong> and updates each match live below <strong>15 minutes before every match</strong>!
              </>
            ) : (
              <>
                Credentials and group link will unlock on this screen once payment is verified by the Admin or Owner.
              </>
            )}
          </span>
        </div>
      </div>

      {/* ── 3-Match IDP Cards Grid ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-500 font-bold uppercase tracking-wider px-1">
          <span>Match Schedule &amp; Custom Room IDPs</span>
          <span className="text-emerald-700 font-extrabold normal-case flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600 glow-pulse" />
            {!isConfirmed
              ? "Awaiting Payment Approval"
              : hasAnyRoomReady
              ? "IDP Released"
              : "Awaiting Host Release"}
          </span>
        </div>

        {matches.map((m) => {
          const matchReady = m.isAvailable && isConfirmed;
          return (
            <div
              key={m.matchNumber}
              className={`rounded-xl border transition-all ${
                matchReady
                  ? "border-emerald-300 bg-emerald-50/40 p-3.5 sm:p-4"
                  : "border-slate-200 bg-slate-50/60 p-3.5"
              }`}
            >
              {/* Match Header */}
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-black text-xs sm:text-sm text-slate-900">
                    🎮 Match {m.matchNumber}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700">
                    {m.map}
                  </span>
                  {(m.idpTime || m.startTime) && (
                    <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                      {m.idpTime ? `IDP: ${m.idpTime}` : ""}
                      {m.idpTime && m.startTime ? " · " : ""}
                      {m.startTime ? `Start: ${m.startTime}` : ""}
                    </span>
                  )}
                </div>

                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider border ${
                    !isConfirmed
                      ? "bg-amber-100 text-amber-800 border-amber-300"
                      : matchReady
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                      : "bg-slate-100 text-slate-600 border-slate-300"
                  }`}
                >
                  {!isConfirmed
                    ? "🔒 LOCKED"
                    : matchReady
                    ? "🟢 ROOM READY"
                    : "⏳ 15M BEFORE MATCH"}
                </span>
              </div>

              {/* Match Credentials when released */}
              {!isConfirmed ? (
                <div className="rounded-lg bg-amber-50/80 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-center gap-2 font-medium">
                  <span>🔒</span>
                  <span>Room ID &amp; Password locked until UTR approval by Admin/Owner.</span>
                </div>
              ) : matchReady ? (
                <div className="space-y-2 relative overflow-hidden rounded-xl p-1">
                  {/* Dynamic Anti-Leak Tracker Watermark Overlay */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none select-none absolute inset-0 z-10 overflow-hidden flex items-center justify-center opacity-[0.11] rotate-[-12deg]"
                  >
                    <div className="text-center font-mono text-[9px] sm:text-xs font-black tracking-widest text-slate-900 uppercase space-y-1 whitespace-nowrap">
                      <p>⚡ LEAK TRACKER · {teamName ? `TEAM: ${teamName}` : "VERIFIED REGISTRATION"} · SLOT #{slotNumber ?? "—"}</p>
                      <p>+91 {whatsapp ? whatsapp.replace(/\D/g, "").slice(-10) : "REGISTERED"} · STRICTLY CONFIDENTIAL</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 relative z-20">
                    {/* Room ID */}
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2 shadow-xs">
                      <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wider text-slate-400 font-extrabold">
                          ROOM ID
                        </p>
                        <p className="font-mono text-sm sm:text-base font-black text-slate-900 tracking-wider truncate">
                          {m.roomId}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(m.roomId!, `room-${m.matchNumber}`)}
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                          copiedKey === `room-${m.matchNumber}`
                            ? "bg-emerald-600 text-white shadow-xs"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                        }`}
                      >
                        {copiedKey === `room-${m.matchNumber}` ? "Copied ✓" : "Copy ID"}
                      </button>
                    </div>

                    {/* Room Password */}
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2 shadow-xs">
                      <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wider text-slate-400 font-extrabold">
                          PASSWORD
                        </p>
                        <p className="font-mono text-sm sm:text-base font-black text-slate-900 tracking-wider truncate">
                          {m.password || "No Pass"}
                        </p>
                      </div>
                      {m.password && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(m.password!, `pass-${m.matchNumber}`)}
                          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                            copiedKey === `pass-${m.matchNumber}`
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                          }`}
                        >
                          {copiedKey === `pass-${m.matchNumber}` ? "Copied ✓" : "Copy Pass"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 1-Tap Copy Both + Anti Leak Indicator */}
                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-slate-400 font-medium flex items-center gap-1 text-[10px]">
                      <span>🛡️</span>
                      <span>Anti-leak watermarked</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          `Room ID: ${m.roomId} | Password: ${m.password || ""}`,
                          `both-${m.matchNumber}`
                        )
                      }
                      className="text-xs text-blue-700 hover:text-blue-900 font-bold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span>📋</span>
                      <span>
                        {copiedKey === `both-${m.matchNumber}`
                          ? "ID & Password Copied ✓"
                          : "Copy Both ID & Pass"}
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Waiting state */
                <div className="rounded-xl bg-white border border-slate-200 p-3 flex items-start gap-2 text-xs text-slate-600">
                  <span className="text-amber-500 mt-0.5">⏱️</span>
                  <span>
                    Match {m.matchNumber} credentials will be released here <strong>15 mins before match</strong> and posted in your <strong>{lobbyLabel} WhatsApp Group</strong>.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Quick In-Game Join Help ── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 space-y-1">
        <p className="font-black text-slate-800 uppercase tracking-wider text-[11px]">
          🎮 How to Join in BGMI:
        </p>
        <p>1. Open BGMI ➔ Select Mode (Maps) ➔ Tap the <strong>Room</strong> icon on top.</p>
        <p>2. Enter Match Room ID &amp; Password from above.</p>
        <p>3. Join your assigned slot {slotNumber != null ? <strong>(Slot #{slotNumber})</strong> : ""} immediately!</p>
      </div>
    </div>
  );
}
