import { test, expect } from "@playwright/test";

test.describe("Phase 6.6: brand identity & web manifest", () => {
  test("all favicon, app icon, OG image, manifest, and font assets serve cleanly and match Logo geometry", async ({ page, request }) => {
    const assets = [
      ["/favicon.svg", "image/svg+xml"],
      ["/favicon.ico", "image/"],
      ["/favicon-16.png", "image/png"],
      ["/favicon-32.png", "image/png"],
      ["/apple-touch-icon.png", "image/png"],
      ["/icon-192.png", "image/png"],
      ["/icon-512.png", "image/png"],
      ["/icon-512-maskable.png", "image/png"],
      ["/og-image.png", "image/png"],
      ["/site.webmanifest", "manifest"],
      ["/fonts/bricolage-grotesque-latin-wght-normal.woff2", "font/woff2"],
    ];

    for (const [assetPath] of assets) {
      const res = await request.get(assetPath);
      expect(res.status(), `${assetPath} should return HTTP 200`).toBe(200);
      const body = await res.body();
      expect(body.length, `${assetPath} should be non-empty`).toBeGreaterThan(50);
    }

    const svgText = await (await request.get("/favicon.svg")).text();
    expect(svgText).toContain('viewBox="0 0 32 32"');
    expect(svgText).toContain("@media (prefers-color-scheme: dark)");
    expect(svgText).toContain("M16 10H20A2 2 0 0 1 22 12V18");

    const manifest = await (await request.get("/site.webmanifest")).json();
    expect(manifest.name).toBe("Visualify");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    await page.goto("/");
    const headerLogoPath = await page.locator("header svg path").first().getAttribute("d");
    expect(headerLogoPath).toBe("M16 10H20A2 2 0 0 1 22 12V18");
  });
});
