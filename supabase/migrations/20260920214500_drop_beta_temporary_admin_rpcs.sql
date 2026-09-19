-- Credential and synthetic-test bootstrap completed; remove temporary surfaces.
drop function public.beta_admin_bootstrap_manual_runtime(text);
drop function public.beta_admin_seed_synthetic_identity(uuid,text,text,text,text);
drop function public.beta_admin_cleanup_synthetic_identity(uuid,text);
