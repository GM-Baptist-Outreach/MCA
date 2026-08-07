insert into subscription_plans (name, tuition_tier, frequency, price, stripe_price_id, active) values
  ('Elementary Annual', 'elementary', 'annual', 1100.00, null, true),
  ('Elementary Monthly', 'elementary', 'monthly', 99.00, null, true),
  ('High School Annual', 'high_school', 'annual', 1175.00, null, true),
  ('High School Monthly', 'high_school', 'monthly', 109.00, null, true)
on conflict (name) do nothing;
