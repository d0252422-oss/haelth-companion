# GitHub Actions security policy v1

Immutable full 40-character upstream commit pins are required for every remote action. Retain the previous tag in a comment; updates need upstream tag resolution evidence and workflow regression. Source: https://docs.github.com/en/actions/reference/security/secure-use

Blocking: unpinned uses, high-confidence security findings (including injection, unsafe download/artifact execution, broad token writes), or confirmed unjustified persisted credentials. Medium/low confidence findings require manual logic review; they are not confirmed disclosures and never silently pass. No current accepted exceptions.

Any future exception requires reason, exact file/rule scope, owner and review trigger (action/config/permissions change); high-confidence findings require remediation rather than blanket suppression. Scanner execution/JSON errors fail closed. Repository settings are not changed by the local Gate.

All three workflows use workflow-level contents: read and inherit it at job level. No job performs authenticated Git writes. Checkout persistence is disabled. Android artifact upload contains only APK/checksum paths, not .git; the prior artipacked finding was a potential exposure path, not evidence of leaked credentials. No permissions expansion or reduction was needed.

act: algorithm/domain jobs are LOCAL_ACT_PARTIAL (Linux dependencies and cache/runtime differences). Android is NOT_SUPPORTED_LOCAL for this run (SDK/config dependencies). No suitable runner image is cached; simulation is NOT_RUN_RESOURCE_HEAVY, not PASS. Never run deployment/secrets jobs or pull images automatically.

CI preparation: existing CI remains the second layer. The portable policy unit tests can run with existing Node jobs without scanner databases. Future actionlint/changed-SQL CI adoption requires pinned tool setup and runtime budget review; do not add a download-heavy security matrix. No hosted minutes incurred until an authorized push/run.
