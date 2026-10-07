-- Short public referral codes for clean share URLs.
-- Existing 32-character codes remain valid; only newly created codes use the shorter format.
create or replace function private.create_referral_code() returns text
language plpgsql security definer set search_path=''
as $$
declare code text; tries integer := 0;
begin
 if auth.uid() is null or not exists(select 1 from public.feature_flags where key='referrals' and enabled) then raise exception 'referrals_disabled'; end if;
 select i.code into code from public.referral_invites i where user_id=auth.uid();
 if code is not null then return code; end if;
 loop
   tries := tries + 1;
   code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
   begin
     insert into public.referral_invites(user_id,code) values(auth.uid(),code);
     return code;
   exception when unique_violation then
     if tries >= 8 then raise exception 'referral_code_generation_failed'; end if;
   end;
 end loop;
end $$;
revoke all on function private.create_referral_code() from public,anon;
grant execute on function private.create_referral_code() to authenticated;
