// SDK-supported transport injection. Deadline includes response body consumption.
export const AUTH_HTTP_TIMEOUT_MS = 10000;
export const boundedSdkFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname !== '/auth/v1/user') return fetch(input, init);
  const signals = [AbortSignal.timeout(AUTH_HTTP_TIMEOUT_MS)];
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);
  return fetch(input, {...init, signal:AbortSignal.any(signals)});
};
