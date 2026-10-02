import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Round 6 admin feedback (MCA_R6_ADMIN_FEEDBACK).
// Round 9 (MCA_R9_TICKETS): every feedback gets a six-digit ticket number
// (assigned by a gapless DB trigger), shown in the support email subject and
// in a branded confirmation email to the admin.
// Round 9c (MCA_R9C_TICKET_FROM_DAVID): the ticket email to support is sent
// FROM david@mcahomeschool.com (verified sending domain) with a display name
// naming the submitting admin ("Chase Kelly via MCA"), and Reply-To David's
// inbox. The submitting admin's name and verified email (from the JWT, never
// the request body) are shown at the top of the ticket body.
//
// Actions (POST JSON, admin JWT required):
//   { action: "send", topic, message, page_url?, screenshot_path? }
//       Logs the feedback in public.admin_feedback, then emails it through
//       Resend to FEEDBACK_TO (from/reply-to David, admin named in the body)
//       and the page they were on, then sends the admin a confirmation.
//       A screenshot (uploaded by the admin to the private admin-feedback
//       bucket under <their user id>/) is attached.
//   { action: "status", feedback_id }
//       Asks Resend for the latest delivery event of a sent feedback email and
//       stores it on the row (delivery_status).

const FEEDBACK_TO = "support@reply.gmbaptistoutreach.com";
// Ticket email to support. mcahomeschool.com is the verified Resend domain but
// has no inbox, so Reply-To is David's real mailbox (same as parent emails).
const TICKET_FROM_EMAIL = "david@mcahomeschool.com";
const TICKET_REPLY_TO = "david@midwestchristianacademy.com";
// Confirmation email to the submitting admin (unchanged).
const FEEDBACK_FROM = "MCA Admin Feedback <admin@mcahomeschool.com>";
const TOPICS = new Set(["Problem or bug", "Question", "Idea or request", "Help Center content", "Other"]);
const MAX_MESSAGE = 5000;
const SCHOOL_NAME = "Midwest Christian Academy";
const SCHOOL_ADDRESS = "2300 NW 32nd Street, Newcastle, OK 73065";
const SCHOOL_PHONE = "(844) 663-4477";
const LOGO_URL =
  "https://vibe.filesafe.space/1784303289974857996/attachments/5ce70202-91c1-463f-929b-e89f47f07a50.png";
const NAVY = "#14213d";
const GOLD = "#c9a227";

export function formatTicket(n: number | string | null | undefined): string {
  const num = Number(n);
  return Number.isFinite(num) && num > 0 ? String(Math.trunc(num)).padStart(6, "0") : "------";
}

