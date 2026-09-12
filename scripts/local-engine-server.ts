// Local-only synthetic authentication authority and existing Deno route host. No external auth calls.
import { createSyntheticAuthority } from "./local-engine-auth.ts";
import { LocalEngineRuntime } from "../supabase/functions/mobile-health-beta/local-engine-runtime.ts";
import {
  dispatchLocalEngine,
  registerLocalEngineHandler,
} from "../supabase/functions/mobile-health-beta/index.ts";
import subjects from "../fixtures/engine-local-identities.json" with {
  type: "json",
};

if (Deno.env.get("HEALTH_ENGINE_LOCAL_ONLY") !== "1") {
  throw Error("LOCAL_ENGINE_DISABLED");
}
const config = JSON.parse(await Deno.readTextFile(Deno.args[0]));
const authority = await createSyntheticAuthority();
const runtime = new LocalEngineRuntime(config, authority.verify);
await runtime.start();
registerLocalEngineHandler((request) => runtime.handle(request));
const counters = { requests: 0 };
const headers = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'",
};
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 57841 },
  async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") {
      return new Response("LOCAL_ONLY", {
        status: 403,
      });
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return new Response(
        "ORIGIN_REJECTED",
        { status: 403 },
      );
    }
    if (url.pathname === "/local-health") {
      return Response.json({ status: "LOCAL_SYNTHETIC", ...counters }, {
        headers,
      });
    }
    const cookie = (request.headers.get("cookie") || "").split(";").map((v) =>
      v.trim()
    ).find((v) => v.startsWith("engine_session="))?.slice(15);
    if (url.pathname === "/local-login" && request.method === "POST") {
      const body = await request.json(),
        account = String(body.account),
        entry = subjects[account as keyof typeof subjects];
      if (!entry) {
        return Response.json({ error: "UNKNOWN_SYNTHETIC_ACCOUNT" }, {
          status: 400,
        });
      }
      // Only this synthetic loopback host can issue an intentionally expired test session.
      const token = await authority.issue(account, body.expired === true);
      return Response.json({ synthetic: true }, {
        headers: {
          ...headers,
          "set-cookie":
            `engine_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,
        },
      });
    }
    if (url.pathname === "/local-logout" && request.method === "POST") {
      if (cookie) await authority.revoke(cookie);
      return Response.json({ ok: true }, {
        headers: {
          ...headers,
          "set-cookie":
            "engine_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        },
      });
    }
    if (url.pathname === "/v1/engine/web") {
      counters.requests++;
      const h = new Headers(request.headers);
      if (cookie && !h.has("authorization")) {
        h.set(
          "authorization",
          "Bearer " + cookie,
        );
      }
      const response = await dispatchLocalEngine(
        new Request(request, { headers: h }),
      );
      return response || new Response("DISABLED", { status: 503 });
    }
    if (url.pathname === "/local-runtime-metrics") {
      return Response.json({
        timings: runtime.timings,
      }, { headers });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      let html = await Deno.readTextFile("index.html");
      // No public CDN/OAuth request from this test page. Existing app code/layout remains the application.
      html = html.replace(/<script src="https:[^"]+"[^>]*><\/script>/g, "")
        .replace(/<link href="https:[^>]+>/g, "");
      html = html.replace(
        "<head>",
        "<head><script>window.HEALTH_ENGINE_LOCAL_CONFIG={enabled:true};window.lucide={createIcons(){}};</script>",
      );
      return new Response(html, {
        headers: { ...headers, "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/scripts/local-engine-web.js") {
      return new Response(
        await Deno.readTextFile("scripts/local-engine-web.js"),
        { headers: { ...headers, "content-type": "text/javascript" } },
      );
    }
    return new Response("NOT_FOUND", { status: 404 });
  },
);
let draining = false;
const timer = setInterval(async () => {
  if (draining) return;
  draining = true;
  try {
    for (const user of Object.values(subjects)) {
      if ("canonical" in user) await runtime.drain(user.canonical);
    }
  } catch { /* durable queue retry remains authoritative */ }
  finally { draining = false; }
}, 2000);
Deno.addSignalListener("SIGINT", async () => {
  clearInterval(timer);
  await server.shutdown();
  await runtime.close();
});
