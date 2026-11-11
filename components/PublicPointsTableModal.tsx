"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { getBgmiPlacePoints, TeamMatchScore, OverallTeamStanding } from "./PointsTableTab";

interface PublicPointsTableModalProps {
  onClose: () => void;
}

export function PublicPointsTableModal({ onClose }: PublicPointsTableModalProps) {
  const [events, setEvents] = useState<{ id: string; title: string; starts_at: string; prize_pool_paise: number }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [match1, setMatch1] = useState<TeamMatchScore[]>([]);
  const [match2, setMatch2] = useState<TeamMatchScore[]>([]);
  const [match3, setMatch3] = useState<TeamMatchScore[]>([]);

  // 1. Fetch available tournaments
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("events")
        .select("id, title, starts_at, prize_pool_paise")
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
    const map: Record<string, { matchesPlayed: number; wwcd: number; placementPoints: number; killPoints: number; totalPoints: number }> = {};

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏆</span>
            <div>
              <h3 className="font-black text-slate-900 text-lg sm:text-xl">Official Points Table &amp; Results</h3>
              <p className="text-xs text-slate-500 font-medium">BGMI Official 10-Point Scoring · Live Standings</p>
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
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} ({new Date(ev.starts_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Top 3 Podium if results exist */}
        {overallStandings.length > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center pt-2">
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

            {/* Standings Table */}
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase text-[10px]">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Squad</th>
                    <th className="py-2.5 px-2 text-center">WWCD 🍗</th>
                    <th className="py-2.5 px-2 text-right">Kills</th>
                    <th className="py-2.5 px-3 text-right font-black text-blue-700">Total Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {overallStandings.map((s) => (
                    <tr
                      key={s.teamName}
                      className={s.rank === 1 ? "bg-amber-50/50 font-bold" : "hover:bg-slate-50"}
                    >
                      <td className="py-2.5 px-3 font-mono font-black text-slate-500">
                        {s.rank === 1 ? "🥇" : s.rank === 2 ? "🥈" : s.rank === 3 ? "🥉" : s.rank}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        {s.teamName}
                      </td>
                      <td className="py-2.5 px-2 text-center font-bold text-amber-600">
                        {s.wwcd > 0 ? s.wwcd : "—"}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                        {s.killPoints}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-black text-sm text-blue-700">
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

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5 font-bold text-emerald-700">
            <span>🛡️</span>
            <span>Official Host Verified Results</span>
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
