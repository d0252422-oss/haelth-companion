const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const sourceLine = name => html.split(/\r?\n/u).find(line => line.includes(`function ${name}(`)) || '';

test('daily nutrition totals include only explicit includedInTotals records', () => {
  const source = sourceLine('dailyNutritionRows');
  assert.ok(source);
  if (source.includes('HealthCoreUX.aggregateNutritionByDate')) {
    assert.match(source, /HealthCoreUX\.aggregateNutritionByDate\(records,CONFIG\.TIMEZONE\)/u);
  } else {
    const context = vm.createContext({
      manualSqlEnabled: () => true,
      localManualTotal: (rows, key) => rows.reduce((sum, row) => sum + row[key], 0),
    });
    vm.runInContext(source, context);
    context.records = [
      { date: '2026-09-24', userConfirmed: true, includedInTotals: true, calories: 200, protein: 20, carbs: 20, fat: 5 },
      { date: '2026-09-24', userConfirmed: true, includedInTotals: false, calories: 900, protein: 90, carbs: 90, fat: 50 },
    ];
    assert.deepEqual(
      JSON.parse(vm.runInContext('JSON.stringify(dailyNutritionRows(records))', context)),
      [{ date: '2026-09-24', calories: 200, protein: 20, carbs: 20, fat: 5 }],
    );
  }
  const renderSource = sourceLine('renderNutrition');
  assert.match(renderSource, /included=meals\.filter\(meal=>meal\.includedInTotals===true\)/u);
  assert.doesNotMatch(renderSource, /userConfirmed===true\|\|/u);
});

test('new analysis food starts unknown rather than fabricating zero nutrients or confidence', () => {
  const handler = html.split(/\r?\n/u).find(line => line.includes('document.getElementById("add-ai-food").onclick')) || '';
  assert.match(handler, /calories:null,protein:null,carbs:null,fat:null,confidence:null/u);
  assert.doesNotMatch(handler, /calories:0|confidence:0/u);
});

test('optimistic dashboard totals keep explicitly excluded meals out', () => {
  const source = sourceLine('optimisticUpsertMeals');
  assert.match(source, /row\.includedInTotals===true/u);
  assert.doesNotMatch(source, /row\.userConfirmed===true\|\|row\.includedInTotals===true/u);
});

test('edited meal totals preserve unknown nutrients instead of fabricating zero', () => {
  const source = sourceLine('calculateEditedMealTotal');
  assert.ok(source);
  if (source.includes('HealthCoreUX.calculateKnownNutrientTotals')) {
    assert.match(source, /HealthCoreUX\.calculateKnownNutrientTotals\(foods\)/u);
    const helper = fs.readFileSync('scripts/core-ux-contract.js', 'utf8');
    const context = vm.createContext({ module: { exports: {} }, exports: {}, require, console });
    vm.runInContext(helper, context);
    const core = context.module.exports;
    assert.deepEqual(core.calculateKnownNutrientTotals([{ calories: null, protein: '', carbs: undefined, fat: null }]), { calories: null, protein: null, carbs: null, fat: null });
  } else {
    const context = vm.createContext({});
    vm.runInContext(source, context);
    const unknown = JSON.parse(vm.runInContext('JSON.stringify(calculateEditedMealTotal([{ calories: null, protein: "", carbs: undefined, fat: null }]))', context));
    assert.deepEqual(unknown, { calories: null, protein: null, carbs: null, fat: null });
  }
});
