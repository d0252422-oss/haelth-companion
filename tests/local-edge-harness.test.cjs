const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const helper=fs.readFileSync('scripts/local-edge-container.mjs','utf8');
const host=fs.readFileSync('scripts/local-engine-server.ts','utf8');
const runner=fs.readFileSync('scripts/test-manual-sql-e2e.mjs','utf8');

// These are harness safety/contract tests, NOT actual Edge execution evidence.
test('Edge mode cannot construct a host engine and only proxies the exact local route',()=>{
 assert.match(host,/if\(!edgeProxy\)\{[\s\S]*?new LocalEngineRuntime/);
 assert.match(host,/edgeProxy !== 'http:\/\/127\.0\.0\.1:57921\/functions\/v1\/mobile-health-beta\/v1\/engine\/web'/);
 assert.match(host,/UNSAFE_EDGE_TEST_PROXY/);
 assert.match(host,/HEALTH_ENGINE_LOCAL_ONLY/);
 assert.match(host,/DENO_DEPLOYMENT_ID/);
});
test('Container stays local, digest pinned, bounded, and owns only its unique instance',()=>{
 assert.match(helper,/npipe:\/\/\/\/\.\/pipe\/dockerDesktopLinuxEngine/);
 assert.match(helper,/edge-runtime@sha256:[a-f0-9]{64}/);
 assert.match(helper,/'--pull=never'/);
 assert.match(helper,/'127\.0\.0\.1:57921:9000'/);
 assert.match(helper,/'health-edge-'\+randomUUID\(\)/);
 assert.match(helper,/'--policy','per_request'/);
 assert.match(helper,/cpuTimeHardLimitMs:2000/);
 assert.match(helper,/memoryLimitMb:256/);
 assert.match(helper,/workerTimeoutMs:150000/);
 assert.doesNotMatch(helper,/system.*prune|volume.*prune|--privileged|--network.*host|docker\.sock|Deno\.Command/);
});
test('Source is allowlisted and leaf TLS certificate is separate from its trusted CA',()=>{
 assert.match(helper,/git.*\['--no-optional-locks','ls-files','supabase\/functions\/mobile-health-beta'\]/);
 assert.match(helper,/basicConstraints=critical,CA:FALSE/);
 assert.match(helper,/extendedKeyUsage=serverAuth/);
 assert.match(helper,/'-verify_hostname','host.docker.internal'/);
 assert.match(helper,/SSL_CERT_FILE:'\/test\/cert.pem'/);
 assert.match(helper,/DENO_TLS_CA_STORE:'mozilla,system'/);
 assert.doesNotMatch(helper,/unsafely-ignore-certificate-errors|rejectUnauthorized:false|NODE_TLS_REJECT_UNAUTHORIZED/);
 assert.doesNotMatch(helper,/source=\$\{privateDir\}/);
});
test('Execution classification and failures cannot silently become CLI or passing evidence',()=>{
 assert.match(helper,/DOCKER_DIRECT_OFFICIAL_EDGE_NOT_SUPABASE_CLI_STACK/);
 assert.match(runner,/NOT_RUN_IN_THIS_MODE/);
 assert.match(runner,/Actual product handler must deny anonymous/);
 assert.match(runner,/ACTUAL_EDGE_RESOURCE_OR_BOOT_FAILURE/);
 assert.match(helper,/runtime\.stdout\.log/);
 assert.match(helper,/runtime\.stderr\.log/);
});
