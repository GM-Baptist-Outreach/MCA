-- Security hardening: trigger / event-trigger functions must not be callable
-- via PostgREST RPC (/rest/v1/rpc/...). Postgres only checks EXECUTE on a
-- trigger function at CREATE TRIGGER time, never when the trigger fires, so
-- the triggers keep working (they run SECURITY DEFINER as owner postgres).
-- is_admin() is intentionally left alone (used by RLS policies).

revoke execute on function public.notify_ghl_form_submission() from public, anon, authenticated;
revoke execute on function public.notify_ghl_score_submission() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- keep service_role / postgres able to execute (explicit, idempotent)
grant execute on function public.notify_ghl_form_submission() to service_role;
grant execute on function public.notify_ghl_score_submission() to service_role;
grant execute on function public.rls_auto_enable() to service_role;
