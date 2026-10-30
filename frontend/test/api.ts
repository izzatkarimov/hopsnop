import { vi } from "vitest";

/* Stand-in for fetch, answered from set-up replies; an unanswered request fails. */

/** NEXT_PUBLIC_API_URL in vitest.config.mts. */
export const API_URL = "http://api.test";

export type ApiCall = {
  method: string;
  path: string;
  body: unknown;
  init: RequestInit;
};

/** A response body can only be read once. */
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
    install() {
      routes = [];
      calls = [];
      unhandled = [];
      vi.stubGlobal("fetch", vi.fn(fetchMock));
    },

    /** One reply per request in turn; the last is repeated. */
    on(method: string, path: string, ...replies: Reply[]) {
      routes = routes.filter((r) => !(r.method === method && r.path === path));
      routes.push({ method, path, replies, served: 0 });
    },

    calls(method?: string, path?: string): ApiCall[] {
      return calls.filter(
        (call) => (!method || call.method === method) && (!path || call.path === path),
      );
    },

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

export function html(status: number, body = "<html><body>Error</body></html>"): Reply {
  return () => new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

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

export function networkError(): Reply {
  return () => Promise.reject(new TypeError("Failed to fetch"));
}

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
