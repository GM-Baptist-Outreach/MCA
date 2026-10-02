import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Round 10: one-click re-enrollment. Marker: MCA_R10_REENROLL
//
// POST JSON, signed-in parent (own family) or admin (pass family_id):
//   { action: "status" }
//       window (open, dates, school year) and, per student: current enrollment,
//       suggested next grade and tier, and any re-enrollment already saved.
//   { action: "confirm", parent: {...}, students: [{ student_id, grade_next,
//       frequency, decline? }] }
//       saves the (prefilled, edited) contact info and one reenrollments row
//       per student. Payment path per student:
//         autopay  - active Stripe subscription: it renews on its own. If it
//                    was set to stop at period end, it's switched back on
//                    (no charge now; the normal renewal charges later).
//         comp     - enrollment without payment: nothing to pay; MCA follows up.
//         checkout - no live subscription: status awaiting_payment; the parent
//                    pays with { action: "checkout" }.
//   { action: "checkout", student_id }
//       Stripe Checkout (subscription) for that student's plan. Saved cards
//       show there. stripe-webhook (metadata.reenrollment_id) marks it paid.
//
// The window is app_settings reenroll_open / reenroll_window_start /
// reenroll_window_end / reenroll_school_year. Parents can only confirm while
// it's open; admins can always act for a family.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SITE = "https://mcahomeschool.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function nextGrade(last: string | null): string {
  const t = (last ?? "").trim().toLowerCase();
  if (!t || t === "none" || t === "pre-k" || t === "prek") return "k";
  if (t === "k" || t === "kindergarten") return "1";
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? String(Math.min(n + 1, 12)) : t;
}
function tierForEntering(grade: string): "elementary" | "high_school" {
  const n = parseInt(grade, 10);
  return Number.isFinite(n) && n >= 9 ? "high_school" : "elementary";
}

type Ctx = { admin: SupabaseClient; family: Record<string, unknown>; isAdmin: boolean };

async function context(req: Request, body: Record<string, unknown>): Promise<Ctx | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Sign in first." }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "Sign in first." }, 401);
  const { data: isAdminRaw } = await userClient.rpc("is_admin");
  const isAdmin = !!isAdminRaw;
  const admin = service();
  const cols = "id, parent_name, second_parent_name, email, phone, address, address_street, address_city, address_state, address_zip, stripe_customer_id, is_test_account";
  if (typeof body.family_id === "string" && body.family_id) {
    if (!isAdmin) return json({ error: "Admin only" }, 403);
    const { data } = await admin.from("families").select(cols).eq("id", body.family_id).maybeSingle();
    if (!data) return json({ error: "Family not found" }, 404);
    return { admin, family: data, isAdmin };
  }
  const { data } = await admin.from("families").select(cols).eq("auth_user_id", userData.user.id).maybeSingle();
  if (!data) return json({ error: "No family is linked to this sign-in." }, 404);
  return { admin, family: data, isAdmin };
}

async function windowState(admin: SupabaseClient) {
  const { data } = await admin.rpc("mca_reenroll_window");
  return data as { open: boolean; start: string | null; end: string | null; school_year: string; active: boolean };
}

async function familyStudents(admin: SupabaseClient, familyId: string, schoolYear: string) {
  const [{ data: students }, { data: enrollments }, { data: re }] = await Promise.all([
    admin.from("students").select("id, student_name, last_grade_completed").eq("family_id", familyId).order("student_name"),
    admin
      .from("enrollments")
      .select("id, student_id, tuition_tier, frequency, price, status, is_comp, stripe_subscription_id, stripe_subscription_status, cancel_at_period_end, current_period_end")
      .eq("family_id", familyId),
    admin.from("reenrollments").select("*").eq("family_id", familyId).eq("school_year", schoolYear),
  ]);
  return (students ?? []).map((s) => {
    const enr = (enrollments ?? [])
      .filter((e) => e.student_id === s.id)
      .sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1))[0] ?? null;
    const grade = nextGrade(s.last_grade_completed as string | null);
    return {
      student_id: s.id,
      student_name: s.student_name,
      last_grade_completed: s.last_grade_completed,
      suggested_grade: grade,
      suggested_tier: tierForEntering(grade),
      enrollment: enr,
      reenrollment: (re ?? []).find((r) => r.student_id === s.id) ?? null,
    };
  });
}

