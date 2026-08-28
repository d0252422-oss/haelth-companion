'use strict';

const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { runDomain } = require('./apps-script-health-score-runner.cjs');

const RUNTIMES = Object.freeze({ CURRENT: 'CURRENT', SHADOW: 'SHADOW', CANDIDATE: 'CANDIDATE' });
const ALGORITHM_VERSION = 'health-score-v1.0';

function selectRuntime(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.hasOwn(RUNTIMES, normalized) ? RUNTIMES[normalized] : RUNTIMES.CURRENT;
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('INVALID_ALGORITHM_REQUEST');
  for (const key of ['algorithm_id', 'algorithm_version', 'domain', 'subject_ref', 'period_start', 'period_end', 'timezone']) {
    if (typeof request[key] !== 'string' || !request[key]) throw new Error(`INVALID_ALGORITHM_REQUEST:${key}`);
  }
  if (request.algorithm_version !== ALGORITHM_VERSION) throw new Error('UNSUPPORTED_ALGORITHM_VERSION');
  if (!request.canonical_inputs || typeof request.canonical_inputs !== 'object' || Array.isArray(request.canonical_inputs)) {
    throw new Error('INVALID_ALGORITHM_REQUEST:canonical_inputs');
  }
  return request;
}

function traceability(request) {
  const refs = Array.isArray(request.traceability_refs) ? [...request.traceability_refs].map(String).sort() : [];
  const stable = JSON.stringify({
    algorithm_id: request.algorithm_id, algorithm_version: request.algorithm_version,
    domain: request.domain, subject_ref: request.subject_ref,
    period_start: request.period_start, period_end: request.period_end,
    canonical_inputs: request.canonical_inputs, traceability_refs: refs,
  });
  return { input_fingerprint: createHash('sha256').update(stable).digest('hex'), input_record_ids: refs };
}

function normalizeCurrent(request, raw) {
  const reasonCodes = raw.dependencyAdjustment && raw.dependencyAdjustment !== 'NONE'
    ? [raw.dependencyAdjustment] : [];
  return {
    value: raw.score ?? null,
    score: raw.score ?? null,
    completeness: raw.completeness,
    confidence: raw.confidence,
    missing_inputs: [...(raw.missingData || [])].sort(),
    reason_codes: reasonCodes.sort(),
    algorithm_version: ALGORITHM_VERSION,
    traceability: traceability(request),
  };
}

class AppsScriptRuntimeAdapter {
  constructor() { this.name = 'APPS_SCRIPT_CURRENT'; this.computeOnly = true; }
  execute(request) {
    validateRequest(request);
    const raw = runDomain(request.domain, request.canonical_inputs);
    return { raw, normalized: normalizeCurrent(request, raw) };
  }
}

function pythonExecutable() {
  return process.env.ALGORITHM_PYTHON || path.resolve('.venv', 'Scripts', 'python.exe');
}

class PythonRuntimeAdapter {
  constructor(options = {}) {
    this.name = 'PYTHON_CANDIDATE'; this.computeOnly = true;
    this.executable = options.executable || pythonExecutable();
  }
  execute(request) {
    validateRequest(request);
    const result = spawnSync(this.executable, [path.resolve('scripts', 'python-algorithm-runtime.py')], {
      cwd: path.resolve('.'), input: JSON.stringify(request), encoding: 'utf8', windowsHide: true,
      env: { ...process.env, PYTHONPATH: path.resolve('.') },
    });
    if (result.status !== 0) throw new Error(`CANDIDATE_RUNTIME_FAILURE:${String(result.stderr || '').trim().slice(0, 160)}`);
    return { raw: null, normalized: JSON.parse(result.stdout) };
  }
}

