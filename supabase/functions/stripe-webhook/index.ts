import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

// Stripe calls this directly (signature-verified, not a Supabase JWT).
// checkout.session.completed is where families/students/enrollments rows
// actually get created — not in create-enrollment-checkout — so there's
// never a DB row without a real, paid-for Stripe object behind it.
// Also keeps enrollments.stripe_subscription_status / cancel_at_period_end /
// current_period_end in sync on renewal, cancellation, and payment failure.

function tierFor(lastGradeCompleted: string): "elementary" | "high_school" | null {
  if (!lastGradeCompleted || lastGradeCompleted === "none") return null;
  return ["8", "9", "10", "11"].includes(lastGradeCompleted) ? "high_school" : "elementary";
}

function parseStudentsFromMetadata(metadata: Record<string, string>) {
  const count = Number(metadata.student_count || "0");
  const students: { firstName: string; lastName: string; gender: string; birthdate: string; lastGradeCompleted: string }[] = [];
  for (let i = 0; i < count; i++) {
    const raw = metadata[`student_${i}`];
    if (!raw) continue;
    const [firstName, lastName, gender, birthdate, lastGradeCompleted] = raw.split("|");
    students.push({ firstName, lastName, gender, birthdate, lastGradeCompleted });
  }
  return students;
}

Deno.serve(async (req: Request) => {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeSecretKey || !webhookSecret) {
    return new Response("Stripe webhook not configured yet", { status: 503 });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature!, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Idempotency: unique constraint on stripe_event_id means a duplicate
  // delivery fails here and we return early without reprocessing.
  const { error: insertEventError } = await admin
    .from("stripe_webhook_events")
    .insert({ stripe_event_id: event.id, event_type: event.type });
  if (insertEventError) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = (session.metadata ?? {}) as Record<string, string>;
        const students = parseStudentsFromMetadata(metadata);

        const { data: family, error: familyError } = await admin
          .from("families")
          .insert({
            parent_name: `${metadata.parent_first_name ?? ""} ${metadata.parent_last_name ?? ""}`.trim(),
            second_parent_name: metadata.parent_second_name || null,
            email: metadata.parent_email ?? "",
            phone: metadata.parent_phone ?? "",
            address: metadata.parent_address ?? "",
            report_token: crypto.randomUUID(),
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
          })
          .select()
          .single();

        if (familyError) throw familyError;

        for (const s of students) {
          const { data: studentRow, error: studentError } = await admin
            .from("students")
            .insert({
              family_id: family.id,
              student_name: `${s.firstName} ${s.lastName}`,
              gender: s.gender || null,
              birthdate: s.birthdate || null,
              last_grade_completed: s.lastGradeCompleted || null,
            })
            .select()
            .single();

          if (studentError) throw studentError;

          const tier = tierFor(s.lastGradeCompleted);
          if (!tier) continue; // Kindergarten route — no tuition enrollment row.

          const { data: plan } = await admin
            .from("subscription_plans")
            .select("stripe_price_id")
            .eq("tuition_tier", tier)
            .eq("frequency", metadata.payment_plan)
            .maybeSingle();

          await admin.from("enrollments").insert({
            family_id: family.id,
            student_id: studentRow.id,
            tuition_tier: tier,
            stripe_price_id: plan?.stripe_price_id ?? null,
            stripe_subscription_status: "active",
          });
        }

        // One-way GHL contact push — marketing/communication only, never the
        // source of truth for billing. Skips gracefully if not configured yet.
        const ghlApiKey = Deno.env.get("GHL_API_KEY_MCA");
        const ghlLocationId = Deno.env.get("GHL_LOCATION_ID_MCA");
        if (ghlApiKey && ghlLocationId) {
          try {
            const ghlRes = await fetch("https://services.leadconnectorhq.com/contacts/", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${ghlApiKey}`,
                Version: "2021-07-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                locationId: ghlLocationId,
                firstName: metadata.parent_first_name,
                lastName: metadata.parent_last_name,
                email: metadata.parent_email,
                phone: metadata.parent_phone,
                address1: metadata.parent_address,
              }),
            });
            if (ghlRes.ok) {
              const ghlContact = await ghlRes.json();
              await admin
                .from("families")
                .update({ ghl_contact_id: ghlContact?.contact?.id ?? null })
                .eq("id", family.id);
            } else {
              console.error("GHL contact push failed", await ghlRes.text());
            }
          } catch (ghlErr) {
            console.error("GHL contact push error", ghlErr);
          }
        } else {
          console.log("GHL_API_KEY_MCA / GHL_LOCATION_ID_MCA not set — skipping contact push");
        }

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        const { data: family } = await admin
          .from("families")
          .select("id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (family) {
          const { data: studentRows } = await admin
            .from("students")
            .select("id")
            .eq("family_id", family.id);

          const studentIds = (studentRows ?? []).map((s) => s.id);

          if (studentIds.length > 0) {
            await admin
              .from("enrollments")
              .update({
                stripe_subscription_status: subscription.status,
                cancel_at_period_end: subscription.cancel_at_period_end,
                current_period_end: subscription.current_period_end
                  ? new Date(subscription.current_period_end * 1000).toISOString()
                  : null,
                updated_at: new Date().toISOString(),
              })
              .in("student_id", studentIds);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const { data: family } = await admin
            .from("families")
            .select("id")
            .eq("stripe_subscription_id", invoice.subscription as string)
            .maybeSingle();

          if (family) {
            const { data: studentRows } = await admin
              .from("students")
              .select("id")
              .eq("family_id", family.id);

            const studentIds = (studentRows ?? []).map((s) => s.id);

            if (studentIds.length > 0) {
              await admin
                .from("enrollments")
                .update({ stripe_subscription_status: "past_due", updated_at: new Date().toISOString() })
                .in("student_id", studentIds);
            }
          }
        }
        break;
      }

      default:
        break; // Unhandled event types are fine to ignore.
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook handler error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
