import { NextRequest, NextResponse } from "next/server";
import { resolveGeminiKey, executeGeminiGenerateContent } from "@/lib/gemini";

interface TeamResult {
  rank: number;
  slotNumber?: number;
  teamName: string;
  kills: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageBase64, matchNumber, registeredSquads } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, message: "No scoreboard image provided." },
        { status: 400 }
      );
    }

    // 1. Resolve Gemini API Key (Header > Process Env > Safe Fallback)
    const clientKey = req.headers.get("x-gemini-api-key");
    const apiKey = resolveGeminiKey(clientKey);

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          requiresApiKey: true,
          message:
            "Google Gemini API Key is missing. Please set your free Gemini API Key in the AI Settings modal.",
        },
        { status: 200 }
      );
    }

    // 2. Parse MimeType and Raw Base64
    let mimeType = "image/jpeg";
    let rawData = imageBase64;

    const dataUrlMatch = imageBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      rawData = dataUrlMatch[2];
    }

    // 3. Roster-Aware Prompt (Slots 5 to 25)
    let rosterContext = "";
    if (Array.isArray(registeredSquads) && registeredSquads.length > 0) {
      rosterContext = `
OFFICIAL TOURNAMENT REGISTERED SQUADS (Slots 5 to 25):
${registeredSquads
  .map(
    (s: { slotNumber?: number; teamName?: string }, idx: number) =>
      `- Slot ${s.slotNumber || idx + 5}: "${s.teamName || "Squad"}"`
  )
  .join("\n")}

CRITICAL SQUAD-TO-SLOT MATCHING INSTRUCTIONS:
- Players in BGMI/PUBG screenshots frequently use clan prefixes, decorative symbols (e.g. 〆, 々, •, ˣ, 亗, 亗, 𝕏), or individual player IGNs instead of the full registered team name.
- Cross-reference and MATCH each team in the screenshot with the closest official registered squad above.
- Extract their survival placement rank (1 to 20), their exact Slot Number (between Slots 5 and 25), and total team kill finishes count.
- If a team is not in the registered list, extract the clean readable clan/team name from the screenshot.
`;
    }

    const prompt = `You are an expert esports tournament referee and automated vision parsing engine for BGMI (Battlegrounds Mobile India) and PUBG Mobile competitive scrims.
Analyze this in-game match results / scoreboard screenshot for Match ${matchNumber || 1}.
Extract each squad, their survival rank (1 to 20), their assigned slotNumber (Slots 5 to 25), and their total kill finishes count.
${rosterContext}
Return ONLY a valid JSON array of objects with no markdown code fences, matching this structure:
[
  { "rank": 1, "slotNumber": 5, "teamName": "Team Soul", "kills": 8 },
  { "rank": 2, "slotNumber": 6, "teamName": "GodLike", "kills": 5 }
]`;

    const geminiPayload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: rawData,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json",
      },
    };

    const result = await executeGeminiGenerateContent(apiKey, geminiPayload);

    if (!result.ok) {
      let hint = "";
      if (
        result.status === 401 ||
        result.text.includes("API_KEY_SERVICE_BLOCKED") ||
        result.text.includes("UNAUTHENTICATED")
      ) {
        hint =
          " Google rejected this key (401). In Google AI Studio (aistudio.google.com/app/apikey), click 'Create API key in new project' (instead of an imported project) to get a pre-enabled AIzaSy... key.";
      }
      return NextResponse.json(
        {
          success: false,
          message: `Gemini API Error (${result.status}): ${result.text.slice(0, 140)}.${hint}`,
        },
        { status: 200 }
      );
    }

    const geminiData = result.data;
    const candidateText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || result.text || "[]";

    // Clean any accidental markdown fences
    const cleanedText = candidateText.replace(/```json/gi, "").replace(/```/g, "").trim();
    let teams: TeamResult[] = [];

    try {
      teams = JSON.parse(cleanedText);
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "Could not parse AI response into team standings format.",
          raw: candidateText,
        },
        { status: 200 }
      );
    }

    if (!Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No teams were detected in the provided scoreboard image.",
        },
        { status: 200 }
      );
    }

    // Sanitize results with Slot number assignment (Slots 5 to 25)
    const sanitized: TeamResult[] = teams.map((t, idx) => ({
      rank: Number(t.rank) || idx + 1,
      slotNumber: Number(t.slotNumber) || idx + 5,
      teamName: String(t.teamName || `Squad ${idx + 1}`).trim(),
      kills: Math.max(0, Number(t.kills) || 0),
    }));

    // Sort by rank ascending
    sanitized.sort((a, b) => a.rank - b.rank);

    return NextResponse.json({
      success: true,
      teams: sanitized,
      count: sanitized.length,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        message: (err as Error).message || "Internal AI parsing error.",
      },
      { status: 500 }
    );
  }
}
