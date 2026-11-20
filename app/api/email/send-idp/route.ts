import { NextRequest, NextResponse } from "next/server";
import { sendIdpEmail, IdpNotificationPayload, IdpMatchInfo } from "@/lib/emailService";
import { supabase } from "@/lib/supabase";
import { ORG_NAME } from "@/lib/config";
import { parse3MatchIDP } from "@/lib/matchIdp";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      eventId,
      recipientEmail,
      teamName,
      slotNumber,
      matches: customMatches,
      whatsappGroupLink,
    } = body;

    if (!eventId && !customMatches) {
      return NextResponse.json(
        { success: false, message: "Missing eventId or match credentials." },
        { status: 400 }
      );
    }

    // 1. Fetch Event details if eventId provided
    let eventTitle = "Apex Scrims Tournament";
    let eventMode = "Squad";
    let groupLink = whatsappGroupLink || null;
    let resolvedMatches: IdpMatchInfo[] = [];

    if (eventId) {
      const { data: eventData } = await supabase
        .from("events")
        .select("title, mode, room_id, room_password, idp_times, start_times, maps, whatsapp_group_link")
        .eq("id", eventId)
        .single();

      if (eventData) {
        eventTitle = eventData.title;
        eventMode = eventData.mode || "Squad";
        if (!groupLink) groupLink = eventData.whatsapp_group_link;

        const parsed = parse3MatchIDP({
          roomId: eventData.room_id,
          roomPassword: eventData.room_password,
          idpTimes: eventData.idp_times,
          startTimes: eventData.start_times,
          maps: eventData.maps,
        });

        resolvedMatches = parsed.map((m) => ({
          matchNumber: m.matchNumber,
          map: m.map,
          roomId: m.roomId || "PENDING",
          roomPassword: m.password || "PENDING",
          startTime: m.startTime,
          idpTime: m.idpTime,
        }));
      }
    }

    if (customMatches && Array.isArray(customMatches) && customMatches.length > 0) {
      resolvedMatches = customMatches;
    }

    if (resolvedMatches.length === 0) {
      return NextResponse.json(
        { success: false, message: "No match IDP credentials found to email." },
        { status: 400 }
      );
    }

    // 2. Scenario A: Single recipient email provided (e.g. user clicked "Send to my Gmail" on /my-tournaments)
    if (recipientEmail && typeof recipientEmail === "string") {
      const payload: IdpNotificationPayload = {
        recipientEmail: recipientEmail.trim(),
        teamName: teamName || "Registered Squad",
        lobbyTitle: eventTitle,
        lobbyMode: eventMode,
        assignedSlot: slotNumber || null,
        whatsappGroupLink: groupLink,
        matches: resolvedMatches,
      };

      const result = await sendIdpEmail(payload);
      return NextResponse.json(result);
    }

    // 3. Scenario B: Batch broadcast to all verified captains for this lobby (Admin clicked "Email IDP to all captains")
    const { data: regRows } = await supabase
      .from("registrations")
      .select("id, team_name, whatsapp, slot_number, status, user_id")
      .eq("event_id", eventId)
      .neq("status", "cancelled");

    const recipients: { email: string; teamName: string; slotNumber: number | null }[] = [];

    if (regRows && regRows.length > 0) {
      for (const r of regRows) {
        // Look up email if user_id linked
        let email = "";
        if (r.user_id) {
          try {
            const { data: userData } = await supabase.auth.admin.getUserById(r.user_id);
            if (userData?.user?.email) {
              email = userData.user.email;
            }
          } catch {}
        }
        if (email) {
          recipients.push({
            email,
            teamName: r.team_name,
            slotNumber: r.slot_number,
          });
        }
      }
    }

    // Prepare broadcast results
    let sentCount = 0;
    const bccEmails = recipients.map((r) => r.email).filter(Boolean);

    for (const r of recipients) {
      const payload: IdpNotificationPayload = {
        recipientEmail: r.email,
        teamName: r.teamName,
        lobbyTitle: eventTitle,
        lobbyMode: eventMode,
        assignedSlot: r.slotNumber,
        whatsappGroupLink: groupLink,
        matches: resolvedMatches,
      };
      const res = await sendIdpEmail(payload);
      if (res.success) sentCount++;
    }

    const bccList = bccEmails.join(",");
    const samplePayload: IdpNotificationPayload = {
      recipientEmail: bccList || "captains@apex-esports.in",
      teamName: "All Registered Squads",
      lobbyTitle: eventTitle,
      lobbyMode: eventMode,
      whatsappGroupLink: groupLink,
      matches: resolvedMatches,
    };
    const sampleResult = await sendIdpEmail(samplePayload);

    return NextResponse.json({
      success: true,
      message: `IDP notification prepared for ${recipients.length} captain(s).`,
      sentCount,
      totalCaptains: recipients.length,
      bccList,
      gmailWebUrl: sampleResult.gmailWebUrl,
      mailtoUrl: sampleResult.mailtoUrl,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, message: (err as Error).message || "Failed to process IDP email dispatch." },
      { status: 500 }
    );
  }
}
