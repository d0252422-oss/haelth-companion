-- Temporary service-role-only setup/cleanup for a bounded actual-login RLS test.
create function public.beta_admin_seed_synthetic_identity(p_user_id uuid,p_external_hash text,p_subject_hash text,p_email_hash text,p_run_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_external_hash !~ '^[0-9a-f]{64}$' or p_subject_hash !~ '^[0-9a-f]{64}$' or p_email_hash !~ '^[0-9a-f]{64}$'
  or p_run_id !~ '^beta-risk-[0-9a-f-]{36}$' then raise exception 'SYNTHETIC_SCOPE_REJECTED'; end if;
 insert into public.users(id,external_subject_hash,status,timezone) values(p_user_id,p_external_hash,'ACTIVE','Asia/Taipei');
 insert into private.beta_web_identity_aliases(web_subject_hash,verified_email_hash,canonical_user_id) values(p_subject_hash,p_email_hash,p_user_id);
 insert into private.user_entitlements(user_id,access_status,source,metadata) values(p_user_id,'BETA','SYSTEM',jsonb_build_object('synthetic',true,'runId',p_run_id));
 return true;
end $$;
create function public.beta_admin_cleanup_synthetic_identity(p_user_id uuid,p_run_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_run_id !~ '^beta-risk-[0-9a-f-]{36}$' or not exists(select 1 from private.user_entitlements e where e.user_id=p_user_id and e.metadata @> jsonb_build_object('synthetic',true,'runId',p_run_id)) then raise exception 'SYNTHETIC_CLEANUP_SCOPE_REJECTED'; end if;
 delete from public.engine_manual_body_records where canonical_user_id=p_user_id and body->>'runId'=p_run_id;
 delete from private.user_entitlements where user_id=p_user_id and metadata->>'runId'=p_run_id;
 delete from private.beta_web_identity_aliases where canonical_user_id=p_user_id;
 delete from public.users where id=p_user_id;
 return true;
end $$;
revoke all on function public.beta_admin_seed_synthetic_identity(uuid,text,text,text,text),public.beta_admin_cleanup_synthetic_identity(uuid,text) from public,anon,authenticated;
grant execute on function public.beta_admin_seed_synthetic_identity(uuid,text,text,text,text),public.beta_admin_cleanup_synthetic_identity(uuid,text) to service_role;
