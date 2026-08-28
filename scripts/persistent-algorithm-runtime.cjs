'use strict';

const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const { performance } = require('node:perf_hooks');
const {
  ALGORITHM_VERSION, RUNTIMES, AppsScriptRuntimeAdapter, compareResults,
  selectRuntime, validateRequest,
} = require('./algorithm-runtime-adapter.cjs');

const REQUIRED_RESULT_FIELDS = ['value', 'score', 'completeness', 'confidence', 'missing_inputs', 'reason_codes', 'algorithm_version', 'traceability'];

function validateCandidateResult(result, request) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('CANDIDATE_PARTIAL_OUTPUT');
  if (REQUIRED_RESULT_FIELDS.some((field) => !Object.hasOwn(result, field))) throw new Error('CANDIDATE_PARTIAL_OUTPUT');
  if (result.algorithm_version !== request.algorithm_version) throw new Error('CANDIDATE_WRONG_VERSION');
  if (!Array.isArray(result.missing_inputs) || !Array.isArray(result.reason_codes)) throw new Error('CANDIDATE_PARTIAL_OUTPUT');
  if (!result.traceability || typeof result.traceability !== 'object') throw new Error('CANDIDATE_PARTIAL_OUTPUT');
  return result;
}

class PersistentPythonRuntimeAdapter {
  constructor(options = {}) {
    this.name = 'PYTHON_PERSISTENT_CANDIDATE';
    this.computeOnly = true;
    this.executable = options.executable || process.env.ALGORITHM_PYTHON || path.resolve('.venv', 'Scripts', 'python.exe');
    this.args = options.args || [path.resolve('scripts', 'python-algorithm-worker.py')];
    this.cwd = options.cwd || path.resolve('.');
    this.startupTimeoutMs = options.startupTimeoutMs || 5000;
    this.requestTimeoutMs = options.requestTimeoutMs || 3000;
    this.health = 'UNAVAILABLE';
    this.child = null;
    this.pending = new Map();
    this.startPromise = null;
    this.handshake = null;
  }

  get pid() { return this.child?.pid || null; }

