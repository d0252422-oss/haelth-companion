import { computeDomainRequest } from "../supabase/functions/mobile-health-beta/engine-portable.ts";
const fixtures = JSON.parse(
  await Deno.readTextFile(
    ".engine-artifacts/blocker-closure/portable-fixtures.json",
  ),
);
const request = fixtures.find((f: any) => f.id === "single-steps").request;
const report: any = {
  environment: Deno.version,
  classification: "TARGET_LANGUAGE_DENO_HOST_NOT_EDGE",
  synthetic: true,
  method:
    "performance.now wall time; heap delta not peak memory; one cold call per size",
  production_sla: "NOT_DEFINED",
  measurements: [],
};
for (const count of [1, 40, 5000]) {
  const records = Array.from(
    { length: count },
    (_, i) => ({
      ...request.canonical_inputs.records[0],
      record_id: "benchmark-" + i,
      value: 1,
    }),
  );
  const before = Deno.memoryUsage(), start = performance.now();
  const result = await computeDomainRequest({
    ...request,
    canonical_inputs: { ...request.canonical_inputs, records },
  });
  report.measurements.push({
    records: count,
    days: 28,
    wall_ms: performance.now() - start,
    heap_delta_bytes: Deno.memoryUsage().heapUsed - before.heapUsed,
    daily_steps: result.bundle.daily.metrics.steps,
  });
  if (result.bundle.daily.metrics.steps !== count) {
    throw Error("BENCHMARK_ARITHMETIC_FAILURE");
  }
}
report.actual_edge_cpu = "NOT_MEASURED";
report.actual_edge_peak_memory = "NOT_MEASURED";
console.log(JSON.stringify(report, null, 2));
await Deno.writeTextFile(
  ".engine-artifacts/blocker-closure/portable-performance.json",
  JSON.stringify(report, null, 2),
);
