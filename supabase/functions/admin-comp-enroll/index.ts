import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Admin-only. Enrolls a family with NO Stripe checkout at all - a
// scholarship, a staff family, a pilot spot, whatever the reason. It
// mirrors the family/student/enrollment creation that checkout.session.completed
// does in stripe-webhook (same tier logic, same "Kindergarten gets a
// student row but no enrollment row" rule, same GHL contact/opportunity
// push, same confirmation email) so a comp enrollment shows up everywhere
// a paid one would - EXCEPT it never touches Stripe, and every enrollment
// row it creates is stamped is_comp = true with a required comp_reason, so
// it can never be mistaken for real revenue in a list, a report, or GHL.
//
// Family matching is by email (case-insensitive) rather than
// stripe_customer_id, since there's no Stripe customer here - comp
// families are looked up/reused the same way a returning paid family is,
// just keyed differently.
//
// Source pulled from deployed v5 into the repo on 2026-09-30. Parent-facing
// contact is david@midwestchristianacademy.com, and replies go to David.

const GHL_ENROLLMENT_PIPELINE_ID = "NuTKV11562lhb6EYckXp";
const GHL_STAGE_NEW_ENROLLMENT = "358c5f58-93b8-43da-b547-b809273e664b";
const GHL_CONTACT_FIELD_STUDENTS_INFO = "f0C2O1oIzoFliT0jlrv8";
const GHL_OPP_FIELD_STUDENT_FIRST_NAME = "STgt9LEYDHBypPsEbN0Q";
const GHL_OPP_FIELD_STUDENT_LAST_NAME = "YzTxc3Yec6P7z9R1Wvb5";
const GHL_OPP_FIELD_STUDENT_GENDER = "WwRsgVbIJSJFInKOGICT";
const GHL_OPP_FIELD_STUDENT_BIRTHDATE = "e0jvXTJSt2BpxfueuCxT";
const GHL_OPP_FIELD_TUITION_TIER = "jGT3VSQNSFDgcpE4Uv6A";
const GHL_OPP_FIELD_PAYMENT_PLAN = "u9d6ZZsIM2lmFKc7HAh3";

const COMP_REASONS = ["financial_hardship", "staff_family", "scholarship", "pilot", "other"];

