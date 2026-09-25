const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /id="quick-open"[^>]*data-testid="quick-add"/);
assert.match(html, /id="desktop-quick-open"[^>]*aria-label="快速新增資料"/);
assert.match(html, /getElementById\("quick-open"\)\.addEventListener\("click",handleQuickOpen\)/);
assert.match(html, /getElementById\("desktop-quick-open"\)\.addEventListener\("click",handleQuickOpen\)/);
assert.match(html, /@media\(max-width:767px\)\{[^\n]*\.desktop-quick-open\{display:none\}/);
assert.doesNotMatch(html, /quick-open[^\n]*(?:touchstart|touchend|pointerdown|pointerup)/i);
assert.match(html, /\.sheet-backdrop,\.date-range-backdrop\{[^}]*pointer-events:none/);
assert.match(html, /\.sheet-backdrop\.show,\.date-range-backdrop\.show\{[^}]*pointer-events:auto/);
assert.match(html, /\.mobile-nav\{[^}]*pointer-events:none/);
assert.match(html, /\.mobile-nav button\{[^}]*pointer-events:auto[^}]*touch-action:manipulation/);
assert.match(html, /\.mobile-nav \.add-nav\{[^}]*min-width:48px[^}]*min-height:48px/);
assert.match(html, /function setOverlayOpen\(element,open\)/);
assert.match(html, /function openSheet\(view="quick-sheet"\)\{[\s\S]*?style\.display=id===view\?"block":"none"[\s\S]*?setOverlayOpen\(backdrop,true\)/);
assert.match(html, /function closeSheet\(\{fromHistory=false\}=\{\}\)[\s\S]*?setOverlayOpen\(backdrop,false\)/);
assert.match(html, /function refreshInBackground\(label,task\)/);
assert.match(html, /refreshInBackground\("workout-(?:create|update|batch-update|delete)"[\s\S]*?await refreshAfterRecordMutation\("training"\)/);
assert.doesNotMatch(html, /await loadRange\(globalDateRange,\{force:true\}\);closeSheet\(\)/);
assert.match(html, /await apiService\.upsertBodyRecord\(data\)/);
assert.match(html, /sectionLoadKeys\.delete\("body"\);clearDashboardCache\(\)/);
assert.match(html, /if\(!current\(\)\)return;setSubmitting\(btn,false\);closeSheet\(\);toast/);
assert.match(html, /upsertHealthCheckin\([\s\S]*?\);if\(!current\(\)\)return;setSubmitting\(btn,false\);loadCheckinFormDate\.binding=null;closeSheet\(\);toast\("身體狀態已更新。"\)/);
// Local unresolved writes must retain their envelope before normal draft creation.
assert.match(html, /start-workout"\)\.onclick=\(\)=>requestWorkoutStart\(\)/);
const views=fs.readFileSync(path.join(__dirname,'..','scripts/web-view-state.js'),'utf8');
assert.match(views,/function requestWorkoutStart\(\)[\s\S]*?workoutSession\?\.saving[\s\S]*?workoutSession\?\.sqlLocked[\s\S]*?showModal\(\)[\s\S]*?beginWorkoutDraft\(\)/);
assert.match(views,/function syncQuickAddCapabilities\(\)/);
assert.match(html, /UI_TEST_MODE=/);
assert.match(html, /document\.elementFromPoint\(event\.clientX,event\.clientY\)/);
assert.match(html, /function optimisticUpsertMeals\(records\)/);
assert.match(html, /function revalidateNutritionDate\(date,\{delays=NUTRITION_PUBLICATION_POLL_DELAYS\}=\{\}\)/);
assert.match(html, /clientRequestId:mutationRequestId\(form\)/);
assert.match(html, /function completeMealSave\([\s\S]*?closeSheet\(\);optimisticUpsertMeals/);
assert.doesNotMatch(html, /refreshInBackground\("nutrition",\(\)=>refreshAfterRecordMutation\("nutrition"\)\)/);

console.log('Mobile FAB regression tests: PASS');
