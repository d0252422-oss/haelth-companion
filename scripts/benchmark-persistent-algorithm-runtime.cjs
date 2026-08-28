'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { AppsScriptRuntimeAdapter, PythonRuntimeAdapter } = require('./algorithm-runtime-adapter.cjs');
const { AsyncAlgorithmRuntimeRouter, PersistentPythonRuntimeAdapter } = require('./persistent-algorithm-runtime.cjs');

const fixture = JSON.parse(fs.readFileSync('fixtures/algorithm-golden/health-score-v1.0.json', 'utf8')).fixtures[0];
const baseRequest = {
  algorithm_id: fixture.algorithm_id, algorithm_version: fixture.algorithm_version,
  domain: fixture.domain, subject_ref: 'local-benchmark-user',
  period_start: fixture.input_window.start, period_end: fixture.input_window.end,
  timezone: fixture.timezone, canonical_inputs: fixture.canonical_inputs, traceability_refs: [],
};

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  return {
    count: values.length, min_ms: Number(sorted[0].toFixed(3)),
    median_ms: Number(percentile(0.5).toFixed(3)), p95_ms: Number(percentile(0.95).toFixed(3)),
    mean_ms: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
    max_ms: Number(sorted.at(-1).toFixed(3)),
  };
}

function workingSetBytes(pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)}).WorkingSet64`], { encoding: 'utf8', windowsHide: true });
  const value = Number(String(result.stdout || '').trim());
  return Number.isFinite(value) ? value : null;
}

async function measure(count, operation) {
  const durations = [];
  const details = [];
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now();
    details.push(await operation(index));
    durations.push(performance.now() - startedAt);
  }
  return { ...stats(durations), details };
}

async function main() {
  const current = new AppsScriptRuntimeAdapter();
  const subprocess = new PythonRuntimeAdapter();
  const persistent = new PersistentPythonRuntimeAdapter();
  const coldStartedAt = performance.now();
  await persistent.start();
  const coldStartMs = performance.now() - coldStartedAt;
  const memoryBaseline = workingSetBytes(persistent.pid);
  const currentEvidence = await measure(100, () => current.execute(baseRequest));
  const subprocessEvidence = await measure(10, () => subprocess.execute(baseRequest));
  const warmEvidence = await measure(100, (index) => persistent.execute({ ...baseRequest, request_id: `warm-${index}` }));
  const shadowRouter = new AsyncAlgorithmRuntimeRouter({ current, candidate: persistent });
  const shadowEvidence = await measure(100, (index) => shadowRouter.execute({ ...baseRequest, request_id: `shadow-${index}` }, 'SHADOW'));
  const sequential = await measure(500, (index) => persistent.execute({ ...baseRequest, request_id: `load-${index}`, subject_ref: `user-${index % 7}` }));
  const concurrentStartedAt = performance.now();
  const concurrentResults = await Promise.all(Array.from({ length: 25 }, (_, index) => persistent.execute({ ...baseRequest, request_id: `concurrent-load-${index}`, subject_ref: `concurrent-user-${index}` })));
  const concurrentMs = performance.now() - concurrentStartedAt;
  const memoryAfterLoad = workingSetBytes(persistent.pid);
  const algorithmTimings = warmEvidence.details.map((item) => Number(item.timing.algorithm_execution_ms));
  const requestSerializationTimings = warmEvidence.details.map((item) => Number(item.timing.request_serialization_ms));
  const deserializationTimings = warmEvidence.details.map((item) => Number(item.timing.request_deserialization_ms));
  const serializationTimings = warmEvidence.details.map((item) => Number(item.timing.result_serialization_ms));
  const restartStartedAt = performance.now();
  await persistent.restart();
  const restartMs = performance.now() - restartStartedAt;
  await persistent.execute({ ...baseRequest, request_id: 'post-restart-verification' });
  await persistent.close();
  process.stdout.write(`${JSON.stringify({
    environment: 'LOCAL_WINDOWS_NON_PRODUCTION', process_count: 1,
    python_persistent_cold_start_ms: Number(coldStartMs.toFixed(3)),
    python_persistent_restart_ms: Number(restartMs.toFixed(3)),
    current_reference: { ...currentEvidence, details: undefined },
    python_subprocess_cold: { ...subprocessEvidence, details: undefined },
    python_persistent_warm_request: { ...warmEvidence, details: undefined },
    python_algorithm_execution: stats(algorithmTimings),
    request_serialization: stats(requestSerializationTimings),
    request_deserialization: stats(deserializationTimings),
    result_serialization: stats(serializationTimings),
    shadow_warm_end_to_end: { ...shadowEvidence, details: undefined },
    sequential_load_500: { ...sequential, details: undefined, successful: 500, failed: 0 },
    concurrent_load_25: { total_ms: Number(concurrentMs.toFixed(3)), successful: concurrentResults.length, failed: 0 },
    memory_baseline_bytes: memoryBaseline, memory_after_load_bytes: memoryAfterLoad,
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'BENCHMARK_FAILURE'}\n`); process.exitCode = 1; });