const MCA_FROM_EMAIL = "Midwest Christian Academy <admin@mcahomeschool.com>";
const MCA_REPLY_TO_EMAIL = "david@midwestchristianacademy.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function tierFor(lastGradeCompleted: string): "elementary" | "high_school" | null {
  if (!lastGradeCompleted || lastGradeCompleted === "none") return null;
  return ["8", "9", "10", "11"].includes(lastGradeCompleted) ? "high_school" : "elementary";
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await callerClient.rpc("is_admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { parent, paymentPlan, students, compReason } = body ?? {};

    if (
      !parent?.email || !parent?.firstName || !parent?.lastName || !parent?.phone
    ) {
      return new Response(JSON.stringify({ error: "Missing required parent information" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (paymentPlan !== "annual" && paymentPlan !== "monthly") {
      return new Response(JSON.stringify({ error: "Invalid payment plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(students) || students.length === 0) {
      return new Response(JSON.stringify({ error: "At least one student is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!compReason || !COMP_REASONS.includes(compReason)) {
      return new Response(JSON.stringify({ error: "A valid comp reason is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const addressFull = parent.addressStreet
      ? `${parent.addressStreet}, ${parent.addressCity}, ${parent.addressState} ${parent.addressZip}`
      : "";

    const { data: existingFamily, error: existingFamilyError } = await admin
      .from("families")
      .select("id, ghl_contact_id")
      .ilike("email", parent.email)
      .maybeSingle();

    if (existingFamilyError) throw existingFamilyError;

    let family: { id: string; ghl_contact_id: string | null };
    let isReturningFamily = false;

    if (existingFamily) {
      family = existingFamily;
      isReturningFamily = true;
    } else {
      const { data: newFamily, error: familyError } = await admin
        .from("families")
        .insert({
          parent_name: `${parent.firstName} ${parent.lastName}`.trim(),
          second_parent_name: parent.secondParentName || null,
          email: parent.email,
          phone: parent.phone,
          address: addressFull || null,
          address_street: parent.addressStreet || null,
          address_city: parent.addressCity || null,
          address_state: parent.addressState || null,
          address_zip: parent.addressZip || null,
          report_token: crypto.randomUUID(),
        })
        .select("id, ghl_contact_id")
        .single();

      if (familyError) throw familyError;
      family = newFamily;
    }

    const ghlApiKey = Deno.env.get("GHL_API_KEY_MCA");
    const ghlLocationId = Deno.env.get("GHL_LOCATION_ID_MCA");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

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

    // Existing contacts don't get their customFields applied by the
    // create-or-find POST below (that request fails with a duplicate-email
    // error and we just extract the existing ID from it) - so a second
    // enrollment under a returning family's contact never picked up the
    // new student in "Students Information" without this explicit update.
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

    async function ghlCreateOrFindContact(reqBody: unknown): Promise<string | null> {
      if (!ghlApiKey || !ghlLocationId) return null;
      const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghlApiKey}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody),
      });

      if (res.ok) {
        const data = await res.json();
        return data?.contact?.id ?? null;
      }

      const errorBody = await res.json().catch(() => null);
      const existingContactId: string | null = errorBody?.meta?.contactId ?? null;
      if (existingContactId) return existingContactId;

      console.error("GHL /contacts/ failed", res.status, JSON.stringify(errorBody));
      return null;
    }

    async function sendEmail(to: string, subject: string, html: string) {
      if (!resendApiKey || !to) return;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: MCA_FROM_EMAIL,
          reply_to: MCA_REPLY_TO_EMAIL,
          to: [to],
          subject,
          html,
        }),
      });
      if (!res.ok) {
        console.error("Resend send failed", res.status, await res.text());
      }
    }

    const studentsInfoText = students.map((s: any, i: number) =>
      `Student ${i + 1}: ${s.firstName} ${s.lastName} | Gender: ${s.gender || "n/a"} | Birthdate: ${s.birthdate || "n/a"} | Last Grade Completed: ${s.lastGradeCompleted || "n/a"}`
    ).join("\n");

    const ghlContactId = await ghlCreateOrFindContact({
      locationId: ghlLocationId,
      firstName: parent.firstName,
      lastName: parent.lastName,
      email: parent.email,
      phone: parent.phone,
      ...(parent.addressStreet
        ? {
            address1: parent.addressStreet,
            city: parent.addressCity,
            state: parent.addressState,
            postalCode: parent.addressZip,
          }
        : {}),
      customFields: [
        { id: GHL_CONTACT_FIELD_STUDENTS_INFO, field_value: studentsInfoText },
      ],
    });

    if (ghlContactId && !family.ghl_contact_id) {
      await admin.from("families").update({ ghl_contact_id: ghlContactId }).eq("id", family.id);
    }
    if (ghlContactId) {
      await addGhlTag(ghlContactId, "comp-enrollment");
    }

    const createdStudents: { id: string; name: string; tier: string | null }[] = [];

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
        createdStudents.push({ id: studentRow.id, name: studentRow.student_name, tier: null });
        if (ghlContactId) await addGhlTag(ghlContactId, "kindergarten-enrolled");
        continue;
      }

      const { data: enrollmentRow, error: enrollmentError } = await admin
        .from("enrollments")
        .insert({
          family_id: family.id,
          student_id: studentRow.id,
          tuition_tier: tier,
          frequency: paymentPlan,
          price: 0,
          status: "active",
          is_comp: true,
          comp_reason: compReason,
        })
        .select()
        .single();

      if (enrollmentError) throw enrollmentError;

      createdStudents.push({ id: studentRow.id, name: studentRow.student_name, tier });

      if (ghlContactId) {
        const ghlOpportunity = await ghlFetch("/opportunities/", {
          pipelineId: GHL_ENROLLMENT_PIPELINE_ID,
          locationId: ghlLocationId,
          pipelineStageId: GHL_STAGE_NEW_ENROLLMENT,
          name: `${s.firstName} ${s.lastName} - ${tier === "high_school" ? "High School" : "Elementary"} (Comp - ${compReason.replaceAll("_", " ")})`,
          status: "open",
          contactId: ghlContactId,
          monetaryValue: 0,
          customFields: [
            { id: GHL_OPP_FIELD_STUDENT_FIRST_NAME, field_value: s.firstName },
            { id: GHL_OPP_FIELD_STUDENT_LAST_NAME, field_value: s.lastName },
            { id: GHL_OPP_FIELD_STUDENT_GENDER, field_value: s.gender },
            { id: GHL_OPP_FIELD_STUDENT_BIRTHDATE, field_value: s.birthdate },
            { id: GHL_OPP_FIELD_TUITION_TIER, field_value: tier === "high_school" ? "High School" : "Elementary" },
            { id: GHL_OPP_FIELD_PAYMENT_PLAN, field_value: paymentPlan === "annual" ? "Annual" : "Monthly" },
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

    // Rebuild "Students Information" from the family's FULL roster in our
    // own database, not just the students in this request - the only way
    // it stays correct across more than one enrollment event for the same
    // family (comp or paid).
    if (ghlContactId) {
      const { data: allStudents } = await admin
        .from("students")
        .select("student_name, gender, birthdate, last_grade_completed")
        .eq("family_id", family.id)
        .order("created_at");

      const fullStudentsInfoText = (allStudents ?? [])
        .map((s, i) =>
          `Student ${i + 1}: ${s.student_name} | Gender: ${s.gender || "n/a"} | Birthdate: ${s.birthdate || "n/a"} | Last Grade Completed: ${s.last_grade_completed || "n/a"}`
        )
        .join("\n");

      await ghlUpdateContact(ghlContactId, {
        customFields: [
          { id: GHL_CONTACT_FIELD_STUDENTS_INFO, field_value: fullStudentsInfoText },
        ],
      });
    }

    const summaryHtml = createdStudents
      .map((s) => `<li>${escapeHtml(s.name)}${s.tier ? ` - ${s.tier === "high_school" ? "High School" : "Elementary"}` : " - Kindergarten"}</li>`)
      .join("");
    await sendEmail(
      parent.email,
      isReturningFamily ? "A new enrollment has been added to your account" : "Welcome to Midwest Christian Academy!",
      `
        <div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
          <h2>${isReturningFamily ? "Enrollment Added" : "Enrollment Confirmed"}</h2>
          <p>Thank you for joining Midwest Christian Academy. Here's a summary:</p>
          <ul>${summaryHtml}</ul>
          <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
        </div>
      `
    );

    return new Response(
      JSON.stringify({ success: true, family_id: family.id, students: createdStudents }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
