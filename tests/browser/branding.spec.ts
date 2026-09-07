import { test, expect } from "@playwright/test";

test("brand and install metadata work on desktop and mobile", async ({ page, request, isMobile }) => {
  await page.goto("/");
  const brand = page.locator(isMobile ? ".mobile-brand" : ".sidebar .brand");
  await expect(brand.locator("img")).toBeVisible();
  expect(await brand.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#245a49");

  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await request.get(manifestUrl!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "ShelfScout", start_url: "/", scope: "/", display: "standalone" });
  expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain("maskable");
  for (const icon of manifest.icons) {
    const asset = await request.get(icon.src);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["content-type"]).toContain("image/png");
    const png = await asset.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  for (const link of await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').all()) {
    const asset = await request.get((await link.getAttribute("href"))!);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["content-type"]).toMatch(/^image\//);
  }
});
