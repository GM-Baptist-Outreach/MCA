-- Re-issue a failed PACE. Admin only, via public.is_admin().
-- One transaction: keep the failed score in the slot notes, issue the slot
-- again, mark the matching pace_status row issued, and decrement one stock
-- row by 1 when a stock row exists (quantity may go negative).

create or replace function public.mca_reissue_pace(slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  slot public.student_pace_slots%rowtype;
  note_line text;
  stock_id uuid;
begin
  if coalesce(public.is_admin(), false) is not true then
    raise exception 'Admin only';
  end if;

  select *
  into slot
  from public.student_pace_slots
  where id = slot_id
  for update;

  if not found then
    raise exception 'PACE slot not found';
  end if;

  if slot.status is distinct from 'failed' then
    raise exception 'Only a failed PACE can be re-issued';
  end if;

  note_line := format(
    'Failed score %s on %s. Re-issued %s.',
    coalesce(slot.score::text, 'none'),
    coalesce(to_char(slot.completed_at, 'YYYY-MM-DD'), 'unknown date'),
    to_char(timezone('utc', now()), 'YYYY-MM-DD')
  );

  update public.student_pace_slots
  set
    notes = concat_ws(E'\n', nullif(btrim(notes), ''), note_line),
    status = 'issued',
    score = null,
    completed_at = null,
    issued_at = (timezone('utc', now()))::date,
    updated_at = now()
  where id = slot.id;

  if slot.item_id is not null then
    update public.pace_status
    set
      status = 'issued',
      status_date = (timezone('utc', now()))::date,
      updated_at = now()
    where student_id = slot.student_id
      and item_id = slot.item_id;

    select il.id
    into stock_id
    from public.inventory_levels il
    where il.item_id = slot.item_id
    order by il.quantity_on_hand desc, il.updated_at desc
    limit 1;

    if stock_id is not null then
      update public.inventory_levels
      set
        quantity_on_hand = quantity_on_hand - 1,
        updated_at = now()
      where id = stock_id;
    end if;
  end if;
end;
$$;

revoke all on function public.mca_reissue_pace(uuid) from public, anon;
grant execute on function public.mca_reissue_pace(uuid) to authenticated;

comment on function public.mca_reissue_pace(uuid) is
  'Admin-only re-issue of a failed PACE slot. Appends the failed score to notes, sets the slot and pace_status to issued, and decrements one inventory row.';
