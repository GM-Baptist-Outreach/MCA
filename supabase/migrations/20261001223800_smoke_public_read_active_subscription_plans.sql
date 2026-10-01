-- The public Enroll page reads live tuition prices; without this it always shows the hardcoded fallback.
create policy public_read_active_subscription_plans on public.subscription_plans
  for select to anon, authenticated
  using (active = true);
