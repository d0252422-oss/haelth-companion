// Browser acceptance diagnostics that never retain headers, bodies, query strings,
// fragments, console text, or credentials. Safe to include in local evidence.
function safeResource(raw) {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'INVALID_URL';
  }
}

function requestKey(request) {
  return `${request.method()} ${safeResource(request.url())}`;
}

export function observeWebAcceptance(page) {
  const expectedFailures = new Set();
  const state = {
    console: { warning: 0, error: 0 },
    page_errors: 0,
    failed_requests: [],
    http_errors: [],
  };

  page.on('console', entry => {
    if (entry.type() === 'warning') state.console.warning += 1;
    if (entry.type() === 'error') state.console.error += 1;
  });
  page.on('pageerror', () => { state.page_errors += 1; });
  page.on('requestfailed', request => {
    const key = requestKey(request);
    state.failed_requests.push({
      method: request.method(),
      resource: safeResource(request.url()),
      expected: expectedFailures.has(key),
      failure: /blockedbyclient/iu.test(request.failure()?.errorText || '') ? 'BLOCKED_BY_CLIENT' : 'NETWORK_FAILURE',
    });
  });
  page.on('response', response => {
    if (response.status() >= 400) state.http_errors.push({status: response.status(), resource: safeResource(response.url())});
  });

  return {
    markExpectedBlock(request) { expectedFailures.add(requestKey(request)); },
    snapshot() {
      const failed = state.failed_requests.map(item => ({...item}));
      const http = state.http_errors.map(item => ({...item}));
      return {
        console: {...state.console},
        page_errors: state.page_errors,
        failed_requests: failed,
        unexpected_failed_requests: failed.filter(item => !item.expected),
        http_errors: http,
      };
    },
  };
}

export function filterFirstPartyHttpErrors(snapshot, hosts) {
  const allowed = new Set(hosts);
  return snapshot.http_errors.filter(item => {
    try { return allowed.has(new URL(item.resource).hostname); }
    catch { return true; }
  });
}

export function assertExpectedBuild(expectedBuildId, delivery) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{2,79}$/u.test(expectedBuildId || '')) throw Error('EXPECTED_BUILD_ID_REQUIRED');
  if (delivery?.liveDeployedBuildId !== expectedBuildId) throw Error('LIVE_DEPLOYED_BUILD_MISMATCH');
  if (delivery?.liffLoadedBuildId !== expectedBuildId) throw Error('LIFF_LOADED_BUILD_MISMATCH');
  return true;
}

export function assertResolvedBetaTarget(entryResource, resolvedResource) {
  let entry;
  let resolved;
  try {
    entry = new URL(entryResource);
    resolved = new URL(resolvedResource);
  } catch {
    throw Error('UNAPPROVED_RESOLVED_TARGET');
  }
  const localEntry = ['127.0.0.1', 'localhost'].includes(entry.hostname);
  if (localEntry) {
    if (!['127.0.0.1', 'localhost'].includes(resolved.hostname) || resolved.origin !== entry.origin) {
      throw Error('UNAPPROVED_RESOLVED_TARGET');
    }
    return true;
  }
  if (resolved.protocol !== 'https:' || resolved.port
      || resolved.hostname !== 'd0252422-oss.github.io'
      || !resolved.pathname.startsWith('/health-companion-beta/')) {
    throw Error('UNAPPROVED_RESOLVED_TARGET');
  }
  return true;
}

export function assertUnauthenticatedBoundary(boundary) {
  if (boundary?.authenticatedAppVisible !== false) throw Error('UNAUTHENTICATED_APP_VISIBLE');
  if (boundary?.authenticatedAppInert !== true || boundary?.authenticatedAppAriaHidden !== true) throw Error('UNAUTHENTICATED_APP_NOT_INERT');
  if (boundary?.loginVisible !== true && boundary?.accessGateVisible !== true) throw Error('AUTH_BOUNDARY_NOT_VISIBLE');
  return true;
}

export {safeResource};
