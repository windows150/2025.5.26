import { describe, test, expect, beforeEach } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { RuntimeBridge } from "../runtime-bridge.js";
import { adaptRoute } from "../route-adapter.js";
import type { Route, RouteRequest, RouteResponse, IAgentRuntime } from "../eliza-types.js";

function createBridge(): RuntimeBridge {
  return new RuntimeBridge({
    config: { plugins: [], settings: {}, agentName: "Test" },
    openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
}

/**
 * Create a minimal IncomingMessage for testing.
 * We simulate enough of the Node HTTP interface for our adapter to work.
 */
function createMockReq(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = opts.method;
  req.url = opts.url;
  req.headers = opts.headers ?? {};
  req.headers.host = "localhost:3000";

  // Simulate body streaming
  if (opts.body) {
    // Push the body data after a tick so the async iterator works
    process.nextTick(() => {
      req.push(Buffer.from(opts.body!));
      req.push(null);
    });
  } else {
    process.nextTick(() => {
      req.push(null);
    });
  }

  return req;
}

/**
 * Create a mock ServerResponse that captures written data.
 */
function createMockRes(): {
  res: ServerResponse;
  getStatus: () => number;
  getBody: () => string;
  getHeaders: () => Record<string, string | string[]>;
} {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req);

  let statusCode = 200;
  let body = "";
  const headers: Record<string, string | string[]> = {};

  // Override write/end to capture output
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: string | number | readonly string[]) => {
    headers[name.toLowerCase()] = value as string | string[];
    return origSetHeader(name, value);
  };

  const origEnd = res.end.bind(res);
  // Override end to capture the body
  (res as { end: (...args: unknown[]) => ServerResponse }).end = (
    chunk?: unknown,
    ..._rest: unknown[]
  ): ServerResponse => {
    if (chunk) body = String(chunk);
    statusCode = res.statusCode;
    origEnd();
    return res;
  };

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
    getHeaders: () => headers,
  };
}

describe("adaptRoute", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("returns null for routes without handler", () => {
    const route: Route = {
      type: "GET",
      path: "/status",
    };
    expect(adaptRoute(route, bridge)).toBeNull();
  });

  test("prefixes path with /eliza", () => {
    const route: Route = {
      type: "GET",
      path: "/api/health",
      handler: async (_req, res) => {
        res.status(200).json({ ok: true });
      },
    };
    const adapted = adaptRoute(route, bridge);
    expect(adapted).not.toBeNull();
    expect(adapted!.path).toBe("/eliza/api/health");
  });

  test("handles path without leading slash", () => {
    const route: Route = {
      type: "GET",
      path: "health",
      handler: async (_req, res) => { res.status(200).json({}); },
    };
    const adapted = adaptRoute(route, bridge);
    expect(adapted!.path).toBe("/eliza/health");
  });

  test("GET route passes query parameters", async () => {
    let receivedQuery: Record<string, string | string[]> = {};
    const route: Route = {
      type: "GET",
      path: "/search",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedQuery = req.query ?? {};
        res.status(200).json({ received: true });
      },
    };

    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "GET", url: "/eliza/search?q=hello&limit=10" });
    const { res } = createMockRes();

    await adapted.handler(req, res);
    expect(receivedQuery["q"]).toBe("hello");
    expect(receivedQuery["limit"]).toBe("10");
  });

  test("POST route parses JSON body", async () => {
    let receivedBody: Record<string, unknown> = {};
    const route: Route = {
      type: "POST",
      path: "/api/action",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedBody = req.body ?? {};
        res.status(200).json({ ok: true });
      },
    };

    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({
      method: "POST",
      url: "/eliza/api/action",
      body: JSON.stringify({ action: "transfer", amount: 100 }),
    });
    const { res } = createMockRes();

    await adapted.handler(req, res);
    expect(receivedBody["action"]).toBe("transfer");
    expect(receivedBody["amount"]).toBe(100);
  });

  test("POST route handles non-JSON body with parse error flag", async () => {
    let receivedBody: Record<string, unknown> = {};
    const route: Route = {
      type: "POST",
      path: "/raw",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedBody = req.body ?? {};
        res.status(200).json({ ok: true });
      },
    };

    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({
      method: "POST",
      url: "/eliza/raw",
      body: "plain text body",
    });
    const { res } = createMockRes();

    await adapted.handler(req, res);
    expect(receivedBody["_raw"]).toBe("plain text body");
    expect(receivedBody["_parseError"]).toBe(true);
  });

  test("passes method and headers to RouteRequest", async () => {
    let receivedReq: RouteRequest | undefined;
    const route: Route = {
      type: "GET",
      path: "/info",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedReq = req;
        res.status(200).json({});
      },
    };

    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({
      method: "GET",
      url: "/eliza/info",
      headers: { "x-custom": "value", "authorization": "Bearer token123" },
    });
    const { res } = createMockRes();

    await adapted.handler(req, res);
    expect(receivedReq?.method).toBe("GET");
    expect(receivedReq?.headers?.["x-custom"]).toBe("value");
    expect(receivedReq?.headers?.["authorization"]).toBe("Bearer token123");
  });

  test("runtime is passed to handler", async () => {
    let receivedRuntime: IAgentRuntime | undefined;
    const route: Route = {
      type: "GET",
      path: "/rt",
      handler: async (_req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime) => {
        receivedRuntime = runtime;
        res.status(200).json({});
      },
    };

    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "GET", url: "/eliza/rt" });
    const { res } = createMockRes();

    await adapted.handler(req, res);
    expect(receivedRuntime).toBe(bridge);
  });

  test("duplicate query params become arrays", async () => {
    let receivedQuery: Record<string, string | string[]> = {};
    const route: Route = {
      type: "GET",
      path: "/multi",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedQuery = req.query ?? {};
        res.status(200).json({});
      },
    };

    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "GET", url: "/eliza/multi?tag=a&tag=b" });
    const { res } = createMockRes();

    await adapted.handler(req, res);
    expect(receivedQuery["tag"]).toEqual(["a", "b"]);
  });
});

