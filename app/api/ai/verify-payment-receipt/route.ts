import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageBase64, submittedUtr, expectedAmountRupees } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, message: "No payment receipt image provided." },
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

    // 3. Prompt Gemini 1.5 Flash Vision for Financial Receipt Analysis
    const prompt = `You are a financial verification assistant for an Indian esports tournament UPI payment gateway.
Analyze this payment confirmation screenshot (from Google Pay, PhonePe, Paytm, BHIM, Cred, POP, or bank apps).
User submitted UTR: "${submittedUtr || "None"}".
Expected Amount: "₹${expectedAmountRupees || "Unknown"}".

Carefully extract and verify:
1. 12-digit UPI Transaction ID / UTR / Reference number visible on the receipt.
2. The exact amount paid in Rupees.
3. The payment app detected (Google Pay, PhonePe, Paytm, BHIM, POP, Cred, etc.).
4. Authenticity check: Does the image look authentic or are there signs of fake receipt generation, font distortion, manipulated numbers, or spoof apps?
5. Match check: Does the detected UTR match the submitted UTR "${submittedUtr || ""}"?

Return ONLY a valid JSON object with no markdown code fences:
{
  "detectedUtr": "string or null",
  "detectedAmount": number or null,
  "appName": "string",
  "utrMatches": boolean,
  "isAuthentic": boolean,
  "confidence": "high" | "medium" | "low",
  "analysisNotes": "concise 1-2 sentence explanation"
}`;

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
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    const cleanedText = candidateText.replace(/```json/gi, "").replace(/```/g, "").trim();
    let result = null;

    try {
      result = JSON.parse(cleanedText);
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "Could not parse AI receipt verification result.",
          raw: candidateText,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      analysis: result,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        message: (err as Error).message || "Internal payment analysis error.",
      },
      { status: 500 }
    );
  }
}
