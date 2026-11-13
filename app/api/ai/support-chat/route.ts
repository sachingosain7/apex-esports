import { NextRequest, NextResponse } from "next/server";
import { resolveGeminiKey, executeGeminiGenerateContent } from "@/lib/gemini";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { success: false, message: "Please provide a valid question" },
        { status: 400 }
      );
    }

    // Resolve Gemini API Key
    const clientKey = req.headers.get("x-gemini-api-key");
    const activeApiKey = resolveGeminiKey(clientKey);

    const systemInstruction = `You are the official 24/7 AI Support Bot for ${ORG_NAME} (Battlegrounds Mobile India / BGMI Scrims & Tournaments Platform).
Your mission is to guide players, clarify queries, and give direct website navigation paths in friendly, encouraging English or Hinglish (Hindi + English).

KEY PLATFORM KNOWLEDGE:
1. Room ID & Password (IDP):
   - IDP is released exactly 15 minutes before match start time.
   - Players can unlock their 3-Match IDP & official WhatsApp group on the "My Tournaments" page (/my-tournaments) by searching their 12-digit UPI UTR or 10-digit WhatsApp number.
2. Competitive Slot Allocation:
   - Slots 5 to 25 are dedicated to registered player squads (up to 20 teams).
   - Slots 1 to 4 are strictly reserved for host admins, casters, and tournament referees.
3. Registration & Payments:
   - Capable captains can select lobbies on /register or the homepage.
   - Entry fee is paid via QR code, then captain submits the 12-digit UTR transaction reference.
   - AI and admins verify UTR within 1-2 minutes, instantly unlocking the lobby WhatsApp group.
4. Match Format:
   - 3 matches per lobby: Match 1 (Erangel), Match 2 (Miramar), Match 3 (Rondo).
   - Official BGMI 10-point scoring system (1st: 10 pts, 2nd: 6, 3rd: 5, 4th: 4, 5th: 3, 6th: 2, 7th: 1, 8th: 1, 9-16th: 0 pts + 1 pt per kill finish).
5. Prize Pool & Payouts:
   - Top 4 squads win cash prizes (e.g. In ₹600 pool: 1st: ₹350, 2nd: ₹150, 3rd: ₹70, 4th: ₹30).
   - Payouts are transferred via UPI immediately after Match 3 concludes.
6. Support & Host Contact:
   - Official WhatsApp Support: +91 ${SUPPORT_WHATSAPP}.

GUIDELINES FOR YOUR ANSWERS:
- Keep answers concise, clear, and direct (max 3-4 short bullet points or 2-3 sentences).
- Always include relevant navigation paths (e.g., "[Go to My Tournaments](/my-tournaments)" or "[Register Lobby](/register)").
- If asked about fake/unverified payments, explain that admins check bank transactions and fake UTRs result in slot cancellation.
`;

    const conversationHistory = Array.isArray(history)
      ? history.slice(-6).map((h: { role: string; text: string }) => ({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: h.text }],
        }))
      : [];

    const geminiPayload = {
      contents: [
        {
          role: "user",
          parts: [{ text: systemInstruction }],
        },
        {
          role: "model",
          parts: [{ text: "Understood! I am ready to assist players with Apex Esports scrims, IDP schedule, slots 5-25, and payments." }],
        },
        ...conversationHistory,
        {
          role: "user",
          parts: [{ text: message }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
      },
    };

    const execution = await executeGeminiGenerateContent(activeApiKey, geminiPayload);

    if (!execution.ok) {
      // Fallback: If AI API fails, return a helpful offline default answer based on keywords
      const fallbackReply = generateFallbackReply(message);
      return NextResponse.json({
        success: true,
        reply: fallbackReply,
        source: "fallback",
      });
    }

    const aiText =
      execution.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      generateFallbackReply(message);

    return NextResponse.json({
      success: true,
      reply: aiText,
      source: "gemini",
    });
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || "Internal server error";
    return NextResponse.json({
      success: true,
      reply: generateFallbackReply(""),
      source: "offline_fallback",
      error: errorMsg,
    });
  }
}

function generateFallbackReply(query: string): string {
  const q = query.toLowerCase();

  if (q.includes("idp") || q.includes("room") || q.includes("pass") || q.includes("password") || q.includes("id")) {
    return "🔑 **Room ID & Password Schedule:**\n- Released **15 minutes before match start time**.\n- Check your unlocked IDP on the [My Tournaments Page](/my-tournaments) using your 12-digit UTR or WhatsApp number.\n- Your official Lobby WhatsApp group also posts live credentials!";
  }

  if (q.includes("pay") || q.includes("utr") || q.includes("verify") || q.includes("pending") || q.includes("approve")) {
    return "💳 **Payment & UTR Verification:**\n- After paying via UPI QR, submit your 12-digit UTR on [Register](/register).\n- Verification takes 1-2 minutes. Once verified, your status changes to **CONFIRMED** and unlocks your 3-match IDP schedule!";
  }

  if (q.includes("slot") || q.includes("5") || q.includes("25") || q.includes("team")) {
    return "🎯 **Slot Allocation (Slots 5 to 25):**\n- Registered squads occupy **Slots 5 to 25** (up to 20 competitive teams).\n- Slots 1 to 4 are reserved for host referees and casters. Check your assigned slot number on [My Tournaments](/my-tournaments)!";
  }

  if (q.includes("prize") || q.includes("money") || q.includes("payout") || q.includes("win")) {
    return "🏆 **Prize Pool Distribution:**\n- Top 4 squads receive cash prizes via instant UPI right after Match 3 concludes.\n- For a ₹600 lobby: 1st: ₹350, 2nd: ₹150, 3rd: ₹70, 4th: ₹30.";
  }

  return `👋 Welcome to **${ORG_NAME} Support**!\n\nHere are the most common paths:\n• 🔑 **View Room ID & Pass:** [My Tournaments](/my-tournaments)\n• 🎮 **Join Upcoming Lobbies:** [Register Now](/register)\n• 📊 **Check Leaderboards:** [Points Table](/)\n• 💬 **WhatsApp Host:** +91 ${SUPPORT_WHATSAPP}`;
}
