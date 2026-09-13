'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareGate}=require('../scripts/ios-shortcut-real-device-gate.cjs');
test('Shortcut device preparation stays pending and includes all five distinct windows',()=>{const gate=prepareGate('2026-09-14T04:00:00.000Z');assert.equal(gate.status,'PENDING_OWNER_DEVICE');assert.equal(gate.network_operations,0);assert.equal(gate.template_only,true);assert.deepEqual(gate.cases.map(c=>c.domain),['steps','heart_rate','sleep','weight','workout']);assert.ok(gate.cases.every(c=>c.status==='NOT_RUN'));assert.match(gate.acceptance,/never prove/);});
test('Shortcut device preparation requires an explicit valid frozen UTC endpoint',()=>{for(const input of [undefined,'','2026-09-14','2026-02-30T00:00:00.000Z'])assert.throws(()=>prepareGate(input));});
