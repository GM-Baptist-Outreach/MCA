-- Single payment mode for Stripe and Shippo, read on each Edge request.
-- Default live so production stays on the current (legacy) keys until an
-- admin flips it. Keys themselves stay in Edge secrets:
--   STRIPE_SECRET_KEY_LIVE / STRIPE_WEBHOOK_SECRET_LIVE
--   STRIPE_SECRET_KEY_TEST / STRIPE_WEBHOOK_SECRET_TEST
--   SHIPPO_API_KEY_LIVE / SHIPPO_API_KEY_TEST
-- Legacy STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and SHIPPO_API_KEY are live.

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

revoke all on table public.app_settings from public, anon;
grant select, insert, update, delete on table public.app_settings to authenticated;
grant all on table public.app_settings to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_settings'
      and policyname = 'admin_full_access'
  ) then
    create policy admin_full_access on public.app_settings
      for all to authenticated
      using (is_admin())
      with check (is_admin());
  end if;
end $$;

create or replace function public.app_settings_validate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.key = 'payment_mode' and new.value not in ('test', 'live') then
    raise exception 'payment_mode must be test or live';
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists app_settings_validate on public.app_settings;
create trigger app_settings_validate
  before insert or update on public.app_settings
  for each row execute function public.app_settings_validate();

revoke all on function public.app_settings_validate() from public, anon, authenticated;

insert into public.app_settings (key, value)
values ('payment_mode', 'live')
on conflict (key) do nothing;
