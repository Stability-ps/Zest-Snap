-- Recorded verbatim from production (version 20261003032602) on 2026-10-04. Currently unused by the app.
create or replace function public.complete_scan(
  p_request uuid,
  p_file_name text,
  p_mime_type text,
  p_document_type text,
  p_summary text,
  p_payload jsonb,
  p_warning_count integer,
  p_model text,
  p_input integer,
  p_output integer,
  p_cost numeric,
  p_pages integer
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request public.scan_requests;
  period date;
begin
  if p_pages < 0
     or p_input < 0
     or p_output < 0
     or coalesce(p_cost, 0) < 0
     or p_warning_count < 0 then
    raise exception 'invalid_result';
  end if;

  select *
    into request
    from public.scan_requests
   where id = p_request
     and status = 'reserved'
   for update;

  if not found then
    raise exception 'reservation_unavailable';
  end if;

  insert into public.scans (
    id,
    user_id,
    file_name,
    mime_type,
    document_type,
    summary,
    status,
    warning_count,
    model,
    input_tokens,
    output_tokens,
    estimated_cost_usd,
    payload,
    created_at,
    completed_at
  ) values (
    p_request,
    request.user_id,
    p_file_name,
    p_mime_type,
    p_document_type,
    p_summary,
    'review',
    p_warning_count,
    p_model,
    p_input,
    p_output,
    p_cost,
    p_payload,
    request.created_at,
    now()
  );

  update public.scan_requests
     set status = 'completed',
         input_tokens = p_input,
         output_tokens = p_output,
         estimated_cost_usd = p_cost
   where id = p_request;

  period := date_trunc('month', request.created_at at time zone 'UTC')::date;

  update public.usage_monthly
     set pdf_pages = pdf_pages + p_pages,
         estimated_cost_usd = estimated_cost_usd + coalesce(p_cost, 0)
   where user_id = request.user_id
     and period_start = period;

  perform public.award_milestone(request.user_id, 'first_scan');
  perform public.qualify_referral(request.user_id);
end;
$$;

revoke all on function public.complete_scan(
  uuid,text,text,text,text,jsonb,integer,text,integer,integer,numeric,integer
) from public, anon, authenticated;
grant execute on function public.complete_scan(
  uuid,text,text,text,text,jsonb,integer,text,integer,integer,numeric,integer
) to service_role;
