# SQL lint policy v1

SQLFluff 4.3.0, postgres. No automatic SQL rewrites. Native PostgreSQL/RLS tests remain mandatory; lint is not correctness proof.

`config/sql-lint-baseline.json` records byte SHA256 for existing SQL, including staging/drafts. Only identical bytes receive INFO_BASELINED. New/untracked or modified SQL is linted with all default rules by `scripts/sql-lint-changed.ps1`. Committing a file does not exempt it. Baseline changes require explicit review, raw lint evidence and parser validity; runner never refreshes it automatically.

Blocking: PRS/LXR/TMP (unparseable/unlintable input), AM04 (unknown result column count) and AM07 (set operands with unequal column counts). Remaining unfamiliar structural rules require review, not automatic acceptance. SQL lint is not a security-definer/RLS analyzer.

Nonblocking: LT whitespace/layout, CP capitalization, AL alias style, RF04 reserved-keyword naming. Other RF reference rules require review because unresolved references can affect correctness. Historical LT01/LT02/LT05 and RF04 are legacy readability/naming debt, not confirmed SQL defects. Changed-file warnings are visible but cosmetic warnings alone do not fail release. Unknown structural warnings remain review-required.

Do not disable every rule, edit applied migrations to clear cosmetic debt, or regenerate baseline solely to make CI green. Migration byte hashes also guard accidental historical edits. Deleted files are reported through Git review; no SQL execution occurs in lint.
