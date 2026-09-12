import { generateKeyPair, jwtVerify, SignJWT } from "npm:jose@6.1.3";
import subjects from "../fixtures/engine-local-identities.json" with {
  type: "json",
};
// Disposable test issuer ONLY. No real OAuth identities or keys are loaded.
export async function createSyntheticAuthority() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const issuer = "http://127.0.0.1:57841/local-test-auth",
    audience = "health-engine-local",
    revoked = new Set<string>();
  return {
    async issue(account: string, expired = false) {
      const entry = subjects[account as keyof typeof subjects];
      if (!entry) throw Error("UNKNOWN_SYNTHETIC_ACCOUNT");
      return await new SignJWT({}).setProtectedHeader({ alg: "ES256" })
        .setSubject(entry.auth).setIssuer(issuer).setAudience(audience).setJti(
          crypto.randomUUID(),
        ).setIssuedAt().setExpirationTime(
          expired ? Math.floor(Date.now() / 1000) - 10 : "30m",
        ).sign(privateKey);
    },
    async verify(token: string) {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer,
        audience,
        algorithms: ["ES256"],
      });
      if (!payload.sub || !payload.jti || revoked.has(payload.jti)) {
        throw Error("INVALID_TOKEN");
      }
      const entry = Object.entries(subjects).find(([, v]) =>
        v.auth === payload.sub
      );
      if (!entry) throw Error("INVALID_TOKEN");
      return {
        id: payload.sub,
        email: entry[0].toLowerCase() + "@example.invalid",
        app_metadata: { provider: "google" },
        identities: [{
          provider: "google",
          identity_data: { sub: "synthetic-" + entry[0] },
        }],
      };
    },
    async revoke(token: string) {
      try {
        const { payload } = await jwtVerify(token, publicKey, {
          issuer,
          audience,
        });
        if (payload.jti) revoked.add(payload.jti);
      } catch { /* invalid tokens already rejected */ }
    },
  };
}
