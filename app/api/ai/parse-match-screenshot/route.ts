import { NextRequest, NextResponse } from "next/server";

interface TeamResult {
  rank: number;
  teamName: string;
  kills: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageBase64, matchNumber } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, message: "No scoreboard image provided." },
        { status: 400 }
      );
    }

    // 1. Resolve Gemini API Key (Header > Process Env)
    const clientKey = req.headers.get("x-gemini-api-key");
    const apiKey =
      (clientKey && clientKey.trim().length > 10 ? clientKey.trim() : null) ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY;

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

    // 3. Prompt Gemini 1.5 Flash Vision
    const prompt = `You are an expert esports tournament referee for BGMI (Battlegrounds Mobile India) and PUBG Mobile scrims.
Analyze this in-game match results / scoreboard screenshot for Match ${matchNumber || 1}.
Extract each squad, their survival rank (1 to 20), and their kill finishes count.
Clean up stylized font symbols (e.g. 〆, 々) to keep standard readable team/player names.
Return ONLY a valid JSON array of objects with no markdown code fences, matching this structure:
[
  { "rank": 1, "teamName": "Team Soul", "kills": 8 },
  { "rank": 2, "teamName": "GodLike", "kills": 5 }
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json(
        {
          success: false,
          message: `Gemini API Error (${geminiRes.status}): ${errText.slice(0, 200)}`,
        },
        { status: 200 }
      );
    }

    const geminiData = await geminiRes.json();
    const candidateText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

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

    // Sanitize results
    const sanitized = teams.map((t, idx) => ({
      rank: Number(t.rank) || idx + 1,
      teamName: String(t.teamName || `Team ${idx + 1}`).trim(),
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
