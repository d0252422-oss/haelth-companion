const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalUserId(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

export function sameCanonicalUserId(left: unknown, right: unknown): boolean {
  const normalizedLeft = canonicalUserId(left);
  const normalizedRight = canonicalUserId(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}
