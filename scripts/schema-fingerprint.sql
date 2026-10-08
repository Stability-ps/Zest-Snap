-- Read-only catalog fingerprint used to compare a database built from supabase/migrations with production.
-- One row per object: kind, name, md5 of its whitespace-normalised definition. Run the same query on both sides.
with norm as (select 1)
select kind, name, md5(def) as hash from (
  select 'function' kind, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' name,
         regexp_replace(p.prosrc,'\s+','','g')||'|secdef='||p.prosecdef||'|cfg='||coalesce(array_to_string(p.proconfig,','),'')||'|ret='||pg_get_function_result(p.oid) def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
  union all
  select 'column', table_schema||'.'||table_name||'.'||column_name,
         data_type||'|'||is_nullable||'|'||coalesce(regexp_replace(column_default,'\s+','','g'),'')
    from information_schema.columns where table_schema in ('public','private')
  union all
  select 'constraint', c.conrelid::regclass::text||'.'||c.conname, regexp_replace(pg_get_constraintdef(c.oid),'\s+','','g')
    from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private')
  union all
  select 'policy', schemaname||'.'||tablename||'.'||policyname,
         cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(regexp_replace(qual,'\s+','','g'),'')||'|'||coalesce(regexp_replace(with_check,'\s+','','g'),'')
    from pg_policies where schemaname in ('public','private') or (schemaname='storage' and tablename='objects')
  union all
  select 'rls', n.nspname||'.'||c.relname, c.relrowsecurity::text
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','private')
  union all
  select 'trigger', c.relname||'.'||t.tgname, regexp_replace(pg_get_triggerdef(t.oid),'\s+','','g')
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where not t.tgisinternal and n.nspname in ('public','private')
  union all
  select 'index', schemaname||'.'||indexname, regexp_replace(indexdef,'\s+','','g') from pg_indexes where schemaname in ('public','private')
  union all
  select 'grant', table_schema||'.'||table_name||'.'||grantee, string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants where table_schema in ('public','private') and grantee in ('anon','authenticated')
   group by table_schema, table_name, grantee
  union all
  select 'function_grant', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||').'||r.rolname, 'execute'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r
   where n.nspname in ('public','private') and r.rolname in ('anon','authenticated') and has_function_privilege(r.oid, p.oid, 'execute')
  union all
  select 'cron', jobname, schedule||'|'||regexp_replace(command,'\s+','','g') from cron.job
  union all
  select 'bucket', id, coalesce(public::text,'')||'|'||coalesce(file_size_limit::text,'')||'|'||coalesce(array_to_string(allowed_mime_types,','),'') from storage.buckets
) x order by kind, name;
