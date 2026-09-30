import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, webhookVerificationCandidates } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";
import { isStoreShippingLine } from "../_shared/storeShipping.ts";
import { PORTAL_LOGIN_URL, renderTemplate, sendResendEmail } from "../_shared/emailTemplates.ts";

// Stripe calls this directly (signature-verified, not a Supabase JWT).
// checkout.session.completed is where families/students/enrollments rows
// (or orders/order_items rows, for the store) actually get created — not
// in the checkout-creation functions — so there's never a DB row without a
// real, paid-for Stripe object behind it. Also keeps
// enrollments.stripe_subscription_status / cancel_at_period_end /
// current_period_end in sync on renewal, cancellation, and payment failure.
// Pushes a GHL Contact (parent) + one GHL Opportunity per tuition-eligible
// student into the Enrollment pipeline — one-way, GHL is never read from.
// Also sends a confirmation email (via Resend) for both store orders and
// new enrollments — best-effort, a failed send never blocks the real
// order/enrollment creation that already committed.
//
// A family can enroll additional students later under a brand-new Stripe
// subscription (create-enrollment-checkout already reuses the same Stripe
// Customer by email) — when that happens we reuse the existing families
// row instead of creating a duplicate, and every enrollment row carries
// its OWN stripe_subscription_id rather than relying on the family-level
// column, since a family can now have more than one subscription over
// time. Renewal/cancellation/payment-failure below look up affected
// enrollments directly by stripe_subscription_id for the same reason.
//
// GHL tagging: every meaningful event below tags the relevant GHL contact
// (payment-failed, kindergarten-enrolled, store-order-placed) so David can
// build whatever GHL workflow he wants off "Tag Added: X" without ever
// needing this function edited again. We only ever ADD tags, never remove
// them — removal (where it makes sense, e.g. one-time event tags meant to
// re-fire) is the last step of the GHL workflow itself, not our job here.
//
// current_period_end: this account uses Stripe's newer "flexible billing"
// behavior, where the period end lives on each subscription ITEM rather
// than the top-level Subscription object — the top-level field comes back
// empty here even though the SDK type still declares it. periodEndFromSubscription
// below checks both, item-level first, so this keeps working regardless of
// which shape a given Stripe account uses. Populated both at enrollment
// creation (an explicit retrieve, since checkout.session.completed only
// hands us the subscription ID) and on every subsequent renewal/cancellation
// update.
//
// Comp-to-paid conversion: send-payment-link creates a Checkout Session for
// an EXISTING comp enrollment (built by admin-comp-enroll) rather than a
// brand-new one. That session carries metadata.conversion_of_enrollment_id,
// checked FIRST below, before the store and normal-enrollment branches —
// it UPDATES that one enrollment row in place (is_comp: false, real Stripe
// IDs, real price) and never touches families/students, since those already
// exist from the comp enrollment.

// GHL account IDs for Midwest Christian Academy (not secrets, just this
// account's fixed IDs — created via the Pass 1/Pass 2 GHL audit+build).
const GHL_ENROLLMENT_PIPELINE_ID = "NuTKV11562lhb6EYckXp";
const GHL_STAGE_NEW_ENROLLMENT = "358c5f58-93b8-43da-b547-b809273e664b"; // New Enrollment (Paid)
const GHL_CONTACT_FIELD_STUDENTS_INFO = "f0C2O1oIzoFliT0jlrv8"; // Students Information (contact-level)
const GHL_OPP_FIELD_STUDENT_FIRST_NAME = "STgt9LEYDHBypPsEbN0Q";
const GHL_OPP_FIELD_STUDENT_LAST_NAME = "YzTxc3Yec6P7z9R1Wvb5";
const GHL_OPP_FIELD_STUDENT_GENDER = "WwRsgVbIJSJFInKOGICT";
const GHL_OPP_FIELD_STUDENT_BIRTHDATE = "e0jvXTJSt2BpxfueuCxT";
const GHL_OPP_FIELD_TUITION_TIER = "jGT3VSQNSFDgcpE4Uv6A";
const GHL_OPP_FIELD_PAYMENT_PLAN = "u9d6ZZsIM2lmFKc7HAh3";
const GHL_OPP_FIELD_STRIPE_SUBSCRIPTION_ID = "lRwN744F4kyZJAX6kKvp";
const GHL_OPP_FIELD_ENROLLMENT_ID = "N14OwSVKCdI15d9zTSSU"; // Enrollment ID (Internal) — links back to the admin portal

