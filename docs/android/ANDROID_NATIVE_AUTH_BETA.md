# Android native authentication — Beta

## Selected strategy

`NATIVE_GOOGLE_ID_TOKEN`

Beta 0.1.0-beta.10 keeps the beta.8 native-auth/session-restore path and beta.9 background-sync architecture. It additionally reconciles persisted local work metadata with WorkManager's durable state at startup so a killed or missing worker cannot leave the UI in `SYNCING` indefinitely.
After the session and user-scoped state are restored, the app renders a usable connected state and enqueues unique, user-scoped WorkManager jobs for an immediate incremental sync, a bounded history backfill, and 12-hour periodic incremental sync. Manual sync shares the same process single-flight gate. After
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
4. The app schedules the first bounded, authenticated sync automatically and immediately shows that background work is in progress.
5. The user may leave the app; Android continues best-effort work subject to OS scheduling and reports a terminal result or automatic retry state.

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
- Version: `0.1.0-beta.10-debug` (`versionCode 10`)
- Upgrade contract: restore encrypted session, resolve canonical user, migrate legacy sync metadata, then schedule work.
- Packaging contract: `assembleDebug` fails closed unless the Beta API, Beta Supabase URL, publishable key, and Google web client ID are configured.
- Immediate work: expedited when quota permits, otherwise regular; deterministic `health-sync-immediate-<user hash>`, normally `ExistingWorkPolicy.KEEP`. A confirmed stale running state is replaced atomically and resumes from the existing checkpoint.
- Periodic work: deterministic `health-sync-periodic-<user hash>`, every 12 hours, `ExistingPeriodicWorkPolicy.KEEP`.
- Historical backfill: a regular, network-constrained worker chained after the immediate delta when history remains pending.
- Constraints: connected network; no permanent foreground service, wake lock, or polling loop.
- Retry: exponential 30-second WorkManager backoff, at most three worker attempts, eight-minute worker deadline.
- Recovery metadata records the work ID, enqueue/start/progress/terminal timestamps, current stage and request count. A running state without progress for ten minutes is terminalized as stale and replaced; constrained queued work remains queued rather than being cancelled for lack of network.
- Incremental window: last successful sync minus one hour through a stable retry-window end; six-hour fallback when no success exists. Pending history remains bounded to 30 days.
- Local timestamps, background result, and history state are scoped by a hash of the canonical user ID and cleared on logout.
- Foreground fallback: only for devices that do not support Health Connect background reads; it uses the same small incremental window and a 120-second terminal deadline.
- History window: 30 days through durable, checkpointed, network-constrained WorkManager work.
- Background execution is OS-scheduled best effort; it is not advertised as real-time.
- Signing certificate SHA-1: `D1:A7:F6:7A:C2:F5:2B:EF:06:DF:B3:E4:D5:8A:56:47:DF:53:34:65`
- Signing certificate SHA-256: `43:5E:F9:65:1E:6B:6C:31:41:EC:FC:33:70:B5:7E:15:E9:3D:3E:CF:3C:2A:72:2D:ED:8B:6A:A8:75:42:43:00`

This debug certificate identity is suitable only for the current development-signed real-device gate. A future non-debug Beta signing identity needs a separate Android OAuth client registration for package `app.healthcompanion.sync.beta` and that signing certificate.

## Runtime gate

Beta.8 real-device evidence proves session restore and authenticated ingestion. Beta.9 real-device evidence proves background synchronization and database ingestion. Beta.10 requires a direct-over-beta.9 test only for stale-work recovery; it does not change OAuth, session storage, Health Connect mapping, batching, idempotency or score formulas.
