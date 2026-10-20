import { vi } from "vitest";

/*
 * The network boundary for tests: a stand-in for fetch that answers from
 * replies a test sets up. Nothing here reaches a server. A request without
 * a reply fails the test (see verify), so a test cannot pass by accident on
 * a request it did not expect.
 */

/** NEXT_PUBLIC_API_URL in vitest.config.mts. */
export const API_URL = "http://api.test";

/** A request as the backend would have received it. */
export type ApiCall = {
  method: string;
  /** Path and query string, e.g. "/users/alice" or "/feed?limit=20". */
  path: string;
  /** The JSON body, parsed, or the FormData of a form, if there was one. */
  body: unknown;
  init: RequestInit;
};

/** Makes the response to one request. A response body can only be read once. */
export type Reply = () => Response | Promise<Response>;

type Route = { method: string; path: string; replies: Reply[]; served: number };

function createApi() {
  let routes: Route[] = [];
  let calls: ApiCall[] = [];
  let unhandled: string[] = [];

  async function fetchMock(input: RequestInfo | URL, init: RequestInit = {}) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname + url.search;
    calls.push({
      method,
      path,
      body:
        typeof init.body === "string"
          ? JSON.parse(init.body)
          : init.body instanceof FormData
            ? init.body
            : undefined,
      init,
    });

    const route =
      url.origin === API_URL
        ? routes.find((r) => r.method === method && r.path === path)
        : undefined;
    if (!route) {
      unhandled.push(`${method} ${url.href}`);
      // Rejected like a request that reached nothing.
      throw new TypeError(`No reply set up for ${method} ${url.href}`);
    }
    const reply = route.replies[Math.min(route.served, route.replies.length - 1)];
    route.served++;
    return reply();
  }

  return {
    /** Puts the stand-in in place of fetch. Done before every test by test/setup.ts. */
    install() {
      routes = [];
      calls = [];
      unhandled = [];
      vi.stubGlobal("fetch", vi.fn(fetchMock));
    },

    /**
     * Answers requests to one route with these replies, one per request in
     * turn; the last one is repeated. Replaces what the route had before.
     */
    on(method: string, path: string, ...replies: Reply[]) {
      routes = routes.filter((r) => !(r.method === method && r.path === path));
      routes.push({ method, path, replies, served: 0 });
    },

    /** The requests made so far, all of them or those to one route. */
    calls(method?: string, path?: string): ApiCall[] {
      return calls.filter(
        (call) => (!method || call.method === method) && (!path || call.path === path),
      );
    },

    /** Fails the test if a request had no reply. Done after every test by test/setup.ts. */
    verify() {
      if (unhandled.length > 0) {
        throw new Error(`Requests without a reply:\n${unhandled.join("\n")}`);
      }
    },
  };
}

export const api = createApi();

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Reply {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
}

/** A body that is not JSON, such as an error page from a proxy. */
export function html(status: number, body = "<html><body>Error</body></html>"): Reply {
  return () => new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

/**
 * A small ZIP archive, as the data export sends: the bytes of a real ZIP
 * file's start, and the name the backend gives it.
 */
export const ZIP_BYTES = new Uint8Array([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
]);

export function zip(
  filename: string | null,
  bytes: Uint8Array<ArrayBuffer> = ZIP_BYTES,
): Reply {
  return () =>
    new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        ...(filename ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}),
      },
    });
}

export function noContent(): Reply {
  return () => new Response(null, { status: 204 });
}

/** No response at all: offline, unreachable, or blocked by CORS. */
export function networkError(): Reply {
  return () => Promise.reject(new TypeError("Failed to fetch"));
}

/**
 * A reply that waits until the test answers it, for loading states and for
 * answers that arrive out of order.
 */
export function deferred() {
  let answer!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  return {
    reply: (() => response) as Reply,
    async respond(reply: Reply) {
      answer(await reply());
    },
  };
}
