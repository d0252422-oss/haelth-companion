const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /id="quick-open"[^>]*data-testid="quick-add"/);
assert.match(html, /getElementById\("quick-open"\)\.addEventListener\("click",handleQuickOpen\)/);
assert.doesNotMatch(html, /quick-open[^\n]*(?:touchstart|touchend|pointerdown|pointerup)/i);
assert.match(html, /\.sheet-backdrop,\.date-range-backdrop\{[^}]*pointer-events:none/);
assert.match(html, /\.sheet-backdrop\.show,\.date-range-backdrop\.show\{[^}]*pointer-events:auto/);
assert.match(html, /\.mobile-nav\{[^}]*pointer-events:none/);
assert.match(html, /\.mobile-nav button\{[^}]*pointer-events:auto[^}]*touch-action:manipulation/);
assert.match(html, /\.mobile-nav \.add-nav\{[^}]*min-width:48px[^}]*min-height:48px/);
assert.match(html, /function setOverlayOpen\(element,open\)/);
assert.match(html, /function openSheet\(view="quick-sheet"\)\{[^}]*style\.display=id===view\?"block":"none"[^}]*setOverlayOpen\(backdrop,true\)/);
assert.match(html, /function closeSheet\(\)\{setOverlayOpen\(document\.getElementById\("sheet-backdrop"\),false\);\}/);
assert.match(html, /function refreshInBackground\(label,task\)/);
assert.doesNotMatch(html, /await refreshAfterRecordMutation\(/);
assert.doesNotMatch(html, /await loadRange\(globalDateRange,\{force:true\}\);closeSheet\(\)/);
assert.match(html, /upsertBodyRecord\(data\);setSubmitting\(btn,false\);closeSheet\(\);toast/);
assert.match(html, /upsertHealthCheckin\([\s\S]*?\);closeSheet\(\);toast\("身體狀態已更新。"\)/);
assert.match(html, /start-workout"\)\.onclick=\(\)=>\{workoutSession=/);
assert.match(html, /UI_TEST_MODE=/);
assert.match(html, /document\.elementFromPoint\(event\.clientX,event\.clientY\)/);
assert.match(html, /function optimisticUpsertMeals\(records\)/);
assert.match(html, /function revalidateNutritionDate\(date\)/);
assert.match(html, /clientRequestId:mutationRequestId\(form\)/);
assert.match(html, /function completeMealSave\([\s\S]*?closeSheet\(\);optimisticUpsertMeals/);
assert.doesNotMatch(html, /refreshInBackground\("nutrition",\(\)=>refreshAfterRecordMutation\("nutrition"\)\)/);

console.log('Mobile FAB regression tests: PASS');