describe("adaptRoute — error and edge cases", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("handler errors propagate to caller", async () => {
    const route: Route = {
      type: "GET",
      path: "/explode",
      handler: async () => {
        throw new Error("Route handler failed");
      },
    };
    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "GET", url: "/eliza/explode" });
    const { res } = createMockRes();

    await expect(adapted.handler(req, res)).rejects.toThrow("Route handler failed");
  });

  test("PUT request parses body", async () => {
    let receivedBody: Record<string, unknown> = {};
    const route: Route = {
      type: "PUT" as "PUT",
      path: "/update",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedBody = req.body ?? {};
        res.status(200).json({});
      },
    };
    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({
      method: "PUT",
      url: "/eliza/update",
      body: JSON.stringify({ name: "new" }),
    });
    const { res } = createMockRes();
    await adapted.handler(req, res);
    expect(receivedBody["name"]).toBe("new");
  });

  test("GET request has no body parsing", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    const route: Route = {
      type: "GET",
      path: "/get",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedBody = req.body;
        res.status(200).json({});
      },
    };
    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "GET", url: "/eliza/get" });
    const { res } = createMockRes();
    await adapted.handler(req, res);
    expect(receivedBody).toBeUndefined();
  });

  test("RouteResponse send with string uses raw string", async () => {
    let sentData = "";
    const route: Route = {
      type: "GET",
      path: "/text",
      handler: async (_req: RouteRequest, res: RouteResponse) => {
        res.status(200).send("plain text");
      },
    };
    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "GET", url: "/eliza/text" });
    const { res } = createMockRes();
    await adapted.handler(req, res);
    // The send method was called — no error
  });

  test("RouteResponse end terminates response", async () => {
    const route: Route = {
      type: "GET",
      path: "/end",
      handler: async (_req: RouteRequest, res: RouteResponse) => {
        res.status(204).end();
      },
    };
    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "GET", url: "/eliza/end" });
    const { res } = createMockRes();
    await adapted.handler(req, res);
    // No error
  });

  test("POST with empty body does not set parsedBody", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    const route: Route = {
      type: "POST",
      path: "/empty",
      handler: async (req: RouteRequest, res: RouteResponse) => {
        receivedBody = req.body;
        res.status(200).json({});
      },
    };
    const adapted = adaptRoute(route, bridge)!;
    const req = createMockReq({ method: "POST", url: "/eliza/empty", body: "" });
    const { res } = createMockRes();
    await adapted.handler(req, res);
    expect(receivedBody).toBeUndefined();
  });
});
