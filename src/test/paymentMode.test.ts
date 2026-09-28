import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  normalizePaymentMode,
  readPaymentMode,
  resolveShippoApiKey,
  resolveStripeSecretKey,
  webhookVerificationCandidates,
} from "../../supabase/functions/_shared/paymentMode";
import {
  estimatePaceParcel,
  isReasonableGroundRate,
  isStoreShippingLine,
  MCA_WAREHOUSE_FROM_ADDRESS,
  quoteStoreShippoRate,
  selectShippoRate,
  shippingTierFeeCents,
  shouldQuoteShippo,
  SHIPPO_SHIPMENTS_URL,
} from "../../supabase/functions/_shared/storeShipping";

const root = resolve(__dirname, "../..");

describe("payment mode", () => {
  it("defaults to live unless the value is exactly test", () => {
    expect(normalizePaymentMode(undefined)).toBe("live");
    expect(normalizePaymentMode("")).toBe("live");
    expect(normalizePaymentMode("LIVE")).toBe("live");
    expect(normalizePaymentMode(" test ")).toBe("test");
  });

  it("uses the test Stripe secret only in test mode", () => {
    const env = {
      STRIPE_SECRET_KEY: "sk_live_legacy",
      STRIPE_SECRET_KEY_LIVE: "sk_live_named",
      STRIPE_SECRET_KEY_TEST: "sk_test_named",
    };
    expect(resolveStripeSecretKey("live", env)).toBe("sk_live_named");
    expect(resolveStripeSecretKey("test", env)).toBe("sk_test_named");
    expect(resolveStripeSecretKey("test", { STRIPE_SECRET_KEY: "sk_live_legacy" })).toBeNull();
  });

  it("treats the legacy Stripe secret as live", () => {
    expect(resolveStripeSecretKey("live", { STRIPE_SECRET_KEY: "sk_live_legacy" })).toBe(
      "sk_live_legacy",
    );
    expect(resolveStripeSecretKey("live", {})).toBeNull();
  });

  it("picks the Shippo key for the active mode and treats the legacy key as live", () => {
    const env = {
      SHIPPO_API_KEY: "shippo_live_legacy",
      SHIPPO_API_KEY_LIVE: "shippo_live_named",
      SHIPPO_API_KEY_TEST: "shippo_test_named",
    };
    expect(resolveShippoApiKey("live", env)).toBe("shippo_live_named");
    expect(resolveShippoApiKey("test", env)).toBe("shippo_test_named");
    expect(resolveShippoApiKey("live", { SHIPPO_API_KEY: "shippo_live_legacy" })).toBe(
      "shippo_live_legacy",
    );
    expect(resolveShippoApiKey("test", { SHIPPO_API_KEY: "shippo_live_legacy" })).toBeNull();
  });

  it("dual-verifies webhooks, trying the active mode first", () => {
    const env = {
      STRIPE_WEBHOOK_SECRET: "whsec_legacy",
      STRIPE_WEBHOOK_SECRET_TEST: "whsec_test",
      STRIPE_SECRET_KEY: "sk_live_legacy",
      STRIPE_SECRET_KEY_TEST: "sk_test_named",
    };
    expect(webhookVerificationCandidates("live", env).map((c) => c.mode)).toEqual([
      "live",
      "test",
    ]);
    expect(webhookVerificationCandidates("live", env)[0]).toMatchObject({
      webhookSecret: "whsec_legacy",
      secretKey: "sk_live_legacy",
    });
    expect(webhookVerificationCandidates("test", env)[0]).toMatchObject({
      mode: "test",
      webhookSecret: "whsec_test",
      secretKey: "sk_test_named",
    });
  });

  it("does not try the same webhook secret twice", () => {
    const candidates = webhookVerificationCandidates("test", {
      STRIPE_WEBHOOK_SECRET_LIVE: "whsec_same",
      STRIPE_WEBHOOK_SECRET_TEST: "whsec_same",
      STRIPE_SECRET_KEY_LIVE: "sk_live",
      STRIPE_SECRET_KEY_TEST: "sk_test",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].mode).toBe("test");
  });

  it("reads payment_mode at request time and defaults to live on failure", async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { value: "test" }, error: null }),
          }),
        }),
      }),
    };
    expect(await readPaymentMode(admin)).toBe("test");

    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "missing" } }),
          }),
        }),
      }),
    };
    expect(await readPaymentMode(broken)).toBe("live");
  });
});

