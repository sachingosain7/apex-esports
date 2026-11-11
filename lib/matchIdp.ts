// ─────────────────────────────────────────────────────────────────────────────
// lib/matchIdp.ts
// Handles 3-Match IDP (Room ID & Password) parsing, extraction & formatting
// for BGMI esports lobbies (L1, L2, L3, L4, L5, L6, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export type SingleMatchIDP = {
  matchNumber: number;
  label: string;
  map: string;
  roomId: string | null;
  password: string | null;
  idpTime: string | null;
  startTime: string | null;
  isAvailable: boolean;
};

/**
 * Extracts lobby identifier like "L1", "L2", "L3", "L4", "L5", "L6" from title.
 * Examples:
 *   "APX 1-3PM | L1" -> "L1"
 *   "Apex Scrims L2" -> "L2"
 *   "Erangel Scrim - 8 PM" -> "Lobby"
 */
export function extractLobbyLabel(title: string): string {
  const match = title.match(/\b(L[1-9][0-9]?)\b/i);
  if (match) return match[1].toUpperCase();
  const lobbyMatch = title.match(/lobby\s*([0-9]+)/i);
  if (lobbyMatch) return `L${lobbyMatch[1]}`;
  return "Lobby";
}

/**
 * Splits text lines into an array of clean strings.
 */
function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parses a field that may contain 3 values (M1, M2, M3), JSON, or a single value.
 */
export function extractMatchCredentials(val: string | null | undefined): {
  m1: string;
  m2: string;
  m3: string;
} {
  const parsed = parseFieldMatches(val);
  return {
    m1: parsed.m1 || "",
    m2: parsed.m2 || "",
    m3: parsed.m3 || "",
  };
}

function parseFieldMatches(val: string | null | undefined): {
  m1: string | null;
  m2: string | null;
  m3: string | null;
} {
  if (!val || !val.trim()) {
    return { m1: null, m2: null, m3: null };
  }
  const clean = val.trim();

  // 1. Try JSON
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const obj = JSON.parse(clean);
      return {
        m1: (obj.m1 || obj.match1 || obj["1"] || null)?.toString().trim() || null,
        m2: (obj.m2 || obj.match2 || obj["2"] || null)?.toString().trim() || null,
        m3: (obj.m3 || obj.match3 || obj["3"] || null)?.toString().trim() || null,
      };
    } catch {
      // ignore
    }
  }

  // 2. Try Tagged (M1: ..., M2: ..., M3: ... or Match 1: ...)
  const m1Match = clean.match(/(?:m1|match\s*1)\s*[:=-]\s*([^\r\n,|]+)/i);
  const m2Match = clean.match(/(?:m2|match\s*2)\s*[:=-]\s*([^\r\n,|]+)/i);
  const m3Match = clean.match(/(?:m3|match\s*3)\s*[:=-]\s*([^\r\n,|]+)/i);

  if (m1Match || m2Match || m3Match) {
    return {
      m1: m1Match ? m1Match[1].trim() : null,
      m2: m2Match ? m2Match[1].trim() : null,
      m3: m3Match ? m3Match[1].trim() : null,
    };
  }

  // 3. Try multiline entries (Line 1 = Match 1, Line 2 = Match 2, Line 3 = Match 3)
  const lines = splitLines(clean);
  if (lines.length >= 2) {
    return {
      m1: lines[0] || null,
      m2: lines[1] || null,
      m3: lines[2] || null,
    };
  }

  // 4. Try comma or pipe separation: "123, 456, 789"
  if (clean.includes(",") || clean.includes("|")) {
    const parts = clean.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        m1: parts[0] || null,
        m2: parts[1] || null,
        m3: parts[2] || null,
      };
    }
  }

  // 5. Default fallback: Single value assigned to Match 1
  return {
    m1: clean,
    m2: null,
    m3: null,
  };
}

/**
 * Parses full 3-Match IDP credentials for any event/registration.
 */
export function parse3MatchIDP({
  roomId,
  roomPassword,
  maps,
  idpTimes,
  startTimes,
}: {
  roomId: string | null | undefined;
  roomPassword: string | null | undefined;
  maps?: string[] | null;
  idpTimes?: string | null | undefined;
  startTimes?: string | null | undefined;
}): SingleMatchIDP[] {
  const roomIds = parseFieldMatches(roomId);
  const passwords = parseFieldMatches(roomPassword);
  const idpTimesParsed = parseFieldMatches(idpTimes);
  const startTimesParsed = parseFieldMatches(startTimes);

  // If password was given as a single global password, use it for all available rooms
  const singlePass =
    roomPassword &&
    !roomPassword.includes("\n") &&
    !roomPassword.includes(",") &&
    !roomPassword.toLowerCase().includes("m1") &&
    !roomPassword.toLowerCase().includes("m2")
      ? roomPassword.trim()
      : null;

  const defaultMaps = ["Erangel", "Miramar", "Erangel"];
  const mapList = maps && maps.length > 0 ? maps : defaultMaps;

  return [1, 2, 3].map((num) => {
    const key = `m${num}` as "m1" | "m2" | "m3";
    const rId = roomIds[key];
    let rPass = passwords[key];
    if (!rPass && singlePass && rId) {
      rPass = singlePass;
    }

    const assignedMap = mapList[num - 1] || mapList[0] || "Erangel";
    const assignedIdpTime = idpTimesParsed[key] || (num === 1 && idpTimes ? idpTimes.trim() : null) || null;
    const assignedStartTime = startTimesParsed[key] || (num === 1 && startTimes ? startTimes.trim() : null) || null;

    return {
      matchNumber: num,
      label: `Match ${num}`,
      map: assignedMap,
      roomId: rId,
      password: rPass,
      idpTime: assignedIdpTime,
      startTime: assignedStartTime,
      isAvailable: Boolean(rId && rId.trim().length > 0),
    };
  });
}

/**
 * Serializes 3 separate match room IDs into database storage format.
 */
export function serializeMatchRoomIds(
  m1: string | null | undefined,
  m2: string | null | undefined,
  m3: string | null | undefined
): string | null {
  const c1 = m1?.trim();
  const c2 = m2?.trim();
  const c3 = m3?.trim();

  // If only Match 1 is filled and others empty, return simple string or tagged
  if (!c1 && !c2 && !c3) return null;
  if (c1 && !c2 && !c3) return c1;

  const lines: string[] = [];
  if (c1) lines.push(`M1: ${c1}`);
  if (c2) lines.push(`M2: ${c2}`);
  if (c3) lines.push(`M3: ${c3}`);
  return lines.join("\n");
}

/**
 * Serializes 3 separate match passwords into database storage format.
 */
export function serializeMatchPasswords(
  m1: string | null | undefined,
  m2: string | null | undefined,
  m3: string | null | undefined
): string | null {
  const c1 = m1?.trim();
  const c2 = m2?.trim();
  const c3 = m3?.trim();

  if (!c1 && !c2 && !c3) return null;
  // If all are the same, save single string
  if (c1 && c1 === c2 && c1 === c3) return c1;
  if (c1 && !c2 && !c3) return c1;

  const lines: string[] = [];
  if (c1) lines.push(`M1: ${c1}`);
  if (c2) lines.push(`M2: ${c2}`);
  if (c3) lines.push(`M3: ${c3}`);
  return lines.join("\n");
}
