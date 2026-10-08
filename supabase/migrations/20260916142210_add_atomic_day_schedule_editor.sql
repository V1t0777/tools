
create or replace function public.replace_day_schedule(
  p_date date,
  p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_date is null then
    raise exception 'date is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  delete from public.schedule_assignments
  where work_date = p_date;

  insert into public.schedule_assignments(
    work_date,
    duty_type_id,
    staff_id,
    time_slot,
    note
  )
  select
    p_date,
    (item->>'duty_type_id')::bigint,
    (item->>'staff_id')::uuid,
    coalesce(nullif(item->>'time_slot',''), '未标注'),
    nullif(item->>'note','')
  from jsonb_array_elements(p_items) as item;
end;
$$;

revoke all on function public.replace_day_schedule(date,jsonb) from public;
revoke all on function public.replace_day_schedule(date,jsonb) from anon;
grant execute on function public.replace_day_schedule(date,jsonb) to authenticated;
