'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const html=fs.readFileSync('index.html','utf8');
const hosted=fs.readFileSync('scripts/local-engine-web.js','utf8');
const observations=fs.readFileSync('scripts/manual-observation-web.js','utf8');
const runtime=fs.readFileSync('supabase/functions/mobile-health-beta/local-engine-runtime.ts','utf8');

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
  assert.match(html,/clearExerciseCache\(\);clearPersonalState\(\);showLogin/u);
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
  assert.match(observations,/refresh=async\(\)=>\{await refreshSectionRange/u);
  assert.doesNotMatch(observations,/refreshDerivedData/u);
  assert.doesNotMatch(html,/revalidateNutritionDate\(date\)\{[^}]*refreshDailyNutrition/u);
});
