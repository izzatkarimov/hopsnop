import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  generateNonce,
  staticSecurityHeaders,
} from "./security-headers";

function parse(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values];
    }),
  );
}

const production = {
  nonce: "abc123==",
  apiUrl: "https://api.hopsnop.com/",
  development: false,
};

describe("contentSecurityPolicy", () => {
  it("lets scripts run only with the page's nonce", () => {
    const scripts = parse(contentSecurityPolicy(production)).get("script-src");

    expect(scripts).toContain("'nonce-abc123=='");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("allows inline styles only with the nonce", () => {
    const styles = parse(contentSecurityPolicy(production)).get("style-src");

    expect(styles).toEqual(["'self'", "'nonce-abc123=='"]);
  });

  it("lets the pages talk to their own origin and the API's, and no other", () => {
    const connect = parse(contentSecurityPolicy(production)).get("connect-src");

    expect(connect).toEqual(["'self'", "https://api.hopsnop.com"]);
  });

  it("refuses frames, plugins, other base URLs and forms sent elsewhere", () => {
    const policy = parse(contentSecurityPolicy(production));

    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
  });

  it("upgrades http: addresses when the API is served over HTTPS", () => {
    const policy = parse(contentSecurityPolicy(production));

    expect(policy.has("upgrade-insecure-requests")).toBe(true);
  });

  it("loads pictures from the API and from no other host", () => {
    const policy = parse(contentSecurityPolicy(production));

    expect(policy.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://api.hopsnop.com",
    ]);
  });

  it("leaves plain HTTP alone on a developer's machine", () => {
    const policy = parse(
      contentSecurityPolicy({
        nonce: "n",
        apiUrl: "http://localhost:8000",
        development: true,
      }),
    );

    expect(policy.has("upgrade-insecure-requests")).toBe(false);
    expect(policy.get("connect-src")).toContain("http://localhost:8000");
    expect(policy.get("img-src")).toContain("http://localhost:8000");
  });

  it("loosens scripts and styles only for next dev", () => {
    const policy = parse(
      contentSecurityPolicy({ ...production, development: true }),
    );

    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("style-src")).toContain("'unsafe-inline'");
  });

  it("names no API when the address is missing or not a web address", () => {
    for (const apiUrl of [undefined, "", "not a url", "javascript:alert(1)"]) {
      const connect = parse(
        contentSecurityPolicy({ ...production, apiUrl }),
      ).get("connect-src");

      expect(connect).toEqual(["'self'"]);
    }
  });
});

describe("generateNonce", () => {
  it("is 128 bits, base64-encoded, and different every time", () => {
    const nonces = new Set(Array.from({ length: 100 }, generateNonce));

    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});

describe("staticSecurityHeaders", () => {
  it("covers sniffing, referrers, framing and opener access", () => {
    const headers = Object.fromEntries(
      staticSecurityHeaders.map(({ key, value }) => [key, value]),
    );

    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });
});
