// Deno is provided by the Supabase Edge runtime.
/* global Deno */

// Browser origins allowed to start a Stripe Checkout session from the public
// checkout functions. The validated Origin header (never a client-supplied body
// field) is also the base for Stripe success/cancel URLs, so a third party
// cannot mint an MCA-branded checkout that redirects payers elsewhere.
// Extra origins (e.g. a preview host) come from EXTRA_ALLOWED_ORIGINS,
// comma-separated, so they can be added without a redeploy.

const BASE_ALLOWED_ORIGINS = [
  "https://mcahomeschool.com",
  "https://www.mcahomeschool.com",
];

function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

export function allowedOrigins(): string[] {
  const extra = (Deno.env.get("EXTRA_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map(normalize)
    .filter(Boolean);
  return [...BASE_ALLOWED_ORIGINS, ...extra];
}

/** The request's Origin if it is allow-listed, otherwise null. */
export function matchAllowedOrigin(req: Request): string | null {
  const raw = req.headers.get("Origin");
  if (!raw) return null;
  const origin = normalize(raw);
  return allowedOrigins().includes(origin) ? origin : null;
}

export function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function forbiddenOriginResponse(): Response {
  return new Response(JSON.stringify({ error: "Forbidden origin" }), {
    status: 403,
    headers: { ...corsHeadersFor(null), "Content-Type": "application/json" },
  });
}
