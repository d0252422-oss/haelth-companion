(function (root) {
  'use strict';

  const BUILD_ID = '20260925-score-convergence-01';
  const RECOVERY_PREFIX = 'healthCompanionBuildRecovery:';

  function recoveryUrl(href, liveBuildId) {
    const url = new URL(href);
    url.searchParams.set('v', liveBuildId);
    return url.toString();
  }

  function shouldRecover(expectedBuildId, liveBuildId, recoveredBuildId) {
    return Boolean(liveBuildId && liveBuildId !== expectedBuildId && recoveredBuildId !== liveBuildId);
  }

  async function checkLiveBuild(options = {}) {
    const fetchImpl = options.fetchImpl || root.fetch?.bind(root);
    const storage = options.storage || root.sessionStorage;
    const location = options.location || root.location;
    const expectedBuildId = options.expectedBuildId || BUILD_ID;
    const entryVersionToken = new URL(location.href).searchParams.get('v') || null;
    const diagnostics = root.HEALTH_BUILD_DIAGNOSTICS = {
      expectedBuildId,
      liveDeployedBuildId: null,
      liffLoadedBuildId: expectedBuildId,
      entryVersionToken,
      recovery: 'NOT_REQUIRED'
    };
    root.EXPECTED_BUILD_ID = expectedBuildId;
    root.LIFF_LOADED_BUILD_ID = expectedBuildId;
    if (!fetchImpl) return diagnostics;
    try {
      const response = await fetchImpl(`build.json?expected=${encodeURIComponent(expectedBuildId)}&t=${Date.now()}`, {cache: 'no-store'});
      if (!response.ok) throw Error(`BUILD_MANIFEST_HTTP_${response.status}`);
      const manifest = await response.json();
      const liveBuildId = typeof manifest?.buildId === 'string' ? manifest.buildId : '';
      diagnostics.liveDeployedBuildId = liveBuildId || null;
      root.LIVE_DEPLOYED_BUILD_ID = diagnostics.liveDeployedBuildId;
      const key = RECOVERY_PREFIX + liveBuildId;
      const recoveredBuildId = storage?.getItem(key) || '';
      if (shouldRecover(expectedBuildId, liveBuildId, recoveredBuildId)) {
        storage?.setItem(key, liveBuildId);
        diagnostics.recovery = 'ONE_TIME_RELOAD';
        location.replace(recoveryUrl(location.href, liveBuildId));
      }
      return diagnostics;
    } catch (error) {
      diagnostics.recovery = 'CHECK_UNAVAILABLE';
      diagnostics.error = error?.message || String(error);
      return diagnostics;
    }
  }

  const api = {BUILD_ID, recoveryUrl, shouldRecover, checkLiveBuild};
  root.HealthBuildVersion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.location) void checkLiveBuild();
})(typeof globalThis !== 'undefined' ? globalThis : window);
