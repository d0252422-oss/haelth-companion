'use strict';

const PLATFORM = Object.freeze({ ANDROID: 'ANDROID', IOS: 'IOS', OTHER: 'OTHER' });
const CONNECTION_STATES = new Set(['NOT_INSTALLED_OR_UNKNOWN', 'PERMISSION_REQUIRED', 'CONNECTED', 'SYNCING', 'SYNCED', 'ERROR', 'UNKNOWN', 'PARTIAL', 'REQUESTED']);

function detectPlatform(userAgent = '', platform = '') {
  const evidence = `${userAgent} ${platform}`.toLowerCase();
  if (/android/u.test(evidence)) return PLATFORM.ANDROID;
  if (/iphone|ipad|ipod/u.test(evidence) || (/mac/u.test(platform.toLowerCase()) && /mobile/u.test(userAgent.toLowerCase()))) return PLATFORM.IOS;
  return PLATFORM.OTHER;
}

function normalizeTesterAccessConfig(input = {}) {
  const cleanUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
  };
  return Object.freeze({
    androidApkUrl: cleanUrl(input.ANDROID_BETA_APK_URL),
    iosShortcutUrl: cleanUrl(input.IOS_SHORTCUT_SHARE_URL),
    androidVersion: String(input.ANDROID_BETA_APK_VERSION || '準備中'),
    shortcutVersion: String(input.IOS_SHORTCUT_VERSION || '準備中'),
    connectorVersion: String(input.CONNECTOR_VERSION || 'hdl-v2.connector-ingestion.v1'),
  });
}

function connectorPresentation(platform, configInput = {}, statusInput = {}) {
  const config = normalizeTesterAccessConfig(configInput);
  const status = CONNECTION_STATES.has(statusInput.connection_status) ? statusInput.connection_status : 'UNKNOWN';
  if (platform === PLATFORM.ANDROID) return Object.freeze({
    platform, connector: 'android_helper', primary: true, href: config.androidApkUrl,
    ready: Boolean(config.androidApkUrl), label: config.androidApkUrl ? '下載 Android Beta' : 'Android 測試版準備中',
    version: config.androidVersion, connectorVersion: config.connectorVersion, status,
  });
  if (platform === PLATFORM.IOS) return Object.freeze({
    platform, connector: 'ios_shortcut', primary: true, href: config.iosShortcutUrl,
    ready: Boolean(config.iosShortcutUrl), label: config.iosShortcutUrl ? '加入健康同步捷徑' : 'iPhone 健康同步捷徑準備中',
    version: config.shortcutVersion, connectorVersion: config.connectorVersion, status,
  });
  return Object.freeze({ platform: PLATFORM.OTHER, connector: null, primary: false, href: null, ready: false, label: '請選擇你的手機', status: 'UNKNOWN' });
}

module.exports = { CONNECTION_STATES, PLATFORM, connectorPresentation, detectPlatform, normalizeTesterAccessConfig };
