'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const html=fs.readFileSync('index.html','utf8');
const hosted=fs.readFileSync('scripts/local-engine-web.js','utf8');
const observations=fs.readFileSync('scripts/manual-observation-web.js','utf8');
const runtime=fs.readFileSync('supabase/functions/mobile-health-beta/local-engine-runtime.ts','utf8');
const profiler=fs.readFileSync('scripts/profile-web-performance.mjs','utf8');

test('initial document does not synchronously compile Tailwind or block on LINE SDK',()=>{
  assert.doesNotMatch(html,/cdn\.tailwindcss\.com/u);
  assert.match(html,/<script id="lucide-sdk" async/u);
  assert.doesNotMatch(html,/<script[^>]+static\.line-scdn\.net/u);
  assert.match(html,/function isLikelyLineContext/u);
  assert.match(html,/script\.src="https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js";script\.async=true/u);
  assert.match(html,/rel="stylesheet" media="print" onload="this\.media='all'"/u);
});

test('hosted bootstrap reuses the authenticated provider identity result',()=>{
  assert.match(hosted,/getManualProviderIdentity/u);
  assert.match(hosted,/action==='getCurrentUser'&&hostedManualBinding\?\.token===sessionToken/u);
  assert.match(hosted,/return \{user:\{userId:hostedManualBinding\.canonical\},access:hostedManualBinding\.access\}/u);
});

test('exercise catalog is user/provider scoped, bounded and prefetched after dashboard readiness',()=>{
  assert.match(html,/EXERCISE_CACHE_TTL=10\*60\*1000/u);
  assert.match(html,/dashboardProviderNamespace\(\).*currentUser\?\.userId/u);
  assert.match(html,/sessionStorage\.getItem\(exerciseCacheKey\(\)\)/u);
  assert.match(html,/scheduleExerciseCatalogPrefetch\(\);perfLog\("boot-ready"/u);
  assert.match(html,/function purgePrivateClientState\(\)[\s\S]*?healthCompanionExercises/u);
  const clearPersonalState=html.match(/function clearPersonalState\(\)\{[^\n]+/u)?.[0]||'';
  assert.match(clearPersonalState,/clearLocalManualState/u);
  assert.match(clearPersonalState,/purgePrivateClientState/u);
  assert.ok(clearPersonalState.indexOf('clearLocalManualState')<clearPersonalState.indexOf('purgePrivateClientState'));
});

test('sleep and activity begin canonical and manual reads in parallel',()=>{
  for(const section of ['sleep','activity'])assert.match(html,new RegExp(`if\\(section==="${section}"\\)\\{const manual=refreshManualObservationList\\(section,start,end\\)\\.then`,'u'));
});

test('durable manual writes release the UI before bounded score recomputation',()=>{
  assert.match(runtime,/scheduleDrain\(user: string\)/u);
  assert.match(runtime,/EdgeRuntime\?\.waitUntil/u);
  for(const action of ['manualObservations','manualBody'])assert.match(runtime,new RegExp(`data = await this\\.${action}\\.write[\\s\\S]{0,220}this\\.scheduleDrain\\(identity\\.canonical\\)`,'u'));
  assert.match(runtime,/data = \{ \.\.\.data, status: "SAVED", analysisStatus: "ANALYSIS_PENDING" \}/u);
  assert.doesNotMatch(runtime,/try\s*\{\s*await this\.drain\(identity\.canonical\);\s*data\.analysisStatus/u);
  assert.match(observations,/publicationDelays=result\?\.analysisJobScheduled===false\?\[0\]:\[0,\.\.\.MANUAL_OBSERVATION_PUBLICATION_DELAYS\][\s\S]*?for\(const delayMs of publicationDelays\)[\s\S]*?refreshAfterRecordMutation\(section\)/u);
  assert.doesNotMatch(observations,/refreshDerivedData/u);
  assert.doesNotMatch(html,/revalidateNutritionDate\(date\)\{[^}]*refreshDailyNutrition/u);
  assert.match(html,/if\(result\?\.analysisJobScheduled!==false\)\{const recomputeStarted=performance\.now\(\);try\{await apiService\.refreshDerivedData\("workout",workoutDate\)/u);
  assert.match(html,/result\?\.analysisJobScheduled===false\?`訓練完成：\$\{totalSets\} 組已儲存・紀錄更新中。`/u);
});

test('sheet focus work is scoped to the active form instead of every hidden form',()=>{
  assert.match(html,/function overlayFocusScope\(element\)\{const activeView=element\?\.id==="sheet-backdrop"\?element\.dataset\.activeView/);
  assert.match(html,/backdrop\.dataset\.activeView=view;backdrop\.setAttribute\("aria-labelledby"/);
  assert.match(html,/function overlayFocusable\(element\)\{return \[\.\.\.overlayFocusScope\(element\)\.querySelectorAll/);
});

test('performance acceptance measures form visibility and actual input readiness separately',()=>{
  assert.match(profiler,/async function timedOpen\(/u);
  assert.match(profiler,/name\+'_visual_ms'/u);
  assert.match(profiler,/name\+'_interactive_ms'/u);
  for(const flow of ['weight_open','nutrition_open','sleep_open','steps_open','energy_open','exercise_picker'])assert.match(profiler,new RegExp(`['"]${flow}['"]`,'u'));
  assert.match(profiler,/visual_median_ms!==null&&flow\.visual_median_ms<=100/u);
  assert.match(profiler,/interactive_median_ms!==null&&flow\.interactive_median_ms<=300/u);
});
