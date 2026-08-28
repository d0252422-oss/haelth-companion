'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const sourcePath = process.argv[2] || 'evidence/apps-script-production/head/程式碼.js';
const outputPath = process.argv[3] || 'fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js';
const source = fs.readFileSync(sourcePath, 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`SNAPSHOT_MARKER_NOT_FOUND:${startMarker}`);
  return source.slice(start, end).trim();
}

const config = slice('var HEALTH_SCORING_CONFIG = {', '\n};') + '\n};';
const engine = slice('// ===== healthScoringEngine.gs =====', '\nfunction generateDailyRecommendations');
const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
const generated = [
  "'use strict';",
  '// GENERATED TEST SNAPSHOT: exact scoring unit extracted from the canonical Apps Script runtime.',
  `// Full canonical source SHA-256: ${sourceHash}`,
  '// Contains no production identity, credentials, network calls, or deployment configuration.',
  config,
  engine,
].join('\n\n');
fs.writeFileSync(outputPath, `${generated}\n`);
