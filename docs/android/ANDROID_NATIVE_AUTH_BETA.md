# Android native authentication — Beta

## Selected strategy

`NATIVE_GOOGLE_ID_TOKEN`

Beta 0.1.0-beta.7 keeps the native auth path and adds user-scoped background state,
single-flight manual sync, bounded foreground sync,
paginated Health Connect reads, and best-effort WorkManager history backfill. After
Supabase verifies the Google ID token, the Beta Edge runtime derives the
canonical binding from the verified Google provider subject. Client-provided
user identifiers, email addresses, and legacy web-session tokens are rejected
on the native linking route.

The Android companion uses Android Credential Manager and Google ID Services. A Google ID token is exchanged through the official Supabase Auth client. The Beta Edge Function validates the resulting Supabase access token with `auth.getUser`, requires a Google-backed identity, and resolves the canonical Health Companion user from a private one-to-one mapping.

The same Google ID token is also presented to the existing Health Companion web-auth service once during account linking. The returned short-lived web session is verified server-side and is used only to bind the Supabase auth UUID to the existing canonical user. Client-supplied user IDs are never trusted.

## Normal user flow

1. Install and open the Beta APK.
2. Tap **使用 Google 帳號登入** and choose an account.
3. Approve the existing least-privilege Health Connect read permissions.
4. The app performs the first bounded, authenticated sync automatically.
5. The app shows sync success, no-data, or a recoverable error state.

No connection code, token, server URL, account ID, or technical configuration is entered by the user.

## Session security

- Supabase access/refresh session state is managed by the official client.
- Stored session JSON and PKCE verifier state are AES-GCM encrypted with a non-exportable Android Keystore key.
- Logout clears both Supabase session state and Android Credential Manager state.
- Requests send `Authorization: Bearer <access token>`; tokens are never logged or displayed.
- The Edge Function derives the canonical user through a service-role-only mapping RPC.
- Legacy install-claim routes remain available for isolated diagnostics but are not called from `MainActivity`.

## Required external Beta configuration

The repository intentionally contains no OAuth secret. Before a runtime test:

1. In the Google Cloud project dedicated to Beta, create/configure an Android OAuth client for the tested package and signing-certificate SHA-1.
2. Keep a Google Web OAuth client as the ID-token server audience.
3. In Supabase project `uavimjgccigpbwqmfkhh`, enable the Google provider with that Web client ID and its client secret.
4. Configure CI/repository variables for the public Supabase publishable key and Google Web client ID.
5. Apply the scoped Beta identity-link migration and deploy the updated Beta Edge Function only after verifying the target project guard.

No redirect URI is required by the selected native ID-token flow. Do not add the Google client secret, Supabase service-role key, or database credentials to the APK or repository.

### Current development-signed artifact identity

- Package: `app.healthcompanion.sync.beta.debug`
- Version: `0.1.0-beta.7-debug` (`versionCode 7`)
- Periodic work: unique `health-sync-periodic`, every 12 hours, `ExistingPeriodicWorkPolicy.KEEP`.
- Historical backfill: unique one-time `health-sync-history-backfill`, `ExistingWorkPolicy.KEEP`.
- Constraints: connected network; no permanent foreground service, wake lock, or polling loop.
- Retry: exponential 30-second WorkManager backoff, at most three worker attempts, eight-minute worker deadline.
- Incremental window: last successful sync minus one hour through now; seven-day fallback; pending history remains bounded to 30 days.
- Local timestamps, background result, and history state are scoped by a hash of the canonical user ID and cleared on logout.
- Foreground window: 7 days with a 120-second terminal deadline
- History window: 30 days through unique, network-constrained WorkManager jobs
- Background execution is OS-scheduled best effort; it is not advertised as real-time.
- Signing certificate SHA-1: `D1:A7:F6:7A:C2:F5:2B:EF:06:DF:B3:E4:D5:8A:56:47:DF:53:34:65`
- Signing certificate SHA-256: `43:5E:F9:65:1E:6B:6C:31:41:EC:FC:33:70:B5:7E:15:E9:3D:3E:CF:3C:2A:72:2D:ED:8B:6A:A8:75:42:43:00`

This debug certificate identity is suitable only for the current development-signed real-device gate. A future non-debug Beta signing identity needs a separate Android OAuth client registration for package `app.healthcompanion.sync.beta` and that signing certificate.

## Runtime gate

Code and static tests do not prove Google OAuth, account identity convergence, Health Connect permissions, or real data. Those remain a real-device gate after external Beta configuration and a new APK artifact are ready.
