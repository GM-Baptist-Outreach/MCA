// Deno is provided by the Supabase Edge runtime.
/* global Deno */

import type { PaymentEnv } from "./paymentMode.ts";

export function readEdgePaymentEnv(): PaymentEnv {
  const get = (key: string) => {
    const value = Deno.env.get(key);
    return value?.trim() ? value.trim() : undefined;
  };
  return {
    STRIPE_SECRET_KEY: get("STRIPE_SECRET_KEY"),
    STRIPE_SECRET_KEY_LIVE: get("STRIPE_SECRET_KEY_LIVE"),
    STRIPE_SECRET_KEY_TEST: get("STRIPE_SECRET_KEY_TEST"),
    STRIPE_WEBHOOK_SECRET: get("STRIPE_WEBHOOK_SECRET"),
    STRIPE_WEBHOOK_SECRET_LIVE: get("STRIPE_WEBHOOK_SECRET_LIVE"),
    STRIPE_WEBHOOK_SECRET_TEST: get("STRIPE_WEBHOOK_SECRET_TEST"),
    SHIPPO_API_KEY: get("SHIPPO_API_KEY"),
    SHIPPO_API_KEY_LIVE: get("SHIPPO_API_KEY_LIVE"),
    SHIPPO_API_KEY_TEST: get("SHIPPO_API_KEY_TEST"),
  };
}
