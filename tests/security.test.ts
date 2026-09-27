import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAppNavigation } from "../src/main/navigation";

function policy(): Map<string, string[]> {
  const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const content = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  if (!content) throw new Error("no CSP meta tag");
  return new Map(content.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
}

describe("Content-Security-Policy", () => {
  it("lets sketches load remote images, video and fetches", () => {
    const csp = policy();
    for (const directive of ["img-src", "media-src", "connect-src"]) {
      expect(csp.get(directive)).toEqual(expect.arrayContaining(["'self'", "https:", "http:"]));
    }
    expect(csp.get("img-src")).toEqual(expect.arrayContaining(["data:", "blob:"]));
    expect(csp.get("media-src")).toEqual(expect.arrayContaining(["blob:"]));
    expect(csp.get("connect-src")).toContain("ws://localhost:*");
  });

  it("still only runs Ao's own scripts", () => {
    expect(policy().get("script-src")).toEqual(["'self'", "'unsafe-eval'"]);
  });
});

describe("isAppNavigation", () => {
  const app = "file:///opt/ao/dist/renderer/index.html?sketch=dunes";

  it("allows reloading the app page", () => {
    expect(isAppNavigation("file:///opt/ao/dist/renderer/index.html?sketch=ink", app)).toBe(true);
    expect(isAppNavigation("http://localhost:5173/?sketch=ink", "http://localhost:5173/")).toBe(true);
  });

  it("blocks leaving the app", () => {
    expect(isAppNavigation("https://example.com/", app)).toBe(false);
    expect(isAppNavigation("file:///etc/passwd", app)).toBe(false);
    expect(isAppNavigation("http://localhost:6000/", "http://localhost:5173/")).toBe(false);
    expect(isAppNavigation("not a url", app)).toBe(false);
  });
});
