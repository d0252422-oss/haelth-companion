const test = require('node:test');
const assert = require('node:assert/strict');
const build = require('../scripts/build-version.js');

test('stale build recovery runs once and preserves LIFF state, route and query', async () => {
  const values = new Map();
  const storage = {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const replacements = [];
  const location = {href:'https://d0252422-oss.github.io/haelth-companion/training?v=old&liff.state=%3Frange%3D30d&source=line',replace:url=>replacements.push(url)};
  const fetchImpl = async () => ({ok:true,json:async()=>({buildId:'20260920-quick-add-v3-02'})});
  await build.checkLiveBuild({fetchImpl,storage,location,expectedBuildId:'old'});
  assert.equal(replacements.length,1);
  const recovered = new URL(replacements[0]);
  assert.equal(recovered.pathname,'/haelth-companion/training');
  assert.equal(recovered.searchParams.get('liff.state'),'?range=30d');
  assert.equal(recovered.searchParams.get('source'),'line');
  assert.equal(recovered.searchParams.get('v'),'20260920-quick-add-v3-02');
  await build.checkLiveBuild({fetchImpl,storage,location,expectedBuildId:'old'});
  assert.equal(replacements.length,1,'the same mismatch must not create a reload loop');
});

test('current embedded build never reloads even when LIFF owns an older entry token', async () => {
  let replacements=0;
  const location={href:'https://d0252422-oss.github.io/haelth-companion/?v=0df82fd&liff.state=%3Frange%3D30d',replace:()=>replacements++};
  const result=await build.checkLiveBuild({fetchImpl:async()=>({ok:true,json:async()=>({buildId:build.BUILD_ID})}),storage:{getItem:()=>null,setItem(){}},location});
  assert.equal(replacements,0);assert.equal(result.liffLoadedBuildId,build.BUILD_ID);assert.equal(result.entryVersionToken,'0df82fd');
});
