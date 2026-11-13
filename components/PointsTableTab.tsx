"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";
import { resolveGeminiKey } from "@/lib/gemini";

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
  slotNumber?: number; // BGMI standard competitive slots 5 to 25
  teamName: string;
  rank: number; // 1-20
  kills: number;
};

export type MatchData = {
  matchNumber: number;
  mapName: string;
  scores: TeamMatchScore[];
};

export type OverallTeamStanding = {
  rank: number;
  slotNumber?: number;
  teamName: string;
  matchesPlayed: number;
  wwcd: number;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
};

export type RegisteredSquadSlot = {
  slotNumber: number; // 5 to 25
  teamName: string;
  whatsapp?: string;
  isConfirmed: boolean;
};

interface PointsTableTabProps {
  showToast: (m: string, t: "success" | "error") => void;
}

export function PointsTableTab({ showToast }: PointsTableTabProps) {
  // Top-level Mode: "manual" = Manual Control Center, "ai" = Autonomous AI Engine
  const [mainMode, setMainMode] = useState<"manual" | "ai">("manual");

  const [events, setEvents] = useState<{ id: string; title: string; starts_at: string; prize_pool_paise: number }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"match1" | "match2" | "match3" | "overall">("match1");

  // Official Registered Squads mapped to Slots 5 to 25
  const [registeredRoster, setRegisteredRoster] = useState<RegisteredSquadSlot[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  // Scores state for matches 1, 2, 3
  const [match1Scores, setMatch1Scores] = useState<TeamMatchScore[]>([]);
  const [match2Scores, setMatch2Scores] = useState<TeamMatchScore[]>([]);
  const [match3Scores, setMatch3Scores] = useState<TeamMatchScore[]>([]);
  const [saving, setSaving] = useState(false);
  const [copiedLeaderboard, setCopiedLeaderboard] = useState(false);
  const [lastAutoSavedTime, setLastAutoSavedTime] = useState<string | null>(null);

  // Top 4 Teams & Final Points Table Image state
  const [topTeams, setTopTeams] = useState({
    first: "",
    second: "",
    third: "",
    fourth: "",
  });
  const [pointsTableImage, setPointsTableImage] = useState<string | null>(null);

  // AI Autonomous Scoreboard Engine State
  const [aiImageBase64, setAiImageBase64] = useState<string | null>(null);
  const [aiTargetMatch, setAiTargetMatch] = useState<1 | 2 | 3>(1);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiAutoPublishing, setAiAutoPublishing] = useState(false);
  const [aiResults, setAiResults] = useState<TeamMatchScore[] | null>(null);
  const [aiApiKey, setAiApiKey] = useState("");
  const [showAiKeyInput, setShowAiKeyInput] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // 1. Load available lobbies & saved Gemini key
  useEffect(() => {
    try {
      const k = localStorage.getItem("apex_gemini_api_key");
      const valid = resolveGeminiKey(k);
      setAiApiKey(valid);
      localStorage.setItem("apex_gemini_api_key", valid);
    } catch {}

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
          try {
            const savedEventId = localStorage.getItem("apex_points_selected_event_id");
            const match = data.find((e) => e.id === savedEventId);
            setSelectedEventId(match ? match.id : data[0].id);
          } catch {
            setSelectedEventId(data[0].id);
          }
        }
      }
      setLoadingEvents(false);
    })();
  }, []);

  // 2. Load registrations mapped to SLOTS 5 TO 25 for the selected tournament
  const loadRosterForEvent = useCallback(async (eventId: string) => {
    if (!eventId) return [];
    setLoadingRoster(true);
    try {
      // Fetch registrations from supabase
      const { data: regs } = await supabase
        .from("registrations")
        .select("team_name, status, created_at, whatsapp")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });

      // Check local submissions fallback if none in remote
      let teamList: { team_name: string; whatsapp?: string; isConfirmed: boolean }[] = [];
      if (regs && regs.length > 0) {
        teamList = regs.map((r) => ({
          team_name: r.team_name,
          whatsapp: r.whatsapp,
          isConfirmed: r.status === "confirmed",
        }));
      } else {
        try {
          const localStr = localStorage.getItem("apex_all_submissions");
          if (localStr) {
            const allLocal = JSON.parse(localStr);
            interface LocalSub {
              events?: Array<{ id?: string; event_id?: string }>;
              teamName?: string;
              whatsapp?: string;
              status?: string;
            }
            const matching = allLocal.filter((ls: LocalSub) =>
              ls.events?.some((e) => (e.id || e.event_id) === eventId)
            );
            if (matching.length > 0) {
              teamList = matching.map((m: LocalSub) => ({
                team_name: m.teamName || "Registered Squad",
                whatsapp: m.whatsapp,
                isConfirmed: m.status === "approved" || m.status === "confirmed",
              }));
            }
          }
        } catch {}
      }

      // De-duplicate unique squad names
      const seen = new Set<string>();
      const uniqueTeams = teamList.filter((t) => {
        const clean = t.team_name?.trim();
        if (!clean || seen.has(clean.toLowerCase())) return false;
        seen.add(clean.toLowerCase());
        return true;
      });

      // Standard BGMI scrim slots: Slots 5 to 25 (up to 21 squads)
      const slots: RegisteredSquadSlot[] = [];
      for (let slot = 5; slot <= 25; slot++) {
        const teamIndex = slot - 5;
        if (teamIndex < uniqueTeams.length) {
          slots.push({
            slotNumber: slot,
            teamName: uniqueTeams[teamIndex].team_name,
            whatsapp: uniqueTeams[teamIndex].whatsapp,
            isConfirmed: uniqueTeams[teamIndex].isConfirmed,
          });
        }
      }

      setRegisteredRoster(slots);
      return slots;
    } catch (e) {
      console.error("Error loading roster:", e);
      return [];
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  // 3. Load Points Table & Restore Draft across browser reloads
  useEffect(() => {
    if (!selectedEventId) return;

    (async () => {
      // Load roster slots 5-25
      const currentRoster = await loadRosterForEvent(selectedEventId);

      // Check localStorage draft first so page refresh never loses user's typed data
      let restoredFromDraft = false;
      try {
        const draftStr = localStorage.getItem(`apex_points_draft_${selectedEventId}`);
        if (draftStr) {
          const draft = JSON.parse(draftStr);
          if (Array.isArray(draft.m1) && draft.m1.length > 0) {
            setMatch1Scores(draft.m1);
            setMatch2Scores(draft.m2 || []);
            setMatch3Scores(draft.m3 || []);
            if (draft.topTeams) setTopTeams(draft.topTeams);
            if (draft.image) setPointsTableImage(draft.image);
            if (draft.mainMode) setMainMode(draft.mainMode);
            if (draft.activeSubTab) setActiveSubTab(draft.activeSubTab);
            if (draft.aiResults) setAiResults(draft.aiResults);
            if (draft.aiTargetMatch) setAiTargetMatch(draft.aiTargetMatch);
            setLastAutoSavedTime(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
            restoredFromDraft = true;
          }
        }
      } catch {}

      if (restoredFromDraft) return;

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

        // If empty, prepopulate from confirmed squads in Slots 5 to 25
        if (m1.length === 0) {
          if (currentRoster.length > 0) {
            m1 = currentRoster.map((s, idx) => ({
              slotNumber: s.slotNumber,
              teamName: s.teamName,
              rank: idx + 1,
              kills: 0,
            }));
            m2 = currentRoster.map((s, idx) => ({
              slotNumber: s.slotNumber,
              teamName: s.teamName,
              rank: idx + 1,
              kills: 0,
            }));
            m3 = currentRoster.map((s, idx) => ({
              slotNumber: s.slotNumber,
              teamName: s.teamName,
              rank: idx + 1,
              kills: 0,
            }));
          } else {
            // Default 16 squads in Slots 5 to 20
            const defaultTeams = [
              "Team 1", "Team 2", "Team 3", "Team 4",
              "Team 5", "Team 6", "Team 7", "Team 8",
              "Team 9", "Team 10", "Team 11", "Team 12",
              "Team 13", "Team 14", "Team 15", "Team 16"
            ];
            m1 = defaultTeams.map((name, i) => ({ slotNumber: i + 5, teamName: name, rank: i + 1, kills: 0 }));
            m2 = defaultTeams.map((name, i) => ({ slotNumber: i + 5, teamName: name, rank: i + 1, kills: 0 }));
            m3 = defaultTeams.map((name, i) => ({ slotNumber: i + 5, teamName: name, rank: i + 1, kills: 0 }));
          }
        }

        // Load Top 4 Teams and points table image
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

        setMatch1Scores(m1);
        setMatch2Scores(m2);
        setMatch3Scores(m3);
      } catch (err) {
        console.error("Error loading points data:", err);
      }
    })();
  }, [selectedEventId, loadRosterForEvent]);

  // 4. Auto-save all draft progress to localStorage so browser reload NEVER wipes typed data
  useEffect(() => {
    if (!selectedEventId || match1Scores.length === 0) return;
    try {
      const payload = {
        m1: match1Scores,
        m2: match2Scores,
        m3: match3Scores,
        topTeams,
        image: pointsTableImage,
        mainMode,
        activeSubTab,
        aiResults,
        aiTargetMatch,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(`apex_points_draft_${selectedEventId}`, JSON.stringify(payload));
      setLastAutoSavedTime(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    } catch {}
  }, [
    selectedEventId,
    match1Scores,
    match2Scores,
    match3Scores,
    topTeams,
    pointsTableImage,
    mainMode,
    activeSubTab,
    aiResults,
    aiTargetMatch,
  ]);

  // Current active match score list for manual editor
  const currentScores = activeSubTab === "match1" ? match1Scores : activeSubTab === "match2" ? match2Scores : match3Scores;
  const setCurrentScores = (newScores: TeamMatchScore[]) => {
    if (activeSubTab === "match1") setMatch1Scores(newScores);
    else if (activeSubTab === "match2") setMatch2Scores(newScores);
    else if (activeSubTab === "match3") setMatch3Scores(newScores);
  };

  const handleUpdateScore = (index: number, field: "rank" | "kills" | "teamName" | "slotNumber", val: string | number) => {
    const copy = [...currentScores];
    if (field === "teamName") {
      copy[index].teamName = String(val);
    } else if (field === "slotNumber") {
      copy[index].slotNumber = Math.max(5, Math.min(25, Number(val) || 5));
    } else {
      copy[index][field] = Math.max(0, Number(val) || 0);
    }
    setCurrentScores(copy);
  };

  const handleAddSquad = () => {
    const nextSlot = Math.min(25, 5 + currentScores.length);
    const newSquad: TeamMatchScore = {
      slotNumber: nextSlot,
      teamName: `Slot ${nextSlot} Squad`,
      rank: currentScores.length + 1,
      kills: 0,
    };
    setCurrentScores([...currentScores, newSquad]);
  };

  const handleRemoveSquad = (index: number) => {
    const copy = currentScores.filter((_, i) => i !== index);
    setCurrentScores(copy);
  };

  // Compute Overall Standings across all 3 matches
  const overallStandings: OverallTeamStanding[] = useMemo(() => {
    const teamMap: Record<
      string,
      {
        slotNumber?: number;
        matchesPlayed: number;
        wwcd: number;
        placementPoints: number;
        killPoints: number;
        totalPoints: number;
      }
    > = {};

    const processMatch = (scores: TeamMatchScore[]) => {
      for (const s of scores) {
        const name = s.teamName.trim();
        if (!name) continue;
        if (!teamMap[name]) {
          teamMap[name] = {
            slotNumber: s.slotNumber,
            matchesPlayed: 0,
            wwcd: 0,
            placementPoints: 0,
            killPoints: 0,
            totalPoints: 0,
          };
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

    // Sort: Total Points desc ➔ WWCD desc ➔ Placement Pts desc ➔ Kill Pts desc
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

      // 4. Update Event with Top 4 Winners & Final Points Table Image
      await supabase
        .from("events")
        .update({
          top_teams: topTeams,
          final_points_table_url: pointsTableImage,
          status: "completed",
        })
        .eq("id", selectedEventId);

      // 5. Update local draft
      try {
        localStorage.setItem(
          `apex_points_draft_${selectedEventId}`,
          JSON.stringify({
            m1: match1Scores,
            m2: match2Scores,
            m3: match3Scores,
            topTeams,
            image: pointsTableImage,
            mainMode,
            activeSubTab,
            aiResults,
            aiTargetMatch,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {}

      showToast("🚀 Points Table & Top 4 Winners published live on homepage!", "success");
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
    showToast("Top 4 squads auto-filled from calculated overall standings!", "success");
  };

  // ── AI Autonomous Scoreboard Scanner Handlers ──
  const handleAiScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast("Scoreboard screenshot must be under 8MB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAiImageBase64(reader.result);
        setAiResults(null);
        setAiError(null);
        showToast("Match screenshot loaded! Ready to scan.", "success");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleScanScoreboardWithAi = async () => {
    if (!aiImageBase64) {
      showToast("Please upload an in-game match scoreboard screenshot first", "error");
      return;
    }
    setAiScanning(true);
    setAiError(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (aiApiKey.trim()) {
        headers["x-gemini-api-key"] = aiApiKey.trim();
      }

      // Format registered squads in Slots 5 to 25 so AI can match IGNs / clan tags to official roster
      const registeredSquadsPayload = registeredRoster.map((r) => ({
        slotNumber: r.slotNumber,
        teamName: r.teamName,
      }));

      const res = await fetch("/api/ai/parse-match-screenshot", {
        method: "POST",
        headers,
        body: JSON.stringify({
          imageBase64: aiImageBase64,
          matchNumber: aiTargetMatch,
          registeredSquads: registeredSquadsPayload,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        if (data.requiresApiKey) {
          setShowAiKeyInput(true);
          setAiError(data.message);
          showToast("Gemini API Key required. Enter your free key below.", "error");
        } else {
          setAiError(data.message || "Failed to scan scoreboard");
          showToast(data.message || "AI scanning failed", "error");
        }
        return;
      }

      const extracted: TeamMatchScore[] = data.teams.map(
        (t: { rank: number; slotNumber?: number; teamName: string; kills: number }, idx: number) => ({
          rank: Number(t.rank) || idx + 1,
          slotNumber: Number(t.slotNumber) || idx + 5,
          teamName: String(t.teamName || `Squad ${idx + 1}`),
          kills: Number(t.kills) || 0,
        })
      );

      setAiResults(extracted);
      showToast(
        `🤖 AI auto-matched ${extracted.length} squads with Slots 5–25! Review preview below.`,
        "success"
      );
    } catch (err: unknown) {
      const msg = (err as Error).message || "Connection error";
      setAiError(msg);
      showToast("Network error while connecting to AI service.", "error");
    } finally {
      setAiScanning(false);
    }
  };

  const handleDemoAiScan = () => {
    // Generate sample demo squads mapped to Slots 5 to 20
    const demoTeams: TeamMatchScore[] = [
      { rank: 1, slotNumber: 5, teamName: registeredRoster[0]?.teamName || "Team Soul", kills: 14 },
      { rank: 2, slotNumber: 6, teamName: registeredRoster[1]?.teamName || "GodLike Esports", kills: 9 },
      { rank: 3, slotNumber: 7, teamName: registeredRoster[2]?.teamName || "Global Esports", kills: 6 },
      { rank: 4, slotNumber: 8, teamName: registeredRoster[3]?.teamName || "Carnival Gaming", kills: 5 },
      { rank: 5, slotNumber: 9, teamName: "Team XSpark", kills: 4 },
      { rank: 6, slotNumber: 10, teamName: "Orangutan", kills: 3 },
      { rank: 7, slotNumber: 11, teamName: "Entity Gaming", kills: 3 },
      { rank: 8, slotNumber: 12, teamName: "Revenant Esports", kills: 2 },
      { rank: 9, slotNumber: 13, teamName: "Team 8Bit", kills: 2 },
      { rank: 10, slotNumber: 14, teamName: "Medal Esports", kills: 1 },
      { rank: 11, slotNumber: 15, teamName: "Blind Esports", kills: 1 },
      { rank: 12, slotNumber: 16, teamName: "Gujarat Tigers", kills: 0 },
      { rank: 13, slotNumber: 17, teamName: "Team Forever", kills: 0 },
      { rank: 14, slotNumber: 18, teamName: "WSB Gaming", kills: 0 },
      { rank: 15, slotNumber: 19, teamName: "Hydra Official", kills: 0 },
      { rank: 16, slotNumber: 20, teamName: "Autobotz Esports", kills: 0 },
    ];
    setAiResults(demoTeams);
    showToast("Loaded sample demo extraction! Click 'Apply & Sync' or 'One-Click Auto-Publish'.", "success");
  };

  // Sync AI results to manual editor so admin can review or tweak
  const handleApplyAiResultsToManual = () => {
    if (!aiResults || aiResults.length === 0) return;
    if (aiTargetMatch === 1) {
      setMatch1Scores(aiResults);
      setActiveSubTab("match1");
    } else if (aiTargetMatch === 2) {
      setMatch2Scores(aiResults);
      setActiveSubTab("match2");
    } else {
      setMatch3Scores(aiResults);
      setActiveSubTab("match3");
    }
    setMainMode("manual");
    showToast(`✓ Synced ${aiResults.length} squads into Match ${aiTargetMatch} manual table!`, "success");
  };

  // Fully Autonomous: 1-Click Auto-Publish Match Scores, Overall Standings & Top 4
  const handleOneClickAutoPublish = async () => {
    if (!aiResults || aiResults.length === 0 || !selectedEventId) return;
    setAiAutoPublishing(true);
    try {
      let m1 = match1Scores;
      let m2 = match2Scores;
      let m3 = match3Scores;

      if (aiTargetMatch === 1) {
        m1 = aiResults;
        setMatch1Scores(aiResults);
      } else if (aiTargetMatch === 2) {
        m2 = aiResults;
        setMatch2Scores(aiResults);
      } else {
        m3 = aiResults;
        setMatch3Scores(aiResults);
      }

      // Upsert target match table to Supabase
      await supabase.from("points_tables").upsert(
        {
          event_id: selectedEventId,
          match_number: aiTargetMatch,
          data: aiResults,
          is_published: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,match_number" }
      );

      // Auto-calculate new Top 4
      const calculatedTop4 = {
        first: aiResults[0]?.teamName || topTeams.first,
        second: aiResults[1]?.teamName || topTeams.second,
        third: aiResults[2]?.teamName || topTeams.third,
        fourth: aiResults[3]?.teamName || topTeams.fourth,
      };
      setTopTeams(calculatedTop4);

      // If screenshot was provided, use as points table image
      let finalImg = pointsTableImage;
      if (aiImageBase64) {
        finalImg = aiImageBase64;
        setPointsTableImage(aiImageBase64);
      }

      // Update event with top teams
      await supabase
        .from("events")
        .update({
          top_teams: calculatedTop4,
          final_points_table_url: finalImg,
          status: "completed",
        })
        .eq("id", selectedEventId);

      showToast(`🚀 Autonomous Publish Successful! Match ${aiTargetMatch} and Top 4 are live.`, "success");
    } catch (e: unknown) {
      showToast((e as Error).message || "Autonomous publish failed", "error");
    } finally {
      setAiAutoPublishing(false);
    }
  };

  const handleSaveAiKey = (key: string) => {
    setAiApiKey(key);
    try {
      localStorage.setItem("apex_gemini_api_key", key.trim());
      showToast("Gemini API Key saved successfully!", "success");
      setShowAiKeyInput(false);
      setAiError(null);
    } catch {}
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
      const slotBadge = s.slotNumber ? ` [Slot ${s.slotNumber}]` : "";
      const wwcdBadge = s.wwcd > 0 ? ` [${s.wwcd} WWCD 🍗]` : "";
      text += `${medal} *${s.teamName}*${slotBadge} — *${s.totalPoints} PTS* (Place: ${s.placementPoints} | Kills: ${s.killPoints})${wwcdBadge}\n`;
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
      {/* ── Top Header & Lobby Selector Bar ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                <span>📊</span>
                <span>Points Table &amp; Results Command Center</span>
              </h2>
              {lastAutoSavedTime && (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                  <span>💾</span>
                  <span>Auto-saved {lastAutoSavedTime}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Official BGMI 10-Point Scoring (1st: 10, 2nd: 6, 3rd: 5... + 1 pt/kill) · Slots 5 to 25 squad allocation.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleCopyWhatsAppLeaderboard}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{copiedLeaderboard ? "✓" : "📋"}</span>
              <span>{copiedLeaderboard ? "Copied!" : "Copy WhatsApp Standings"}</span>
            </button>

            <button
              type="button"
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

        {/* Tournament Selector */}
        <div className="flex items-center gap-3 pt-2 border-t border-slate-100 flex-wrap">
          <label className="text-xs font-extrabold uppercase tracking-wider text-slate-500 shrink-0">
            Select Tournament:
          </label>
          <select
            value={selectedEventId}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
              try {
                localStorage.setItem("apex_points_selected_event_id", e.target.value);
              } catch {}
            }}
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

      {/* ── 🌟 DUAL MENU OPTION SELECTOR (Requested by User) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Option 1: Manual Control Center */}
        <button
          type="button"
          onClick={() => setMainMode("manual")}
          className={`flex flex-col text-left p-4 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden ${
            mainMode === "manual"
              ? "border-blue-600 bg-blue-50/70 shadow-md ring-2 ring-blue-500/20"
              : "border-slate-200 bg-white hover:border-slate-300 opacity-80 hover:opacity-100"
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="flex items-center gap-2 font-black text-sm text-slate-900">
              <span className="text-lg">✍️</span>
              <span>Manual Control Center</span>
            </span>
            {mainMode === "manual" ? (
              <span className="bg-blue-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-full">
                Active Mode
              </span>
            ) : (
              <span className="text-[11px] font-bold text-slate-400">Switch ➔</span>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            100% Manual row-by-row keyboard editing. Set team names, kills, ranks &amp; Top 4 winners with zero AI interference.
          </p>
        </button>

        {/* Option 2: Autonomous AI Scoreboard Engine */}
        <button
          type="button"
          onClick={() => setMainMode("ai")}
          className={`flex flex-col text-left p-4 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden ${
            mainMode === "ai"
              ? "border-indigo-600 bg-indigo-50/80 shadow-md ring-2 ring-indigo-500/20"
              : "border-slate-200 bg-white hover:border-indigo-300 opacity-80 hover:opacity-100"
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="flex items-center gap-2 font-black text-sm text-indigo-950">
              <span className="text-lg">🤖</span>
              <span>Autonomous AI Scoreboard Engine</span>
            </span>
            {mainMode === "ai" ? (
              <span className="bg-indigo-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-full shadow-xs">
                Active Mode
              </span>
            ) : (
              <span className="text-[11px] font-bold text-indigo-600">Switch ➔</span>
            )}
          </div>
          <p className="text-xs text-indigo-900/80 leading-relaxed">
            Upload in-game screenshot: AI auto-matches with registered squads in <strong>Slots 5–25</strong>, computes totals &amp; publishes live with 1 click!
          </p>
        </button>
      </div>

      {/* ── 🛡️ Confirmed Roster Banner: Slots 5 to 25 (Shared Context) ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">🎯</span>
            <span className="text-xs font-black uppercase tracking-wider text-slate-700">
              Official Scrim Slots (Slots 5 to 25)
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200">
              {registeredRoster.length} Teams Registered
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Slots 1–4 are reserved for Admins/Casters. Registered squads fill starting from Slot 5.
          </p>
        </div>

        {/* Squad slot pills */}
        {loadingRoster ? (
          <div className="py-2 text-xs text-slate-400 font-medium">Loading confirmed squads…</div>
        ) : registeredRoster.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {registeredRoster.map((r) => (
              <div
                key={r.slotNumber}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-800"
              >
                <span className="font-mono text-[10px] font-black bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-md">
                  #{r.slotNumber}
                </span>
                <span>{r.teamName}</span>
                {r.isConfirmed && (
                  <span className="text-[10px] text-emerald-600 font-extrabold" title="Confirmed Registration">
                    ✓
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">
            No registered teams found yet for this lobby. Slots 5 through 20 will use default squad slots.
          </p>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MENU OPTION 2: 🤖 AUTONOMOUS AI SCOREBOARD ENGINE
          ═══════════════════════════════════════════════════════════════════════ */}
      {mainMode === "ai" && (
        <div className="rounded-3xl border-2 border-indigo-300 bg-gradient-to-b from-indigo-50/90 to-white p-5 sm:p-7 shadow-lg space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-indigo-200/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-md">
                🤖
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-black text-indigo-950">
                    Autonomous AI Scoreboard Engine
                  </h3>
                  <span className="text-[10px] font-black uppercase tracking-wider bg-indigo-200 text-indigo-900 px-2.5 py-0.5 rounded-full">
                    Zero Admin Workload
                  </span>
                </div>
                <p className="text-xs text-indigo-800 mt-0.5">
                  AI reads in-game result screenshots, automatically matches messy clan tags to Slots 5–25, and computes standings.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowAiKeyInput(!showAiKeyInput)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-800 bg-indigo-100 hover:bg-indigo-200 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span>⚙️</span>
                <span>{aiApiKey ? "Gemini Key Configured ✓" : "Set API Key"}</span>
              </button>
            </div>
          </div>

          {/* Inline API Key Configurator (If Needed) */}
          {showAiKeyInput && (
            <div className="rounded-2xl border border-indigo-300 bg-white p-4 space-y-2.5 shadow-sm">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <span>🔑</span>
                  <span>Google Gemini API Key (100% Free)</span>
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-bold text-blue-600 hover:underline"
                >
                  Get free key from Google AI Studio ↗
                </a>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder="Paste AIzaSy... or AQ.Ab... key here"
                  className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 outline-none focus:border-indigo-600 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => handleSaveAiKey(aiApiKey)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-black text-xs hover:bg-indigo-700 cursor-pointer shadow-xs shrink-0"
                >
                  Save Key
                </button>
              </div>
            </div>
          )}

          {aiError && (
            <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-start justify-between gap-2 shadow-xs">
              <span className="font-semibold">⚠️ {aiError}</span>
              <button
                type="button"
                onClick={() => setAiError(null)}
                className="font-black hover:underline cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Workflow Step 1 & 2: Target Match & Screenshot Upload */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step 1: Target Match */}
            <div className="rounded-2xl bg-white border border-indigo-200 p-4 space-y-2.5 shadow-xs">
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <span>🎮</span>
                <span>Step 1: Choose Target Match</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAiTargetMatch(m as 1 | 2 | 3)}
                    className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      aiTargetMatch === m
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Match {m}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                {aiTargetMatch === 1 ? "Erangel" : aiTargetMatch === 2 ? "Miramar" : "Rondo"} scorecard will be extracted.
              </p>
            </div>

            {/* Step 2: Upload Screenshot */}
            <div className="rounded-2xl bg-white border border-indigo-200 p-4 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <span>📸</span>
                  <span>Step 2: Upload Result Screenshot</span>
                </label>
                {aiImageBase64 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAiImageBase64(null);
                      setAiResults(null);
                    }}
                    className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={handleAiScreenshotUpload}
                className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-100 file:text-indigo-900 hover:file:bg-indigo-200 cursor-pointer"
              />
              <p className="text-[10px] text-slate-400">
                Accepts end-of-game victory/results screen, alive scoreboard, or kill table.
              </p>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleScanScoreboardWithAi}
                disabled={aiScanning || !aiImageBase64}
                className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-sm ${
                  aiScanning || !aiImageBase64
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                }`}
              >
                {aiScanning ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    <span>Scanning &amp; Matching Slots 5–25…</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>Scan Scoreboard with AI</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDemoAiScan}
                className="px-3.5 py-2.5 rounded-xl text-xs font-bold text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 transition-colors cursor-pointer shadow-2xs"
              >
                🧪 Try Sample Demo Scan
              </button>
            </div>

            <span className="text-[11px] text-indigo-900 font-semibold">
              🛡️ Safeguard: Admin retains 100% manual override in the Manual Control Center tab.
            </span>
          </div>

          {/* ── Extracted AI Results Table & Autonomous Publish Card ── */}
          {aiResults && aiResults.length > 0 && (
            <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50/70 p-5 space-y-4 animate-in fade-in">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-emerald-200 pb-3">
                <div>
                  <h4 className="text-sm font-black text-emerald-950 flex items-center gap-2">
                    <span>✓</span>
                    <span>AI Extracted {aiResults.length} Squads for Match {aiTargetMatch}</span>
                  </h4>
                  <p className="text-xs text-emerald-800">
                    Teams cross-referenced against tournament roster (Slots 5–25).
                  </p>
                </div>

                {/* Primary Dual Actions: Apply to Manual vs One-Click Auto-Publish */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleApplyAiResultsToManual}
                    className="px-3 py-1.5 rounded-xl text-xs font-black bg-white border border-emerald-400 text-emerald-950 hover:bg-emerald-100 shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <span>✍️</span>
                    <span>Apply &amp; Edit in Manual Tab</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOneClickAutoPublish}
                    disabled={aiAutoPublishing}
                    className="px-4 py-1.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {aiAutoPublishing ? (
                      <span>Publishing…</span>
                    ) : (
                      <>
                        <span>🚀</span>
                        <span>1-Click Auto-Publish &amp; Save</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Extracted Matrix */}
              <div className="overflow-x-auto rounded-xl border border-emerald-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-emerald-200 bg-emerald-100/60 text-emerald-950 font-extrabold uppercase text-[10px] tracking-wider">
                      <th className="py-2.5 px-3 w-16">Rank</th>
                      <th className="py-2.5 px-3 w-20">Slot #</th>
                      <th className="py-2.5 px-3">Matched Registered Squad</th>
                      <th className="py-2.5 px-3 text-center w-20">Kills</th>
                      <th className="py-2.5 px-3 text-right w-24">Place Pts</th>
                      <th className="py-2.5 px-3 text-right font-black text-indigo-700 w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {aiResults.map((s, idx) => {
                      const placePts = getBgmiPlacePoints(s.rank);
                      const total = placePts + (s.kills || 0);
                      return (
                        <tr key={idx} className={s.rank === 1 ? "bg-amber-50/60 font-bold" : "hover:bg-slate-50"}>
                          <td className="py-2 px-3 font-mono">#{s.rank}</td>
                          <td className="py-2 px-3">
                            <span className="font-mono text-[10px] font-black bg-indigo-50 border border-indigo-200 text-indigo-800 px-2 py-0.5 rounded-md">
                              Slot {s.slotNumber || idx + 5}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-bold text-slate-900">
                            {s.teamName}
                            {s.rank === 1 && <span className="ml-2 text-amber-700 text-[10px]">🍗 WWCD</span>}
                          </td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-slate-700">{s.kills}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600">{placePts}</td>
                          <td className="py-2 px-3 text-right font-mono font-black text-indigo-700">{total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MENU OPTION 1: ✍️ MANUAL CONTROL CENTER
          ═══════════════════════════════════════════════════════════════════════ */}
      {mainMode === "manual" && (
        <div className="space-y-6">
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
              type="button"
              onClick={() => setActiveSubTab("match1")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeSubTab === "match1" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>🎮</span>
              <span>Match 1 (Erangel)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab("match2")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeSubTab === "match2" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>🏜️</span>
              <span>Match 2 (Miramar)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab("match3")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeSubTab === "match3" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>🏔️</span>
              <span>Match 3 (Rondo)</span>
            </button>

            <button
              type="button"
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
                      <th className="py-3 px-3">Slot #</th>
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
                              {s.rank}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-mono text-[10px] font-black bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">
                              Slot {s.slotNumber || "-"}
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
            /* Single Match Score Input View (Manual row-by-row editor) */
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {activeSubTab === "match1" ? "🎮 Match 1 — Erangel" : activeSubTab === "match2" ? "🏜️ Match 2 — Miramar" : "🏔️ Match 3 — Rondo"} Scorecard
                  </h3>
                  <p className="text-xs text-slate-500">
                    Enter rank (1-20), slot # (5-25), team name and kills. Place points are auto-computed.
                  </p>
                </div>

                <button
                  type="button"
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
                      <th className="py-2.5 px-3 w-20">Slot #</th>
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

                          {/* Slot # (Slots 5 to 25) */}
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={5}
                              max={25}
                              value={score.slotNumber || idx + 5}
                              onChange={(e) => handleUpdateScore(idx, "slotNumber", e.target.value)}
                              className="w-16 rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-center font-mono font-bold text-indigo-900 outline-none focus:border-indigo-600"
                              title="Competitive Slot 5 to 25"
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
      )}
    </div>
  );
}
