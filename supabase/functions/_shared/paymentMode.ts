// Payment mode is a single switch for Stripe and Shippo.
// Default is live so a missing row keeps today's production behavior.
// Legacy STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / SHIPPO_API_KEY count as live.

export type PaymentMode = "test" | "live";

export type PaymentEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_SECRET_KEY_LIVE?: string;
  STRIPE_SECRET_KEY_TEST?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_WEBHOOK_SECRET_LIVE?: string;
  STRIPE_WEBHOOK_SECRET_TEST?: string;
  SHIPPO_API_KEY?: string;
  SHIPPO_API_KEY_LIVE?: string;
  SHIPPO_API_KEY_TEST?: string;
};

export type WebhookCandidate = {
  mode: PaymentMode;
  webhookSecret: string;
  secretKey: string | null;
};

const PAYMENT_MODE_KEY = "payment_mode";

function nonempty(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizePaymentMode(raw: unknown): PaymentMode {
  return String(raw ?? "").trim().toLowerCase() === "test" ? "test" : "live";
}

export function resolveStripeSecretKey(mode: PaymentMode, env: PaymentEnv): string | null {
  if (mode === "test") return nonempty(env.STRIPE_SECRET_KEY_TEST);
  return nonempty(env.STRIPE_SECRET_KEY_LIVE) ?? nonempty(env.STRIPE_SECRET_KEY);
}

export function resolveShippoApiKey(mode: PaymentMode, env: PaymentEnv): string | null {
  if (mode === "test") return nonempty(env.SHIPPO_API_KEY_TEST);
  return nonempty(env.SHIPPO_API_KEY_LIVE) ?? nonempty(env.SHIPPO_API_KEY);
}

// Try the active mode's webhook secret first, then the other mode, so an
// in-flight event from the mode we just left still verifies. Legacy
// STRIPE_WEBHOOK_SECRET is the live secret when STRIPE_WEBHOOK_SECRET_LIVE
// is unset. The matching secret tells us which Stripe API key to use.
export function webhookVerificationCandidates(
  activeMode: PaymentMode,
  env: PaymentEnv,
): WebhookCandidate[] {
  const liveSecret = nonempty(env.STRIPE_WEBHOOK_SECRET_LIVE) ?? nonempty(env.STRIPE_WEBHOOK_SECRET);
  const testSecret = nonempty(env.STRIPE_WEBHOOK_SECRET_TEST);
  const liveKey = nonempty(env.STRIPE_SECRET_KEY_LIVE) ?? nonempty(env.STRIPE_SECRET_KEY);
  const testKey = nonempty(env.STRIPE_SECRET_KEY_TEST);

  const live: WebhookCandidate | null = liveSecret
    ? { mode: "live", webhookSecret: liveSecret, secretKey: liveKey }
    : null;
  const test: WebhookCandidate | null = testSecret
    ? { mode: "test", webhookSecret: testSecret, secretKey: testKey }
    : null;

  const ordered = activeMode === "test" ? [test, live] : [live, test];
  const seen = new Set<string>();
  const candidates: WebhookCandidate[] = [];
  for (const candidate of ordered) {
    if (!candidate || seen.has(candidate.webhookSecret)) continue;
    seen.add(candidate.webhookSecret);
    candidates.push(candidate);
  }
  return candidates;
}

type PaymentModeReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: { value?: string | null } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export async function readPaymentMode(admin: PaymentModeReader): Promise<PaymentMode> {
  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", PAYMENT_MODE_KEY)
      .maybeSingle();
    if (error) {
      console.error("[payment-mode] read failed, defaulting to live", error.message ?? error);
      return "live";
    }
    return normalizePaymentMode(data?.value);
  } catch (err) {
    console.error("[payment-mode] read threw, defaulting to live", err);
    return "live";
  }
}
