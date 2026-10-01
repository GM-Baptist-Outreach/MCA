import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, forbiddenOriginResponse, matchAllowedOrigin } from "../_shared/allowedOrigin.ts";

// Public (verify_jwt = false). Receives the two public website lead forms
// (Curriculum Guide request + Contact form) and pushes them into MCA's GHL
// location: upsert the contact, tag it by form, and (contact form) add the
// message as a contact note. Returns { ok: true, contact_id } ONLY when the
// GHL contact upsert succeeded, so the site can show a real success state
// instead of fire-and-forget. Any GHL failure -> 502 with a generic error;
// details go to the function logs (no full PII is logged).
//
// Browser-origin allow-listed via _shared/allowedOrigin.ts. A hidden
// honeypot field ("website") short-circuits bots with a fake success.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
// The public GHL location id the site's external-tracking script uses. Only
// used to log whether GHL_LOCATION_ID_MCA points at the same location.
const PUBLIC_TRACKING_LOCATION_ID = "9YFQxlzS8RBbYsxQ9knD";

const FORMS = {
  curriculum_guide: { source: "Website - Curriculum Guide", tag: "website-curriculum-guide" },
  contact: { source: "Website - Contact Form", tag: "website-contact-form" },
} as const;
type FormKind = keyof typeof FORMS;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY_BYTES = 20_000;
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_MESSAGE = 5000;
const MAX_URL = 500;

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
  });
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

// GHL rejects malformed phone numbers on contact create, which would turn a
// typo into a lost lead. Normalize US numbers to E.164; drop anything that
// isn't plausibly a phone number (it still goes in the note for contacts).
function normalizePhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}***@${domain ?? ""}`;
}

Deno.serve(async (req: Request) => {
  const origin = matchAllowedOrigin(req);

  if (req.method === "OPTIONS") {
    if (!origin) return forbiddenOriginResponse();
    return new Response("ok", { headers: corsHeadersFor(origin) });
  }
  if (!origin) return forbiddenOriginResponse();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

  // ---- Parse + validate ----
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: "Request too large" }, origin);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON body" }, origin);
  }

  // Honeypot: real users never see/fill this field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    console.log("submit-website-form: honeypot tripped, ignoring");
    return json(200, { ok: true }, origin);
  }

  const form = body.form as FormKind;
  if (form !== "curriculum_guide" && form !== "contact") {
    return json(400, { error: "Invalid form" }, origin);
  }

  const firstName = str(body.first_name, MAX_NAME);
  const lastName = str(body.last_name, MAX_NAME);
  const email = str(body.email, MAX_EMAIL + 1).toLowerCase();
  const phoneRaw = str(body.phone, MAX_PHONE);
  const pageUrl = str(body.page_url, MAX_URL);
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!email || email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email)) {
    return json(400, { error: "A valid email address is required" }, origin);
  }
  if (!firstName) return json(400, { error: "First name is required" }, origin);
  if (form === "curriculum_guide" && !lastName) {
    return json(400, { error: "Last name is required" }, origin);
  }
  if (form === "contact" && !message) return json(400, { error: "Message is required" }, origin);
  if (message.length > MAX_MESSAGE) {
    return json(400, { error: `Message must be ${MAX_MESSAGE} characters or fewer` }, origin);
  }

  const apiKey = Deno.env.get("GHL_API_KEY_MCA");
  const locationId = Deno.env.get("GHL_LOCATION_ID_MCA");
  if (!apiKey || !locationId) {
    console.error("submit-website-form: GHL_API_KEY_MCA / GHL_LOCATION_ID_MCA not configured");
    return json(502, { error: "We couldn't submit your request right now." }, origin);
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const { source, tag } = FORMS[form];
  const phone = normalizePhone(phoneRaw);
  const logCtx = `form=${form} email=${maskEmail(email)}`;

  // ---- 1. Upsert contact (required for success) ----
  let contactId: string | null = null;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        locationId,
        firstName,
        ...(lastName ? { lastName } : {}),
        email,
        ...(phone ? { phone } : {}),
        source,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      contactId = data?.contact?.id ?? null;
    } else {
      console.error(`submit-website-form: GHL upsert failed ${logCtx} status=${res.status}`, JSON.stringify(data)?.slice(0, 500));
    }
  } catch (err) {
    console.error(`submit-website-form: GHL upsert threw ${logCtx}`, String(err));
  }

  if (!contactId) {
    return json(502, { error: "We couldn't submit your request right now." }, origin);
  }

  // ---- 2. Tag (additive; never removes existing tags) ----
  let tagged = false;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tags: [tag] }),
    });
    const data = await res.json().catch(() => null);
    tagged = res.ok && Array.isArray(data?.tags) && data.tags.includes(tag);
    if (!res.ok) {
      console.error(`submit-website-form: GHL tag failed ${logCtx} contact=${contactId} status=${res.status}`, JSON.stringify(data)?.slice(0, 300));
    }
  } catch (err) {
    console.error(`submit-website-form: GHL tag threw ${logCtx} contact=${contactId}`, String(err));
  }

  // ---- 3. Note with the message (contact form) ----
  let noteId: string | null = null;
  if (form === "contact") {
    const noteBody = [
      "Website contact form message:",
      "",
      message,
      "",
      phoneRaw ? `Phone entered: ${phoneRaw}` : null,
      pageUrl ? `Page: ${pageUrl}` : null,
      `Submitted: ${new Date().toISOString()}`,
    ].filter((l) => l !== null).join("\n");
    try {
      const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: noteBody }),
      });
      const data = await res.json().catch(() => null);
      noteId = res.ok ? (data?.note?.id ?? null) : null;
      if (!res.ok) {
        console.error(`submit-website-form: GHL note failed ${logCtx} contact=${contactId} status=${res.status}`, JSON.stringify(data)?.slice(0, 300));
      }
    } catch (err) {
      console.error(`submit-website-form: GHL note threw ${logCtx} contact=${contactId}`, String(err));
    }
  }

  console.log(
    `submit-website-form: ok ${logCtx} contact=${contactId} tagged=${tagged}` +
      (form === "contact" ? ` note=${noteId ?? "FAILED"}` : "") +
      ` location_matches_tracking_id=${locationId === PUBLIC_TRACKING_LOCATION_ID}`,
  );

  return json(200, { ok: true, contact_id: contactId }, origin);
});