  async start() {
    if (this.health === 'HEALTHY' && this.child) return this.handshake;
    if (this.startPromise) return this.startPromise;
    this.health = 'DEGRADED';
    this.startPromise = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (errorClass) => {
        if (settled) return;
        settled = true;
        this.health = 'UNAVAILABLE';
        this.startPromise = null;
        reject(new Error(errorClass));
      };
      const timeout = setTimeout(() => fail('CANDIDATE_STARTUP_TIMEOUT'), this.startupTimeoutMs);
      const child = spawn(this.executable, this.args, {
        cwd: this.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: this.cwd },
      });
      this.child = child;
      child.once('error', () => { clearTimeout(timeout); fail('CANDIDATE_STARTUP_FAILURE'); });
      child.once('exit', () => {
        clearTimeout(timeout);
        this.child = null;
        this.health = 'UNAVAILABLE';
        this.startPromise = null;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('CANDIDATE_CRASH'));
        }
        this.pending.clear();
        if (!settled) fail('CANDIDATE_STARTUP_FAILURE');
      });
      child.stderr.resume();
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { this._failPending('CANDIDATE_INVALID_JSON'); return; }
        if (message.type === 'ready' && !settled) {
          clearTimeout(timeout);
          settled = true;
          this.handshake = message;
          if (message.algorithm_version !== ALGORITHM_VERSION) {
            this.health = 'INCOMPATIBLE';
            this.startPromise = null;
            reject(new Error('CANDIDATE_WRONG_VERSION'));
            return;
          }
          this.health = 'HEALTHY';
          resolve(message);
          return;
        }
        this._handleResponse(message);
      });
    });
    return this.startPromise;
  }

  _failPending(errorClass) {
    this.health = 'DEGRADED';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(errorClass));
    }
    this.pending.clear();
  }

  _handleResponse(message) {
    const pending = this.pending.get(String(message.request_id || ''));
    if (!pending) return;
    this.pending.delete(String(message.request_id));
    clearTimeout(pending.timeout);
    if (!message.ok) { pending.reject(new Error(String(message.error_class || 'CANDIDATE_RUNTIME_FAILURE'))); return; }
    try {
      const normalized = validateCandidateResult(message.result, pending.request);
      pending.resolve({
        raw: null, normalized,
        timing: { ...(message.timing || {}), request_serialization_ms: Number(pending.requestSerializationMs.toFixed(6)) },
      });
    } catch (error) { pending.reject(error); }
  }

  async execute(request) {
    validateRequest(request);
    if (!this.child || this.health !== 'HEALTHY') throw new Error(this.health === 'INCOMPATIBLE' ? 'CANDIDATE_WRONG_VERSION' : 'CANDIDATE_NOT_RUNNING');
    const requestId = String(request.request_id || randomUUID());
    if (requestId.length > 128) throw new Error('INVALID_REQUEST_ID');
    const envelope = { ...request, request_id: requestId };
    const serializationStartedAt = performance.now();
    const encodedEnvelope = JSON.stringify(envelope);
    const requestSerializationMs = performance.now() - serializationStartedAt;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        this.health = 'DEGRADED';
        reject(new Error('CANDIDATE_TIMEOUT'));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout, request, requestSerializationMs });
      this.child.stdin.write(`${encodedEnvelope}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(new Error('CANDIDATE_TRANSPORT_FAILURE'));
      });
    });
  }

  async restart() { await this.close(); return this.start(); }

  async close() {
    const child = this.child;
    if (!child) { this.health = 'UNAVAILABLE'; this.startPromise = null; return; }
    this.child = null;
    this.health = 'UNAVAILABLE';
    this.startPromise = null;
    child.stdin.end();
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { if (!child.killed) child.kill(); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
}

function errorClass(error) {
  const value = error instanceof Error ? error.message : String(error);
  const allowed = new Set(['CANDIDATE_NOT_RUNNING', 'CANDIDATE_STARTUP_FAILURE', 'CANDIDATE_STARTUP_TIMEOUT', 'CANDIDATE_CRASH', 'CANDIDATE_TIMEOUT', 'CANDIDATE_INVALID_JSON', 'CANDIDATE_PARTIAL_OUTPUT', 'CANDIDATE_WRONG_VERSION', 'CANDIDATE_TRANSPORT_FAILURE', 'UNKNOWN_ALGORITHM_ID', 'UNKNOWN_ALGORITHM_VERSION', 'INVALID_CANONICAL_INPUTS', 'INVALID_REQUEST_ID']);
  return allowed.has(value) ? value : 'CANDIDATE_RUNTIME_FAILURE';
}

class AsyncAlgorithmRuntimeRouter {
  constructor(options = {}) {
    this.current = options.current || new AppsScriptRuntimeAdapter();
    this.candidate = options.candidate;
    this.allowNonProductionCandidate = options.allowNonProductionCandidate === true;
    this.telemetry = options.telemetry || (() => {});
  }

  async execute(request, configuredMode) {
    validateRequest(request);
    let mode = selectRuntime(configuredMode);
    const candidateHealthy = this.candidate?.health === 'HEALTHY';
    if (mode === RUNTIMES.CANDIDATE && (!this.allowNonProductionCandidate || !candidateHealthy)) mode = RUNTIMES.CURRENT;
    const startedAt = performance.now();
    const primary = this.current.execute(request);
    let normalized = primary.normalized;
    let comparison = null;
    let fallbackUsed = false;
    let candidateError = null;
    let shadowDuration = null;
    if (mode === RUNTIMES.SHADOW || mode === RUNTIMES.CANDIDATE) {
      const shadowStartedAt = performance.now();
      try {
        const shadow = await this.candidate.execute(request);
        shadowDuration = performance.now() - shadowStartedAt;
        comparison = compareResults(primary.normalized, shadow.normalized);
        if (mode === RUNTIMES.CANDIDATE && comparison.parity_result === 'MATCH') normalized = shadow.normalized;
        if (mode === RUNTIMES.CANDIDATE && comparison.parity_result !== 'MATCH') {
          normalized = primary.normalized; fallbackUsed = true; candidateError = 'CANDIDATE_PARITY_MISMATCH';
        }
      } catch (error) {
        shadowDuration = performance.now() - shadowStartedAt;
        fallbackUsed = true;
        candidateError = errorClass(error);
        normalized = primary.normalized;
      }
    }
    const event = {
      request_id: String(request.request_id || ''), algorithm_id: request.algorithm_id,
      algorithm_version: request.algorithm_version, runtime: mode,
      runtime_health: this.candidate?.health || 'UNAVAILABLE', duration_ms: Number((performance.now() - startedAt).toFixed(3)),
      fallback_used: fallbackUsed, difference_class: comparison?.difference_class || null,
      error_class: candidateError, shadow_duration_ms: shadowDuration === null ? null : Number(shadowDuration.toFixed(3)),
    };
    this.telemetry(event);
    return {
      userResult: mode === RUNTIMES.CANDIDATE && !fallbackUsed ? normalized : primary.raw,
      normalizedResult: normalized, shadowComparison: comparison, telemetry: event,
    };
  }
}

module.exports = { AsyncAlgorithmRuntimeRouter, PersistentPythonRuntimeAdapter, validateCandidateResult };
