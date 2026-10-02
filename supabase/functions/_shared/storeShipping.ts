// Shippo rating for STORE orders with fulfillment = ship only.
// Enrollment, tuition, and local pickup must not import this module.
//
// Parcel assumptions (rating only — this does not buy a label):
// - One carton leaves the Newcastle warehouse.
// - Each store unit is estimated at 0.4 lb (a PACE booklet plus a little
//   packing; answer keys and thin resource books fit the same allowance).
// - The carton itself adds 0.6 lb. Minimum billable weight is 1 lb.
// - Footprint is 12 x 10 inches. Height starts at 4 inches and grows by
//   0.35 inch per unit, capped at 12 inches, so a large order still rates
//   as one box instead of failing Shippo's parcel limits.
// - Weight and height are estimates. The warehouse can correct the parcel
//   when a label is purchased later.

export const MCA_WAREHOUSE_FROM_ADDRESS = {
  name: "Midwest Christian Academy",
  company: "Midwest Christian Academy",
  street1: "2300 NW 32nd Street",
  city: "Newcastle",
  state: "OK",
  zip: "73065",
  country: "US",
  phone: "8446634477",
  email: "David@midwestchristianacademy.com",
} as const;

export const SHIPPO_SHIPMENTS_URL = "https://api.goshippo.com/shipments/";

const PER_UNIT_LB = 0.4;
const PACKAGING_LB = 0.6;
const MIN_WEIGHT_LB = 1;
const CARTON_LENGTH_IN = 12;
const CARTON_WIDTH_IN = 10;
const MIN_HEIGHT_IN = 4;
const PER_UNIT_HEIGHT_IN = 0.35;
const MAX_HEIGHT_IN = 12;

export type ShippoAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
};

export type PaceParcel = {
  length: string;
  width: string;
  height: string;
  distance_unit: "in";
  weight: string;
  mass_unit: "lb";
};

export type ShippoRateLike = {
  object_id?: string;
  amount?: string;
  currency?: string;
  provider?: string;
  servicelevel?: { name?: string; token?: string } | null;
};

export type SelectedShippoRate = {
  amountCents: number;
  rateObjectId: string;
  provider: string;
  service: string;
  ground: boolean;
};

export type ShippingTier = {
  min_quantity: number;
  max_quantity: number | null;
  price: number | string;
};

const GROUND_RE = /ground|home[_\s-]?delivery|parcel[_\s-]?select|surepost|smart[_\s-]?post/i;
const EXPRESS_RE =
  /express|overnight|next[_\s-]?day|2nd[_\s-]?day|second[_\s-]?day|priority|expedited|\bair\b|first[_\s-]?class/i;

export function shouldQuoteShippo(flow: string, fulfillment: string): boolean {
  return flow === "store" && fulfillment === "ship";
}

export function isStoreShippingLine(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "shipping";
}

export function estimatePaceParcel(totalQuantity: number): PaceParcel {
  const qty = Math.max(1, Math.floor(Number(totalQuantity)) || 1);
  const weightLb = Math.max(
    MIN_WEIGHT_LB,
    Math.round((PACKAGING_LB + qty * PER_UNIT_LB) * 100) / 100,
  );
  const heightIn = Math.min(
    MAX_HEIGHT_IN,
    Math.max(MIN_HEIGHT_IN, Math.round((2 + qty * PER_UNIT_HEIGHT_IN) * 10) / 10),
  );
  return {
    length: String(CARTON_LENGTH_IN),
    width: String(CARTON_WIDTH_IN),
    height: String(heightIn),
    distance_unit: "in",
    weight: String(weightLb),
    mass_unit: "lb",
  };
}

export function isReasonableGroundRate(rate: ShippoRateLike): boolean {
  const token = rate.servicelevel?.token ?? "";
  const name = rate.servicelevel?.name ?? "";
  const blob = `${token} ${name}`;
  if (!GROUND_RE.test(blob)) return false;
  if (EXPRESS_RE.test(blob) && !/ground/i.test(blob)) return false;
  return true;
}

