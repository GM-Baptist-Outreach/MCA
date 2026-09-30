-- Editable parent emails. Seeded with the current wording, plus the portal
-- login link on the welcome emails. Reset copies default_subject/default_body_html
-- back over the editable columns.

create table if not exists public.email_templates (
  key text primary key,
  name text not null,
  description text,
  subject text not null,
  body_html text not null,
  enabled boolean not null default true,
  variables jsonb not null default '[]'::jsonb,
  default_subject text not null,
  default_body_html text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;
grant select, insert, update, delete on public.email_templates to authenticated;
grant all on public.email_templates to service_role;

drop policy if exists admin_full_access on public.email_templates;
create policy admin_full_access on public.email_templates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.email_templates (
  key, name, description, subject, body_html, enabled, variables, default_subject, default_body_html
) values
(
  'welcome_paid',
  'Welcome (paid enrollment)',
  'Sent when a new family''s paid enrollment checkout completes.',
  'Welcome to Midwest Christian Academy!',
  $body_welcome_paid$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Confirmed</h2>
  <p>Thank you for enrolling with Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_welcome_paid$,
  true,
  jsonb_build_array('student_list', 'portal_url', 'parent_first_name'),
  'Welcome to Midwest Christian Academy!',
  $body_welcome_paid$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Confirmed</h2>
  <p>Thank you for enrolling with Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_welcome_paid$
),
(
  'enrollment_added_paid',
  'Enrollment added (paid)',
  'Sent when a returning family adds a paid enrollment.',
  'Your new enrollment with Midwest Christian Academy is confirmed',
  $body_enrollment_added_paid$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Added</h2>
  <p>Thank you for enrolling with Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_enrollment_added_paid$,
  true,
  jsonb_build_array('student_list', 'portal_url', 'parent_first_name'),
  'Your new enrollment with Midwest Christian Academy is confirmed',
  $body_enrollment_added_paid$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Added</h2>
  <p>Thank you for enrolling with Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_enrollment_added_paid$
),
(
  'welcome_comp',
  'Welcome (comp enrollment)',
  'Sent when an admin enrolls a new family without payment.',
  'Welcome to Midwest Christian Academy!',
  $body_welcome_comp$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Confirmed</h2>
  <p>Thank you for joining Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_welcome_comp$,
  true,
  jsonb_build_array('student_list', 'portal_url', 'parent_first_name'),
  'Welcome to Midwest Christian Academy!',
  $body_welcome_comp$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Confirmed</h2>
  <p>Thank you for joining Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_welcome_comp$
),
(
  'enrollment_added_comp',
  'Enrollment added (comp)',
  'Sent when an admin adds a comp enrollment to an existing family.',
  'A new enrollment has been added to your account',
  $body_enrollment_added_comp$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Added</h2>
  <p>Thank you for joining Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_enrollment_added_comp$,
  true,
  jsonb_build_array('student_list', 'portal_url', 'parent_first_name'),
  'A new enrollment has been added to your account',
  $body_enrollment_added_comp$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Enrollment Added</h2>
  <p>Thank you for joining Midwest Christian Academy. Here's a summary:</p>
  {{student_list}}
  <p>Sign in to the Parent Portal any time: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_enrollment_added_comp$
),
(
  'payment_link',
  'Payment link',
  'Sent when an admin converts a comp enrollment to paid.',
  'Set up payment for {{student_name}}''s enrollment',
  $body_payment_link$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Time to set up payment</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>{{student_name}}'s enrollment is ready to move to a paid plan - {{frequency}}, ${{price}}. Everything else stays exactly the same: their student record, your Parent Portal access, all of it. You just need to add a payment method.</p>
  <p><a href="{{checkout_url}}" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">Set Up Payment</a></p>
  <p>Questions? Call us at (844) 663-4477 or reach out at david@midwestchristianacademy.com.</p>
</div>$body_payment_link$,
  true,
  jsonb_build_array('parent_first_name', 'student_name', 'frequency', 'price', 'checkout_url', 'portal_url'),
  'Set up payment for {{student_name}}''s enrollment',
  $body_payment_link$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Time to set up payment</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>{{student_name}}'s enrollment is ready to move to a paid plan - {{frequency}}, ${{price}}. Everything else stays exactly the same: their student record, your Parent Portal access, all of it. You just need to add a payment method.</p>
  <p><a href="{{checkout_url}}" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">Set Up Payment</a></p>
  <p>Questions? Call us at (844) 663-4477 or reach out at david@midwestchristianacademy.com.</p>
</div>$body_payment_link$
),
(
  'payment_setup_confirmed',
  'Payment setup confirmed',
  'Sent when a comp-to-paid checkout completes.',
  'Payment is now set up for {{student_name}}',
  $body_payment_setup_confirmed$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Payment Set Up</h2>
  <p>Thanks! {{student_name}}'s enrollment is now on a paid {{frequency}} plan{{price_suffix}}. Nothing else changes — same student record, same Parent Portal access.</p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_payment_setup_confirmed$,
  true,
  jsonb_build_array('student_name', 'frequency', 'price', 'price_suffix', 'portal_url'),
  'Payment is now set up for {{student_name}}',
  $body_payment_setup_confirmed$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Payment Set Up</h2>
  <p>Thanks! {{student_name}}'s enrollment is now on a paid {{frequency}} plan{{price_suffix}}. Nothing else changes — same student record, same Parent Portal access.</p>
  <p>If you have any questions, reach out to david@midwestchristianacademy.com or call (844) 663-4477.</p>
</div>$body_payment_setup_confirmed$
),
(
  'store_order_confirmed',
  'Store order confirmed',
  'Sent when a store checkout completes.',
  'Your Midwest Christian Academy order is confirmed',
  $body_store_order_confirmed$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Order Confirmed</h2>
  <p>Thank you for your order! Here's a summary:</p>
  {{order_items}}
  <p>{{fulfillment_line}}</p>
  <p><strong>Total: ${{order_total}}</strong></p>
  <p>We'll get this prepared and reach out with any questions. Call us at (844) 663-4477 if you need anything.</p>
</div>$body_store_order_confirmed$,
  true,
  jsonb_build_array('order_items', 'fulfillment_line', 'order_total', 'store_url'),
  'Your Midwest Christian Academy order is confirmed',
  $body_store_order_confirmed$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Order Confirmed</h2>
  <p>Thank you for your order! Here's a summary:</p>
  {{order_items}}
  <p>{{fulfillment_line}}</p>
  <p><strong>Total: ${{order_total}}</strong></p>
  <p>We'll get this prepared and reach out with any questions. Call us at (844) 663-4477 if you need anything.</p>
</div>$body_store_order_confirmed$
),
(
  'scores_needed_reminder',
  'Scores needed',
  'Sent when a pick list is paused for missing scores.',
  'Scores needed before the next PACE shipment for {{student_name}}',
  $body_scores_needed_reminder$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Hello,</p>
  <p>Before MCA can ship the next PACEs for {{student_name}}, we need scores for these already-issued PACEs:</p>
  {{missing_scores}}
  <p>Please submit them in the parent portal (Upload Tests) or call us at (844) 663-4477.</p>
  <p>ACE remains the official grade record. This reminder is only about the shipment.</p>
  <p>Midwest Christian Academy</p>
</div>$body_scores_needed_reminder$,
  true,
  jsonb_build_array('student_name', 'missing_scores', 'portal_url'),
  'Scores needed before the next PACE shipment for {{student_name}}',
  $body_scores_needed_reminder$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Hello,</p>
  <p>Before MCA can ship the next PACEs for {{student_name}}, we need scores for these already-issued PACEs:</p>
  {{missing_scores}}
  <p>Please submit them in the parent portal (Upload Tests) or call us at (844) 663-4477.</p>
  <p>ACE remains the official grade record. This reminder is only about the shipment.</p>
  <p>Midwest Christian Academy</p>
</div>$body_scores_needed_reminder$
),
(
  'resource_book_needed',
  'Books needed',
  'Sent when upcoming PACEs need resource books that are not on the pick list.',
  'Books needed for {{student_name}}',
  $body_resource_book_needed$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Your student will need these books for upcoming PACEs:</p>
  {{book_list}}
  <p><a href="{{store_url}}">Buy in the MCA store</a></p>
</div>$body_resource_book_needed$,
  true,
  jsonb_build_array('student_name', 'book_list', 'store_url'),
  'Books needed for {{student_name}}',
  $body_resource_book_needed$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Your student will need these books for upcoming PACEs:</p>
  {{book_list}}
  <p><a href="{{store_url}}">Buy in the MCA store</a></p>
</div>$body_resource_book_needed$
)
on conflict (key) do nothing;

comment on table public.email_templates is
  'Parent email copy. Supabase Auth magic-link templates stay in the Supabase dashboard, not here.';
