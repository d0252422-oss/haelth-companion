const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repositoryRoot, 'codemagic.yaml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Codemagic iOS gate is root-scoped, bounded, and unsigned', () => {
  assert.match(workflow, /^workflows:\s*$/m);
  assert.match(workflow, /^  ios-xcode-gate:\s*$/m);
  assert.match(workflow, /^    instance_type: mac_mini_m2\s*$/m);
  assert.match(workflow, /^    max_build_duration: 30\s*$/m);
  assert.match(workflow, /^      xcode: "16\.4"\s*$/m);
  assert.doesNotMatch(workflow, /^    triggering:/m);
  assert.doesNotMatch(workflow, /^    publishing:/m);
  assert.doesNotMatch(workflow, /distribution|certificate|provisioning/i);
});

test('Codemagic gate generates and verifies the declared project contract', () => {
  assert.match(workflow, /command -v xcodegen/);
  assert.match(workflow, /brew install xcodegen/);
  assert.match(workflow, /xcodegen generate --spec project\.yml/);
  assert.match(workflow, /test -d HealthSyncHelper\.xcodeproj/);
  assert.match(workflow, /xcodebuild -list -project HealthSyncHelper\.xcodeproj/);
  assert.match(workflow, /expected_targets = \{"HealthSyncHelper", "HealthSyncHelperTests"\}/);
  assert.match(workflow, /expected_schemes = \{"HealthSyncHelper"\}/);
});

test('Codemagic gate runs only simulator tests and exports diagnostics', () => {
  assert.match(workflow, /xcrun simctl list devices available -j/);
  assert.match(workflow, /xcodebuild test/);
  assert.match(workflow, /platform=iOS Simulator/);
  assert.match(workflow, /tests\.xcresult/);
  assert.doesNotMatch(workflow, /archive|testflight|app-store|app_store/i);
});
