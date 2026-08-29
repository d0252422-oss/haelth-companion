-- A manual claim starts unbound and becomes installation-bound atomically when
-- it is consumed. The earlier constraint incorrectly rejected that transition.
alter table private.mobile_install_claims
  drop constraint mobile_install_claims_binding_check;

alter table private.mobile_install_claims
  add constraint mobile_install_claims_binding_check check (
    (binding_method = 'VERIFIED_APP_LINK' and installation_key_fingerprint is not null)
    or (
      binding_method = 'ONE_TIME_CODE'
      and (
        (consumed_at is null and installation_key_fingerprint is null)
        or (consumed_at is not null and installation_key_fingerprint is not null)
      )
    )
  );