export function ticketFrom(name: string | null, email: string | null): string {
  const label = (name || email || "MCA admin").replace(/["<>,;\\\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `"${label || "MCA admin"} via MCA" <${TICKET_FROM_EMAIL}>`;
}

function isEmail(value: string | null | undefined): value is string {
  return !!value && /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(value);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type Admin = { userId: string; email: string | null; name: string | null };

async function authorize(req: Request): Promise<Admin | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin } = await userClient.rpc("is_admin");
  if (!isAdmin) return json({ error: "Admin only" }, 403);
  const { data: row } = await service()
    .from("admin_users")
    .select("name")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  return { userId: userData.user.id, email: userData.user.email ?? null, name: (row?.name as string | null) ?? null };
}

async function sendFeedback(admin: Admin, body: Record<string, unknown>): Promise<Response> {
  const topic = String(body.topic ?? "").trim();
  const message = String(body.message ?? "").trim();
  const pageUrl = String(body.page_url ?? "").trim().slice(0, 500) || null;
  const screenshotPath = String(body.screenshot_path ?? "").trim() || null;
  if (!TOPICS.has(topic)) return json({ error: "Pick a topic." }, 400);
  if (!message) return json({ error: "Write a message." }, 400);
  if (message.length > MAX_MESSAGE) return json({ error: `Keep the message under ${MAX_MESSAGE} characters.` }, 400);
  if (screenshotPath && !screenshotPath.startsWith(`${admin.userId}/`)) {
    return json({ error: "Screenshot path not allowed." }, 400);
  }

  const db = service();
  const { data: inserted, error: insertError } = await db
    .from("admin_feedback")
    .insert({
      admin_user_id: admin.userId,
      admin_name: admin.name,
      admin_email: admin.email,
      topic,
      message,
      page_url: pageUrl,
      screenshot_path: screenshotPath,
      email_to: FEEDBACK_TO,
    })
    .select("id, created_at, ticket_number")
    .single();
  if (insertError || !inserted) {
    console.error("admin_feedback insert failed", insertError);
    return json({ error: "Couldn't save your feedback. Please try again." }, 500);
  }

  const attachments: Array<{ filename: string; content: string }> = [];
  if (screenshotPath) {
    const { data: file, error: fileError } = await db.storage.from("admin-feedback").download(screenshotPath);
    if (file && !fileError) {
      const filename = screenshotPath.split("/").pop() || "screenshot.png";
      attachments.push({ filename, content: toBase64(new Uint8Array(await file.arrayBuffer())) });
    } else {
      console.error("screenshot download failed", fileError);
    }
  }

  const who = admin.name ? `${admin.name} (${admin.email ?? "no email"})` : admin.email ?? "Unknown admin";
  const sentAt = new Date(inserted.created_at as string).toLocaleString("en-US", { timeZone: "America/New_York" });
  const ticket = formatTicket(inserted.ticket_number as number);
  const subject = `MCA feedback #${ticket}: ${topic}${message.includes("[TEST]") ? " [TEST]" : ""}`;
  // The admin's email comes only from the verified session (authorize() -> auth.getUser()).
  const replyTo = isEmail(admin.email) ? admin.email : undefined;
  const submitter = admin.name
    ? `${escapeHtml(admin.name)} &lt;${escapeHtml(admin.email ?? "no email")}&gt;`
    : escapeHtml(admin.email ?? "Unknown admin");
  const html = `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 640px;">
  <h2 style="margin:0 0 8px">Ticket #${ticket}: new feedback from the MCA admin Help Center</h2>
  <p style="margin:0 0 10px;padding:8px 12px;background:#eef2f8;border-left:4px solid #14213d;font-size:15px"><b>Submitted by:</b> ${submitter}</p>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:2px 12px 2px 0;color:#666">Ticket</td><td>#${ticket}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">From</td><td>${escapeHtml(who)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Topic</td><td>${escapeHtml(topic)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Page</td><td>${escapeHtml(pageUrl ?? "(not recorded)")}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Sent</td><td>${escapeHtml(sentAt)} Eastern</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Screenshot</td><td>${attachments.length ? "attached" : "none"}</td></tr>
  </table>
  <p style="white-space:pre-wrap;border-left:4px solid #c9a227;padding:8px 12px;background:#fbf6e6">${escapeHtml(message)}</p>
  <p style="font-size:12px;color:#888">Ticket #${ticket} · feedback id ${inserted.id}. Submitted by ${submitter}. To answer the admin, write to ${replyTo ? escapeHtml(replyTo) : "their email"}; replying to this email goes to ${TICKET_REPLY_TO}.</p>
</div>`;

  const key = Deno.env.get("RESEND_API_KEY");
  let status: "sent" | "failed" = "failed";
  let resendId: string | null = null;
  let emailError: string | null = null;
  if (!key) {
    emailError = "RESEND_API_KEY is not set";
  } else {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: ticketFrom(admin.name, admin.email),
        to: [FEEDBACK_TO],
        reply_to: TICKET_REPLY_TO,
        subject,
        html,
        attachments: attachments.length ? attachments : undefined,
      }),
    });
    const text = await res.text();
    if (res.ok) {
      status = "sent";
      try {
        resendId = (JSON.parse(text) as { id?: string }).id ?? null;
      } catch {
        resendId = null;
      }
    } else {
      emailError = `Resend ${res.status}: ${text.slice(0, 300)}`;
      console.error("Resend send failed", emailError);
    }
  }
  await db
    .from("admin_feedback")
    .update({ email_status: status, resend_id: resendId, email_error: emailError })
    .eq("id", inserted.id);

  if (status !== "sent") {
    return json(
      {
        ok: false,
        id: inserted.id,
        ticket_number: ticket,
        error: `Your feedback was saved as ticket #${ticket}, but the email didn't go out. We'll still see it.`,
      },
      502,
    );
  }

  const confirmation = await sendConfirmation(key!, replyTo, {
    ticket,
    topic,
    message,
    pageUrl,
    sentAt,
    name: admin.name,
    hasScreenshot: attachments.length > 0,
  });
  await db
    .from("admin_feedback")
    .update({
      confirmation_status: confirmation.status,
      confirmation_resend_id: confirmation.resendId,
      confirmation_error: confirmation.error,
    })
    .eq("id", inserted.id);

  return json({
    ok: true,
    id: inserted.id,
    ticket_number: ticket,
    resend_id: resendId,
    confirmation_sent: confirmation.status === "sent",
    confirmation_to: confirmation.status === "sent" ? replyTo : null,
  });
}

