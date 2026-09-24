// Web-only Beta publication artifact. It never deploys, logs in, reads secrets,
// or copies Edge/migration/Android files from the shared working tree.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

export const BETA_PROJECT_REF = 'uavimjgccigpbwqmfkhh';
export const PRODUCTION_PROJECT_REF = 'vptqedxdxfoohbqctujf';
export const WEB_FILES = Object.freeze([
  'index.html',
  'build.json',
  'scripts/build-version.js',
  'scripts/core-ux-contract.js',
  'scripts/local-engine-web.js',
  'scripts/web-view-state.js',
  'scripts/manual-observation-web.js',
]);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertWebTarget(projectRef) {
  if (projectRef === PRODUCTION_PROJECT_REF) throw Error('PRODUCTION_TARGET_DENIED');
  if (projectRef !== BETA_PROJECT_REF) throw Error('BETA_TARGET_NOT_ALLOWLISTED');
}

export function createPublicSqlConfig(projectRef = BETA_PROJECT_REF) {
  assertWebTarget(projectRef);
  const config = {
    enabled: true,
    release: 'AB',
    schemaVersion: 'manual-sql-v1',
    projectRef,
    endpoint: `https://${projectRef}.supabase.co/functions/v1/mobile-health-beta/v1/engine/web`,
  };
  return Buffer.from(`globalThis.HEALTH_MANUAL_SQL_CONFIG=Object.freeze(${JSON.stringify(config)});\n`);
}

