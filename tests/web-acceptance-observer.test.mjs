import test from 'node:test';
import assert from 'node:assert/strict';
import {assertExpectedBuild, assertResolvedBetaTarget, assertUnauthenticatedBoundary, filterFirstPartyHttpErrors, observeWebAcceptance, safeResource} from '../scripts/web-acceptance-observer.mjs';

class FakePage {
  handlers = new Map();
  on(name, handler) { this.handlers.set(name, handler); }
  emit(name, value) { this.handlers.get(name)?.(value); }
}

const request = (method, url, errorText = '') => ({method:()=>method,url:()=>url,failure:()=>({errorText})});

test('observer strips query and fragment data from every stored resource', () => {
  assert.equal(safeResource('https://example.test/path?access_token=secret#fragment'), 'https://example.test/path');
  assert.equal(safeResource('not a url'), 'INVALID_URL');
});

test('observer separates intentionally blocked writes from unexpected failures without retaining payloads', () => {
  const page = new FakePage();
  const observer = observeWebAcceptance(page);
  const blocked = request('POST','https://example.test/write?token=secret','net::ERR_BLOCKED_BY_CLIENT');
  observer.markExpectedBlock(blocked);
  page.emit('requestfailed', blocked);
  page.emit('requestfailed', request('GET','https://example.test/read?token=secret','net::ERR_CONNECTION_RESET'));
  page.emit('console', {type:()=> 'warning'});
  page.emit('console', {type:()=> 'error'});
  page.emit('pageerror', new Error('sensitive text must not be retained'));
  const snapshot = observer.snapshot();
  assert.equal(snapshot.failed_requests[0].expected, true);
  assert.equal(snapshot.failed_requests[0].resource, 'https://example.test/write');
  assert.equal(snapshot.unexpected_failed_requests.length, 1);
  assert.equal(snapshot.unexpected_failed_requests[0].resource, 'https://example.test/read');
  assert.deepEqual(snapshot.console, {warning:1,error:1});
  assert.equal(snapshot.page_errors, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|sensitive text/u);
});

test('first-party HTTP filtering is host scoped', () => {
  const page = new FakePage();
  const observer = observeWebAcceptance(page);
  page.emit('response', {status:()=>503,url:()=> 'https://beta.example.test/app?secret=1'});
  page.emit('response', {status:()=>404,url:()=> 'https://cdn.example.test/font'});
  const snapshot = observer.snapshot();
  assert.deepEqual(filterFirstPartyHttpErrors(snapshot,['beta.example.test']), [{status:503,resource:'https://beta.example.test/app'}]);
});

test('build comparison and unauthenticated boundary fail closed', () => {
  assert.equal(assertExpectedBuild('candidate-1',{liveDeployedBuildId:'candidate-1',liffLoadedBuildId:'candidate-1'}),true);
  assert.throws(()=>assertExpectedBuild('',{}),/EXPECTED_BUILD_ID_REQUIRED/u);
  assert.throws(()=>assertExpectedBuild('candidate-1',{liveDeployedBuildId:'old',liffLoadedBuildId:'candidate-1'}),/LIVE_DEPLOYED_BUILD_MISMATCH/u);
  assert.throws(()=>assertExpectedBuild('candidate-1',{liveDeployedBuildId:'candidate-1',liffLoadedBuildId:'old'}),/LIFF_LOADED_BUILD_MISMATCH/u);
  const safe={authenticatedAppVisible:false,authenticatedAppAriaHidden:true,authenticatedAppInert:true,loginVisible:true,accessGateVisible:false};
  assert.equal(assertUnauthenticatedBoundary(safe),true);
  assert.throws(()=>assertUnauthenticatedBoundary({...safe,authenticatedAppVisible:true}),/UNAUTHENTICATED_APP_VISIBLE/u);
  assert.throws(()=>assertUnauthenticatedBoundary({...safe,authenticatedAppAriaHidden:false,authenticatedAppInert:false}),/UNAUTHENTICATED_APP_NOT_INERT/u);
  assert.throws(()=>assertUnauthenticatedBoundary({...safe,loginVisible:false}),/AUTH_BOUNDARY_NOT_VISIBLE/u);
});

test('resolved live target must remain on the exact Beta Pages application', () => {
  const liff='https://liff.line.me/2011116657-9SpSnQlN?range=30d';
  assert.equal(assertResolvedBetaTarget(liff,'https://d0252422-oss.github.io/health-companion-beta/'),true);
  assert.equal(assertResolvedBetaTarget(liff,'https://d0252422-oss.github.io/haelth-companion/'),true);
  assert.equal(assertResolvedBetaTarget('http://127.0.0.1:8080/index.html','http://127.0.0.1:8080/index.html'),true);
  assert.throws(()=>assertResolvedBetaTarget(liff,'https://d0252422-oss.github.io/health-companion/'),/UNAPPROVED_RESOLVED_TARGET/u);
  assert.throws(()=>assertResolvedBetaTarget(liff,'https://vptqedxdxfoohbqctujf.supabase.co/'),/UNAPPROVED_RESOLVED_TARGET/u);
  assert.throws(()=>assertResolvedBetaTarget(liff,'not-a-url'),/UNAPPROVED_RESOLVED_TARGET/u);
});
