const assert = require('assert');
const fs = require('fs');
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

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /--font-ui:"Microsoft JhengHei","微軟正黑體","Noto Sans TC",sans-serif/);
assert.match(html, /family=Noto\+Sans\+TC/);
assert.doesNotMatch(html, /DM Sans|Fraunces/);
assert.match(html, /svg text\{font-family:var\(--font-ui\)\}/);
assert.match(html, /weightTrendRows=body\.filter\(row=>num\(row\.weight\)!==null\)/);
assert.doesNotMatch(html, /weightTrendRows=body\.filter\([^\n]+\.slice\(-7\)/);
assert.match(html, /renderTrendChart\("dashboard-weight-chart",weightTrendRows,\{metric:"weight",compact:true\}\)/);
assert.doesNotMatch(html, /renderTrendChart\("dashboard-weight-chart"[^\n]*showDataLabels:false/);
assert.match(html, /function positionTrendAtLatest\(scroll\)/);
assert.match(html, /function bindTrendDrag\(scroll\)/);
assert.match(html, /touchmove/);
assert.match(html, /passive:false/);
assert.match(html, /touch-action:pan-y/);
assert.match(html, /左右滑動查看全部/);
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
assert.strictEqual(evaluate('metricDisplay("weight",86.444,{full:true,overrides:{decimalPlaces:2}})'), '86.44 kg');
assert.strictEqual(evaluate('normalizeTrendData([{date:"2026-08-09",weight:86.6},{date:"2026-08-10",weight:null},{date:"2026-08-11",weight:88}],"weight").length'), 2);
assert.strictEqual(evaluate('normalizeTrendData([{date:"2026-08-09",weight:86.6},{date:"2026-08-10",weight:null},{date:"2026-08-11",weight:88}],"weight",true).length'), 3);
assert.strictEqual(evaluate('trendViewportWidth({clientWidth:900})'), 334);

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
assert.match(longBox.innerHTML, /左右滑動查看全部 30 筆資料/);
assert.match(longBox.innerHTML, /class="trend-scroll is-scrollable"/);
assert.match(longBox.innerHTML, /width="2056"/);

console.log('Trend chart unit tests: PASS');
