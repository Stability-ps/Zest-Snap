-- Recorded from production (version 20261003040228) on 2026-10-04.
create or replace function private.create_referral_code() returns text
language plpgsql security definer set search_path=''
as $$
declare code text;
begin
 if auth.uid() is null or not exists(select 1 from public.feature_flags where key='referrals' and enabled) then raise exception 'referrals_disabled'; end if;
 insert into public.referral_invites(user_id,code) values(auth.uid(),replace(gen_random_uuid()::text,'-','')) on conflict(user_id) do nothing;
 select i.code into code from public.referral_invites i where user_id=auth.uid();
 return code;
end $$;
revoke all on function private.create_referral_code() from public,anon;
grant execute on function private.create_referral_code() to authenticated;

create or replace function private.claim_referral_code(p_code text) returns void
language plpgsql security definer set search_path=''
as $$
declare sender uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.feature_flags where key='referrals' and enabled) then raise exception 'referrals_disabled'; end if;
 select user_id into sender from public.referral_invites where code=p_code;
 if sender is null or sender=auth.uid() then raise exception 'invalid_referral'; end if;
 if exists(select 1 from public.scan_requests where user_id=auth.uid()) then raise exception 'existing_account_activity'; end if;
 insert into public.referrals(referrer_id,referred_user_id,referral_code,status)
 values(sender,auth.uid(),p_code,'signed_up') on conflict(referred_user_id) do nothing;
end $$;
revoke all on function private.claim_referral_code(text) from public,anon;
grant execute on function private.claim_referral_code(text) to authenticated;

create or replace function public.create_referral() returns text
language sql security invoker set search_path=''
as $$ select private.create_referral_code(); $$;
revoke all on function public.create_referral() from public,anon;
grant execute on function public.create_referral() to authenticated;

create or replace function public.claim_referral(p_code text) returns void
language sql security invoker set search_path=''
as $$ select private.claim_referral_code(p_code); $$;
revoke all on function public.claim_referral(text) from public,anon;
grant execute on function public.claim_referral(text) to authenticated;
