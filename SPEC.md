# Midwest Christian Academy — Build Spec

**Last updated:** August 7, 2026
**Status:** Planning / documentation only. No Supabase project or Stripe keys are wired up in this repo yet.

This document consolidates the client-facing planning conversation into a single spec to drive implementation in follow-up sessions. It is organized for reference during build, not in the original narrative order.

---

## 1. Client

**Midwest Christian Academy LLC (MCA)** — a homeschool curriculum company using the A.C.E. system. **Not a church.** No pastor, no worship content, no doctrinal statement anywhere on the site.

- Contact: David Moore, owner/president
- Phone: (844) 663-4477
- Email: David@midwestchristianacademy.com
- Address: 2300 NW 32nd Street, Newcastle, OK 73065
- Office hours: Monday–Thursday, 8:00 AM–4:30 PM
- Domain: midwestchristianacademy.com
- Social: Facebook and Instagram (Midwest Christian Academy)

**Audience:** A parent already homeschooling, or considering it, who wants confidence the curriculum will hold up (accreditation, college acceptance, structure). MCA is the guide — three generations of one family who've lived this themselves — not a corporate edtech vendor.

**Brand:** Logo is a navy and gold compass rose with an open book, "MIDWEST CHRISTIAN ACADEMY" wordmark, tagline "Accredited Homeschool Services." Palette: navy primary, warm gold/tan accent, white/off-white background, soft gray secondary. Compass/book motif should recur as a visual element throughout, not just sit static in the header.

---

## 2. Site pages (built, mostly done)

Homepage, Our Story, Our Approach, Enroll, Free Curriculum Guide opt-in, Contact.

> The Free Curriculum Guide asset itself (guide or explainer video) does not exist yet — a dependency blocking that CTA from delivering anything, still outstanding.

---

## 3. Business model

Enrollment/tuition is the primary revenue path — almost all profit comes from tuition; margin on individual workbooks is minimal. Individual workbook/PACE purchases are a real but secondary path (Priority 3), for independent families or other schools buying wholesale.

**Four flat subscription plans, no per-subject pricing:**

| Plan | Grades | Annual | Monthly |
|---|---|---|---|
| Elementary | 1–8 | $1,100 | $99 |
| High School | 9–12 | $1,175 | $109 |

- No quarterly option going forward (retired, confirmed by David).
- One payment frequency covers the whole family (not mixed per student) — this also avoids Stripe's one-interval-per-subscription limit.
- **Kindergarten does not use tuition at all.** It routes to the Priority 3 store as a one-time kit purchase (no grade tracking at that level).
- No multi-child or returning-family discounts.
- Sales tax: confirmed non-issue in Oklahoma.
- Shipping is the default fulfillment method ("pretty much everything is shipped"), not pickup.
- Restocking Fee and Service Fee are not real standalone charges — already included elsewhere. Mark inactive rather than priced.
- Existing quarterly-plan families moving to monthly: no proration, no refund. Handled by simply re-running them through the same enrollment flow onto the new plan — not a special migration feature.

---

## 4. Priority build order

### Priority 1 — Enrollment + Stripe subscription

- Parent record: name, optional second parent, phone, email.
- Dynamically-added students: name, gender, birthdate, last grade completed.
- Four pre-created Stripe **Price objects** (not dynamic `price_data`), kept in sync automatically from the `subscription_plans` table whenever David edits a price in the admin portal — he should never touch Stripe's dashboard directly.
- Checkout bundles one line item per student against the correct existing Price ID.
- Enrolled parents are also pushed to GHL as a contact (one-way, at enrollment, for marketing/SMS/email and an eventual review-request flow). **Not real-time synced to billing — GHL is not the source of truth for payments.**

### Priority 2 — Parent portal

- Supabase Auth passwordless email one-time-code login, no password.
- Parent sees their name and their students; read-only on plan/subscription info; can self-edit their own contact info.
- Core form: grade-report submission — student (dropdown), subject, PACE number, test score, and multiple photos (one per test page, stored as an array).
- On submit: creates a GHL opportunity card and notifies staff.
- ACE's own system stays the actual record keeper — this portal is a bridge only.

### Priority 3 — Full inventory/pricing catalog + one-off store

