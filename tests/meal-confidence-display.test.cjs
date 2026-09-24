const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const functionSource = html.split(/\r?\n/u).find(line => line.includes('function mealConfidenceText('));

test('meal confidence preserves UNKNOWN instead of inventing zero percent', () => {
  assert.ok(functionSource, 'mealConfidenceText must exist');
  const context = vm.createContext({});
  vm.runInContext(functionSource, context);
  for (const value of [undefined, null, '', false, '0.8', 'bad', -0.1, 1.1, Infinity]) {
    context.value = value;
    assert.equal(vm.runInContext('mealConfidenceText(value)', context), '信心未知');
  }
  for (const [value, expected] of [[0, '低信心，請確認 · 0%'], [0.6, '中等信心 · 60%'], [0.8, '高信心 · 80%'], [1, '高信心 · 100%']]) {
    context.value = value;
    assert.equal(vm.runInContext('mealConfidenceText(value)', context), expected);
  }
});

test('meal analysis rendering uses the bounded confidence formatter for item and overall state', () => {
  const renderLine = html.split(/\r?\n/u).find(line => line.includes('function renderMealAnalysis(')) || '';
  assert.match(renderLine, /mealConfidenceText\(food\.confidence\)/u);
  assert.match(renderLine, /mealConfidenceText\(mealAnalysis\?\.overallConfidence\)/u);
  assert.doesNotMatch(renderLine, /Number\((?:food\.confidence|mealAnalysis\?\.overallConfidence)\|\|0\)/u);
});
