"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { getBgmiPlacePoints, TeamMatchScore, OverallTeamStanding } from "./PointsTableTab";

interface PublicPointsTableModalProps {
  onClose: () => void;
}

type ModalSubTab = "overall" | "match1" | "match2" | "match3" | "poster";

export function PublicPointsTableModal({ onClose }: PublicPointsTableModalProps) {
  const [events, setEvents] = useState<
    { id: string; title: string; starts_at: string; prize_pool_paise: number; final_points_table_url?: string | null }[]
  >([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [match1, setMatch1] = useState<TeamMatchScore[]>([]);
  const [match2, setMatch2] = useState<TeamMatchScore[]>([]);
  const [match3, setMatch3] = useState<TeamMatchScore[]>([]);
  const [activeTab, setActiveTab] = useState<ModalSubTab>("overall");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  // 1. Fetch available tournaments
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("events")
        .select("id, title, starts_at, prize_pool_paise, final_points_table_url")
        .order("starts_at", { ascending: false })
        .limit(20);

      if (data && data.length > 0) {
        setEvents(data);
        setSelectedEventId(data[0].id);
      }
      setLoading(false);
    })();
  }, []);

  // 2. Fetch points table data for selected event
  useEffect(() => {
    if (!selectedEventId) return;

    (async () => {
      let m1: TeamMatchScore[] = [];
      let m2: TeamMatchScore[] = [];
      let m3: TeamMatchScore[] = [];

      try {
        const { data: savedTables } = await supabase
          .from("points_tables")
          .select("match_number, data")
          .eq("event_id", selectedEventId)
          .eq("is_published", true);

        if (savedTables && savedTables.length > 0) {
          for (const st of savedTables) {
            if (st.match_number === 1 && Array.isArray(st.data)) m1 = st.data;
            if (st.match_number === 2 && Array.isArray(st.data)) m2 = st.data;
            if (st.match_number === 3 && Array.isArray(st.data)) m3 = st.data;
          }
        }
      } catch {}

      // Check localStorage cache fallback
      if (m1.length === 0) {
        try {
          const cached = localStorage.getItem(`apex_points_${selectedEventId}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            m1 = parsed.m1 || [];
            m2 = parsed.m2 || [];
            m3 = parsed.m3 || [];
          }
        } catch {}
      }

      setMatch1(m1);
      setMatch2(m2);
      setMatch3(m3);
    })();
  }, [selectedEventId]);

  // Compute standings
  const overallStandings: OverallTeamStanding[] = useMemo(() => {
    const map: Record<
      string,
      { matchesPlayed: number; wwcd: number; placementPoints: number; killPoints: number; totalPoints: number }
    > = {};

    const process = (scores: TeamMatchScore[]) => {
      for (const s of scores) {
        const name = s.teamName?.trim();
        if (!name) continue;
        if (!map[name]) {
          map[name] = { matchesPlayed: 0, wwcd: 0, placementPoints: 0, killPoints: 0, totalPoints: 0 };
        }
        const placePts = getBgmiPlacePoints(s.rank);
        const killPts = s.kills || 0;
        map[name].matchesPlayed += 1;
        if (s.rank === 1) map[name].wwcd += 1;
        map[name].placementPoints += placePts;
        map[name].killPoints += killPts;
        map[name].totalPoints += placePts + killPts;
      }
    };

    process(match1);
    process(match2);
    process(match3);

    const list: OverallTeamStanding[] = Object.keys(map).map((teamName) => ({
      rank: 1,
      teamName,
      ...map[teamName],
    }));

    list.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd;
      if (b.placementPoints !== a.placementPoints) return b.placementPoints - a.placementPoints;
      return b.killPoints - a.killPoints;
    });

    return list.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [match1, match2, match3]);

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const top1 = overallStandings[0];
  const top2 = overallStandings[1];
  const top3 = overallStandings[2];

  // Search filtering
  const filteredOverall = useMemo(() => {
    if (!search.trim()) return overallStandings;
    const q = search.toLowerCase();
    return overallStandings.filter((s) => s.teamName.toLowerCase().includes(q));
  }, [overallStandings, search]);

  const getFilteredMatch = (scores: TeamMatchScore[]) => {
    const sorted = [...scores].sort((a, b) => {
      const ptsA = getBgmiPlacePoints(a.rank) + (a.kills || 0);
      const ptsB = getBgmiPlacePoints(b.rank) + (b.kills || 0);
      return ptsB - ptsA;
    });
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((s) => s.teamName.toLowerCase().includes(q));
  };

  const currentMatchScores = activeTab === "match1" ? match1 : activeTab === "match2" ? match2 : match3;
  const filteredCurrentMatch = getFilteredMatch(currentMatchScores);

  // Formatted Text for WhatsApp & Clipboard
  const getShareableText = () => {
    if (overallStandings.length === 0) return "";
    const lines = [
      `🏆 *${(selectedEvent?.title || "APEX TOURNAMENT").toUpperCase()} — OFFICIAL STANDINGS* 🏆`,
      `📅 *Date:* ${selectedEvent?.starts_at ? new Date(selectedEvent.starts_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Today"}`,
      `💰 *Prize Pool:* ₹${Math.round((selectedEvent?.prize_pool_paise || 0) / 100)}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ];
    overallStandings.forEach((s) => {
      const medal = s.rank === 1 ? "🥇" : s.rank === 2 ? "🥈" : s.rank === 3 ? "🥉" : `#${s.rank}`;
      lines.push(`${medal} ${s.teamName}: ${s.totalPoints} PTS (${s.wwcd} WWCD · ${s.killPoints} Kills)`);
    });
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`⚡ Official Results by ${ORG_NAME}`);
    return lines.join("\n");
  };

  const handleCopyStandings = () => {
    const text = getShareableText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleWhatsAppShare = () => {
    const text = getShareableText();
    if (!text) return;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center text-xl font-black shadow-2xs">
              🏆
            </span>
            <div>
              <h3 className="font-black text-slate-900 text-lg sm:text-xl leading-tight">
                Points Table &amp; Standings
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Official BGIS 10-Point Scoring · Real-Time Match Results
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors flex items-center justify-center cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>

        {/* Tournament selector */}
        {events.length > 0 && (
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Select Lobby / Tournament:
            </label>
            <select
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                setActiveTab("overall");
              }}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-600 focus:bg-white shadow-2xs"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} ({new Date(ev.starts_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sub-Tab Navigation Bar */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("overall")}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "overall"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              }`}
            >
              <span>🏆</span>
              <span>Overall Standings</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("match1")}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "match1"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              }`}
            >
              <span>Match 1</span>
              {match1.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 text-slate-800">
                  {match1.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("match2")}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "match2"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              }`}
            >
              <span>Match 2</span>
              {match2.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 text-slate-800">
                  {match2.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("match3")}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "match3"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              }`}
            >
              <span>Match 3</span>
              {match3.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 text-slate-800">
                  {match3.length}
                </span>
              )}
            </button>
            {selectedEvent?.final_points_table_url && (
              <button
                type="button"
                onClick={() => setActiveTab("poster")}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "poster"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                }`}
              >
                <span>🖼️</span>
                <span>Official Poster</span>
              </button>
            )}
          </div>

          {/* Quick Action Share Buttons */}
          {overallStandings.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleCopyStandings}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                title="Copy formatted standings to clipboard"
              >
                <span>{copied ? "✓" : "📋"}</span>
                <span>{copied ? "Copied!" : "Copy"}</span>
              </button>
              <button
                type="button"
                onClick={handleWhatsAppShare}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-[#25D366] hover:bg-[#20bd5a] text-black transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                title="Share standings to WhatsApp squad group"
              >
                <svg className="w-3.5 h-3.5 fill-black shrink-0" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                </svg>
                <span>Share</span>
              </button>
            </div>
          )}
        </div>

        {/* Search input for large tournaments */}
        {activeTab !== "poster" && overallStandings.length > 5 && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search squad name in standings…"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:border-indigo-600 transition-colors shadow-2xs"
          />
        )}

        {/* ── VIEW 1: OVERALL STANDINGS ── */}
        {activeTab === "overall" && (
          <>
            {overallStandings.length > 0 ? (
              <div className="space-y-4">
                {/* Top 3 Podium */}
                {!search && (
                  <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center pt-1">
                    {/* 2nd Place */}
                    <div className="rounded-2xl bg-slate-100 border border-slate-200 p-3 flex flex-col items-center justify-end">
                      <span className="text-2xl mb-1">🥈</span>
                      <span className="text-[10px] font-extrabold uppercase text-slate-500">2nd Place</span>
                      <p className="font-black text-xs sm:text-sm text-slate-900 truncate max-w-full">
                        {top2?.teamName || "—"}
                      </p>
                      <p className="text-xs font-mono font-bold text-blue-700">{top2?.totalPoints ?? 0} PTS</p>
                    </div>

                    {/* 1st Place (Champion) */}
                    <div className="rounded-2xl bg-amber-50 border-2 border-amber-400 p-3.5 flex flex-col items-center justify-end shadow-sm">
                      <span className="text-3xl mb-1">👑</span>
                      <span className="text-[10px] font-black uppercase text-amber-700">Champion</span>
                      <p className="font-black text-sm sm:text-base text-slate-900 truncate max-w-full">
                        {top1?.teamName || "—"}
                      </p>
                      <p className="text-sm font-mono font-black text-amber-800">{top1?.totalPoints ?? 0} PTS</p>
                      {top1?.wwcd > 0 && (
                        <span className="text-[9px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-bold mt-1">
                          🍗 {top1.wwcd} WWCD
                        </span>
                      )}
                    </div>

                    {/* 3rd Place */}
                    <div className="rounded-2xl bg-amber-50/40 border border-amber-200 p-3 flex flex-col items-center justify-end">
                      <span className="text-2xl mb-1">🥉</span>
                      <span className="text-[10px] font-extrabold uppercase text-amber-800">3rd Place</span>
                      <p className="font-black text-xs sm:text-sm text-slate-900 truncate max-w-full">
                        {top3?.teamName || "—"}
                      </p>
                      <p className="text-xs font-mono font-bold text-blue-700">{top3?.totalPoints ?? 0} PTS</p>
                    </div>
                  </div>
                )}

                {/* Standings Table */}
                <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase text-[10px]">
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Squad</th>
                        <th className="py-2.5 px-2 text-center">Matches</th>
                        <th className="py-2.5 px-2 text-center">WWCD 🍗</th>
                        <th className="py-2.5 px-2 text-right">Place Pts</th>
                        <th className="py-2.5 px-2 text-right">Kills</th>
                        <th className="py-2.5 px-3 text-right font-black text-indigo-700">Total Pts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                      {filteredOverall.map((s) => (
                        <tr
                          key={s.teamName}
                          className={s.rank === 1 ? "bg-amber-50/60 font-bold" : "hover:bg-slate-50"}
                        >
                          <td className="py-2.5 px-3 font-mono font-black text-slate-500">
                            {s.rank === 1 ? "🥇" : s.rank === 2 ? "🥈" : s.rank === 3 ? "🥉" : `#${s.rank}`}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900">{s.teamName}</td>
                          <td className="py-2.5 px-2 text-center text-slate-500 font-mono">{s.matchesPlayed}</td>
                          <td className="py-2.5 px-2 text-center font-bold text-amber-600">
                            {s.wwcd > 0 ? `${s.wwcd} 🍗` : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-slate-600">{s.placementPoints}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-slate-600">{s.killPoints}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-sm text-indigo-700">
                            {s.totalPoints}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center space-y-2">
                <span className="text-3xl">⏱️</span>
                <p className="font-bold text-slate-800 text-sm">Match in Progress or Calculating</p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Points table will be officially published once the host finishes tallying results for all 3 matches.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── VIEW 2: INDIVIDUAL MATCH SCORES (MATCH 1, 2, or 3) ── */}
        {(activeTab === "match1" || activeTab === "match2" || activeTab === "match3") && (
          <div className="space-y-3">
            {filteredCurrentMatch.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase text-[10px]">
                      <th className="py-2.5 px-3">Finish Rank</th>
                      <th className="py-2.5 px-3">Squad Name</th>
                      <th className="py-2.5 px-2 text-right">Place Pts</th>
                      <th className="py-2.5 px-2 text-right">Kills</th>
                      <th className="py-2.5 px-3 text-right font-black text-indigo-700">Match Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    {filteredCurrentMatch.map((s, idx) => {
                      const placePts = getBgmiPlacePoints(s.rank);
                      const kills = s.kills || 0;
                      const totalMatch = placePts + kills;
                      return (
                        <tr
                          key={`${s.teamName}-${idx}`}
                          className={s.rank === 1 ? "bg-amber-50/60 font-bold" : "hover:bg-slate-50"}
                        >
                          <td className="py-2.5 px-3 font-mono font-black text-slate-600">
                            {s.rank === 1 ? "🍗 Winner (#1)" : `#${s.rank}`}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900">{s.teamName}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-slate-600">{placePts}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-slate-600">{kills}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-sm text-indigo-700">
                            {totalMatch}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center space-y-2">
                <span className="text-2xl">⏳</span>
                <p className="font-bold text-slate-800 text-xs">
                  No scores recorded yet for {activeTab.toUpperCase()}.
                </p>
                <p className="text-[11px] text-slate-500">
                  Scores will appear here once the match ends and the host submits the scoreboard.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── VIEW 3: OFFICIAL POSTER GRAPHIC ── */}
        {activeTab === "poster" && selectedEvent?.final_points_table_url && (
          <div className="space-y-3 text-center">
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-950 p-1 shadow-sm">
              <img
                src={selectedEvent.final_points_table_url}
                alt="Official Points Table Poster"
                className="w-full max-h-[60vh] object-contain rounded-xl mx-auto"
              />
            </div>
            <a
              href={selectedEvent.final_points_table_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-xs"
            >
              <span>🔍</span>
              <span>Open Full High-Resolution Poster</span>
            </a>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5 font-bold text-emerald-700">
            <span>🛡️</span>
            <span>Host Verified Official Results</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
