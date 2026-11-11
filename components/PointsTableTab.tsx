"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { extractLobbyLabel } from "@/lib/matchIdp";

export function getBgmiPlacePoints(rank: number): number {
  switch (rank) {
    case 1:
      return 10;
    case 2:
      return 6;
    case 3:
      return 5;
    case 4:
      return 4;
    case 5:
      return 3;
    case 6:
      return 2;
    case 7:
      return 1;
    case 8:
      return 1;
    default:
      return 0;
  }
}

export type TeamMatchScore = {
  teamName: string;
  rank: number; // 1-16
  kills: number;
};

export type MatchData = {
  matchNumber: number;
  mapName: string;
  scores: TeamMatchScore[];
};

export type OverallTeamStanding = {
  rank: number;
  teamName: string;
  matchesPlayed: number;
  wwcd: number;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
};

interface PointsTableTabProps {
  showToast: (m: string, t: "success" | "error") => void;
}

export function PointsTableTab({ showToast }: PointsTableTabProps) {
  const [events, setEvents] = useState<{ id: string; title: string; starts_at: string; prize_pool_paise: number }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"match1" | "match2" | "match3" | "overall">("match1");

  // Scores state for matches 1, 2, 3
  const [match1Scores, setMatch1Scores] = useState<TeamMatchScore[]>([]);
  const [match2Scores, setMatch2Scores] = useState<TeamMatchScore[]>([]);
  const [match3Scores, setMatch3Scores] = useState<TeamMatchScore[]>([]);
  const [saving, setSaving] = useState(false);
  const [copiedLeaderboard, setCopiedLeaderboard] = useState(false);

  // Top 4 Teams & Final Points Table Image state
  const [topTeams, setTopTeams] = useState({
    first: "",
    second: "",
    third: "",
    fourth: "",
  });
  const [pointsTableImage, setPointsTableImage] = useState<string | null>(null);

  // Load available lobbies
  useEffect(() => {
    (async () => {
      setLoadingEvents(true);
      const { data, error } = await supabase
        .from("events")
        .select("id, title, starts_at, prize_pool_paise")
        .order("starts_at", { ascending: false })
        .limit(30);

      if (!error && data) {
        setEvents(data);
        if (data.length > 0) {
          setSelectedEventId(data[0].id);
        }
      }
      setLoadingEvents(false);
    })();
  }, []);

  // Load registrations and existing points table for selected lobby
  useEffect(() => {
    if (!selectedEventId) return;

    (async () => {
      // 1. Try to load saved points tables from Supabase
      try {
        const { data: savedTables } = await supabase
          .from("points_tables")
          .select("match_number, data")
          .eq("event_id", selectedEventId);

        let m1: TeamMatchScore[] = [];
        let m2: TeamMatchScore[] = [];
        let m3: TeamMatchScore[] = [];

        if (savedTables && savedTables.length > 0) {
          for (const st of savedTables) {
            if (st.match_number === 1 && Array.isArray(st.data)) m1 = st.data;
            if (st.match_number === 2 && Array.isArray(st.data)) m2 = st.data;
            if (st.match_number === 3 && Array.isArray(st.data)) m3 = st.data;
          }
        }

        // If not in Supabase, check localStorage cache
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

        // If still empty, prepopulate from confirmed teams in registrations
        if (m1.length === 0) {
          const { data: regs } = await supabase
            .from("registrations")
            .select("team_name")
            .eq("event_id", selectedEventId)
            .order("created_at", { ascending: true });

          const registeredNames = Array.from(new Set((regs || []).map((r) => r.team_name).filter(Boolean)));
          const defaultTeams = registeredNames.length > 0 ? registeredNames : [
            "Team 1", "Team 2", "Team 3", "Team 4",
            "Team 5", "Team 6", "Team 7", "Team 8",
            "Team 9", "Team 10", "Team 11", "Team 12",
            "Team 13", "Team 14", "Team 15", "Team 16"
          ];

          m1 = defaultTeams.map((name, i) => ({ teamName: name, rank: i + 1, kills: 0 }));
          m2 = defaultTeams.map((name, i) => ({ teamName: name, rank: i + 1, kills: 0 }));
          m3 = defaultTeams.map((name, i) => ({ teamName: name, rank: i + 1, kills: 0 }));
        }

        // 4. Load Top 4 Teams and points table image
        try {
          const { data: evData } = await supabase
            .from("events")
            .select("top_teams, final_points_table_url")
            .eq("id", selectedEventId)
            .single();

          if (evData) {
            if (evData.top_teams) {
              setTopTeams({
                first: evData.top_teams.first || "",
                second: evData.top_teams.second || "",
                third: evData.top_teams.third || "",
                fourth: evData.top_teams.fourth || "",
              });
            }
            if (evData.final_points_table_url) {
              setPointsTableImage(evData.final_points_table_url);
            }
          }
        } catch {}

        try {
          const cachedTop = localStorage.getItem(`apex_top_teams_${selectedEventId}`);
          if (cachedTop) {
            const parsed = JSON.parse(cachedTop);
            if (parsed.topTeams) setTopTeams(parsed.topTeams);
            if (parsed.image) setPointsTableImage(parsed.image);
          }
        } catch {}

        setMatch1Scores(m1);
        setMatch2Scores(m2);
        setMatch3Scores(m3);
      } catch (err) {
        console.error("Error loading points data:", err);
      }
    })();
  }, [selectedEventId]);

  // Current active match score list
  const currentScores = activeSubTab === "match1" ? match1Scores : activeSubTab === "match2" ? match2Scores : match3Scores;
  const setCurrentScores = (newScores: TeamMatchScore[]) => {
    if (activeSubTab === "match1") setMatch1Scores(newScores);
    else if (activeSubTab === "match2") setMatch2Scores(newScores);
    else if (activeSubTab === "match3") setMatch3Scores(newScores);
  };

  const handleUpdateScore = (index: number, field: "rank" | "kills" | "teamName", val: string | number) => {
    const copy = [...currentScores];
    if (field === "teamName") {
      copy[index].teamName = String(val);
    } else {
      copy[index][field] = Math.max(0, Number(val) || 0);
    }
    setCurrentScores(copy);
  };

  const handleAddSquad = () => {
    const newSquad: TeamMatchScore = {
      teamName: `Team ${currentScores.length + 1}`,
      rank: currentScores.length + 1,
      kills: 0,
    };
    setCurrentScores([...currentScores, newSquad]);
  };

  const handleRemoveSquad = (index: number) => {
    const copy = currentScores.filter((_, i) => i !== index);
    setCurrentScores(copy);
  };

  // Compute Overall Standings across matches
  const overallStandings: OverallTeamStanding[] = useMemo(() => {
    const teamMap: Record<
      string,
      { matchesPlayed: number; wwcd: number; placementPoints: number; killPoints: number; totalPoints: number }
    > = {};

    const processMatch = (scores: TeamMatchScore[]) => {
      for (const s of scores) {
        const name = s.teamName.trim();
        if (!name) continue;
        if (!teamMap[name]) {
          teamMap[name] = { matchesPlayed: 0, wwcd: 0, placementPoints: 0, killPoints: 0, totalPoints: 0 };
        }
        const placePts = getBgmiPlacePoints(s.rank);
        const killPts = s.kills || 0;
        teamMap[name].matchesPlayed += 1;
        if (s.rank === 1) teamMap[name].wwcd += 1;
        teamMap[name].placementPoints += placePts;
        teamMap[name].killPoints += killPts;
        teamMap[name].totalPoints += placePts + killPts;
      }
    };

    processMatch(match1Scores);
    processMatch(match2Scores);
    processMatch(match3Scores);

    const list: OverallTeamStanding[] = Object.keys(teamMap).map((teamName) => ({
      rank: 1,
      teamName,
      ...teamMap[teamName],
    }));

    // Sort by Total Points desc, then WWCD desc, then placementPoints desc, then kills desc
    list.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.wwcd !== a.wwcd) return b.wwcd - a.wwcd;
      if (b.placementPoints !== a.placementPoints) return b.placementPoints - a.placementPoints;
      return b.killPoints - a.killPoints;
    });

    return list.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [match1Scores, match2Scores, match3Scores]);

  // Save to Supabase and cache
  const handleSaveAndPublish = async () => {
    if (!selectedEventId) return;
    setSaving(true);
    try {
      // 1. Save match 1
      await supabase.from("points_tables").upsert(
        {
          event_id: selectedEventId,
          match_number: 1,
          data: match1Scores,
          is_published: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,match_number" }
      );

      // 2. Save match 2
      await supabase.from("points_tables").upsert(
        {
          event_id: selectedEventId,
          match_number: 2,
          data: match2Scores,
          is_published: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,match_number" }
      );

      // 3. Save match 3
      await supabase.from("points_tables").upsert(
        {
          event_id: selectedEventId,
          match_number: 3,
          data: match3Scores,
          is_published: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,match_number" }
      );

      // 4. Save to localStorage cache
      try {
        localStorage.setItem(
          `apex_points_${selectedEventId}`,
          JSON.stringify({
            m1: match1Scores,
            m2: match2Scores,
            m3: match3Scores,
            updatedAt: new Date().toISOString(),
          })
        );
      } catch {}

      // 5. Update Event with Top 4 Winners & Final Points Table Image & mark completed
      try {
        await supabase
          .from("events")
          .update({
            top_teams: topTeams,
            final_points_table_url: pointsTableImage,
            status: "completed",
          })
          .eq("id", selectedEventId);
      } catch {
        // Fallback: direct update
      }

      try {
        localStorage.setItem(
          `apex_top_teams_${selectedEventId}`,
          JSON.stringify({
            topTeams,
            image: pointsTableImage,
            updatedAt: new Date().toISOString(),
          })
        );
      } catch {}

      showToast("Points Table & Top 4 Winners published live!", "success");
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to save points table", "error");
    } finally {
      setSaving(false);
    }
  };

  const handlePointsImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast("Image size must be under 8MB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPointsTableImage(reader.result);
        showToast("Points table image loaded! Click Save to publish.", "success");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAutoFillTop4 = () => {
    if (overallStandings.length === 0) {
      showToast("Enter match scores first to auto-fill top 4.", "error");
      return;
    }
    setTopTeams({
      first: overallStandings[0]?.teamName || "",
      second: overallStandings[1]?.teamName || "",
      third: overallStandings[2]?.teamName || "",
      fourth: overallStandings[3]?.teamName || "",
    });
    showToast("Top 4 squads auto-filled from current overall standings!", "success");
  };

  const handleCopyWhatsAppLeaderboard = () => {
    const selectedEv = events.find((e) => e.id === selectedEventId);
    const title = selectedEv ? selectedEv.title : "Apex Esports Scrims";

    let text = `🏆 *[${ORG_NAME.toUpperCase()} — OFFICIAL STANDINGS]*\n`;
    text += `🎮 Lobby: *${title}*\n`;
    text += `📊 System: Official BGMI 10-Point System\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    overallStandings.slice(0, 16).forEach((s) => {
      const medal = s.rank === 1 ? "🥇 #1" : s.rank === 2 ? "🥈 #2" : s.rank === 3 ? "🥉 #3" : `#${s.rank}`;
      const wwcdBadge = s.wwcd > 0 ? ` [${s.wwcd} WWCD 🍗]` : "";
      text += `${medal} *${s.teamName}* — *${s.totalPoints} PTS* (Place: ${s.placementPoints} | Kills: ${s.killPoints})${wwcdBadge}\n`;
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🍗 *Winner Winner Chicken Dinners:*\n`;
    const m1Winner = match1Scores.find((s) => s.rank === 1);
    const m2Winner = match2Scores.find((s) => s.rank === 1);
    const m3Winner = match3Scores.find((s) => s.rank === 1);
    if (m1Winner) text += `• Match 1 (Erangel): *${m1Winner.teamName}* (${m1Winner.kills} Kills)\n`;
    if (m2Winner) text += `• Match 2 (Miramar): *${m2Winner.teamName}* (${m2Winner.kills} Kills)\n`;
    if (m3Winner) text += `• Match 3 (Rondo): *${m3Winner.teamName}* (${m3Winner.kills} Kills)\n`;

    text += `\n💬 *Prize Payouts & Verification:* WhatsApp +91 ${SUPPORT_WHATSAPP}\n`;
    text += `🔥 GG to all squads! Register for the next lobby on our website.`;

    navigator.clipboard.writeText(text).then(() => {
      setCopiedLeaderboard(true);
      showToast("WhatsApp Leaderboard copied to clipboard!", "success");
      setTimeout(() => setCopiedLeaderboard(false), 2500);
    });
  };

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="space-y-6">
      {/* ── Top Bar: Lobby Selector & Main Actions ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
              <span>📊</span>
              <span>Points Table &amp; Results Calculator</span>
            </h2>
            <p className="text-xs text-slate-500">
              Official BGMI 10-Point Scoring (1st: 10, 2nd: 6, 3rd: 5... + 1 pt/kill). Auto-calculates totals &amp; WWCD.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCopyWhatsAppLeaderboard}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{copiedLeaderboard ? "✓" : "📋"}</span>
              <span>{copiedLeaderboard ? "Copied!" : "Copy WhatsApp Leaderboard"}</span>
            </button>

            <button
              onClick={handleSaveAndPublish}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-black bg-[#FFB800] hover:bg-[#F59E0B] text-slate-950 transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                  <span>Publishing…</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Save &amp; Publish Standings</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tournament Selection Dropdown */}
        <div className="flex items-center gap-3 pt-2 border-t border-slate-100 flex-wrap">
          <label className="text-xs font-extrabold uppercase tracking-wider text-slate-500 shrink-0">
            Select Tournament:
          </label>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            disabled={loadingEvents}
            className="flex-1 min-w-[240px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} · {new Date(ev.starts_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Official Top 4 Winners & Points Table Image Upload Card ── */}
      <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-amber-200/80 pb-3">
          <div>
            <h3 className="text-sm sm:text-base font-black text-amber-950 flex items-center gap-2">
              <span>👑</span>
              <span>Top 4 Teams &amp; Final Points Table Image</span>
            </h3>
            <p className="text-xs text-amber-800">
              Input the winning teams and upload your official score sheet image to display live on the website.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAutoFillTop4}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-amber-200 hover:bg-amber-300 text-amber-950 border border-amber-400 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Auto-fill top 4 teams based on calculated overall match points"
          >
            <span>⚡</span>
            <span>Auto-Fill from Standings</span>
          </button>
        </div>

        {/* 4 Team Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1st Place */}
          <div className="rounded-xl bg-white border-2 border-amber-400 p-3 space-y-1.5 shadow-xs">
            <label className="text-[10px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-1">
              <span>🥇</span>
              <span>1st Place (Champion)</span>
            </label>
            <input
              type="text"
              value={topTeams.first}
              onChange={(e) => setTopTeams({ ...topTeams, first: e.target.value })}
              placeholder="e.g. Team Soul"
              className="w-full rounded-lg border border-amber-300 bg-amber-50/30 px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-white"
            />
          </div>

          {/* 2nd Place */}
          <div className="rounded-xl bg-white border border-slate-300 p-3 space-y-1.5 shadow-xs">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-600 flex items-center gap-1">
              <span>🥈</span>
              <span>2nd Place (Runner Up)</span>
            </label>
            <input
              type="text"
              value={topTeams.second}
              onChange={(e) => setTopTeams({ ...topTeams, second: e.target.value })}
              placeholder="e.g. GodLike"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
            />
          </div>

          {/* 3rd Place */}
          <div className="rounded-xl bg-white border border-slate-300 p-3 space-y-1.5 shadow-xs">
            <label className="text-[10px] font-black uppercase tracking-wider text-amber-900 flex items-center gap-1">
              <span>🥉</span>
              <span>3rd Place</span>
            </label>
            <input
              type="text"
              value={topTeams.third}
              onChange={(e) => setTopTeams({ ...topTeams, third: e.target.value })}
              placeholder="e.g. Global Esports"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
            />
          </div>

          {/* 4th Place */}
          <div className="rounded-xl bg-white border border-slate-300 p-3 space-y-1.5 shadow-xs">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <span>🎖️</span>
              <span>4th Place</span>
            </label>
            <input
              type="text"
              value={topTeams.fourth}
              onChange={(e) => setTopTeams({ ...topTeams, fourth: e.target.value })}
              placeholder="e.g. Carnival Gaming"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
            />
          </div>
        </div>

        {/* Upload Score Sheet Image */}
        <div className="rounded-xl border border-dashed border-amber-300 bg-white p-3.5 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 cursor-pointer">
              <span>📸</span>
              <span>Upload Official Points Table Screenshot / Image</span>
            </label>
            {pointsTableImage && (
              <button
                type="button"
                onClick={() => setPointsTableImage(null)}
                className="text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
              >
                Remove Image
              </button>
            )}
          </div>

          {pointsTableImage ? (
            <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              <img
                src={pointsTableImage}
                alt="Points Table preview"
                className="h-16 w-auto object-contain rounded-md border border-slate-300 shadow-2xs"
              />
              <div>
                <p className="text-xs font-extrabold text-emerald-800">✓ Points Table Image Attached</p>
                <p className="text-[10px] text-slate-500">Will be viewable by players with 1 click on the homepage.</p>
              </div>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*"
              onChange={handlePointsImageUpload}
              className="block w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-amber-100 file:text-amber-900 hover:file:bg-amber-200 cursor-pointer"
            />
          )}
        </div>
      </div>

      {/* ── Sub Tabs: Match 1, Match 2, Match 3, Overall ── */}
      <div className="flex gap-2 p-1 bg-slate-200/80 rounded-2xl overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveSubTab("match1")}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            activeSubTab === "match1" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>🎮</span>
          <span>Match 1 (Erangel)</span>
        </button>

        <button
          onClick={() => setActiveSubTab("match2")}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            activeSubTab === "match2" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>🏜️</span>
          <span>Match 2 (Miramar)</span>
        </button>

        <button
          onClick={() => setActiveSubTab("match3")}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            activeSubTab === "match3" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>🏔️</span>
          <span>Match 3 (Rondo)</span>
        </button>

        <button
          onClick={() => setActiveSubTab("overall")}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            activeSubTab === "overall" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>🏆</span>
          <span>Overall Standings &amp; Winners</span>
        </button>
      </div>

      {/* ── Active Tab View ── */}
      {activeSubTab === "overall" ? (
        /* Overall Standings Table View */
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>🏆</span>
                <span>Official Overall Standings (3 Matches)</span>
              </h3>
              <p className="text-xs text-slate-500">
                Sorted by Total Points ➔ WWCD ➔ Placement Points ➔ Finishes
              </p>
            </div>
            {selectedEvent && (
              <span className="rounded-full bg-emerald-50 border border-emerald-300 px-3 py-1 text-xs font-bold text-emerald-800">
                Total Prize Pool: ₹{Math.round(selectedEvent.prize_pool_paise / 100)}
              </span>
            )}
          </div>

          {/* Standings Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-extrabold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">Rank</th>
                  <th className="py-3 px-3">Team Name</th>
                  <th className="py-3 px-3 text-center">Matches</th>
                  <th className="py-3 px-3 text-center">WWCD 🍗</th>
                  <th className="py-3 px-3 text-right">Place Pts</th>
                  <th className="py-3 px-3 text-right">Kill Pts</th>
                  <th className="py-3 px-3 text-right font-black text-blue-700">Total Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                {overallStandings.map((s) => {
                  const isTop3 = s.rank <= 3;
                  return (
                    <tr
                      key={s.teamName}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        s.rank === 1
                          ? "bg-amber-50/40 font-bold"
                          : s.rank === 2
                          ? "bg-slate-50/60"
                          : s.rank === 3
                          ? "bg-amber-50/20"
                          : ""
                      }`}
                    >
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-black ${
                            s.rank === 1
                              ? "bg-amber-400 text-slate-950 shadow-xs"
                              : s.rank === 2
                              ? "bg-slate-300 text-slate-900"
                              : s.rank === 3
                              ? "bg-amber-200 text-amber-950"
                              : "text-slate-500 font-mono"
                          }`}
                        >
                          {s.rank === 1 ? "1" : s.rank === 2 ? "2" : s.rank === 3 ? "3" : s.rank}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-black text-slate-900 whitespace-nowrap">
                        {s.teamName}
                        {s.wwcd > 0 && (
                          <span className="ml-2 inline-flex items-center text-[10px] font-bold text-amber-600 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded-full">
                            🍗 {s.wwcd} WWCD
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono">{s.matchesPlayed}</td>
                      <td className="py-3 px-3 text-center font-black text-amber-600 font-mono">
                        {s.wwcd}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-600">
                        {s.placementPoints}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-600">
                        {s.killPoints}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-sm text-blue-700">
                        {s.totalPoints}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Single Match Score Input View */
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-base font-black text-slate-900">
                {activeSubTab === "match1" ? "🎮 Match 1 — Erangel" : activeSubTab === "match2" ? "🏜️ Match 2 — Miramar" : "🏔️ Match 3 — Rondo"} Scorecard
              </h3>
              <p className="text-xs text-slate-500">
                Enter placement (1-16) and kills for each team. Place points are auto-computed.
              </p>
            </div>

            <button
              onClick={handleAddSquad}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>➕</span>
              <span>Add Squad</span>
            </button>
          </div>

          {/* Scores Matrix */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-extrabold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3 w-16">Rank</th>
                  <th className="py-2.5 px-3">Team Name</th>
                  <th className="py-2.5 px-3 w-24 text-center">Kills</th>
                  <th className="py-2.5 px-3 w-24 text-right">Place Pts</th>
                  <th className="py-2.5 px-3 w-24 text-right font-black text-blue-700">Total</th>
                  <th className="py-2.5 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentScores.map((score, idx) => {
                  const placePts = getBgmiPlacePoints(score.rank);
                  const total = placePts + (score.kills || 0);
                  const isWinner = score.rank === 1;

                  return (
                    <tr key={idx} className={isWinner ? "bg-amber-50/50" : "hover:bg-slate-50"}>
                      {/* Rank Input */}
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={score.rank}
                          onChange={(e) => handleUpdateScore(idx, "rank", e.target.value)}
                          className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center font-mono font-bold text-slate-900 outline-none focus:border-blue-600"
                        />
                      </td>

                      {/* Team Name Input */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={score.teamName}
                            onChange={(e) => handleUpdateScore(idx, "teamName", e.target.value)}
                            className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 outline-none focus:border-blue-600"
                            placeholder="Team name"
                          />
                          {isWinner && (
                            <span className="shrink-0 text-amber-700 font-bold text-[11px] bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md">
                              🍗 WWCD
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Kills Input */}
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          min={0}
                          value={score.kills}
                          onChange={(e) => handleUpdateScore(idx, "kills", e.target.value)}
                          className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center font-mono font-bold text-slate-900 outline-none focus:border-blue-600"
                        />
                      </td>

                      {/* Place Points (Auto) */}
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-600">
                        {placePts}
                      </td>

                      {/* Total Points (Auto) */}
                      <td className="py-2 px-3 text-right font-mono font-black text-sm text-blue-700">
                        {total}
                      </td>

                      {/* Remove Button */}
                      <td className="py-2 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveSquad(idx)}
                          className="text-slate-400 hover:text-red-600 transition-colors cursor-pointer text-xs p-1"
                          title="Remove squad"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
