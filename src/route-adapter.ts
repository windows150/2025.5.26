import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type { Route, RouteRequest, RouteResponse } from "./eliza-types.js";
import type { RuntimeBridge } from "./runtime-bridge.js";

export type AdaptedRoute = {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function wrapResponse(res: ServerResponse): RouteResponse {
  const self: RouteResponse = {
    status(code: number) { res.statusCode = code; return self; },
    json(data: unknown) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return self; },
    send(data: unknown) { typeof data === "string" ? res.end(data) : self.json(data); return self; },
    end() { res.end(); return self; },
    setHeader(name: string, value: string | string[]) { res.setHeader(name, value); return self; },
    get headersSent() { return res.headersSent; },
  };
  return self;
}

export function adaptRoute(route: Route, bridge: RuntimeBridge): AdaptedRoute | null {
  if (!route.handler) return null;
  const adaptedPath = `/eliza${route.path.startsWith("/") ? route.path : `/${route.path}`}`;
  const routeHandler = route.handler;

  return {
    path: adaptedPath,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const parsedQuery: Record<string, string | string[]> = {};
      for (const [key, value] of urlObj.searchParams.entries()) {
        const existing = parsedQuery[key];
        parsedQuery[key] = existing
          ? Array.isArray(existing) ? [...existing, value] : [existing, value]
          : value;
      }

      let parsedBody: Record<string, unknown> | undefined;
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        const raw = await readBody(req);
        if (raw.length > 0) {
          try { parsedBody = JSON.parse(raw) as Record<string, unknown>; }
          catch { parsedBody = { _raw: raw, _parseError: true }; }
        }
      }

      await routeHandler(
        { body: parsedBody, params: {}, query: parsedQuery, headers: req.headers as Record<string, string | string[] | undefined>, method: req.method ?? "GET", path: req.url ?? "/", url: req.url ?? "/" },
        wrapResponse(res),
        bridge,
      );
    },
  };
}
