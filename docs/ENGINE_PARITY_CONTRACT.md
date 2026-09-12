# Portable runtime differential contract — 2026-09-12

Defined before the first portable-adapter differential run. No original golden expected
values or Python formulas may be changed to satisfy this contract.

The JS frozen scoring functions are reused verbatim. Only current runtime aggregation,
empty-catalog confirmed nutrition normalization and domain orchestration are ported.
Python remains the independently executed reference; it is not a target dependency.

Compare every domain output and daily/derived field, not only 28 original goldens.
Scores, completeness, rounded measurements, units, null, counts, dates, versions,
statuses, components and missing-data/explanation sets must agree. Unrounded floating
arithmetic diagnostics may differ by at most 1e-12 absolute (IEEE754 operation order);
scores and explicitly rounded outputs must agree exactly. Negative zero normalizes to
zero. Offset-aware calculated timestamps compare by exact instant.

Two declared transport differences are **not formula tolerances**:

- Python fingerprint uses sorted JSON with Python float lexical forms and ASCII escaping.
  Portable fingerprints use sorted JS JSON, domain-separated by
  `fingerprint_scheme=JS_CANONICAL_JSON_V1`. Fingerprints themselves differ, while all
  fingerprinted scientific inputs/outputs are compared. Exclude only specifically named
  `input_fingerprint`, `input_fingerprints`, and `fingerprint_scheme` properties in the
  differential comparator; independently test deterministic replay/order, input revision
  sensitivity, tombstones and lease/generation concurrency. Do not exclude other fields.
  Existing history is retained; the first portable recompute can create a new immutable
  history fingerprint/head without changing algorithm version or score semantics.
- Error presentation differs between Python Pydantic validation and TS error codes;
  malformed units/intervals/subjects/versions must either produce the same missing-data
  flags or reject on both paths. Error text is not an authorization bypass.

The runtime currently has no food catalog: unknown/non-confirmed food reference inputs
remain missing. This does not claim porting a food database, photo model or reference-data
validation. Cross-runtime parity is engineering correctness, not real-world validity.
