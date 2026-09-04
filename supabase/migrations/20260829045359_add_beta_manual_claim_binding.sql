-- Prepared for an isolated Beta project only. Do not apply to production.
alter table private.mobile_install_claims
  add column environment text not null default 'beta'
    check (environment = 'beta'),
  add column binding_method text not null default 'VERIFIED_APP_LINK'
    check (binding_method in ('VERIFIED_APP_LINK', 'ONE_TIME_CODE')),
  alter column installation_key_fingerprint drop not null;

alter table private.mobile_install_claims
  add constraint mobile_install_claims_binding_check check (
    (binding_method = 'VERIFIED_APP_LINK' and installation_key_fingerprint is not null)
    or (binding_method = 'ONE_TIME_CODE' and installation_key_fingerprint is null)
  );

alter table private.mobile_app_sessions
  add column environment text not null default 'beta'
    check (environment = 'beta');

comment on column private.mobile_install_claims.binding_method is
  'Beta continuation mode. ONE_TIME_CODE is a closed-beta fallback and is bound to the installation key on first signed exchange.';
