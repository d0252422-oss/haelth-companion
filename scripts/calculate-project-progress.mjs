// Read-only acceptance progress calculator. Tooling itself never contributes product weight.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const statuses = new Set(['PASS', 'FAIL', 'BLOCKED', 'UNKNOWN', 'IN_PROGRESS']);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const percent = (earned, total, complete) => complete ? 100 : Math.min(99.9, Math.round(earned / total * 1000) / 10);

export function validateProgressBaseline(baseline) {
  const errors = [];
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return ['BASELINE_OBJECT_REQUIRED'];
  for (const key of ['baseline_version', 'baseline_status', 'scope_description']) if (!nonempty(baseline[key])) errors.push(key.toUpperCase() + '_REQUIRED');
  if (typeof baseline.full_scope_confirmed !== 'boolean') errors.push('FULL_SCOPE_CONFIRMED_BOOLEAN_REQUIRED');
  if (baseline.full_scope_confirmed === false && baseline.baseline_status !== 'PROVISIONAL_KNOWN_SCOPE_ONLY') errors.push('UNCONFIRMED_SCOPE_MUST_BE_PROVISIONAL_KNOWN_SCOPE_ONLY');
  if (baseline.previous_progress !== null && !(typeof baseline.previous_progress === 'number' && Number.isFinite(baseline.previous_progress) && baseline.previous_progress >= 0 && baseline.previous_progress <= 100)) errors.push('PREVIOUS_PROGRESS_MUST_BE_NULL_OR_PERCENTAGE');
  if (!Array.isArray(baseline.leaves) || !baseline.leaves.length) return [...errors, 'NONEMPTY_LEAF_GATES_REQUIRED'];
  const ids = new Set();
  let total = 0;
  for (const [index, leaf] of baseline.leaves.entries()) {
    const label = 'LEAF_' + index;
    if (!leaf || typeof leaf !== 'object' || Array.isArray(leaf)) { errors.push(label + '_OBJECT_REQUIRED'); continue; }
    for (const key of ['id', 'module', 'acceptance']) if (!nonempty(leaf[key])) errors.push(label + '_' + key.toUpperCase() + '_REQUIRED');
    if (ids.has(leaf.id)) errors.push('DUPLICATE_LEAF_ID:' + leaf.id);
    ids.add(leaf.id);
    if (['parent', 'parent_id', 'parentId', 'children', 'gates', 'leaves'].some(key => Object.hasOwn(leaf, key))) errors.push(label + '_MUST_BE_LEAF_ONLY');
    if (typeof leaf.weight !== 'number' || !Number.isFinite(leaf.weight) || leaf.weight <= 0 || leaf.weight > 100) errors.push(label + '_INVALID_WEIGHT');
    else total += leaf.weight;
    if (!statuses.has(leaf.status)) errors.push(label + '_INVALID_STATUS');
    if (typeof leaf.evidence_valid !== 'boolean') errors.push(label + '_EVIDENCE_VALID_BOOLEAN_REQUIRED');
    if (!Array.isArray(leaf.evidence)) errors.push(label + '_EVIDENCE_ARRAY_REQUIRED');
    else for (const [evidenceIndex, evidence] of leaf.evidence.entries()) {
      if (!evidence || !nonempty(evidence.path) || typeof evidence.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(evidence.sha256)) errors.push(label + '_INVALID_EVIDENCE_' + evidenceIndex);
    }
  }
  // The epsilon addresses binary addition of decimal weights only; it is not a scoring tolerance.
  if (Math.abs(total - 100) > 1e-9) errors.push('LEAF_WEIGHTS_MUST_SUM_TO_100:' + total);
  return errors;
}

function evidenceCheck(evidence, root) {
  try {
    const target = realpathSync(path.resolve(root, evidence.path));
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return 'EVIDENCE_OUTSIDE_BASELINE_ROOT';
    if (!statSync(target).isFile()) return 'EVIDENCE_NOT_A_FILE';
    const digest = createHash('sha256').update(readFileSync(target)).digest('hex');
    if (digest !== evidence.sha256.toLowerCase()) return 'EVIDENCE_HASH_MISMATCH';
    return null;
  } catch (error) {
    return error.code === 'ENOENT' ? 'EVIDENCE_FILE_MISSING' : 'EVIDENCE_UNREADABLE:' + (error.code || 'UNKNOWN');
  }
}

