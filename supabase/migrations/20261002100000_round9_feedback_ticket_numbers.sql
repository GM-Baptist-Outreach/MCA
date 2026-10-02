-- Round 9 (MCA_R9_TICKETS): six-digit ticket numbers for admin feedback.
-- Additive. Numbers are gapless and race-safe: a BEFORE INSERT trigger bumps a
-- one-row counter inside the same transaction as the insert. The counter row
-- lock serializes concurrent inserts, and a failed insert rolls the counter
-- back with it (a plain sequence would leave gaps).

create table if not exists public.admin_feedback_ticket_counter (
  id boolean primary key default true check (id),
  last_value bigint not null default 0
);
alter table public.admin_feedback_ticket_counter enable row level security;
-- No policies: only the service role and the trigger touch it.
insert into public.admin_feedback_ticket_counter (id, last_value) values (true, 0)
on conflict (id) do nothing;

alter table public.admin_feedback add column if not exists ticket_number bigint;
alter table public.admin_feedback add column if not exists confirmation_status text;
alter table public.admin_feedback add column if not exists confirmation_resend_id text;
alter table public.admin_feedback add column if not exists confirmation_error text;

-- Renumber existing feedback in created order (000001, 000002, ...).
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.admin_feedback
)
update public.admin_feedback f
set ticket_number = o.rn
from ordered o
where o.id = f.id;

update public.admin_feedback_ticket_counter
set last_value = (select coalesce(max(ticket_number), 0) from public.admin_feedback)
where id;

create or replace function public.admin_feedback_assign_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.admin_feedback_ticket_counter
  set last_value = last_value + 1
  where id
  returning last_value into new.ticket_number;
  if new.ticket_number is null then
    raise exception 'admin_feedback_ticket_counter row is missing';
  end if;
  return new;
end;
$$;
revoke all on function public.admin_feedback_assign_ticket() from public, anon, authenticated;

drop trigger if exists admin_feedback_ticket on public.admin_feedback;
create trigger admin_feedback_ticket
before insert on public.admin_feedback
for each row execute function public.admin_feedback_assign_ticket();

alter table public.admin_feedback alter column ticket_number set not null;
create unique index if not exists admin_feedback_ticket_number_key on public.admin_feedback (ticket_number);