function tierFor(lastGradeCompleted: string): "elementary" | "high_school" | null {
  if (!lastGradeCompleted || lastGradeCompleted === "none") return null;
  return ["8", "9", "10", "11"].includes(lastGradeCompleted) ? "high_school" : "elementary";
}

function gradeLabel(lastGradeCompleted: string): string {
  const map: Record<string, string> = {
    none: "None — entering Kindergarten", k: "Kindergarten",
    "1": "1st Grade", "2": "2nd Grade", "3": "3rd Grade", "4": "4th Grade",
    "5": "5th Grade", "6": "6th Grade", "7": "7th Grade", "8": "8th Grade",
    "9": "9th Grade", "10": "10th Grade", "11": "11th Grade",
  };
  return map[lastGradeCompleted] ?? lastGradeCompleted;
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Stripe's top-level Subscription.current_period_end is empty on accounts
// using flexible billing mode — the real value lives on each subscription
// item instead. Check both, top-level first (still correct on older-style
// accounts), falling back to the first item's period end.
function periodEndFromSubscription(subscription: Stripe.Subscription): string | null {
  const topLevel = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const itemLevel = (subscription.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const raw = topLevel || itemLevel;
  return raw ? new Date(raw * 1000).toISOString() : null;
}

Deno.serve(async (req: Request) => {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (!signature) {
    return new Response("Invalid signature", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const activeMode = await readPaymentMode(admin);
  const candidates = webhookVerificationCandidates(activeMode, readEdgePaymentEnv());
  if (candidates.length === 0) {
    console.error("[stripe-webhook] Stripe webhook not configured yet");
    return new Response("Stripe webhook not configured yet", { status: 503 });
  }

  let event: Stripe.Event | null = null;
  let stripe: Stripe | null = null;
  let matchedMode: "test" | "live" | null = null;
  let lastError: unknown = null;

  for (const candidate of candidates) {
    const verifier = new Stripe(candidate.secretKey ?? "sk_test_webhook_verify_only", {
      apiVersion: "2024-12-18.acacia",
    });
    try {
      event = await verifier.webhooks.constructEventAsync(rawBody, signature, candidate.webhookSecret);
      matchedMode = candidate.mode;
      if (candidate.secretKey) stripe = verifier;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!event || !matchedMode) {
    console.error("Webhook signature verification failed", lastError);
    return new Response("Invalid signature", { status: 400 });
  }

  if (!stripe) {
    console.error(`[stripe-webhook] Stripe secret key missing for verified event mode ${matchedMode}`);
    return new Response("Stripe secret key missing for verified event mode", { status: 500 });
  }

  console.log(`[stripe-webhook] verified ${event.type} ${event.id} as ${matchedMode}`);

  const { error: insertEventError } = await admin
    .from("stripe_webhook_events")
    .insert({ stripe_event_id: event.id, event_type: event.type });
  if (insertEventError) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  const ghlApiKey = Deno.env.get("GHL_API_KEY_MCA");
  const ghlLocationId = Deno.env.get("GHL_LOCATION_ID_MCA");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  async function sendEmail(to: string, subject: string, html: string) {
    if (!resendApiKey || !to) {
      console.error("Skipping email send — no RESEND_API_KEY or no recipient", to);
      return;
    }
    await sendResendEmail({ to, subject, html });
  }

  async function ghlFetch(path: string, body: unknown) {
    if (!ghlApiKey || !ghlLocationId) return null;
    const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghlApiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`GHL ${path} failed`, res.status, await res.text());
      return null;
    }
    return res.json();
  }

  // Adds one or more tags to an existing GHL contact. We only ever add —
  // never remove — tags from here; see the file-level comment for why.
  async function addGhlTag(contactId: string, tag: string) {
    if (!ghlApiKey || !contactId) return;
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghlApiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: [tag] }),
    });
    if (!res.ok) {
      console.error(`GHL tag add (${tag}) failed`, res.status, await res.text());
    }
  }

  // Contacts specifically need duplicate-handling: this GHL location rejects
  // a second Contact with an email that already exists (400, with the
  // existing contact's ID conveniently included in the error body). A
  // repeat-enrolling parent hits this every time. Without handling it, the
  // generic ghlFetch above would just log-and-swallow, ghlContactId would be
  // null, and this student's Opportunity would silently never get created —
  // confirmed via a live test against this exact GHL location.
  // Existing contacts don't get their customFields applied by the
  // create-or-find POST below (that request fails with a duplicate-email
  // error and we just extract the existing ID from it) — so a returning
  // family enrolling a second student under a new checkout never picked up
  // the new student in "Students Information" without this explicit update.
  async function ghlUpdateContact(contactId: string, body: unknown) {
    if (!ghlApiKey || !contactId) return;
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ghlApiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("GHL contact update failed", res.status, await res.text());
    }
  }

  async function ghlCreateOrFindContact(body: unknown): Promise<string | null> {
    if (!ghlApiKey || !ghlLocationId) return null;
    const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghlApiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return data?.contact?.id ?? null;
    }

    const errorBody = await res.json().catch(() => null);
    const existingContactId: string | null = errorBody?.meta?.contactId ?? null;
    if (existingContactId) {
      console.log("GHL contact already exists for this email, reusing", existingContactId);
      return existingContactId;
    }

    console.error("GHL /contacts/ failed", res.status, JSON.stringify(errorBody));
    return null;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = (session.metadata ?? {}) as Record<string, string>;

        // ---- Comp-to-paid conversion branch (existing enrollment, no new rows) ----
        if (metadata.conversion_of_enrollment_id) {
          const enrollmentId = metadata.conversion_of_enrollment_id;

          const { data: enrollment } = await admin
            .from("enrollments")
            .select("id, student_id, family_id, tuition_tier, frequency")
            .eq("id", enrollmentId)
            .maybeSingle();

          if (!enrollment) {
            console.error("Comp conversion: enrollment not found", enrollmentId);
            break;
          }

          const frequency = metadata.frequency || enrollment.frequency;

          const [fullSubscription, planRes] = await Promise.all([
            stripe.subscriptions.retrieve(session.subscription as string),
            admin
              .from("subscription_plans")
              .select("stripe_price_id, price")
              .eq("tuition_tier", enrollment.tuition_tier)
              .eq("frequency", frequency)
              .maybeSingle(),
          ]);
          const periodEnd = periodEndFromSubscription(fullSubscription);
          const plan = planRes.data;

          await admin
            .from("enrollments")
            .update({
              is_comp: false,
              frequency,
              stripe_price_id: plan?.stripe_price_id ?? null,
              stripe_subscription_id: session.subscription as string,
              stripe_subscription_status: "active",
              current_period_end: periodEnd,
              price: plan?.price ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", enrollment.id);

          await admin
            .from("families")
            .update({ stripe_customer_id: session.customer as string })
            .eq("id", enrollment.family_id);

          const [{ data: family }, { data: student }] = await Promise.all([
            admin.from("families").select("email, parent_name, ghl_contact_id").eq("id", enrollment.family_id).single(),
            admin.from("students").select("student_name").eq("id", enrollment.student_id).single(),
          ]);

          if (family?.ghl_contact_id) {
            await addGhlTag(family.ghl_contact_id, "converted-to-paid");
          }

          if (family?.email) {
            const paymentEmail = await renderTemplate(admin, "payment_setup_confirmed", {
              student_name: student?.student_name ?? "your student",
              frequency,
              price: plan?.price != null ? String(plan.price) : "",
              price_suffix: plan?.price != null ? ` ($${plan.price})` : "",
              portal_url: PORTAL_LOGIN_URL,
            }, {
              subject: "Payment is now set up for {{student_name}}",
              html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
                  <h2>Payment Set Up</h2>
                  <p>Thanks! {{student_name}}'s enrollment is now on a paid {{frequency}} plan{{price_suffix}}. Nothing else changes — same student record, same Parent Portal access.</p>
                  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
                </div>`,
            });
            await sendEmail(family.email, paymentEmail.subject, paymentEmail.html);
          }

          break;
        }

        // ---- Store order branch (one-time payment, separate from enrollment) ----
        if (metadata.order_type === "store") {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
            expand: ["data.price.product"],
            limit: 100,
          });

          const addressFull = metadata.fulfillment === "ship"
            ? `${metadata.address_street}, ${metadata.address_city}, ${metadata.address_state} ${metadata.address_zip}`
            : null;

          let shippingFeeAmount: number | null = null;
          const orderItemsToInsert: { item_id: string; quantity: number; unit_price_at_order: number }[] = [];
          const emailLineItems: { name: string; quantity: number }[] = [];

          for (const li of lineItems.data) {
            const product = li.price?.product as Stripe.Product | undefined;
            const itemId = product?.metadata?.item_id;
            const quantity = li.quantity ?? 1;
            const unitAmount = (li.price?.unit_amount ?? 0) / 100;

            if (itemId) {
              orderItemsToInsert.push({ item_id: itemId, quantity, unit_price_at_order: unitAmount });
              emailLineItems.push({ name: product?.name ?? "Item", quantity });
            } else if (isStoreShippingLine(product?.name) || isStoreShippingLine(product?.description)) {
              // No item_id in product metadata — this is the shipping line item.
              shippingFeeAmount = unitAmount * quantity;
            }
          }

          // Every store buyer becomes a GHL contact (create-or-find by email,
          // same dedup behavior as enrollment), tagged store-order-placed —
          // this tag is a persistent "has bought from the store" label, not a
          // reset-per-event one, so unlike the other tags here it's fine (and
          // intended) for it to stay on repeat buyers without re-tagging.
          const storeGhlContactId = await ghlCreateOrFindContact({
            locationId: ghlLocationId,
            firstName: metadata.customer_first_name,
            lastName: metadata.customer_last_name,
            email: metadata.customer_email,
            phone: metadata.customer_phone,
            ...(metadata.fulfillment === "ship"
              ? {
                  address1: metadata.address_street,
                  city: metadata.address_city,
                  state: metadata.address_state,
                  postalCode: metadata.address_zip,
                }
              : {}),
          });
          if (storeGhlContactId) {
            await addGhlTag(storeGhlContactId, "store-order-placed");
          }

          const { data: order, error: orderError } = await admin
            .from("orders")
            .insert({
              source: "web",
              status: "submitted",
              payment_status: "paid",
              shipping_address: addressFull,
              shipping_fee: shippingFeeAmount,
              total: (session.amount_total ?? 0) / 100,
              customer_name: `${metadata.customer_first_name ?? ""} ${metadata.customer_last_name ?? ""}`.trim(),
              customer_email: metadata.customer_email ?? "",
              customer_phone: metadata.customer_phone ?? "",
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: (session.payment_intent as string) ?? null,
              ghl_contact_id: storeGhlContactId,
            })
            .select()
            .single();

          if (orderError) throw orderError;

          const { data: locationRow } = await admin
            .from("locations")
            .select("id")
            .eq("active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          const orderItemRows: Array<{
            order_id: string;
            item_id: string;
            quantity: number;
            unit_price_at_order: number;
            backordered: boolean;
          }> = [];
          for (const oi of orderItemsToInsert) {
            let backordered = false;
            if (locationRow) {
              const { data: levelRow } = await admin
                .from("inventory_levels")
                .select("id, quantity_on_hand")
                .eq("item_id", oi.item_id)
                .eq("location_id", locationRow.id)
                .maybeSingle();
              if (levelRow) {
                backordered = Number(levelRow.quantity_on_hand) < oi.quantity;
                await admin
                  .from("inventory_levels")
                  .update({
                    quantity_on_hand: levelRow.quantity_on_hand - oi.quantity,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", levelRow.id);
              }
            }
            orderItemRows.push({ ...oi, order_id: order.id, backordered });
          }

          if (orderItemRows.length > 0) {
            const { error: orderItemsError } = await admin
              .from("order_items")
              .insert(orderItemRows);
            if (orderItemsError) throw orderItemsError;
            if (metadata.customer_email) {
              const { data: familyRows } = await admin
                .from("families")
                .select("id")
                .ilike("email", metadata.customer_email);
              const familyIds = (familyRows ?? []).map((row) => row.id as string);
              if (familyIds.length > 0) {
                const { data: studentRows } = await admin
                  .from("students")
                  .select("id")
                  .in("family_id", familyIds);
                const studentIds = (studentRows ?? []).map((row) => row.id as string);
                if (studentIds.length > 0) {
                  await admin
                    .from("resource_book_notices")
                    .update({ purchased_order_id: order.id })
                    .in("student_id", studentIds)
                    .in("item_id", orderItemRows.map((row) => row.item_id))
                    .is("purchased_order_id", null);
                }
              }
            }
          }

          if (shippingFeeAmount != null) {
            const { data: shippingFeeRow } = await admin
              .from("fees")
              .select("id")
              .eq("name", "Store Order Shipping")
              .maybeSingle();

            if (shippingFeeRow) {
              await admin.from("order_fees").insert({
                order_id: order.id,
                fee_id: shippingFeeRow.id,
                price_at_order: shippingFeeAmount,
              });
            }
          }

          const itemsHtml = `<ul>${emailLineItems
            .map((li) => `<li>${escapeHtml(li.name)} × ${li.quantity}</li>`)
            .join("")}</ul>`;
          const fulfillmentLine = addressFull
            ? `Shipping to: ${addressFull}`
            : "Local pickup";
          const orderEmail = await renderTemplate(admin, "store_order_confirmed", {
            order_items: itemsHtml,
            fulfillment_line: fulfillmentLine,
            order_total: ((session.amount_total ?? 0) / 100).toFixed(2),
          }, {
            subject: "Your Midwest Christian Academy order is confirmed",
            html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
                <h2>Order Confirmed</h2>
                <p>Thank you for your order! Here's a summary:</p>
                {{order_items}}
                <p>{{fulfillment_line}}</p>
                <p><strong>Total: ${"$"}{{order_total}}</strong></p>
                <p>We'll get this prepared and reach out with any questions. Call us at (844) 663-4477 if you need anything.</p>
              </div>`,
          });
          await sendEmail(metadata.customer_email, orderEmail.subject, orderEmail.html);

          break;
        }

        // ---- Enrollment branch (subscription checkout) ----
        const students = parseStudentsFromMetadata(metadata);
        const addressFull = metadata.parent_address_full ?? "";

        // Fetch the full subscription once so we can stamp current_period_end
        // on each enrollment row immediately at creation, instead of leaving
        // it null until the first renewal/cancellation event happens to fire.
        const fullSubscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const initialPeriodEnd = periodEndFromSubscription(fullSubscription);

        // Reuse an existing family if this Stripe customer already has one —
        // create-enrollment-checkout already reuses the same Stripe Customer
        // by email, so a returning parent enrolling a second student later
        // should attach to their existing family record instead of getting a
        // duplicate one.
        const { data: existingFamily, error: existingFamilyError } = await admin
          .from("families")
          .select("id")
          .eq("stripe_customer_id", session.customer as string)
          .maybeSingle();

        if (existingFamilyError) throw existingFamilyError;

        let family: { id: string };
        let isReturningFamily = false;

        if (existingFamily) {
          family = existingFamily;
          isReturningFamily = true;
        } else {
          const { data: newFamily, error: familyError } = await admin
            .from("families")
            .insert({
              parent_name: `${metadata.parent_first_name ?? ""} ${metadata.parent_last_name ?? ""}`.trim(),
              second_parent_name: metadata.parent_second_name || null,
              email: metadata.parent_email ?? "",
              phone: metadata.parent_phone ?? "",
              address: addressFull,
              address_street: metadata.parent_address_street ?? null,
              address_city: metadata.parent_address_city ?? null,
              address_state: metadata.parent_address_state ?? null,
              address_zip: metadata.parent_address_zip ?? null,
              report_token: crypto.randomUUID(),
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
            })
            .select()
            .single();

          if (familyError) throw familyError;
          family = newFamily;
        }

        const studentsInfoText = students.map((s, i) =>
          `Student ${i + 1}: ${s.firstName} ${s.lastName} | Gender: ${s.gender || "n/a"} | Birthdate: ${s.birthdate || "n/a"} | Last Grade Completed: ${gradeLabel(s.lastGradeCompleted)}`
        ).join("\n");

        // Contact push (parent) — one-way, marketing/communication only.
        // Reuses an existing GHL contact for this email if one already exists
        // (repeat-enrolling family) instead of erroring and silently skipping
        // every downstream Opportunity for this checkout.
        const ghlContactId = await ghlCreateOrFindContact({
          locationId: ghlLocationId,
          firstName: metadata.parent_first_name,
          lastName: metadata.parent_last_name,
          email: metadata.parent_email,
          phone: metadata.parent_phone,
          address1: metadata.parent_address_street,
          city: metadata.parent_address_city,
          state: metadata.parent_address_state,
          postalCode: metadata.parent_address_zip,
          customFields: [
            { id: GHL_CONTACT_FIELD_STUDENTS_INFO, field_value: studentsInfoText },
          ],
        });

        if (ghlContactId && !isReturningFamily) {
          await admin.from("families").update({ ghl_contact_id: ghlContactId }).eq("id", family.id);
        }

        const emailEnrollmentSummary: { studentName: string; tier: string; price: number | null }[] = [];

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
          if (!tier) {
            emailEnrollmentSummary.push({ studentName: `${s.firstName} ${s.lastName}`, tier: "Kindergarten", price: null });
            if (ghlContactId) {
              await addGhlTag(ghlContactId, "kindergarten-enrolled");
            }
            continue; // Kindergarten route — no tuition enrollment row, no Opportunity.
          }

          const { data: plan } = await admin
            .from("subscription_plans")
            .select("stripe_price_id, price")
            .eq("tuition_tier", tier)
            .eq("frequency", metadata.payment_plan)
            .maybeSingle();

          const { data: enrollmentRow, error: enrollmentError } = await admin
            .from("enrollments")
            .insert({
              family_id: family.id,
              student_id: studentRow.id,
              tuition_tier: tier,
              stripe_price_id: plan?.stripe_price_id ?? null,
              stripe_subscription_id: session.subscription as string,
              stripe_subscription_status: "active",
              current_period_end: initialPeriodEnd,
              frequency: metadata.payment_plan,
              price: plan?.price ?? null,
            })
            .select()
            .single();

          if (enrollmentError) throw enrollmentError;

          emailEnrollmentSummary.push({
            studentName: `${s.firstName} ${s.lastName}`,
            tier: tier === "high_school" ? "High School" : "Elementary",
            price: plan?.price ?? null,
          });

          if (ghlContactId) {
            const ghlOpportunity = await ghlFetch("/opportunities/", {
              pipelineId: GHL_ENROLLMENT_PIPELINE_ID,
              locationId: ghlLocationId,
              pipelineStageId: GHL_STAGE_NEW_ENROLLMENT,
              name: `${s.firstName} ${s.lastName} — ${tier === "high_school" ? "High School" : "Elementary"} (${metadata.payment_plan})`,
              status: "open",
              contactId: ghlContactId,
              monetaryValue: plan?.price ?? 0,
              customFields: [
                { id: GHL_OPP_FIELD_STUDENT_FIRST_NAME, field_value: s.firstName },
                { id: GHL_OPP_FIELD_STUDENT_LAST_NAME, field_value: s.lastName },
                { id: GHL_OPP_FIELD_STUDENT_GENDER, field_value: s.gender },
                { id: GHL_OPP_FIELD_STUDENT_BIRTHDATE, field_value: s.birthdate },
                { id: GHL_OPP_FIELD_TUITION_TIER, field_value: tier === "high_school" ? "High School" : "Elementary" },
                { id: GHL_OPP_FIELD_PAYMENT_PLAN, field_value: metadata.payment_plan === "annual" ? "Annual" : "Monthly" },
                { id: GHL_OPP_FIELD_STRIPE_SUBSCRIPTION_ID, field_value: session.subscription as string },
                { id: GHL_OPP_FIELD_ENROLLMENT_ID, field_value: enrollmentRow.id },
              ],
            });

            const ghlOpportunityId: string | null = ghlOpportunity?.opportunity?.id ?? null;
            if (ghlOpportunityId) {
              await admin
                .from("enrollments")
                .update({ ghl_opportunity_id: ghlOpportunityId })
                .eq("id", enrollmentRow.id);
            }
          }
        }

        // Rebuild "Students Information" from the family's FULL roster in
        // our own database, not just the students in this checkout — the
        // only way it stays correct across more than one enrollment event
        // for the same family (e.g. a second student enrolled later).
        if (ghlContactId) {
          const { data: allStudents } = await admin
            .from("students")
            .select("student_name, gender, birthdate, last_grade_completed")
            .eq("family_id", family.id)
            .order("created_at");

          const fullStudentsInfoText = (allStudents ?? [])
            .map((s, i) =>
              `Student ${i + 1}: ${s.student_name} | Gender: ${s.gender || "n/a"} | Birthdate: ${s.birthdate || "n/a"} | Last Grade Completed: ${gradeLabel(s.last_grade_completed || "")}`
            )
            .join("\n");

          await ghlUpdateContact(ghlContactId, {
            customFields: [
              { id: GHL_CONTACT_FIELD_STUDENTS_INFO, field_value: fullStudentsInfoText },
            ],
          });
        }

        const summaryHtml = `<ul>${emailEnrollmentSummary
          .map((s) => `<li>${escapeHtml(s.studentName)} — ${escapeHtml(s.tier)}${s.price != null ? ` ($${s.price}/${metadata.payment_plan})` : ""}</li>`)
          .join("")}</ul>`;
        const welcomeKey = isReturningFamily ? "enrollment_added_paid" : "welcome_paid";
        const welcomeEmail = await renderTemplate(admin, welcomeKey, {
          student_list: summaryHtml,
          portal_url: PORTAL_LOGIN_URL,
        }, {
          subject: isReturningFamily
            ? "Your new enrollment with Midwest Christian Academy is confirmed"
            : "Welcome to Midwest Christian Academy!",
          html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
              <h2>${isReturningFamily ? "Enrollment Added" : "Enrollment Confirmed"}</h2>
              <p>Thank you for enrolling with Midwest Christian Academy. Here's a summary:</p>
              {{student_list}}
              <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
              <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
            </div>`,
        });
        await sendEmail(metadata.parent_email, welcomeEmail.subject, welcomeEmail.html);

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        // Look up affected enrollments directly by subscription ID rather
        // than going through a family's single stripe_subscription_id column
        // — a family can have more than one subscription (e.g. a second
        // student enrolled later), and this must only touch the enrollments
        // that actually belong to the subscription that just changed.
        const { data: enrollmentRows } = await admin
          .from("enrollments")
          .select("id")
          .eq("stripe_subscription_id", subscription.id);

        if (enrollmentRows && enrollmentRows.length > 0) {
          const updatePayload: Record<string, unknown> = {
            stripe_subscription_status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_end: periodEndFromSubscription(subscription),
            updated_at: new Date().toISOString(),
          };

          // "the enrollment shows active until the period genuinely ends, then
          // the webhook flips it to withdrawn automatically" — that's this event
          // specifically, not .updated (which fires even when cancel_at_period_end
          // just got set to true but the subscription is still active).
          if (event.type === "customer.subscription.deleted") {
            updatePayload.status = "withdrawn";
          }

          await admin
            .from("enrollments")
            .update(updatePayload)
            .in("id", enrollmentRows.map((e) => e.id));
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const { data: enrollmentRows } = await admin
            .from("enrollments")
            .select("id, family_id")
            .eq("stripe_subscription_id", invoice.subscription as string);

          if (enrollmentRows && enrollmentRows.length > 0) {
            await admin
              .from("enrollments")
              .update({ stripe_subscription_status: "past_due", updated_at: new Date().toISOString() })
              .in("id", enrollmentRows.map((e) => e.id));

            const familyId = enrollmentRows[0].family_id;
            const { data: family } = await admin
              .from("families")
              .select("ghl_contact_id")
              .eq("id", familyId)
              .maybeSingle();

            if (family?.ghl_contact_id) {
              await addGhlTag(family.ghl_contact_id, "payment-failed");
            }
          }
        }
        break;
      }

      default:
        break;
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook handler error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
