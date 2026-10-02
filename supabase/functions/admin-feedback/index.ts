import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Round 6 admin feedback (MCA_R6_ADMIN_FEEDBACK).
//
// Actions (POST JSON, admin JWT required):
//   { action: "send", topic, message, page_url?, screenshot_path? }
//       Logs the feedback in public.admin_feedback, then emails it through
//       Resend to FEEDBACK_TO with the admin's name/email (reply-to = admin)
//       and the page they were on. A screenshot (uploaded by the admin to the
//       private admin-feedback bucket under <their user id>/) is attached.
//   { action: "status", feedback_id }
//       Asks Resend for the latest delivery event of a sent feedback email and
//       stores it on the row (delivery_status).

const FEEDBACK_TO = "support@reply.gmbaptistoutreach.com";
const FEEDBACK_FROM = "MCA Admin Feedback <admin@mcahomeschool.com>";
const TOPICS = new Set(["Problem or bug", "Question", "Idea or request", "Help Center content", "Other"]);
const MAX_MESSAGE = 5000;

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
    .select("id, created_at")
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
  const subject = `MCA admin feedback: ${topic}${message.includes("[TEST]") ? " [TEST]" : ""}`;
  const html = `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 640px;">
  <h2 style="margin:0 0 8px">New feedback from the MCA admin Help Center</h2>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:2px 12px 2px 0;color:#666">From</td><td>${escapeHtml(who)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Topic</td><td>${escapeHtml(topic)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Page</td><td>${escapeHtml(pageUrl ?? "(not recorded)")}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Sent</td><td>${escapeHtml(sentAt)} Eastern</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Screenshot</td><td>${attachments.length ? "attached" : "none"}</td></tr>
  </table>
  <p style="white-space:pre-wrap;border-left:4px solid #c9a227;padding:8px 12px;background:#fbf6e6">${escapeHtml(message)}</p>
  <p style="font-size:12px;color:#888">Feedback id ${inserted.id}. Reply to this email to answer the admin directly.</p>
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
        from: FEEDBACK_FROM,
        to: [FEEDBACK_TO],
        reply_to: admin.email ?? undefined,
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
    return json({ ok: false, id: inserted.id, error: "Your feedback was saved, but the email didn't go out. We'll still see it." }, 502);
  }
  return json({ ok: true, id: inserted.id, resend_id: resendId });
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