export function scanPublicArtifactText(entries) {
  const patterns = [
    ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u],
    ['SUPABASE_SECRET', /sb_secret_[A-Za-z0-9_-]+/u],
    ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ['DATABASE_URI', /postgres(?:ql)?:\/\/[^\s'"`]+/iu],
    ['OPENAI_KEY', /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u],
    ['GITHUB_PAT', /gh[pousr]_[A-Za-z0-9_]{20,}/u],
    ['GOOGLE_API_KEY', /AIza[0-9A-Za-z_-]{20,}/u],
    ['GOOGLE_OAUTH_SECRET', /GOCSPX-[0-9A-Za-z_-]{20,}/u],
    ['AWS_ACCESS_KEY', /AKIA[0-9A-Z]{16}/u],
  ];
  return entries.flatMap(({file,text}) => patterns.filter(([,pattern]) => pattern.test(text)).map(([type]) => ({file,type})));
}

export async function prepareWebBetaArtifact(output, projectRef = BETA_PROJECT_REF) {
  assertWebTarget(projectRef);
  if (!path.isAbsolute(output)) throw Error('ABSOLUTE_OUTPUT_REQUIRED');
  const evidenceRoot = await realpath('D:/Dev/Evidence');
  const parent = await realpath(path.dirname(output));
  const relative = path.relative(evidenceRoot, parent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('OUTPUT_OUTSIDE_D_EVIDENCE');
  await mkdir(output, {recursive:false});

  const files = [], textEntries = [], snapshot = new Map();
  for (const file of WEB_FILES) {
    const source = path.join(repo, file), bytes = await readFile(source);
    if (file.endsWith('.js')) new vm.Script(bytes.toString('utf8'), {filename:file});
    await mkdir(path.dirname(path.join(output, file)), {recursive:true});
    await writeFile(path.join(output, file), bytes, {flag:'wx'});
    snapshot.set(file,bytes);
    files.push({path:file,bytes:bytes.length,sha256:sha256(bytes),source:'WORKTREE_ALLOWLIST'});
    textEntries.push({file,text:bytes.toString('utf8')});
  }
  const build = JSON.parse(snapshot.get('build.json').toString('utf8'));
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{2,79}$/u.test(build.buildId || '')) throw Error('INVALID_BUILD_ID');
  const publicConfig = createPublicSqlConfig(projectRef);
  new vm.Script(publicConfig.toString('utf8'), {filename:'scripts/manual-sql-config.js'});
  await writeFile(path.join(output, 'scripts/manual-sql-config.js'), publicConfig, {flag:'wx'});
  files.push({path:'scripts/manual-sql-config.js',bytes:publicConfig.length,sha256:sha256(publicConfig),source:'GENERATED_BETA_AB_OVERLAY'});
  textEntries.push({file:'scripts/manual-sql-config.js',text:publicConfig.toString('utf8')});

  const html = snapshot.get('index.html').toString('utf8');
  for (const [,inline] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu)) new vm.Script(inline, {filename:'index.html'});
  const localScripts = [...html.matchAll(/<script\s+[^>]*src=["'](?!https?:|\/\/)([^"'?]+)(?:\?[^"']*)?["']/giu)].map(match => match[1].replace(/^\.\//u,''));
  const packaged = new Set(files.map(file => file.path));
  for (const script of localScripts) if (!packaged.has(script)) throw Error(`UNPACKAGED_LOCAL_SCRIPT:${script}`);
  if (localScripts.some(script => !script.endsWith('.js'))) throw Error('UNEXPECTED_LOCAL_SCRIPT_TYPE');
  const versionTokens = [...html.matchAll(/<script\s+[^>]*src=["'](?!https?:|\/\/)[^"']+\?v=([^"']+)["']/giu)].map(match => match[1]);
  if (!versionTokens.length || versionTokens.some(token => token !== build.buildId)) throw Error('BUILD_VERSION_TOKEN_MISMATCH');
  const buildSource = snapshot.get('scripts/build-version.js').toString('utf8');
  if (!buildSource.includes(`const BUILD_ID = '${build.buildId}'`)) throw Error('BUILD_RUNTIME_ID_MISMATCH');

  const secretFindings = scanPublicArtifactText(textEntries);
  if (secretFindings.length) throw Error(`PUBLIC_ARTIFACT_SECRET_PATTERN:${secretFindings.map(item => `${item.file}:${item.type}`).join(',')}`);
  for (const file of files) {
    const artifactBytes=await readFile(path.join(output,file.path));
    if (artifactBytes.length!==file.bytes||sha256(artifactBytes)!==file.sha256)throw Error(`ARTIFACT_INTEGRITY_MISMATCH:${file.path}`);
  }
  const revision = execFileSync('git',['--no-optional-locks','rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  const status = execFileSync('git',['--no-optional-locks','status','--porcelain=v1','--untracked-files=normal'],{cwd:repo,encoding:'utf8'}).replaceAll('\r\n','\n');
  const manifest = {
    schema:'health-companion-web-beta-artifact-v1',
    status:'READY_FOR_REVIEW_NOT_DEPLOYED',
    created_at:new Date().toISOString(),
    source_revision:revision,
    source_worktree_state:status.trim()?'DIRTY':'CLEAN',
    source_status_sha256:sha256(Buffer.from(status)),
    build_id:build.buildId,
    target:{project_ref:projectRef,pages_repository:'d0252422-oss/health-companion-beta',entry:'https://d0252422-oss.github.io/health-companion-beta/'},
    public_sql_config:{enabled:true,release:'AB',sha256:sha256(publicConfig)},
    files,
    exclusions:['Edge functions','migrations','Android','iOS','Python','local configs','credentials','source maps'],
    deployment_authorized:false,
    remote_operations:0,
    limitations:['Artifact integrity is not deployment approval.','Authenticated compatibility and rollback remain separate live gates.'],
  };
  await writeFile(path.join(output,'web-artifact-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--output' || args[2] !== '--target') throw Error('USAGE: --output D:/Dev/Evidence/<new-directory> --target <beta-project-ref>');
  const result = await prepareWebBetaArtifact(path.resolve(args[1]), args[3]);
  console.log(JSON.stringify({status:result.status,build_id:result.build_id,files:result.files.length,remote_operations:result.remote_operations,output:path.resolve(args[1])}));
}
