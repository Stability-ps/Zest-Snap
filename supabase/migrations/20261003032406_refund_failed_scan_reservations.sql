-- Recorded from production (version 20261003032406) on 2026-10-04.
create or replace function public.finish_scan(
  p_request uuid,
  p_status text,
  p_pages integer,
  p_input integer,
  p_output integer,
  p_cost numeric
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request public.scan_requests;
  period date;
begin
  if p_status not in ('completed','failed')
     or p_pages < 0
     or p_input < 0
     or p_output < 0
     or coalesce(p_cost, 0) < 0 then
    raise exception 'invalid_result';
  end if;

  update public.scan_requests
     set status = p_status,
         input_tokens = p_input,
         output_tokens = p_output,
         estimated_cost_usd = p_cost
   where id = p_request
     and status = 'reserved'
  returning * into request;

  if not found then
    return;
  end if;

  period := date_trunc('month', request.created_at at time zone 'UTC')::date;

  if p_status = 'failed' then
    update public.usage_monthly
       set ai_scans = greatest(ai_scans - 1, 0)
     where user_id = request.user_id
       and period_start = period;
    return;
  end if;

  update public.usage_monthly
     set pdf_pages = pdf_pages + p_pages,
         estimated_cost_usd = estimated_cost_usd + coalesce(p_cost, 0)
   where user_id = request.user_id
     and period_start = period;
end;
$$;

revoke all on function public.finish_scan(uuid,text,integer,integer,integer,numeric)
from public, anon, authenticated;
grant execute on function public.finish_scan(uuid,text,integer,integer,integer,numeric)
to service_role;
