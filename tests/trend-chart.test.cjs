const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement() {
  return {
    clientWidth: 390,
    innerHTML: '',
    textContent: '',
    value: 'weight',
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    replaceChildren() {},
    remove() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const elements = new Map();
const document = {
  body: fakeElement(),
  head: fakeElement(),
  documentElement: fakeElement(),
  createElement: fakeElement,
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  },
};
const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const context = {
  console,
  document,
  localStorage: storage,
  sessionStorage: storage,
  location: { search: '', href: 'http://127.0.0.1/' },
  history: { replaceState() {} },
  navigator: {},
  fetch: async () => { throw new Error('fetch must not run in this unit test'); },
  AbortController,
  URL,
  URLSearchParams,
  Intl,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  Map,
  Set,
  Promise,
  performance: { now: () => 0 },
  Blob,
  setTimeout: () => 1,
  clearTimeout() {},
  requestAnimationFrame(callback) { callback(); },
  innerWidth: 390,
  innerHeight: 844,
  scrollTo() {},
  matchMedia() { return { matches: false }; },
  lucide: { createIcons() {} },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /--font-ui:"Microsoft JhengHei","微軟正黑體","Noto Sans TC",sans-serif/);
assert.match(html, /family=Noto\+Sans\+TC/);
assert.doesNotMatch(html, /DM Sans|Fraunces/);
assert.match(html, /svg text\{font-family:var\(--font-ui\)\}/);
assert.match(html, /const DEFAULT_SHARED_METRICS=\["weight","fatMass","sleepHours","trainingSets","caloriesBurned","caloriesIntake"\]/);
assert.match(html, /function renderSharedHealthTrends\(force=false\)/);
assert.match(html, /function bindSharedTrendInteraction\(\)/);
assert.match(html, /function normalizeHealthTimeline\(payload\)/);
assert.match(html, /getHealthTimeline:\(start,end\)=>apiGet\("getHealthTimeline"/);
assert.match(html, /const DASHBOARD_CACHE_SCHEMA="v4"/);
assert.match(html, /function dedupedRequest\(key,load\)/);
assert.match(html, /function positionTrendAtLatest\(scroll\)/);
assert.match(html, /function bindTrendDrag\(scroll\)/);
assert.match(html, /function bindTrendNavigation\(box,scroll\)/);
assert.match(html, /trend-scroll-prev/);
assert.match(html, /trend-scroll-next/);
assert.match(html, /\.analysis-grid>\*\{min-width:0;max-width:100%\}/);
assert.match(html, /touch-action:pan-x pan-y/);
assert.match(html, /\.chart-card\{[^}]*overflow:hidden/);
assert.match(html, /touchmove/);
assert.match(html, /passive:false/);
assert.match(html, /id="muscle-group-select"/);
assert.match(html, /function exerciseMuscleGroup\(exercise\)/);
assert.match(html, /function renderExerciseOptions\(group\)/);
assert.match(html, /function renderMuscleGroupOptions\(\)/);
assert.match(html, /renderExerciseOptions\(groupSelect\.value\)/);
assert.match(html, /id="workout-date"/);
assert.match(html, /id="workout-edit-form"/);
assert.match(html, /updateWorkoutSet:data=>apiPost\("updateWorkoutSet",data\)/);
assert.match(html, /deleteWorkoutSet:recordId=>apiPost\("deleteWorkoutSet",\{recordId\}\)/);
assert.match(html, /class="workout-edit-button secondary-button"/);
assert.match(html, /date:workoutDate/);
assert.match(html, /查看較舊資料/);
assert.match(html, /id="global-range"[^>]*>[\s\S]*value="7d"[\s\S]*value="30d"[\s\S]*value="90d"[\s\S]*value="year"[\s\S]*value="custom"/);
assert.match(html, /const DATE_RANGE_STORAGE_KEY="healthCompanionDateRange"/);
assert.match(html, /function resolveDateRange\(preset="30d",custom=\{\}\)/);
assert.match(html, /function applyGlobalDateRange\(next\)/);
assert.match(html, /id="date-range-form"/);
assert.match(html, /id="global-start-date"/);
assert.match(html, /id="global-end-date"/);
assert.match(html, /const PAGE_HEADERS=/);
assert.match(html, /function updatePageHeader\(screen=activeScreen\)/);
assert.doesNotMatch(html, /data-range-area=/);
assert.doesNotMatch(html, /id="body-custom-range"/);
assert.match(html, /--space-1:4px/);
assert.match(html, /--radius-card:15px/);
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(value => value.trim());
vm.runInContext(script, context, { filename: 'index.inline.js' });

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

assert.strictEqual(evaluate('metricDisplay("weight",86.44,{full:true})'), '86.4 kg');
assert.strictEqual(evaluate('metricDisplay("bodyFat",28.63,{full:true})'), '28.63%');
assert.strictEqual(evaluate('metricDisplay("fatMass",24.744,{full:true})'), '24.74 kg');
assert.strictEqual(evaluate('metricDisplay("steps",11420,{full:false})'), '11.4k');
assert.strictEqual(evaluate('metricDisplay("steps",11420,{full:true})'), '11,420 步');
assert.strictEqual(evaluate('metricDisplay("sleepDuration",450,{full:true})'), '7.5 hr');
assert.strictEqual(evaluate('metricDisplay("sleepHours",7.5,{full:true})'), '7.5 hr');
assert.strictEqual(evaluate('metricDisplay("weight",86.444,{full:true,overrides:{decimalPlaces:2}})'), '86.44 kg');
assert.strictEqual(evaluate('normalizeTrendData([{date:"2026-08-09",weight:86.6},{date:"2026-08-10",weight:null},{date:"2026-08-11",weight:88}],"weight").length'), 2);
assert.strictEqual(evaluate('normalizeTrendData([{date:"2026-08-09",weight:86.6},{date:"2026-08-10",weight:null},{date:"2026-08-11",weight:88}],"weight",true).length'), 3);
assert.strictEqual(evaluate('trendViewportWidth({clientWidth:900})'), 334);
const sevenDayRange = JSON.parse(JSON.stringify(evaluate('resolveDateRange("7d")')));
assert.strictEqual(sevenDayRange.endDate, evaluate('getLocalDateString()'));
assert.strictEqual((new Date(`${sevenDayRange.endDate}T12:00:00Z`) - new Date(`${sevenDayRange.startDate}T12:00:00Z`)) / 86400000, 6);
assert.deepStrictEqual(JSON.parse(JSON.stringify(evaluate('resolveDateRange("custom",{startDate:"2026-08-01",endDate:"2026-08-12"})'))), { startDate: '2026-08-01', endDate: '2026-08-12' });

const timeline = evaluate(`normalizeHealthTimeline({timeline:[
  {date:"2026-08-14",weight:86.5,bodyFatPercentage:28,sleepHours:null,trainingSets:0,caloriesIntake:null},
  {date:"2026-08-15",weight:86.4,bodyFatPercentage:28.5,sleepHours:7.5,trainingSets:12,caloriesIntake:1900}
]})`);
assert.strictEqual(timeline.length, 2);
assert.strictEqual(timeline[0].fatMass, 24.22);
assert.strictEqual(timeline[0].trainingSets, 0);
assert.strictEqual(timeline[0].caloriesIntake, null);
context.__timeline = timeline;
evaluate('appState.healthTimeline=__timeline;selectedHealthDate="2026-08-15";sharedTrendMetrics=["weight","sleepHours","trainingSets","caloriesIntake"];renderSharedHealthTrends(true)');
assert.match(document.getElementById('shared-health-trends').innerHTML, /data-metric="weight"/);
assert.match(document.getElementById('shared-health-trends').innerHTML, /data-metric="sleepHours"/);
assert.match(document.getElementById('shared-health-trends').innerHTML, /shared-cursor/);
assert.match(document.getElementById('daily-detail-grid').innerHTML, /熱量平衡/);

const nutrition = evaluate(`dailyNutritionRows([
  {date:"2026-08-14",includedInTotals:true,calories:500,protein:30,carbs:60,fat:15},
  {date:"2026-08-14",includedInTotals:false,calories:900,protein:80,carbs:90,fat:40},
  {date:"2026-08-15",includedInTotals:false,calories:700}
])`);
assert.deepStrictEqual(JSON.parse(JSON.stringify(nutrition)), [
  { date: '2026-08-14', calories: 500, protein: 30, carbs: 60, fat: 15 },
  { date: '2026-08-15', calories: null, protein: null, carbs: null, fat: null },
]);

const gapped = evaluate('fillDailyGaps([{date:"2026-08-13",calories:1800},{date:"2026-08-15",calories:1900}],{start:"2026-08-13",end:"2026-08-15"})');
assert.strictEqual(gapped.length, 3);
assert.strictEqual(gapped[1].date, '2026-08-14');
assert.strictEqual(gapped[1].calories, undefined);

const bodyBox = document.getElementById('body-trend-chart');
evaluate(`renderTrendChart("body-trend-chart",[
  {date:"2026-08-13",weight:86.8},
  {date:"2026-08-14",weight:86.5},
  {date:"2026-08-15",weight:86.4}
],{metric:"weight"})`);
assert.match(bodyBox.innerHTML, />86\.8</);
assert.match(bodyBox.innerHTML, />86\.5</);
assert.match(bodyBox.innerHTML, />86\.4 kg</);
assert.match(bodyBox.innerHTML, /data-full-value="86\.4 kg"/);
assert.match(bodyBox.innerHTML, /trend-latest-ring/);

evaluate(`renderTrendChart("body-trend-chart",[
  {date:"2026-08-09",weight:86.6},
  {date:"2026-08-10",weight:null},
  {date:"2026-08-11",weight:88}
],{metric:"weight"})`);
assert.strictEqual((bodyBox.innerHTML.match(/class="trend-hit"/g)||[]).length, 2);
assert.match(bodyBox.innerHTML, /width="334"/);

evaluate('renderTrendChart("body-trend-chart",[{date:"2026-08-15",weight:86.4}],{metric:"weight",targetValue:85,labelFormatter:value=>`值 ${value}`,tooltipFormatter:value=>`${value} 公斤`})');
assert.match(bodyBox.innerHTML, /值 86\.4/);
assert.match(bodyBox.innerHTML, /data-full-value="86\.4 公斤"/);
assert.match(bodyBox.innerHTML, /stroke-dasharray="5 5"/);

const longBox = document.getElementById('nutrition-trend-chart');
const thirtyDays = Array.from({ length: 30 }, (_, index) => ({
  date: `2026-07-${String(index + 1).padStart(2, '0')}`,
  calories: 1800 + index,
}));
context.__thirtyDays = thirtyDays;
evaluate('renderTrendChart("nutrition-trend-chart",__thirtyDays,{metric:"calories"})');
assert.match(longBox.innerHTML, /全部 30 筆/);
assert.match(longBox.innerHTML, /class="trend-scroll is-scrollable"/);
assert.match(longBox.innerHTML, /查看較舊資料/);
assert.match(longBox.innerHTML, /查看較新資料/);
assert.match(longBox.innerHTML, /width="2056"/);

evaluate(`exerciseDatabase=[
  {exerciseId:"EX1",exerciseName:"Bench Press",muscleGroup:"Chest",active:true},
  {exerciseId:"EX2",exerciseName:"Fly",muscleGroup:"Chest",active:true},
  {exerciseId:"EX3",exerciseName:"Row",muscleGroup:"Back",active:true},
  {exerciseId:"EX4",exerciseName:"Disabled",muscleGroup:"Chest",active:false}
]`);
evaluate('renderMuscleGroupOptions()');
const groupSelect = document.getElementById('muscle-group-select');
const exerciseSelect = document.getElementById('exercise-select');
assert.match(groupSelect.innerHTML, />Chest</);
assert.match(groupSelect.innerHTML, />Back</);
assert.match(exerciseSelect.innerHTML, />Bench Press</);
assert.match(exerciseSelect.innerHTML, />Fly</);
assert.doesNotMatch(exerciseSelect.innerHTML, /Disabled/);
evaluate('renderExerciseOptions("Back")');
assert.match(exerciseSelect.innerHTML, />Row</);
assert.doesNotMatch(exerciseSelect.innerHTML, /Bench Press/);

console.log('Trend chart unit tests: PASS');