- Rebuilds on the schema already scoped (subjects, items, fees), using David's product/price file.
- Lives only in Supabase, never modeled in GHL.
- Searchable by category, cart-style, custom one-time Stripe Checkout.
- Captures purchaser info and shipping address; notifies staff what sold and where it's going.
- Answer-key selection is explicit per item here (enrolled students get keys as part of what's prescribed, not a purchase decision).

### Not yet re-scoped — needs reconfirming

The **diagnostic-email-to-pick-list automation** (ACE sends a diagnostic result, system auto-builds a fulfillment kit) was scoped in detail earlier but has not been explicitly placed into Priority 1–3. Technical groundwork is already confirmed (see §5) but its place in the build order is an open question.

---

## 5. Diagnostic/prescription technical findings (confirmed, ready whenever this gets built)

- **PACE numbering:** ACE's official numbers are David's internal inventory numbers plus 1000 exactly (`internal = ace_number - 1000`), confirmed against a real diagnostic report and David's actual inventory file.
- **Grade formula:** `grade = ceil(internal_pace_number / 12)`, confirmed as a working assumption against the same real example. David flagged full prescription logic as genuinely technical with real exceptions — treat this formula as a good starting point, **not** fully authoritative.
- **Diagnostic email format**, confirmed from a real example:
  - Sender always `noreply@aceschooloftomorrow.com`
  - Subject always `"A.C.E. [Subject] Diagnostic Report"`
  - Body is a plain labeled-field email: Name, Test Date, Began Testing at PACE, Last PACE Tested, Passed PACEs, Failed PACEs, Learning Gap PACEs, and a Performance Level sentence naming the exact next PACE to advance from.
  - Genuinely parseable, not a hard problem.
- Because MCA creates each student's ACE account (confirmed: manual process for now — staff creates it and relays login to parent), MCA also receives a copy of the diagnostic result, not just the parent.

**Unresolved fork:** does tuition cover kit contents with zero separate invoice (matches what's already been told to parents), or are contents sometimes itemized separately? If fully covered, kit-building is a pure parsing/formatting problem needing no price catalog. If not, that's the trigger point for standing up pricing logic around it.

**Unresolved matching problem:** a parsed diagnostic email needs to map to the correct enrolled student. Matching on name alone is unreliable — proposed fix is a unique identifying alias/address used when MCA creates each ACE account, so the inbound result identifies the student automatically.

**Unresolved operational question:** does MCA ship a full year's remaining PACEs at once from a diagnostic result, or in smaller batches through the year?

---

## 6. Architecture

One stack per client, repeatable pattern: dedicated GitHub repo, dedicated Supabase project, both living under the org of whichever business owns the client relationship (not a new standalone org per client). AI Studio for the frontend (not git-connected, driven by prompts). n8n for automation. Claude Code for real repo/schema/Edge Function work.

**MCA specifics:**
- GitHub repo: `GM-Baptist-Outreach/MCA` (created — this repo).
- Supabase project "Midwest Christian Academy," confirmed live under the GM Baptist Outreach org (not a standalone org), empty and ready.
- Supabase's native GitHub integration should be connected (auto-deploys migrations/Edge Functions on push, no manual reupload).
- Standalone "Midwest Christian Academy-GMBO" org can be deleted once confirmed empty.

**Payment platform:** Stripe for the enrollment subscriptions specifically (confirmed by David). GHL's role is narrow and one-directional: parent-facing communication only, never the source of truth for payment or subscription state. The diagnostic-parsing pick list content never touches GHL at all — only a form-submission event in Priority 2 legitimately creates a GHL opportunity card.

---

## 7. Security model — required before build, not optional

**Row-level security, three tiers:**

1. **Public / anon** — insert-only (enrollment form, order form, opt-ins). No read access to anyone's data. Enrollment/order writes should go through a secured Edge Function that validates input and creates the Stripe object first, so **there's never a database row without a real Stripe object behind it.**
2. **Authenticated parent** (`families.auth_user_id`) — read-only on their own family/students/enrollment/subscription info. Can insert their own students' score reports. Can self-edit their own contact info (parent name, second parent name, email, phone, address).
3. **Admin** (`admin_users`) — full read/write on everything. No role tiers, no staff/admin split — anyone in this table can do anything.

**Stripe webhook required:** a listener updating `enrollments.stripe_subscription_status`, `cancel_at_period_end`, and `current_period_end` whenever Stripe reports a payment failure, cancellation, or renewal. Without it, the admin dashboard only ever reflects what was true at signup, not today.

**Subscription changes:** no proration, ever — standing rule for admin-initiated plan changes and the quarterly-to-monthly migration alike.

**Cancellation:** cancel at period end. One admin action; the enrollment shows active until the period genuinely ends, then the webhook flips it to withdrawn automatically. No refunds, no partial-period logic.

---

## 8. Operational setup — not yet done

- Stripe test-mode keys for the whole build; live keys only right before real families use it.
- Real email provider (SendGrid/Postmark/Resend) connected for Supabase Auth's magic-code emails, not the default sender.
- Supabase Storage access policy for score-report photos (parent can only write to their own folder).
- GHL API credentials for the MCA-specific contact push, separate from GMBO's own.
- Admin portal URL: `/admin` plus a random string suffix as a soft deterrent (real security is still the login itself, not the obscure path).

---

## 9. Schema

Full detail lives in the companion file **`MCA-Supabase-Schema.sql`** (19 tables).

See **`MCA-Supabase-Schema.sql`** at the repo root for the full column-level detail, constraints, and inline notes.

Table inventory (from planning discussion, names only):

- `families`
- `students`
- `subscription_plans`
- `subjects`
- `items`
- `locations` + `inventory_levels` (dormant, not tracking stock)
- `fees`
- `programs`
- `enrollments`
- `score_reports`
- `orders` + `order_items` + `order_fees` (Priority 3 path)
- `admin_users`
- `stripe_webhook_events`
- `subscription_change_log`
- `price_change_log`
- `price_import_batches`

---

## 10. Still open — not blocking, but needs an answer eventually

- Whether keys auto-include for enrolled students or staff hand-pick per student (not answered).
- Real program category names for sales reporting (not answered).
- Adding or dropping a student mid-year (currently a one-time enrollment event, no defined update path).
- Whether a parent can ever change their own plan through the portal, or that's admin-only.
- Actual shipping fee amount for the Priority 3 store.
- Where the diagnostic-to-pick-list automation lands in the Priority 1–3 build order.
