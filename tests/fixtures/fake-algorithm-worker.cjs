'use strict';

const readline = require('node:readline');
const mode = process.argv[2] || 'partial';

if (mode === 'startup-exit') process.exit(2);
if (mode !== 'no-ready') process.stdout.write(`${JSON.stringify({ type: 'ready', runtime: 'FAKE', algorithm_version: mode === 'wrong-version' ? 'health-score-v9.9' : 'health-score-v1.0', algorithm_ids: ['sleep-score'] })}\n`);

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (mode === 'hang') return;
  if (mode === 'crash') process.exit(3);
  if (mode === 'invalid-json') { process.stdout.write('not-json\n'); return; }
  if (mode === 'partial') {
    process.stdout.write(`${JSON.stringify({ type: 'response', request_id: request.request_id, ok: true, result: { score: 1 } })}\n`);
  }
});