export function confirmationHtml(input: {
  ticket: string;
  topic: string;
  message: string;
  pageUrl: string | null;
  sentAt: string;
  name: string | null;
  hasScreenshot: boolean;
}): string {
  const first = (input.name ?? "").trim().split(/\s+/)[0];
  const row = (label: string, value: string) =>
    `<tr><td style="padding:3px 14px 3px 0;color:#666;vertical-align:top">${label}</td><td style="padding:3px 0">${value}</td></tr>`;
  return `<div style="background:#f6f3ea;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1a1a2e">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e6dcc0">
    <div style="background:#ffffff;padding:20px 24px 16px;text-align:center">
      <img src="${LOGO_URL}" alt="${SCHOOL_NAME}" width="264" height="60" style="display:inline-block;width:264px;max-width:100%;height:auto;border:0">
    </div>
    <div style="height:4px;background:${GOLD}"></div>
    <div style="background:${NAVY};color:#ffffff;padding:8px 24px;font-size:13px;letter-spacing:0.04em;text-align:center">MCA ADMIN SUPPORT</div>
    <div style="padding:24px">
      <h2 style="margin:0 0 12px;color:${NAVY};font-size:22px">We received your ticket #${input.ticket}</h2>
      <p style="margin:0 0 12px">${first ? `Hi ${escapeHtml(first)},` : "Hi,"}</p>
      <p style="margin:0 0 16px">Thanks for your feedback from the MCA admin Help Center. Our support team will reply to you by email. To add anything, just reply to this email and keep the ticket number in the subject.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:0 0 12px">
        ${row("Ticket", `#${input.ticket}`)}
        ${row("Topic", escapeHtml(input.topic))}
        ${input.pageUrl ? row("Page", escapeHtml(input.pageUrl)) : ""}
        ${row("Sent", `${escapeHtml(input.sentAt)} Eastern`)}
        ${input.hasScreenshot ? row("Screenshot", "attached to your ticket") : ""}
      </table>
      <p style="margin:0 0 6px;color:#666;font-size:13px">Your message:</p>
      <p style="white-space:pre-wrap;border-left:4px solid ${GOLD};padding:10px 14px;background:#fbf6e6;margin:0 0 16px">${escapeHtml(input.message)}</p>
    </div>
    <div style="padding:14px 24px;background:#faf8f2;border-top:1px solid #eee5cc;font-size:12px;color:#888;text-align:center">
      ${SCHOOL_NAME} · ${SCHOOL_ADDRESS} · ${SCHOOL_PHONE} · mcahomeschool.com
    </div>
  </div>
</div>`;
}

async function sendConfirmation(
  key: string,
  to: string | undefined,
  input: Parameters<typeof confirmationHtml>[0],
): Promise<{ status: "sent" | "failed" | "skipped"; resendId: string | null; error: string | null }> {
  if (!to) return { status: "skipped", resendId: null, error: "No verified email on the admin account" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FEEDBACK_FROM,
        to: [to],
        reply_to: FEEDBACK_TO,
        subject: `We received your ticket #${input.ticket}${input.message.includes("[TEST]") ? " [TEST]" : ""}`,
        html: confirmationHtml(input),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      const error = `Resend ${res.status}: ${text.slice(0, 300)}`;
      console.error("Confirmation send failed", error);
      return { status: "failed", resendId: null, error };
    }
    let resendId: string | null = null;
    try {
      resendId = (JSON.parse(text) as { id?: string }).id ?? null;
    } catch {
      resendId = null;
    }
    return { status: "sent", resendId, error: null };
  } catch (err) {
    return { status: "failed", resendId: null, error: String(err).slice(0, 300) };
  }
}

async function deliveryStatus(body: Record<string, unknown>): Promise<Response> {
  const id = String(body.feedback_id ?? "");
  const db = service();
  const { data: row } = await db.from("admin_feedback").select("id, resend_id").eq("id", id).maybeSingle();
  if (!row?.resend_id) return json({ error: "No sent email for that feedback." }, 404);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "RESEND_API_KEY is not set" }, 500);
  const res = await fetch(`https://api.resend.com/emails/${row.resend_id}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = (await res.json().catch(() => ({}))) as { last_event?: string; to?: string[]; created_at?: string };
  if (!res.ok) return json({ error: `Resend ${res.status}` }, 502);
  const lastEvent = data.last_event ?? "unknown";
  await db
    .from("admin_feedback")
    .update({ delivery_status: lastEvent, delivery_checked_at: new Date().toISOString() })
    .eq("id", row.id);
  return json({ ok: true, id: row.id, resend_id: row.resend_id, last_event: lastEvent, to: data.to, created_at: data.created_at });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = await authorize(req);
  if (admin instanceof Response) return admin;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  if (body.action === "send") return await sendFeedback(admin, body);
  if (body.action === "status") return await deliveryStatus(body);
  return json({ error: "Unknown action" }, 400);
});
