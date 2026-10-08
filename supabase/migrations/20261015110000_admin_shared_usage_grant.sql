-- Admin → Shared failed for every admin with "permission denied for function admin_shared_usage": the public
-- wrapper is SECURITY INVOKER and calls private.admin_shared_usage, whose EXECUTE was revoked from
-- authenticated. Every other private.admin_* function is granted the same way; access is still enforced
-- inside by private.require_admin('view').
grant execute on function private.admin_shared_usage(timestamptz, timestamptz) to authenticated;