function compareResults(primary, candidate) {
  const fields = ['value', 'score', 'completeness', 'confidence', 'missing_inputs', 'reason_codes', 'algorithm_version'];
  const differences = fields.filter((field) => JSON.stringify(primary[field]) !== JSON.stringify(candidate[field]));
  if (!differences.length) return { parity_result: 'MATCH', difference_class: 'MATCH', differences: [] };
  if (differences.every((field) => ['missing_inputs', 'reason_codes'].includes(field))
      && differences.every((field) => JSON.stringify([...primary[field]].sort()) === JSON.stringify([...candidate[field]].sort()))) {
    return { parity_result: 'MATCH', difference_class: 'ORDERING_ONLY', differences };
  }
  if (differences.some((field) => primary[field] == null || candidate[field] == null)) {
    return { parity_result: 'MISMATCH', difference_class: 'NULL_SEMANTICS', differences };
  }
  const numeric = differences.filter((field) => ['value', 'score', 'completeness'].includes(field));
  if (numeric.length === differences.length && numeric.every((field) => Math.abs(primary[field] - candidate[field]) <= 0.1)) {
    return { parity_result: 'MATCH', difference_class: 'ROUNDING_ONLY', differences };
  }
  return { parity_result: 'MISMATCH', difference_class: differences.some((field) => ['value', 'score'].includes(field)) ? 'FORMULA_DIVERGENCE' : 'UNKNOWN', differences };
}

function sanitizedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('CANDIDATE_RUNTIME_FAILURE:') ? 'CANDIDATE_RUNTIME_FAILURE' : 'RUNTIME_FAILURE';
}

class AlgorithmRuntimeRouter {
  constructor(options = {}) {
    this.current = options.current || new AppsScriptRuntimeAdapter();
    this.candidate = options.candidate || new PythonRuntimeAdapter();
    this.allowNonProductionCandidate = options.allowNonProductionCandidate === true;
    this.telemetry = options.telemetry || (() => {});
  }

  execute(request, configuredMode) {
    validateRequest(request);
    let mode = selectRuntime(configuredMode);
    if (mode === RUNTIMES.CANDIDATE && !this.allowNonProductionCandidate) mode = RUNTIMES.CURRENT;
    const start = performance.now();
    const primary = this.current.execute(request);
    let selected = primary;
    let comparison = null;
    let fallbackUsed = false;
    let errorClass = null;
    let shadowDurationMs = null;
    if (mode === RUNTIMES.SHADOW || mode === RUNTIMES.CANDIDATE) {
      const shadowStart = performance.now();
      try {
        const candidate = this.candidate.execute(request);
        shadowDurationMs = performance.now() - shadowStart;
        comparison = compareResults(primary.normalized, candidate.normalized);
        if (mode === RUNTIMES.CANDIDATE) selected = candidate;
      } catch (error) {
        shadowDurationMs = performance.now() - shadowStart;
        fallbackUsed = true;
        errorClass = sanitizedError(error);
        if (mode === RUNTIMES.CANDIDATE) selected = primary;
      }
    }
    const event = {
      algorithm_id: request.algorithm_id, algorithm_version: request.algorithm_version,
      runtime_selected: mode, shadow_runtime: mode === RUNTIMES.CURRENT ? null : this.candidate.name,
      parity_result: comparison?.parity_result || null, difference_class: comparison?.difference_class || null,
      duration_ms: Number((performance.now() - start).toFixed(3)), fallback_used: fallbackUsed,
      error_class: errorClass, trace_id: String(request.trace_id || ''), shadow_duration_ms: shadowDurationMs === null ? null : Number(shadowDurationMs.toFixed(3)),
    };
    this.telemetry(event);
    return {
      userResult: mode === RUNTIMES.CANDIDATE && selected.raw === null ? selected.normalized : primary.raw,
      normalizedResult: selected.normalized, shadowComparison: comparison, telemetry: event,
    };
  }
}

module.exports = {
  ALGORITHM_VERSION, RUNTIMES, AlgorithmRuntimeRouter, AppsScriptRuntimeAdapter,
  PythonRuntimeAdapter, compareResults, selectRuntime, validateRequest,
};
