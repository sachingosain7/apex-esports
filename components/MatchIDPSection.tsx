"use client";

import { useCallback, useEffect, useState } from "react";
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
  isSlotListPublished?: boolean;
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
  isSlotListPublished = false,
  teamName,
  whatsapp,
}: MatchIDPSectionProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string>("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("apex_saved_email") || "";
      if (saved) setTargetEmail(saved);
    } catch {}
  }, []);

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

  const handleEmailIdp = async () => {
    if (!targetEmail.trim() || !targetEmail.includes("@")) {
      setEmailFeedback("Please enter a valid Gmail address.");
      return;
    }
    setSendingEmail(true);
    setEmailFeedback(null);
    try {
      try {
        localStorage.setItem("apex_saved_email", targetEmail.trim());
      } catch {}

      const res = await fetch("/api/email/send-idp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: targetEmail.trim(),
          teamName: teamName || "Registered Squad",
          slotNumber: slotNumber || null,
          whatsappGroupLink,
          matches: matches.map((m) => ({
            matchNumber: m.matchNumber,
            map: m.map,
            roomId: m.roomId || "PENDING",
            roomPassword: m.password || "PENDING",
            startTime: m.startTime,
            idpTime: m.idpTime,
          })),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setEmailFeedback("✓ Match IDP successfully forwarded to your Gmail!");
        if (data.gmailWebUrl && data.provider === "client_gmail_intent") {
          window.open(data.gmailWebUrl, "_blank");
        }
      } else {
        setEmailFeedback(data.message || "Could not dispatch email.");
      }
    } catch {
      setEmailFeedback("Network error connecting to email service.");
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-sm text-slate-900 w-full max-w-full overflow-hidden">
      {/* ── Lobby Identifier & Where IDP is Given Banner ── */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 sm:p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-md bg-emerald-600 px-2.5 py-0.5 text-xs font-black tracking-wider text-white uppercase shrink-0">
              {lobbyLabel}
            </span>
            <span className="text-xs sm:text-sm font-black text-emerald-950">
              3 Matches · 3 Custom Rooms
            </span>
          </div>
          {isSlotListPublished && slotNumber != null ? (
            <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-0.5 text-xs font-mono font-black text-emerald-800 shrink-0">
              Your Slot: #{slotNumber}
            </span>
          ) : (
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 shrink-0">
              Slot # releases with list
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
              className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-extrabold text-xs sm:text-sm py-2.5 px-4 transition-all shadow-sm mt-1 cursor-pointer w-full text-center"
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
            <span>{lobbyLabel} WhatsApp Group link unlocks once payment is verified.</span>
          </div>
        )}

        {/* Clear Explanation for where IDP will be given */}
        <div className="pt-1 flex items-start gap-1.5 text-xs text-emerald-900 leading-relaxed">
          <span className="font-black text-emerald-800 shrink-0">📍 Where IDP is given:</span>
          <span>
            {isConfirmed ? (
              <>
                Credentials release in your <strong>{lobbyLabel} WhatsApp Group</strong> and live below <strong>15 minutes before every match</strong>!
              </>
            ) : (
              <>
                Credentials and group link will unlock on this screen once payment is verified by Admin/Owner.
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
                  ? "border-emerald-300 bg-emerald-50/40 p-3 sm:p-4"
                  : "border-slate-200 bg-slate-50/60 p-3"
              }`}
            >
              {/* Match Header */}
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-black text-xs sm:text-sm text-slate-900">
                    🎮 Match {m.matchNumber}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700">
                    {m.map}
                  </span>
                  {(m.idpTime || m.startTime) && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      {m.idpTime ? `IDP: ${m.idpTime}` : ""}
                      {m.idpTime && m.startTime ? " · " : ""}
                      {m.startTime ? `Start: ${m.startTime}` : ""}
                    </span>
                  )}
                </div>

                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider border shrink-0 ${
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
                      <p>⚡ LEAK TRACKER · {teamName ? `TEAM: ${teamName}` : "VERIFIED REGISTRATION"} · {isSlotListPublished && slotNumber != null ? `SLOT #${slotNumber}` : "SLOT PENDING RELEASE"}</p>
                      <p>+91 {whatsapp ? whatsapp.replace(/\D/g, "").slice(-10) : "REGISTERED"} · STRICTLY CONFIDENTIAL</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Room ID */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center justify-between shadow-2xs">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Room ID
                        </p>
                        <p className="text-base sm:text-lg font-black font-mono text-slate-900">
                          {m.roomId}
                        </p>
                      </div>
                      {m.roomId && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(m.roomId!, `room-${m.matchNumber}`)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                            copiedKey === `room-${m.matchNumber}`
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                          }`}
                        >
                          {copiedKey === `room-${m.matchNumber}` ? "Copied ✓" : "Copy ID"}
                        </button>
                      )}
                    </div>

                    {/* Room Password */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center justify-between shadow-2xs">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Password
                        </p>
                        <p className="text-base sm:text-lg font-black font-mono text-slate-900">
                          {m.password || "—"}
                        </p>
                      </div>
                      {m.password && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(m.password!, `pass-${m.matchNumber}`)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
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
                  <div className="flex items-center justify-between text-[11px] pt-1 flex-wrap gap-1">
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
                    Match {m.matchNumber} credentials release <strong>15 mins before match</strong> here and in your <strong>{lobbyLabel} WhatsApp Group</strong>.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Email IDP Notification Box (Instant Gmail Forwarding & Alerts) ── */}
      {isConfirmed && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
              <span>✉️</span>
              <span>{hasAnyRoomReady ? "Forward IDP to your Gmail" : "Get Match Alerts & IDP on Gmail"}</span>
            </span>
            <span className="text-[10px] bg-indigo-200 text-indigo-900 font-bold px-2 py-0.5 rounded-full">
              Mobile Alert
            </span>
          </div>
          <p className="text-[11px] text-indigo-900/80 leading-relaxed">
            {hasAnyRoomReady
              ? "Receive Room ID, Password, and match schedule directly in your Gmail so your phone alerts you before match starts!"
              : "Save your Gmail address to get notified with Room ID, Password, and schedule as soon as the host releases credentials!"}
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <input
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="Enter your Gmail address…"
              className="flex-1 bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-600 shadow-2xs"
            />
            <button
              type="button"
              onClick={handleEmailIdp}
              disabled={sendingEmail || !targetEmail.trim()}
              className="px-4 py-2.5 rounded-xl text-xs font-black bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-all cursor-pointer shadow-xs flex items-center justify-center gap-1.5 shrink-0"
            >
              <span>{sendingEmail ? "⏳" : "📩"}</span>
              <span>
                {sendingEmail
                  ? "Sending…"
                  : hasAnyRoomReady
                  ? "Send IDP to Gmail"
                  : "Save Gmail Alert"}
              </span>
            </button>
          </div>
          {emailFeedback && (
            <p className="text-[11px] font-bold text-indigo-800 pt-0.5">{emailFeedback}</p>
          )}
        </div>
      )}

      {/* ── Quick In-Game Join Help ── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
        <p className="font-black text-slate-800 uppercase tracking-wider text-[10px]">
          🎮 How to Join in BGMI:
        </p>
        <p>1. Open BGMI ➔ Select Mode (Maps) ➔ Tap the <strong>Room</strong> icon on top.</p>
        <p>2. Enter Match Room ID &amp; Password from above.</p>
        <p>3. Join your assigned slot {isSlotListPublished && slotNumber != null ? <strong>(Slot #{slotNumber})</strong> : <strong>(revealed when official slot list is published)</strong>} immediately!</p>
      </div>
    </div>
  );
}
