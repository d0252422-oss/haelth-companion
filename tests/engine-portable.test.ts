import assert from "node:assert/strict";
import {
  computeDomainRequest,
  PortableEngineRuntime,
  pyRound,
} from "../supabase/functions/mobile-health-beta/engine-portable.ts";
const cases = JSON.parse(
  await Deno.readTextFile(
    Deno.env.get('ENGINE_PARITY_FIXTURES') ?? ".engine-artifacts/blocker-closure/portable-fixtures.json",
  ),
);
function compare(a: any, b: any, path = "root") {
  if (
    path.endsWith(".input_fingerprint") ||
    path.endsWith(".input_fingerprints") || path.endsWith(".fingerprint_scheme")
  ) return;
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return;
    // Predeclared machine-order allowance for unrounded component/ratio diagnostics only.
    if (
      /legacy_component_values|\.components\.|macro_ratio|activity_consistency_observed_fraction/
        .test(path) && Math.abs(a - b) <= 1e-12
    ) return;
    assert.equal(a, b, path);
    return;
  }
  if (path.endsWith(".calculated_at")) {
    assert.equal(Date.parse(a), Date.parse(b), path);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = (v: any) =>
      Object.keys(v).filter((k) => k !== "fingerprint_scheme").sort();
    assert.deepEqual(keys(a), keys(b), path);
    for (const key of keys(a)) compare(a[key], b[key], path + "." + key);
    return;
  }
  assert.equal(a, b, path);
}
for (const f of cases) {
  Deno.test("portable reference parity: " + f.id, async () => {
    if (f.expected_error) {
      await assert.rejects(() => computeDomainRequest(f.request));
      return;
    }
    const actual = await computeDomainRequest(f.request);
    compare(actual, f.expected);
  });
}
Deno.test("all original 28 goldens execute without Python", async () => {
  const data = JSON.parse(
    await Deno.readTextFile("fixtures/algorithm-golden/health-score-v1.0.json"),
  );
  const runtime = new PortableEngineRuntime();
  for (const f of data.fixtures) {
    const { normalized: r } = await runtime.execute({
      ...f,
      canonical_inputs: f.canonical_inputs,
    });
    assert.equal(r.score, f.expected.expected_score, f.fixture_id);
    assert.equal(
      r.completeness,
      f.expected.expected_completeness,
      f.fixture_id,
    );
    assert.equal(r.confidence, f.expected.expected_confidence, f.fixture_id);
    assert.deepEqual(
      r.missing_inputs,
      [...f.expected.expected_missing_inputs].sort(),
      f.fixture_id,
    );
    assert.equal(
      r.algorithm_version,
      f.expected.algorithm_version,
      f.fixture_id,
    );
  }
});
Deno.test("rounding follows Python ties-to-even for glue, not a formula change", () => {
  assert.equal(pyRound(2.675, 2), 2.67);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(-2.5), -2);
});
Deno.test("portable fingerprint order/replay/tombstone semantics", async () => {
  const f = cases.find((c: any) => c.id === "all-domains-baseline-8");
  const a = await computeDomainRequest(f.request),
    b = await computeDomainRequest({
      ...f.request,
      canonical_inputs: {
        ...f.request.canonical_inputs,
        records: [...f.request.canonical_inputs.records].reverse(),
      },
    });
  assert.equal(
    a.bundle.daily.input_fingerprint,
    b.bundle.daily.input_fingerprint,
  );
  assert.equal(a.score, b.score);
  const rows = f.request.canonical_inputs.records;
  const current = rows.find((r: any) =>
    r.domain === "steps" && r.record_id === "steps-0"
  );
  for (
    const mutation of [{ ...current, revision: 2, value: 9001 }, {
      ...current,
      revision: 2,
      deleted: true,
    }]
  ) {
    const revised = await computeDomainRequest({
      ...f.request,
      canonical_inputs: {
        ...f.request.canonical_inputs,
        records: [...rows, mutation],
      },
    });
    assert.notEqual(
      revised.bundle.daily.input_fingerprint,
      a.bundle.daily.input_fingerprint,
    );
  }
  const replay = await computeDomainRequest({
    ...f.request,
    canonical_inputs: {
      ...f.request.canonical_inputs,
      records: [...rows, ...rows],
    },
  });
  assert.equal(
    replay.bundle.daily.input_fingerprint,
    a.bundle.daily.input_fingerprint,
  );
});
