import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";

export interface IdpMatchInfo {
  matchNumber: number;
  map: string;
  idpTime?: string | null;
  startTime?: string | null;
  roomId: string;
  roomPassword: string;
}

export interface IdpNotificationPayload {
  recipientEmail: string;
  captainName?: string;
  teamName: string;
  lobbyTitle: string;
  lobbyMode?: string;
  assignedSlot?: number | null;
  whatsappGroupLink?: string | null;
  matches: IdpMatchInfo[];
}

export interface SendIdpEmailResult {
  success: boolean;
  provider: "resend" | "smtp" | "client_gmail_intent" | "failed";
  message: string;
  gmailWebUrl?: string;
  mailtoUrl?: string;
  error?: string;
}

/**
 * Generates high-impact, mobile-optimized HTML email for Room ID & Password
 */
export function generateIdpHtmlEmail(data: IdpNotificationPayload): string {
  const portalUrl = "https://apex-esports.vercel.app/my-tournaments";

  const matchesHtml = data.matches
    .map(
      (m) => `
    <div style="background-color: #0F1D38; border: 1px solid #1E293B; border-radius: 16px; padding: 16px; margin-bottom: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #1E293B; padding-bottom: 8px;">
        <span style="color: #FFB800; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
          🎯 MATCH ${m.matchNumber} · ${m.map.toUpperCase()}
        </span>
        <span style="background-color: #10B981; color: #042F2E; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 9999px;">
          LIVE ROOM
        </span>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 10px;">
        <tr>
          <td width="50%" style="padding-right: 6px;">
            <div style="background-color: #070D1F; border: 1px solid #334155; border-radius: 12px; padding: 10px; text-align: center;">
              <div style="font-size: 10px; color: #94A3B8; font-weight: 700; text-transform: uppercase;">ROOM ID</div>
              <div style="font-family: monospace; font-size: 18px; font-weight: 900; color: #FFFFFF; letter-spacing: 1px; margin-top: 4px;">
                ${m.roomId || "PENDING"}
              </div>
            </div>
          </td>
          <td width="50%" style="padding-left: 6px;">
            <div style="background-color: #070D1F; border: 1px solid #334155; border-radius: 12px; padding: 10px; text-align: center;">
              <div style="font-size: 10px; color: #94A3B8; font-weight: 700; text-transform: uppercase;">PASSWORD</div>
              <div style="font-family: monospace; font-size: 18px; font-weight: 900; color: #FFB800; letter-spacing: 1px; margin-top: 4px;">
                ${m.roomPassword || "PENDING"}
              </div>
            </div>
          </td>
        </tr>
      </table>

      ${
        m.startTime || m.idpTime
          ? `<div style="font-size: 11px; color: #94A3B8; text-align: center;">
              ${m.idpTime ? `<span>IDP: <strong style="color: #E2E8F0;">${m.idpTime}</strong></span>` : ""}
              ${m.startTime ? `<span style="margin-left: 10px;">Match Starts: <strong style="color: #10B981;">${m.startTime} IST</strong></span>` : ""}
            </div>`
          : ""
      }
    </div>
  `
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.lobbyTitle} — Match IDP Released</title>
</head>
<body style="margin: 0; padding: 0; background-color: #050B1A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F8FAFC;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px 16px;">
    
    <!-- Header Card -->
    <div style="background: linear-gradient(135deg, #0A1128 0%, #0F1D38 100%); border: 1px solid #1E293B; border-radius: 20px; padding: 24px; text-align: center; margin-bottom: 16px;">
      <div style="display: inline-block; background-color: rgba(255, 184, 0, 0.15); border: 1px solid #FFB800; border-radius: 9999px; padding: 4px 14px; margin-bottom: 12px;">
        <span style="color: #FFB800; font-size: 11px; font-weight: 900; letter-spacing: 1px;">⚡ OFFICIAL IDP DROP</span>
      </div>
      <h1 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 900; color: #FFFFFF; letter-spacing: -0.5px;">
        ${data.lobbyTitle}
      </h1>
      <p style="margin: 0; font-size: 13px; color: #94A3B8;">
        Your custom room credentials have been officially released.
      </p>

      <!-- Allotted Slot Badge -->
      <div style="margin-top: 16px; background-color: #070D1F; border: 1px dashed #3B82F6; border-radius: 14px; padding: 12px; display: inline-block;">
        <span style="color: #94A3B8; font-size: 11px; font-weight: 700; text-transform: uppercase;">TEAM:</span>
        <strong style="color: #FFFFFF; font-size: 13px; margin-left: 4px;">${data.teamName}</strong>
        ${
          data.assignedSlot
            ? `<span style="background-color: #3B82F6; color: #FFFFFF; font-weight: 900; font-size: 12px; padding: 2px 8px; border-radius: 6px; margin-left: 8px;">
                SLOT #${data.assignedSlot}
              </span>`
            : ""
        }
      </div>
    </div>

    <!-- Match IDP Cards -->
    <div style="margin-bottom: 16px;">
      ${matchesHtml}
    </div>

    <!-- Important Rules Card -->
    <div style="background-color: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 16px; padding: 16px; margin-bottom: 16px;">
      <div style="font-weight: 800; font-size: 13px; color: #F59E0B; margin-bottom: 6px;">
        ⚠️ CRITICAL MATCH INSTRUCTIONS:
      </div>
      <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #CBD5E1; line-height: 1.6;">
        <li>Enter strictly in your assigned slot: <strong>Slot #${data.assignedSlot || "ALLOTTED"}</strong>.</li>
        <li>Slot hopping or entering other teams' slots will lead to instant kick and tournament disqualification.</li>
        <li>Mobile devices ONLY (No emulators or iPads allowed per official BGMI competitive rules).</li>
        <li>Room starts sharp at schedule time. Ready up immediately upon entering.</li>
      </ul>
    </div>

    <!-- CTAs: Portal & WhatsApp Group -->
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${portalUrl}" style="display: block; background-color: #FFB800; color: #0A1128; font-weight: 900; font-size: 14px; text-decoration: none; padding: 14px 24px; border-radius: 14px; margin-bottom: 10px; box-shadow: 0 4px 12px rgba(255, 184, 0, 0.2);">
        🔑 Open My Tournaments Portal →
      </a>
      ${
        data.whatsappGroupLink
          ? `<a href="${data.whatsappGroupLink}" style="display: inline-block; background-color: #25D366; color: #000000; font-weight: 800; font-size: 13px; text-decoration: none; padding: 10px 20px; border-radius: 12px;">
              💬 Join Official Lobby WhatsApp Group
            </a>`
          : ""
      }
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #1E293B; padding-top: 16px; text-align: center; font-size: 11px; color: #64748B;">
      <p style="margin: 0 0 4px 0;">This official match notification was sent to <strong>${data.recipientEmail}</strong></p>
      <p style="margin: 0;">⚡ Powered by ${ORG_NAME} Tournament Infrastructure</p>
    </div>

  </div>
</body>
</html>
  `.trim();
}

/**
 * Plain Text version for text email clients & fallback
 */
export function generateIdpPlainText(data: IdpNotificationPayload): string {
  const matchesText = data.matches
    .map(
      (m) =>
        `🎯 MATCH ${m.matchNumber} (${m.map})\n` +
        `🆔 ROOM ID: ${m.roomId}\n` +
        `🔑 PASSWORD: ${m.roomPassword}\n` +
        (m.startTime ? `⏰ START: ${m.startTime} IST\n` : "") +
        (m.idpTime ? `📍 IDP DROP: ${m.idpTime}\n` : "")
    )
    .join("\n");

  return `🔥 ${ORG_NAME.toUpperCase()} — ROOM ID & PASSWORD LIVE 🔥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 Lobby: ${data.lobbyTitle} (${data.lobbyMode || "Squad"})
👥 Team: ${data.teamName} ${data.assignedSlot ? `(Allotted Slot #${data.assignedSlot})` : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${matchesText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ RULES:
1. Join strictly in your allotted slot (#${data.assignedSlot || "ASSIGNED"}).
2. Mobile devices ONLY (No emulators).
3. Ready up 5 minutes before match start.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 View live credentials on web: https://apex-esports.vercel.app/my-tournaments
${data.whatsappGroupLink ? `📲 Lobby WhatsApp Group: ${data.whatsappGroupLink}\n` : ""}
Good luck!
— ${ORG_NAME} Command Center`.trim();
}

/**
 * Sends IDP Notification Email via available provider (Resend, SMTP, or intent URL)
 */
export async function sendIdpEmail(payload: IdpNotificationPayload): Promise<SendIdpEmailResult> {
  const subject = `🎮 [IDP RELEASED] ${payload.lobbyTitle} — Room ID & Password Live`;
  const html = generateIdpHtmlEmail(payload);
  const text = generateIdpPlainText(payload);

  // Intent URLs for 1-click fallback
  const gmailWebUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    payload.recipientEmail
  )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  const mailtoUrl = `mailto:${encodeURIComponent(payload.recipientEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(text)}`;

  // 1. Try Resend if RESEND_API_KEY is configured
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey && resendApiKey.trim().length > 10) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey.trim()}`,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || `${ORG_NAME} <tournaments@apex-esports.in>`,
          to: [payload.recipientEmail],
          subject,
          html,
          text,
        }),
      });

      if (res.ok) {
        return {
          success: true,
          provider: "resend",
          message: `IDP notification successfully emailed to ${payload.recipientEmail}!`,
          gmailWebUrl,
          mailtoUrl,
        };
      }
    } catch (err: unknown) {
      console.warn("Resend email dispatch error:", err);
    }
  }

  // 2. Return client intent result so the app can open Gmail with 1 click
  return {
    success: true,
    provider: "client_gmail_intent",
    message: `IDP notification generated for ${payload.recipientEmail}. Ready to send via Gmail.`,
    gmailWebUrl,
    mailtoUrl,
  };
}
