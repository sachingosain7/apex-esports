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
    <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#0A0D15] p-3.5 sm:p-5">
      {/* ── Lobby Identifier & Where IDP is Given Banner ── */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3 sm:p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-emerald-500 px-2.5 py-0.5 text-xs font-black tracking-wider text-black uppercase">
              {lobbyLabel}
            </span>
            <span className="text-xs sm:text-sm font-bold text-white">
              3 Matches · 3 Separate Custom Rooms
            </span>
          </div>
          {slotNumber != null && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-mono font-bold text-emerald-300">
              Your Slot: #{slotNumber}
            </span>
          )}
        </div>

        {/* Individual Lobby WhatsApp Group Button */}
        {whatsappGroupLink ? (
          <a
            href={whatsappGroupLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-extrabold text-xs sm:text-sm py-2.5 px-4 transition-all shadow-md shadow-emerald-950/40 mt-1"
          >
            <svg
              className="w-4 h-4 shrink-0 fill-black"
              viewBox="0 0 24 24"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            </svg>
            <span>👉 Join Official {lobbyLabel} WhatsApp Group</span>
          </a>
        ) : (
          <div className="rounded-lg bg-black/40 border border-white/[0.08] px-3 py-2 text-[11px] text-white/50 flex items-center gap-2">
            <span>ℹ️</span>
            <span>Host will assign the {lobbyLabel} WhatsApp Group link shortly before match.</span>
          </div>
        )}

        {/* Clear Explanation for where IDP will be given */}
        <div className="pt-1 flex items-start gap-1.5 text-[11px] text-emerald-300/90 leading-relaxed">
          <span className="font-bold text-emerald-400">📍 Where IDP is given:</span>
          <span>
            Host shares Room ID &amp; Password in your <strong>{lobbyLabel} WhatsApp Group</strong> and updates each match live below <strong>15 minutes before every match</strong>!
          </span>
        </div>
      </div>

      {/* ── 3-Match IDP Cards Grid ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-[11px] text-white/40 uppercase font-bold tracking-wider px-1">
          <span>Match Schedule &amp; Custom Room IDPs</span>
          <span className="text-emerald-400 font-medium normal-case flex items-center gap-1 font-sans">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 glow-pulse" />
            {hasAnyRoomReady ? "IDP Released" : "Awaiting Host Release"}
          </span>
        </div>

        {matches.map((m) => {
          const matchReady = m.isAvailable && isConfirmed;
          return (
            <div
              key={m.matchNumber}
              className={`rounded-xl border transition-all ${
                matchReady
                  ? "border-emerald-500/40 bg-emerald-500/[0.03] p-3 sm:p-4"
                  : "border-white/[0.06] bg-[#0E1118] p-3 sm:p-3.5"
              }`}
            >
              {/* Match Header */}
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-xs sm:text-sm text-white">
                    🎮 Match {m.matchNumber}
                  </span>
                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                    {m.map}
                  </span>
                  {(m.idpTime || m.startTime) && (
                    <span className="text-[10px] text-white/40 font-mono hidden sm:inline">
                      {m.idpTime ? `IDP: ${m.idpTime}` : ""}
                      {m.idpTime && m.startTime ? " · " : ""}
                      {m.startTime ? `Start: ${m.startTime}` : ""}
                    </span>
                  )}
                </div>

                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${
                    matchReady
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-amber-500/10 text-amber-400/80 border border-amber-500/25"
                  }`}
                >
                  {matchReady ? "🟢 ROOM READY" : "⏳ 15M BEFORE MATCH"}
                </span>
              </div>

              {/* Match Credentials when released */}
              {matchReady ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Room ID */}
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-[#06070B] border border-white/[0.08] px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wider text-white/40 font-bold">
                          ROOM ID
                        </p>
                        <p className="font-mono text-sm sm:text-base font-black text-emerald-300 tracking-wider truncate">
                          {m.roomId}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(m.roomId!, `room-${m.matchNumber}`)}
                        className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                          copiedKey === `room-${m.matchNumber}`
                            ? "bg-emerald-500 text-black shadow"
                            : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                        }`}
                      >
                        {copiedKey === `room-${m.matchNumber}` ? "Copied ✓" : "Copy ID"}
                      </button>
                    </div>

                    {/* Room Password */}
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-[#06070B] border border-white/[0.08] px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wider text-white/40 font-bold">
                          PASSWORD
                        </p>
                        <p className="font-mono text-sm sm:text-base font-black text-emerald-300 tracking-wider truncate">
                          {m.password || "No Pass"}
                        </p>
                      </div>
                      {m.password && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(m.password!, `pass-${m.matchNumber}`)}
                          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                            copiedKey === `pass-${m.matchNumber}`
                              ? "bg-emerald-500 text-black shadow"
                              : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                          }`}
                        >
                          {copiedKey === `pass-${m.matchNumber}` ? "Copied ✓" : "Copy Pass"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 1-Tap Copy Both */}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          `Room ID: ${m.roomId} | Password: ${m.password || ""}`,
                          `both-${m.matchNumber}`
                        )
                      }
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 font-semibold"
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
                <div className="rounded-lg bg-black/30 border border-white/[0.04] p-2.5 flex items-start gap-2 text-xs text-white/50">
                  <span className="text-amber-400 mt-0.5">⏱️</span>
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
      <div className="rounded-xl border border-white/[0.06] bg-black/40 p-3 text-[11px] text-white/40 space-y-1">
        <p className="font-bold text-white/60 uppercase tracking-wider text-[10px]">
          🎮 How to Join in BGMI:
        </p>
        <p>1. Open BGMI ➔ Select Mode (Maps) ➔ Tap the <strong>Room</strong> icon on top.</p>
        <p>2. Enter Match Room ID &amp; Password from above.</p>
        <p>3. Join your assigned slot {slotNumber != null ? <strong>(Slot #{slotNumber})</strong> : ""} immediately!</p>
      </div>
    </div>
  );
}