export function rateAmountCents(rate: ShippoRateLike): number | null {
  if (rate.currency && rate.currency.toUpperCase() !== "USD") return null;
  const amount = Number(rate.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function selectShippoRate(rates: ShippoRateLike[]): SelectedShippoRate | null {
  const priced = rates.flatMap((rate) => {
    const amountCents = rateAmountCents(rate);
    if (amountCents == null || !rate.object_id) return [];
    return [{
      amountCents,
      rateObjectId: rate.object_id,
      provider: rate.provider ?? "",
      service: rate.servicelevel?.name || rate.servicelevel?.token || "",
      ground: isReasonableGroundRate(rate),
    }];
  });

  const ground = priced.filter((rate) => rate.ground);
  const pool = ground.length > 0 ? ground : priced;
  if (pool.length === 0) return null;
  return pool.reduce((best, rate) => (rate.amountCents < best.amountCents ? rate : best));
}

export function shippingTierFeeCents(tiers: ShippingTier[], totalQuantity: number): number {
  const ordered = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity);
  const matching = ordered.find(
    (tier) =>
      totalQuantity >= tier.min_quantity &&
      (tier.max_quantity == null || totalQuantity <= tier.max_quantity),
  );
  const tier = matching ?? ordered[ordered.length - 1];
  if (!tier) return 0;
  const cents = Math.round(Number(tier.price) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function quoteStoreShippoRate(args: {
  apiKey: string;
  to: ShippoAddress;
  totalQuantity: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<SelectedShippoRate | null> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(SHIPPO_SHIPMENTS_URL, {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from: MCA_WAREHOUSE_FROM_ADDRESS,
        address_to: args.to,
        parcels: [estimatePaceParcel(args.totalQuantity)],
        async: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Shippo shipments HTTP ${response.status}: ${text.slice(0, 400)}`);
    }
    const json = JSON.parse(text) as {
      rates?: ShippoRateLike[];
      messages?: unknown[];
    };
    if (Array.isArray(json.messages) && json.messages.length > 0) {
      console.warn("[shippo] shipment messages", JSON.stringify(json.messages).slice(0, 500));
    }
    return selectShippoRate(Array.isArray(json.rates) ? json.rates : []);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Round 11 (MCA_R11_STORE_ADDRESS): a full US ship-to address is required on
// every store checkout. Street line 1 must have a house, PO Box, or route
// number (a church or business name alone can't be shipped to; it belongs on
// line 2). The same rules run in the store form and in
// create-store-order-checkout, so a bad address can never reach Stripe.
// ---------------------------------------------------------------------------

export const US_STATES: Array<[string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"], ["AS", "American Samoa"],
  ["MP", "Northern Mariana Islands"], ["AA", "Armed Forces Americas"], ["AE", "Armed Forces Europe"],
  ["AP", "Armed Forces Pacific"],
];

export function normalizeUsState(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().replace(/\./g, "").toUpperCase();
  if (!v) return null;
  for (const [code, name] of US_STATES) {
    if (v === code || v === name.toUpperCase().replace(/\./g, "")) return code;
  }
  return null;
}

export type ShipAddressInput = {
  addressStreet?: string | null;
  addressStreet2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
};

export type ShipAddress = { street: string; street2: string; city: string; state: string; zip: string };

export type ShipAddressCheck = { ok: boolean; address?: ShipAddress; field?: string; error?: string };

export function validateShipAddress(input: ShipAddressInput): ShipAddressCheck {
  const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
  const street = clean(input.addressStreet);
  const street2 = clean(input.addressStreet2);
  const city = clean(input.addressCity);
  const zip = clean(input.addressZip);
  if (!street) return { ok: false, field: "street", error: "Please enter your street address." };
  if (!/\d/.test(street) || street.length < 4) {
    return {
      ok: false,
      field: "street",
      error:
        "Please enter a street address with a house or box number (for example 123 Main St or PO Box 45). A church or business name goes on the second line.",
    };
  }
  if (street.length > 100 || street2.length > 100) {
    return { ok: false, field: "street", error: "Please shorten the street address (100 characters per line)." };
  }
  if (city.length < 2 || !/[A-Za-z]/.test(city)) return { ok: false, field: "city", error: "Please enter your city." };
  const state = normalizeUsState(input.addressState);
  if (!state) return { ok: false, field: "state", error: "Please choose your state." };
  if (!/^\d{5}(-?\d{4})?$/.test(zip)) {
    return { ok: false, field: "zip", error: "Please enter a 5-digit ZIP code." };
  }
  const zipNorm = zip.length === 9 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip;
  return { ok: true, address: { street, street2, city, state, zip: zipNorm } };
}

/** One-line ship-to as saved on orders.shipping_address. */
export function formatShipAddress(a: ShipAddress): string {
  return [a.street, a.street2, a.city, `${a.state} ${a.zip}`].filter((p) => p && p.trim()).join(", ");
}