export function calculateProjectProgress(baseline, { root = process.cwd() } = {}) {
  const errors = validateProgressBaseline(baseline);
  if (errors.length) return { check_passed: false, baseline_status: 'INVALID_BASELINE', overall_project_progress: 'UNKNOWN', diagnostics: errors };
  const canonicalRoot = realpathSync(root);
  const gateResults = [], moduleProgress = Object.create(null), diagnostics = [];
  let earned = 0, total = 0;
  for (const leaf of baseline.leaves) {
    const reasons = [];
    if (leaf.status === 'PASS') {
      if (!leaf.evidence_valid) reasons.push('EVIDENCE_NOT_ATTESTED_VALID');
      if (!leaf.evidence.length) reasons.push('PASS_REQUIRES_NONEMPTY_EVIDENCE');
      for (const evidence of leaf.evidence) {
        const failure = evidenceCheck(evidence, canonicalRoot);
        if (failure) reasons.push(failure + ':' + evidence.path);
      }
    }
    const validPass = leaf.status === 'PASS' && reasons.length === 0;
    const credit = validPass ? leaf.weight : 0;
    if (reasons.length) diagnostics.push({ gate_id: leaf.id, reasons });
    gateResults.push({ id: leaf.id, status: leaf.status, valid_pass: validPass, credited_weight: credit, reasons });
    const module = moduleProgress[leaf.module] ||= { earned_weight: 0, total_weight: 0, valid_pass_gates: 0, total_gates: 0 };
    module.earned_weight += credit; module.total_weight += leaf.weight; module.total_gates++;
    if (validPass) module.valid_pass_gates++;
    earned += credit; total += leaf.weight;
  }
  const complete = gateResults.every(gate => gate.valid_pass);
  const display = percent(earned, total, complete);
  for (const module of Object.values(moduleProgress)) module.accepted_percentage = percent(module.earned_weight, module.total_weight, module.valid_pass_gates === module.total_gates);
  const comparablePrevious = baseline.previous_progress !== null && baseline.previous_baseline_version === baseline.baseline_version;
  return {
    check_passed: diagnostics.length === 0,
    baseline_version: baseline.baseline_version, baseline_status: baseline.baseline_status,
    full_scope_confirmed: baseline.full_scope_confirmed, scope_description: baseline.scope_description,
    overall_project_progress: baseline.full_scope_confirmed ? display : 'UNKNOWN',
    provisional_known_scope_percentage: baseline.full_scope_confirmed ? null : display,
    accepted_weight: earned, total_weight: total, unverified_progress_weight: total - earned,
    unverified_weight_definition: 'All weight not credited by a valid PASS, including FAIL/BLOCKED/UNKNOWN/IN_PROGRESS and rejected PASS evidence',
    exact_known_scope_percentage: earned / total * 100,
    previous_progress: baseline.previous_progress === null ? 'NOT_AVAILABLE' : baseline.previous_progress,
    progress_change_pp: comparablePrevious ? Math.round((display - baseline.previous_progress) * 10) / 10 : 'NOT_AVAILABLE',
    progress_change_reason: baseline.previous_progress === null ? 'FIRST_VALID_BASELINE' : comparablePrevious ? 'SAME_BASELINE_VERSION_ONLY' : 'PREVIOUS_BASELINE_NOT_COMPARABLE',
    progress_calculation: '100 × valid PASS leaf weights / all leaf weights; local gates never imply remote/device/validity acceptance',
    module_progress: moduleProgress, gate_results: gateResults, diagnostics,
    limitations: ['File hashes establish integrity, not semantic acceptance; evidence_valid remains an explicit reviewer attestation.', 'Provisional weights are planning assumptions; an unconfirmed full delivery scope has UNKNOWN overall progress.'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log('Usage: node scripts/calculate-project-progress.mjs [--check] [project-progress.json]\nRead-only; exits 1 on invalid schema or rejected PASS evidence.');
  else {
    try {
      if (args.some(arg => arg.startsWith('--') && arg !== '--check') || args.filter(arg => arg !== '--check').length > 1) throw Error('INVALID_ARGUMENTS');
      const file = path.resolve(args.find(arg => arg !== '--check') || 'project-progress.json');
      const baseline = JSON.parse(readFileSync(file, 'utf8'));
      const result = calculateProjectProgress(baseline, { root: path.dirname(file) });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.check_passed ? 0 : 1;
    } catch (error) {
      // JSON parse errors may quote input text; diagnostics never echo baseline contents.
      const diagnostic = error instanceof SyntaxError ? 'INVALID_JSON' : error.code || error.message;
      console.log(JSON.stringify({ check_passed: false, overall_project_progress: 'UNKNOWN', diagnostics: [diagnostic] }, null, 2));
      process.exitCode = 1;
    }
  }
}
