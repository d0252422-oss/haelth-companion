'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {scoreView} = require('../scripts/domain-score-response.cjs');
test('domain score API distinguishes measured zero from no score', () => {
  assert.equal(scoreView({score:0,status:'PARTIAL_DATA',completeness:.5}).scoreText,'0');
  assert.equal(scoreView({score:null,status:'INSUFFICIENT_DATA',completeness:0}).scoreText,'—');
});
test('domain score contract rejects percent completeness and invalid values', () => {
  for (const completeness of [-1,100,NaN,Infinity]) {
    assert.throws(() => scoreView({score:0,status:'PARTIAL_DATA',completeness}));
  }
  assert.throws(() => scoreView({score:0,status:'INSUFFICIENT_DATA',completeness:0}));
  assert.throws(() => scoreView({score:null,status:'VALID',completeness:1}));
});
test('stale and error remain visible rather than healthy zero', () => {
  assert.equal(scoreView({score:50,status:'STALE',completeness:.5}).statusText,'資料待更新');
  assert.equal(scoreView({score:null,status:'ERROR',completeness:0}).scoreText,'—');
});
