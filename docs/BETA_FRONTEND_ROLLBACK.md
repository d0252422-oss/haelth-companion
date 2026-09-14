# Beta frontend rollback point — source verified, live artifact partial

Run `health-beta-preparation-20260914-092035`; preparation only. No Pages/Git writes.
Evidence: `D:/Dev/Evidence/health-beta-preparation-20260914-092035`.

| Item | Verified state |
|---|---|
| Repository/target | d0252422-oss/health-companion-beta; https://d0252422-oss.github.io/health-companion-beta/ |
| Pages method | legacy build; main branch root; public HTTPS, no CNAME |
| Latest successful source | 53736e644aaa79163d521daa44c7e87c82ad3126 |
| Pages build/deployment | 1194335403 / 6267512587 |
| Actions run/artifact | 33889535147 / 9943239440, github-pages artifact EXPIRED |
| Recovery files | .nojekyll (0 bytes), index.html (11043 bytes); exactly the immutable Git tree |
| Recovery integrity | Git blob SHA1 and local SHA256 match fetched immutable source; see frontend-source-rollback.json |
| Current product source | 29346ace9842d9bbde221d0fcf4026a52ad3b80c, different from deployed Beta source |

The old Beta is a connector/score landing page, not the complete modern manual Web.
Its public config targets uavimjgccigpbwqmfkhh/mobile-health-beta and the existing
Apps Script session bridge. It has no modern manual SQL provider flag. Captured HTML
retains exact public configuration without recording sessions/secrets. Thus switching
the Beta entry is a product-entry replacement, not merely flipping an existing
deployed manual-form flag. Confirm login return path, assets and feature availability.

`frontend-rollback-source/` and `frontend-source-rollback.json` form a reproducible
**source recovery point**. The deployed Actions artifact is expired. Live URL retrieval
was rejected by the browser tool and was not bypassed with another transport. Live
CDN bytes, platform-generated asset differences and a deployment/reload rollback
exercise are NOT_VERIFIED. Do not label this COMPLETE_DEPLOYABLE_ROLLBACK_PASS.

## Future approved recovery procedure

1. Recheck Pages method and latest successful deployment; if revision changed, capture
   that new source tree/config/assets before mutation. Preserve this earlier snapshot.
2. Verify both saved blobs/hashes and absence of secrets. Create a dedicated clean
   Beta repository checkout from the approved remote revision without shared objects,
   hooks or unrelated files. Do not modify the canonical product branch to restore Beta.
3. Review a new commit restoring the saved frontend code/config. Do not use reset,
   force-push, destructive branch operations or removal of unrelated assets.
4. Only with explicit Beta publication approval, publish that reviewed commit to
   main:/ and wait boundedly for Pages build. Compare served asset hashes, API target,
   login/navigation behavior and a new browser session with the recovery source.
5. If Edge also regressed, deploy its independently captured verified old bundle;
   a function version/digest alone is not a deployable bundle. Do not claim frontend
   recovery repairs backend/schema defects.
6. Preserve every lawful SQL record created after cutover. No SQL deletion, reverse
   bulk migration or Sheets overwrite. Old UI may not display new manual SQL records;
   communicate temporary reduced access until a forward fix restores the SQL UI.

Stop on any cross-user/mapping corruption, preserve evidence and disable affected
Beta provider using the verified configuration recovery. Google Sheets remains
legacy/migration source/rollback reference; no real data import/export was executed.

FRONTEND_ROLLBACK_POINT = PARTIAL_SOURCE_RECOVERY_VERIFIED
ROLLBACK_VERIFIED = SOURCE_HASH_ONLY_NOT_DEPLOYMENT
