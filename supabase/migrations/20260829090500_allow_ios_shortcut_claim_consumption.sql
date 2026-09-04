-- Android one-time claims become installation-key-bound. iOS Shortcut claims
-- instead become bound to a hashed, revocable shortcut session in the same
-- transaction and therefore intentionally retain no installation fingerprint.
alter table private.mobile_install_claims
  drop constraint mobile_install_claims_binding_check;

alter table private.mobile_install_claims
  add constraint mobile_install_claims_binding_check check (
    (binding_method = 'VERIFIED_APP_LINK' and installation_key_fingerprint is not null)
    or (
      binding_method = 'ONE_TIME_CODE'
      and (
        (consumed_at is null and installation_key_fingerprint is null)
        or (consumed_at is not null and platform = 'android' and installation_key_fingerprint is not null)
        or (consumed_at is not null and platform = 'ios' and installation_key_fingerprint is null)
      )
    )
  );
