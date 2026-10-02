// Shared parent-email renderer. A disabled or missing row falls back to the
// hard-coded HTML the caller passes, which matches the seeded default.

export const MCA_EMAIL_FROM = "Midwest Christian Academy <admin@mcahomeschool.com>";
export const MCA_EMAIL_REPLY_TO = "david@midwestchristianacademy.com";
export const PORTAL_LOGIN_URL = "https://mcahomeschool.com/portal/login";

const RAW_HTML_KEYS = new Set([
  "student_list",
  "order_items",
  "missing_scores",
  "book_list",
  "shipment_items",
  "tracking_line",
  "overdue_list",
]);

export type TemplateVars = Record<string, string | number | null | undefined>;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function applyTemplate(source: string, vars: TemplateVars): string {
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (full, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return full;
    const raw = vars[key];
    const text = raw == null ? "" : String(raw);
    return RAW_HTML_KEYS.has(key) ? text : escapeHtml(text);
  });
}

export function unknownTemplateVariables(source: string, allowed: string[]): string[] {
  const found = new Set<string>();
  const allowedSet = new Set(allowed);
  for (const match of source.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!allowedSet.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

type TemplateClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: { subject: string; body_html: string; enabled: boolean } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export async function renderTemplate(
  admin: TemplateClient,
  key: string,
  vars: TemplateVars,
  fallback: { subject: string; html: string },
): Promise<{ subject: string; html: string; source: "template" | "fallback" }> {
  try {
    const { data, error } = await admin
      .from("email_templates")
      .select("subject, body_html, enabled")
      .eq("key", key)
      .maybeSingle();
    if (error || !data || data.enabled === false || !data.subject || !data.body_html) {
      return {
        subject: applyTemplate(fallback.subject, vars),
        html: applyTemplate(fallback.html, vars),
        source: "fallback",
      };
    }
    return {
      subject: applyTemplate(data.subject, vars),
      html: applyTemplate(data.body_html, vars),
      source: "template",
    };
  } catch {
    return {
      subject: applyTemplate(fallback.subject, vars),
      html: applyTemplate(fallback.html, vars),
      source: "fallback",
    };
  }
}

export async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !input.to) {
    console.error("Skipping email send — no RESEND_API_KEY or no recipient");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MCA_EMAIL_FROM,
      reply_to: MCA_EMAIL_REPLY_TO,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!res.ok) {
    console.error("Resend send failed", res.status, await res.text());
    return false;
  }
  return true;
}

export const SAMPLE_TEMPLATE_VARS: TemplateVars = {
  parent_first_name: "Alex",
  student_name: "Jordan Sample",
  student_list: "<ul><li>Jordan Sample — Elementary ($150/monthly)</li></ul>",
  portal_url: PORTAL_LOGIN_URL,
  frequency: "monthly",
  price: "150",
  checkout_url: "https://mcahomeschool.com/enroll?status=preview",
  order_items: "<ul><li>Sample PACE × 1</li></ul>",
  fulfillment_line: "Local pickup",
  order_total: "48.00",
  missing_scores: "<ul><li>Math PACE 1037</li></ul>",
  book_list: "<ul><li>Heidi – $12.00</li></ul>",
  store_url: "https://mcahomeschool.com/store?add=sample",
  shipment_label: "Jordan Sample's PACEs",
  shipment_items: "<ul><li>Math PACE 1037</li><li>English PACE 1037</li></ul>",
  tracking_number: "9400111899223197428490",
  tracking_url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490",
  tracking_line:
    '<p><strong>Tracking:</strong> <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490">9400111899223197428490</a></p>',
  student_names: "Jordan Sample",
  overdue_list: "<ul><li>Jordan Sample: Math PACE 1037 (handed out Sep 1)</li></ul>",
};