describe("store shippo quoting", () => {
  it("treats only the Shipping line as shipping, not sales tax", () => {
    expect(isStoreShippingLine("Shipping")).toBe(true);
    expect(isStoreShippingLine("Oklahoma Sales Tax (10%)")).toBe(false);
  });

  it("quotes Shippo only for store shipments", () => {
    expect(shouldQuoteShippo("store", "ship")).toBe(true);
    expect(shouldQuoteShippo("store", "pickup")).toBe(false);
    expect(shouldQuoteShippo("enrollment", "ship")).toBe(false);
    expect(shouldQuoteShippo("tuition", "ship")).toBe(false);
  });

  it("estimates one PACE carton and caps a large order", () => {
    expect(estimatePaceParcel(1)).toMatchObject({
      length: "12",
      width: "10",
      distance_unit: "in",
      mass_unit: "lb",
      weight: "1",
    });
    expect(Number(estimatePaceParcel(10).weight)).toBe(4.6);
    expect(Number(estimatePaceParcel(100).height)).toBe(12);
    expect(MCA_WAREHOUSE_FROM_ADDRESS).toMatchObject({
      street1: "2300 NW 32nd Street",
      city: "Newcastle",
      state: "OK",
      zip: "73065",
    });
  });

  it("picks the cheapest ground rate, then the cheapest rate overall", () => {
    const selected = selectShippoRate([
      rate("priority", "8.00", "usps_priority", "Priority Mail"),
      rate("ground-expensive", "12.50", "ups_ground", "Ground"),
      rate("ground-cheap", "6.40", "usps_ground_advantage", "Ground Advantage"),
    ]);
    expect(selected).toMatchObject({
      rateObjectId: "ground-cheap",
      amountCents: 640,
      ground: true,
    });

    const airOnly = selectShippoRate([
      rate("express", "22.10", "ups_next_day_air", "Next Day Air"),
      rate("priority", "9.15", "usps_priority", "Priority Mail"),
    ]);
    expect(airOnly).toMatchObject({ rateObjectId: "priority", amountCents: 915, ground: false });
    expect(isReasonableGroundRate({ servicelevel: { token: "usps_priority", name: "Priority Mail" } })).toBe(
      false,
    );
  });

  it("falls back when Shippo has no usable USD rate", () => {
    expect(selectShippoRate([
      { object_id: "cad", amount: "5.00", currency: "CAD", servicelevel: { token: "ups_ground", name: "Ground" } },
      { object_id: "free", amount: "0.00", currency: "USD", servicelevel: { token: "ups_ground", name: "Ground" } },
    ])).toBeNull();
    expect(shippingTierFeeCents([
      { min_quantity: 1, max_quantity: 5, price: "8.50" },
      { min_quantity: 6, max_quantity: null, price: 12 },
    ], 2)).toBe(850);
    expect(shippingTierFeeCents([
      { min_quantity: 1, max_quantity: 5, price: 8.5 },
      { min_quantity: 6, max_quantity: null, price: 12 },
    ], 9)).toBe(1200);
    expect(shippingTierFeeCents([], 3)).toBe(0);
  });

  it("sends the Newcastle origin and uses the returned cents", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.address_from.city).toBe("Newcastle");
      expect(body.address_from.zip).toBe("73065");
      expect(body.async).toBe(false);
      expect(body.parcels[0].mass_unit).toBe("lb");
      expect(init?.headers).toMatchObject({ Authorization: "ShippoToken shippo_test_named" });
      return new Response(JSON.stringify({
        rates: [
          {
            object_id: "rate_ground",
            amount: "7.25",
            currency: "USD",
            provider: "USPS",
            servicelevel: { name: "Ground Advantage", token: "usps_ground_advantage" },
          },
        ],
      }), { status: 200 });
    });

    const quote = await quoteStoreShippoRate({
      apiKey: "shippo_test_named",
      totalQuantity: 3,
      to: {
        name: "Ada Parent",
        street1: "1 Main",
        city: "Tulsa",
        state: "OK",
        zip: "74103",
        country: "US",
      },
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(SHIPPO_SHIPMENTS_URL, expect.any(Object));
    expect(quote).toMatchObject({ amountCents: 725, rateObjectId: "rate_ground" });
  });
});

describe("shippo stays off enrollment", () => {
  it("does not reference Shippo from enrollment checkout", () => {
    const src = readFileSync(
      resolve(root, "supabase/functions/create-enrollment-checkout/index.ts"),
      "utf8",
    );
    expect(src).not.toContain("storeShipping");
    expect(src).not.toContain("SHIPPO_");
    expect(src).not.toContain("goshippo");
    expect(src).toContain("resolveStripeSecretKey");
  });

  it("rates Shippo only inside store checkout", () => {
    const src = readFileSync(
      resolve(root, "supabase/functions/create-store-order-checkout/index.ts"),
      "utf8",
    );
    expect(src).toContain("shouldQuoteShippo");
    expect(src).toContain("shipping_rate_tiers");
    expect(src).toContain("shippo_rate_id");
  });
});

function rate(id: string, amount: string, token: string, name: string) {
  return {
    object_id: id,
    amount,
    currency: "USD",
    provider: "USPS",
    servicelevel: { token, name },
  };
}
