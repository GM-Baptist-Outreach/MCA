-- Midwest Christian Academy — Supabase Schema
-- Last updated: July 17, 2026
-- Notes: subject/item confirmation gates (is_confirmed) exist because David has not
-- yet cleared the full non-core item list. Nothing shows client-facing until active = true.
-- Open, not yet answered by David: pickup vs. shipping, multi-child/returning-family discounts,
-- sales tax handling. Schema below leaves room for all three without a restructure.

-- ============================================================
-- FAMILIES: one row per household, holds contact info
-- ============================================================
create table families (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid references auth.users(id),  -- links to Supabase Auth for the parent portal magic-code login
    parent_name text not null,
    second_parent_name text,                 -- optional
    email text not null,
    phone text not null,
    address text,                            -- shipping address, confirmed default is shipping not pickup
    report_token text unique,                -- powers the pre-populated grade-reporting link, generated once per family
    stripe_customer_id text,
    stripe_subscription_id text,             -- one subscription per family, confirmed: one payment frequency covers all students in the family
    ghl_contact_id text,                     -- one-way sync: pushed at enrollment for marketing/communication, not kept in real-time sync with billing
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- STUDENTS: one row per child, linked to a family
-- Supports multi-kid households and multi-year re-enrollment
-- ============================================================
create table students (
    id uuid primary key default gen_random_uuid(),
    family_id uuid references families(id) not null,
    student_name text not null,
    gender text,
    birthdate date,
    last_grade_completed text,               -- drives tuition tier (1-8 vs 9-12) and Kindergarten-routes-to-store branch
    created_at timestamptz not null default now()
);

-- ============================================================
-- SUBJECTS: canonical list of course subjects
-- ============================================================
create table subjects (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,               -- e.g. "Math", "Physical Science"
    category text,                           -- "Core", "Elective", "One-off" — bucketing for non-core items
    grade_band text,                         -- "Elementary" / "Junior High" / "High School", once known
    is_confirmed boolean not null default false,   -- David's sign-off gate
    active boolean not null default false,         -- controls client-facing visibility
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- ITEMS: every individual orderable thing — PACE, Key, DVD, or other
-- ============================================================
create table items (
    id uuid primary key default gen_random_uuid(),
    subject_id uuid references subjects(id) not null,
    sku text not null unique,                -- stable, human-readable id (e.g. "MATH-109-PACE")
                                              -- generated once, used for price sheet export/reupload matching
    item_type text not null check (item_type in ('pace','key','dvd','other')),
    pace_number int,                         -- for individual PACE or DVD items
    range_start int,                         -- for Key items covering a range of PACE numbers
    range_end int,
    grade_level int,                         -- computed as ceil(pace_number / 12), David confirmed 1-12 = grade 1,
                                              -- 13-24 = grade 2, etc. Treated as a working assumption pending
                                              -- a call to confirm exceptions, editable per item if a subject
                                              -- doesn't follow the clean pattern.
    publisher text,                          -- from prefix noise (AO:, ILS:, RR:), just denotes publisher, not a gate
    dvd_required boolean,                    -- null = not yet determined, David sending breakdown separately
    original_name text not null,             -- raw name from the inventory file, kept for traceability
    sales_price numeric(10,2) not null,
    purchase_price numeric(10,2),            -- internal cost, admin-only visibility, never shown client-side
    price_source text not null default 'import' check (price_source in ('import','manual')),
    price_locked boolean not null default false,  -- true = protect from being overwritten by a bulk re-import
    is_featured boolean not null default false,   -- flags bestsellers like Successful Living, Nutrition Science
    active boolean not null default false,
    is_confirmed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- LOCATIONS: supports multi-location inventory from day one
-- ============================================================
create table locations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    address text,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

-- ============================================================
-- INVENTORY LEVELS: quantity on hand per item, per location
-- ============================================================
create table inventory_levels (
    id uuid primary key default gen_random_uuid(),
    item_id uuid references items(id) not null,
    location_id uuid references locations(id) not null,
    quantity_on_hand int not null default 0,
    quantity_as_of date,
    updated_at timestamptz not null default now(),
    unique (item_id, location_id)
);

-- ============================================================
-- FEES: tuition, registration, and other charges not tied to a subject
-- ============================================================
create table fees (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,               -- "Annual Elementary Tuition", "Registration", etc.
    price numeric(10,2) not null,
    frequency text not null check (frequency in ('annual','quarterly','one_time')),
    active boolean not null default true,
    updated_at timestamptz not null default now()
);

-- ============================================================
-- SUBSCRIPTION PLANS: the four tuition rates, kept separate from the
-- individual-item catalog on purpose. David edits price here through
-- the admin portal, never touches Stripe's dashboard directly. A backend
-- process (Edge Function) syncs any price change here to a real Stripe
-- Price object, so Stripe reporting stays clean (one stable Price ID per
-- plan) without anyone manually creating Products in Stripe.
-- ============================================================
create table subscription_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,               -- "Elementary Annual", "Elementary Monthly", "High School Annual", "High School Monthly"
    tuition_tier text not null check (tuition_tier in ('elementary','high_school')),
    frequency text not null check (frequency in ('annual','monthly')),  -- quarterly retired going forward, confirmed by David
    price numeric(10,2) not null,
    stripe_price_id text,                    -- kept in sync automatically when price changes here
    active boolean not null default true,
    updated_at timestamptz not null default now()
);

-- ============================================================
-- PROGRAMS: how an order gets categorized for sales/inventory reporting
-- Placeholder values, real list to be confirmed with David
-- ============================================================
create table programs (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,               -- e.g. "Full Curriculum", "Single Subject", "Summer Program"
    active boolean not null default true,
    created_at timestamptz not null default now()
);

-- ============================================================
-- ENROLLMENTS: the primary revenue path — tuition/payment plan,
-- curriculum prescribed later off diagnostic results, not chosen by parent
-- ============================================================
create table enrollments (
    id uuid primary key default gen_random_uuid(),
    family_id uuid references families(id) not null,
    student_id uuid references students(id) not null,
    tuition_tier text not null check (tuition_tier in ('elementary','high_school')),  -- grade 1-8 vs 9-12; Kindergarten routes to the store instead, not this table
    stripe_price_id text,                    -- current Stripe Price object, kept in sync with subscription_plans
    stripe_subscription_status text,         -- synced via Stripe webhook: active, past_due, canceled, unpaid, trialing. This is payment health, separate from the status field below.
    cancel_at_period_end boolean not null default false,  -- set true when admin cancels; stays active until the period genuinely ends, no proration/refund
    current_period_end timestamptz,          -- synced via webhook, drives when a scheduled cancellation actually takes effect
    registration_paid boolean not null default false,
    diagnostic_status text not null default 'not_scheduled'
        check (diagnostic_status in ('not_scheduled','scheduled','completed')),  -- confirmed: enroll + pay first, diagnostic sent/scheduled after
    status text not null default 'active' check (status in ('active','withdrawn','graduated')),  -- internal enrollment lifecycle, set by staff/admin action, not by Stripe
    school_year text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
-- NOTE: payment frequency (annual/monthly) and shipping now live at the family level (families.stripe_subscription_id,
-- families.address), since one frequency covers the whole family per a single subscription. Quarterly is dropped from
-- this iteration's four confirmed plans (elementary/high-school x annual/monthly) — flagged to confirm this is
-- intentional and not just an omission.

-- NOTE: Kindergarten does not enroll in tuition, it's a one-time kit purchase (no grade tracking).
-- Kindergarten students route through the ORDERS table (workbook/kit path) below, not enrollments.

-- ============================================================
-- SCORE REPORTS: parent self-grades a PACE and sends a photo of the score.
-- Bridge only, ACE's system stays the official record.
-- ============================================================
create table score_reports (
    id uuid primary key default gen_random_uuid(),
    student_id uuid references students(id) not null,
    subject_id uuid references subjects(id) not null,
    pace_number int not null,
    score text,                              -- stored as text since it may be a raw score or letter grade
    photo_urls text[] not null,              -- one entry per page photographed, Supabase Storage references
    ghl_opportunity_id text,                 -- the opportunity card created in GHL when this submission comes in
    entered_into_ace boolean not null default false,  -- staff toggles once keyed into ACE's system
    reported_at timestamptz not null default now()
);

-- ============================================================
-- ORDERS: secondary path — a la carte workbook purchases (independent
-- families not enrolling, or other schools buying wholesale)
-- ============================================================
create table orders (
    id uuid primary key default gen_random_uuid(),
    family_id uuid references families(id) not null,
    student_id uuid references students(id) not null,
    program_id uuid references programs(id),
    location_id uuid references locations(id),
    school_year text,                        -- e.g. "2026-2027", for renewal tracking over time
    source text not null default 'web' check (source in ('web','internal','auto_generated')),
    status text not null default 'submitted'
        check (status in ('submitted','confirmed','fulfilled','cancelled')),
    payment_status text not null default 'pending'
        check (payment_status in ('pending','invoiced','paid','refunded')),
    shipping_address text,
    shipping_fee numeric(10,2),               -- amount still pending from David; confirmed shipping is the default, not pickup
    total numeric(10,2) not null,
    created_at timestamptz not null default now()
);

-- ============================================================
-- ORDER ITEMS: each book/key/dvd chosen for a given order
-- ============================================================
create table order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references orders(id) not null,
    item_id uuid references items(id) not null,
    quantity int not null default 1,
    unit_price_at_order numeric(10,2) not null,    -- locks price at time of order
    key_requested boolean not null default false,  -- parent's explicit yes/no on the answer key
    created_at timestamptz not null default now()
);

-- ============================================================
-- ORDER FEES: tuition/registration/etc attached to a specific order
-- ============================================================
create table order_fees (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references orders(id) not null,
    fee_id uuid references fees(id) not null,
    price_at_order numeric(10,2) not null,
    created_at timestamptz not null default now()
);

-- ============================================================
-- ADMIN USERS: dashboard access, tied to Supabase Auth (not a shared password)
-- ============================================================
create table admin_users (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid references auth.users(id) not null unique,
    name text,                               -- descriptive label only, no permission tiers. Anyone in this table has full access.
    created_at timestamptz not null default now()
);

-- ============================================================
-- STRIPE WEBHOOK EVENTS: raw event log for idempotency (don't process
-- the same event twice) and debugging when a sync doesn't behave as expected
-- ============================================================
create table stripe_webhook_events (
    id uuid primary key default gen_random_uuid(),
    stripe_event_id text not null unique,
    event_type text not null,
    processed_at timestamptz not null default now()
);

-- ============================================================
-- SUBSCRIPTION CHANGE LOG: tracks a family/student moving between plans,
-- distinct from price_change_log (which tracks a plan's price changing).
-- Covers admin-initiated changes and the quarterly-to-monthly migration.
-- ============================================================
create table subscription_change_log (
    id uuid primary key default gen_random_uuid(),
    enrollment_id uuid references enrollments(id) not null,
    old_plan_id uuid references subscription_plans(id),
    new_plan_id uuid references subscription_plans(id) not null,
    changed_by uuid references admin_users(id),
    proration_applied boolean not null default false,  -- confirmed default policy: no proration
    changed_at timestamptz not null default now()
);

-- ============================================================
-- PRICE CHANGE LOG: audit trail — who changed what price, when, and how
-- ============================================================
create table price_change_log (
    id uuid primary key default gen_random_uuid(),
    item_id uuid references items(id),
    fee_id uuid references fees(id),
    subscription_plan_id uuid references subscription_plans(id),
    changed_by uuid references admin_users(id),
    change_source text not null default 'manual' check (change_source in ('manual','csv_import','stripe_sync')),
    old_price numeric(10,2),
    new_price numeric(10,2),
    changed_at timestamptz not null default now()
);

-- ============================================================
-- PRICE IMPORT BATCHES: tracks each price sheet re-upload
-- Protects against silently overwriting manually corrected prices
-- ============================================================
create table price_import_batches (
    id uuid primary key default gen_random_uuid(),
    imported_by uuid references admin_users(id),
    file_name text,
    rows_updated int not null default 0,
    rows_skipped_locked int not null default 0,   -- count of items skipped due to price_locked = true
    imported_at timestamptz not null default now()
);

-- ============================================================
-- RECOMMENDED INDEXES for sales/inventory reporting
-- (what's selling, by subject, item type, program, school year)
-- ============================================================
create index idx_order_items_item_id on order_items(item_id);
create index idx_orders_program_id on orders(program_id);
create index idx_orders_school_year on orders(school_year);
create index idx_items_subject_id on items(subject_id);
