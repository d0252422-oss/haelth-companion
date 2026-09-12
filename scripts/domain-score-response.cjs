'use strict';

// Shared opt-in frontend view model. Current Web scoring routes remain unchanged.
function scoreView(row) {
  const states = new Set(['VALID','PARTIAL_DATA','INSUFFICIENT_DATA','STALE','ERROR']);
  if (!row || !states.has(row.status) || !Number.isFinite(row.completeness) ||
      row.completeness < 0 || row.completeness > 1 ||
      (row.score !== null && (!Number.isFinite(row.score) || row.score < 0 || row.score > 100)) ||
      (['ERROR','INSUFFICIENT_DATA'].includes(row.status) && row.score !== null) ||
      (['VALID','PARTIAL_DATA'].includes(row.status) && row.score === null)) {
    throw new Error('INVALID_DOMAIN_SCORE_CONTRACT');
  }
  const labels = {VALID:'資料完整',PARTIAL_DATA:'部分資料',INSUFFICIENT_DATA:'資料不足',
    STALE:'資料待更新',ERROR:'計算未完成'};
  return {scoreText:row.score === null ? '—' : String(row.score),
    statusText:labels[row.status],confidence:row.confidence,version:row.version,
    completeness:row.completeness,missingInputs:row.missing_inputs ?? []};
}
module.exports = {scoreView};