function stripeFor(mode: "test" | "live"): Stripe | null {
  const key = resolveStripeSecretKey(mode, readEdgePaymentEnv());
  return key ? new Stripe(key, { apiVersion: "2024-12-18.acacia" }) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ctx = await context(req, body);
    if (ctx instanceof Response) return ctx;
    const { admin, family, isAdmin } = ctx;
    const win = await windowState(admin);
    const familyId = family.id as string;

    if (body.action === "status") {
      const { data: plans } = await admin.from("subscription_plans").select("tuition_tier, frequency, price").eq("active", true);
      return json({
        window: win,
        family: {
          parent_name: family.parent_name, second_parent_name: family.second_parent_name, email: family.email,
          phone: family.phone, address_street: family.address_street, address_city: family.address_city,
          address_state: family.address_state, address_zip: family.address_zip,
        },
        plans: plans ?? [],
        students: await familyStudents(admin, familyId, win.school_year),
      });
    }

    if (!win.active && !isAdmin) {
      return json({ error: "Re-enrollment isn't open right now. Call (844) 663-4477 with any questions." }, 403);
    }

    if (body.action === "confirm") {
      const parent = (body.parent ?? {}) as Record<string, string>;
      const update: Record<string, string | null> = {};
      for (const k of ["parent_name", "second_parent_name", "phone", "address_street", "address_city", "address_state", "address_zip"]) {
        if (typeof parent[k] === "string") update[k] = parent[k].trim() || (k === "second_parent_name" ? null : (family[k] as string | null));
      }
      if (update.parent_name === "" || update.phone === "") return json({ error: "Parent name and phone are required." }, 400);
      if (update.address_street || update.address_city) {
        const street = update.address_street ?? family.address_street;
        const city = update.address_city ?? family.address_city;
        const st = update.address_state ?? family.address_state;
        const zip = update.address_zip ?? family.address_zip;
        update.address = [street, city, [st, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      }
      if (Object.keys(update).length) {
        await admin.from("families").update({ ...update, updated_at: new Date().toISOString() }).eq("id", familyId);
      }

      const rows = Array.isArray(body.students) ? (body.students as Array<Record<string, unknown>>) : [];
      if (rows.length === 0) return json({ error: "Pick at least one student." }, 400);
      const current = await familyStudents(admin, familyId, win.school_year);
      const mode = await readPaymentMode(admin);
      const stripe = stripeFor(mode);
      const results: unknown[] = [];

      for (const row of rows) {
        const info = current.find((c) => c.student_id === row.student_id);
        if (!info) return json({ error: "That student isn't on this family." }, 400);
        if (info.reenrollment?.status === "paid") {
          results.push({ student_id: info.student_id, status: "paid", unchanged: true });
          continue;
        }
        const grade = String(row.grade_next ?? info.suggested_grade).trim().toLowerCase() || info.suggested_grade;
        const tier = tierForEntering(grade);
        const enr = info.enrollment as Record<string, unknown> | null;
        const frequency = row.frequency === "monthly" || row.frequency === "annual"
          ? row.frequency
          : ((enr?.frequency as string) === "monthly" ? "monthly" : "annual");

        let status = "confirmed";
        let path: string = "none";
        let note: string | null = null;
        if (row.decline === true) {
          status = "declined";
        } else if (enr?.is_comp) {
          path = "comp";
          note = "Enrolled without payment this year; MCA will confirm next year's arrangement.";
        } else if (
          enr?.stripe_subscription_id &&
          ["active", "trialing", "past_due"].includes(String(enr?.stripe_subscription_status ?? "active")) &&
          enr?.status === "active"
        ) {
          path = "autopay";
          if (enr.cancel_at_period_end && stripe) {
            await stripe.subscriptions.update(enr.stripe_subscription_id as string, { cancel_at_period_end: false });
            await admin.from("enrollments").update({ cancel_at_period_end: false, cancellation_reason: null, updated_at: new Date().toISOString() }).eq("id", enr.id as string);
            note = "Renewal was switched back on.";
          }
          if (tier !== enr.tuition_tier) note = `${note ? note + " " : ""}Moves to ${tier === "high_school" ? "high school" : "elementary"} pricing; MCA will update the plan.`;
        } else {
          path = "checkout";
          status = "awaiting_payment";
        }

        const { data: saved, error } = await admin
          .from("reenrollments")
          .upsert({
            student_id: info.student_id,
            family_id: familyId,
            enrollment_id: (enr?.id as string) ?? null,
            school_year: win.school_year,
            status,
            grade_next: grade,
            tuition_tier: tier,
            frequency,
            payment_path: status === "declined" ? "none" : path,
            confirmed_at: new Date().toISOString(),
            notes: note,
            updated_at: new Date().toISOString(),
          }, { onConflict: "student_id,school_year" })
          .select("*")
          .single();
        if (error) throw error;
        results.push(saved);
      }
      return json({ ok: true, school_year: win.school_year, results });
    }

    if (body.action === "checkout") {
      const studentId = String(body.student_id ?? "");
      const current = await familyStudents(admin, familyId, win.school_year);
      const info = current.find((c) => c.student_id === studentId);
      if (!info) return json({ error: "That student isn't on this family." }, 400);
      const re = info.reenrollment as Record<string, unknown> | null;
      if (!re || re.status === "declined") return json({ error: "Confirm re-enrollment first." }, 400);
      if (re.status === "paid") return json({ error: "Already paid. Thank you!" }, 400);
      const enr = info.enrollment as Record<string, unknown> | null;
      if (!enr) return json({ error: "No enrollment on file for this student. Please call (844) 663-4477." }, 400);
      if (re.payment_path === "autopay") return json({ error: "This student renews automatically. Nothing to pay now." }, 400);

      const mode = await readPaymentMode(admin);
      const stripe = stripeFor(mode);
      if (!stripe) return json({ error: "Card payments aren't set up yet. Please call (844) 663-4477." }, 503);
      const { data: plan } = await admin
        .from("subscription_plans")
        .select("stripe_price_id, price")
        .eq("tuition_tier", re.tuition_tier as string)
        .eq("frequency", re.frequency as string)
        .eq("active", true)
        .maybeSingle();
      if (!plan?.stripe_price_id) return json({ error: "Pricing isn't set up for that plan. Please call (844) 663-4477." }, 503);

      let customerId = family.stripe_customer_id as string | null;
      if (!customerId && family.email) {
        const found = await stripe.customers.list({ email: family.email as string, limit: 1 });
        customerId = found.data[0]?.id ?? null;
      }
      if (!customerId) {
        const created = await stripe.customers.create({
          email: (family.email as string) ?? undefined,
          name: (family.parent_name as string) ?? undefined,
          phone: (family.phone as string) ?? undefined,
          metadata: { family_id: familyId },
        });
        customerId = created.id;
      }
      if (customerId !== family.stripe_customer_id) {
        await admin.from("families").update({ stripe_customer_id: customerId }).eq("id", familyId);
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
        success_url: `${SITE}/portal?reenroll=paid`,
        cancel_url: `${SITE}/portal?reenroll=cancelled`,
        saved_payment_method_options: { allow_redisplay_filters: ["always", "limited", "unspecified"] },
        metadata: {
          conversion_of_enrollment_id: enr.id as string,
          reenrollment_id: re.id as string,
          frequency: re.frequency as string,
          payment_mode: mode,
        },
      });
      await admin.from("reenrollments").update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", re.id as string);
      return json({ url: session.url, id: session.id, price: plan.price, mode });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[portal-reenroll]", err);
    return json({ error: (err as { message?: string })?.message ?? String(err) }, 500);
  }
});
