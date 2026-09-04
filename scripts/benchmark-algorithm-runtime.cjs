'use strict';

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { AlgorithmRuntimeRouter, AppsScriptRuntimeAdapter, PythonRuntimeAdapter } = require('./algorithm-runtime-adapter.cjs');

const fixture = JSON.parse(fs.readFileSync('fixtures/algorithm-golden/health-score-v1.0.json', 'utf8')).fixtures[0];
const request = {
  algorithm_id: fixture.algorithm_id, algorithm_version: fixture.algorithm_version,
  domain: fixture.domain, subject_ref: 'benchmark-subject',
  period_start: fixture.input_window.start, period_end: fixture.input_window.end,
  timezone: fixture.timezone, canonical_inputs: fixture.canonical_inputs,
  traceability_refs: [], trace_id: 'local-benchmark',
};

function measure(label, iterations, operation) {
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    operation();
    durations.push(performance.now() - startedAt);
  }
  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  return { label, iterations, mean_ms: Number(mean.toFixed(3)), min_ms: Number(Math.min(...durations).toFixed(3)), max_ms: Number(Math.max(...durations).toFixed(3)) };
}

const current = new AppsScriptRuntimeAdapter();
const candidate = new PythonRuntimeAdapter();
const shadow = new AlgorithmRuntimeRouter({ current, candidate });
const evidence = [
  measure('CURRENT_APPS_SCRIPT_VM', 20, () => current.execute(request)),
  measure('CANDIDATE_PYTHON_PROCESS', 5, () => candidate.execute(request)),
  measure('SHADOW_END_TO_END', 5, () => shadow.execute(request, 'SHADOW')),
];
process.stdout.write(`${JSON.stringify({ environment: 'LOCAL_WINDOWS_NON_PRODUCTION', evidence }, null, 2)}\n`);
