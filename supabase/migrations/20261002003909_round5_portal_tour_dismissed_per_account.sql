-- Portal welcome tour: remember dismissal per parent account (not just per browser).
-- The parent's families row gets tour_dismissed_at. Parents already have the
-- parent_update_own_family RLS policy (auth_user_id = auth.uid()), and the
-- guard_family_parent_update trigger limits which columns a parent may change;
-- tour_dismissed_at is added to that allowlist so a parent can set it on their
-- own row only. Admins are unaffected.

alter table public.families
  add column if not exists tour_dismissed_at timestamptz;

comment on column public.families.tour_dismissed_at is
  'When this parent account dismissed the portal welcome tour. NULL = show the tour on next portal load.';

create or replace function public.guard_family_parent_update()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  allowed text[] := array['parent_name','second_parent_name','phone','address',
                          'address_street','address_city','address_state','address_zip',
                          'updated_at','tour_dismissed_at'];
begin
  if current_user not in ('anon', 'authenticated') or coalesce(public.is_admin(), false) then
    return new;
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Only MCA staff can change these family account fields.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_family_parent_update() from public, anon, authenticated;
