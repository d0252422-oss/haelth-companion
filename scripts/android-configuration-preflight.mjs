import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only: no dotenv loading, Gradle mutation, credential lookup or network access.
export const betaSettings = Object.freeze([
  ['HEALTH_COMPANION_BETA_API_BASE_URL', 'packaging', 'api'],
  ['HEALTH_COMPANION_BETA_SUPABASE_URL', 'packaging', 'supabase'],
  ['HEALTH_COMPANION_BETA_SUPABASE_PUBLISHABLE_KEY', 'packaging', 'publishable'],
  ['HEALTH_COMPANION_GOOGLE_WEB_CLIENT_ID', 'packaging', 'google'],
  ['HEALTH_COMPANION_BETA_AUTH_SETUP_URL', 'legacy_bootstrap', 'https'],
  ['HEALTH_COMPANION_BETA_APP_LINK_HOST', 'legacy_bootstrap', 'host'],
]);
const project = 'uavimjgccigpbwqmfkhh.supabase.co';

function statusFor(value, kind) {
  if (typeof value !== 'string' || !value.trim() || value === 'missing') return 'MISSING';
  if (value !== value.trim() || /[\r\n"\\]/.test(value)) return 'INVALID_FORMAT';
  if (kind === 'publishable') {
    // Classification only, never JWT authentication or proof of the key's provenance.
    if (value.startsWith('sb_secret_')) return 'FORBIDDEN_SECRET_KEY';
    if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(value)) return 'FORMAT_ONLY_UNVERIFIED_PROVENANCE';
    try {
      const pieces = value.split('.');
      if (pieces.length !== 3) return 'INVALID_FORMAT';
      const payload = JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8'));
      return payload.role === 'anon' ? 'FORMAT_ONLY_UNVERIFIED_PROVENANCE' : 'FORBIDDEN_NON_PUBLIC_KEY';
    } catch { return 'INVALID_FORMAT'; }
  }
  if (kind === 'google') return /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)
    ? 'FORMAT_ONLY_UNVERIFIED_PROVENANCE' : 'INVALID_FORMAT';
  if (kind === 'host') return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.endsWith('.invalid')
    ? 'FORMAT_ONLY_UNVERIFIED_PROVENANCE' : 'INVALID_FORMAT';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.hostname.endsWith('.invalid')) return 'INVALID_FORMAT';
    if (kind === 'api' && (url.hostname !== project || url.pathname !== '/functions/v1/mobile-health-beta')) return 'UNEXPECTED_BETA_TARGET';
    if (kind === 'supabase' && value !== `https://${project}`) return 'UNEXPECTED_BETA_TARGET';
    return 'FORMAT_ONLY_UNVERIFIED_PROVENANCE';
  } catch { return 'INVALID_FORMAT'; }
}

export function inspectAndroidConfiguration(environment) {
  const settings = betaSettings.map(([name, scope, kind]) => ({
    name, scope, source: 'process_environment', status: statusFor(environment[name], kind),
  }));
  const blocked = settings.filter(x => x.scope === 'packaging' && x.status !== 'FORMAT_ONLY_UNVERIFIED_PROVENANCE');
  return {
    schema_version: 1,
    status: blocked.length ? 'BLOCKED_REQUIRED_CONFIGURATION' : 'FORMAT_READY_PROVENANCE_REVIEW_REQUIRED',
    packaging_task: ':app:verifyBetaRuntimeConfiguration', target_variant: ':app:assembleDebug',
    source_precedence: ['process_environment', 'non_routable_gradle_defaults'],
    unused_as_configuration_sources: ['Gradle project properties', 'local.properties', '.env files'],
    settings, blocking_names: blocked.map(x => x.name),
    credentials_printed: false, environment_mutated: false, build_executed: false,
    provenance_verified: false, remote_operations: 0,
    limitations: [
      'Format validation does not establish provenance, target authorization, OAuth registration or public key validity.',
      'Legacy bootstrap settings are recorded separately; the existing packaging task guards only the four native-auth settings.',
      'assembleRelease is not attached to the existing debug configuration guard; do not treat release as an alternative.',
    ],
  };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const report = inspectAndroidConfiguration(process.env);
  const reportOption = process.argv.indexOf('--report');
  if (reportOption >= 0) {
    const root = path.dirname(path.dirname(currentFile));
    const outputRoot = path.resolve(root, '.engine-artifacts/blocker-closure');
    const output = path.resolve(root, process.argv[reportOption + 1] ?? '');
    if (!output.startsWith(outputRoot + path.sep) || path.extname(output) !== '.json') throw new Error('REPORT_PATH_OUTSIDE_DEDICATED_EVIDENCE_DIRECTORY');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ ...report, observed_at: new Date().toISOString() }, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'BLOCKED_REQUIRED_CONFIGURATION' ? 2 : 0;
}
