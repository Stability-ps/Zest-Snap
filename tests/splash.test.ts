import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PWA_STARTUP_SCREENS, pwaStartupImages, startupImageFile } from "../lib/pwa-startup";

const pngSize = (path: string) => {
  const b = readFileSync(path);
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${path} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

test("every iOS startup image exists at the exact pixel size of its screen (run `npm run pwa:splash`)", () => {
  for (const s of PWA_STARTUP_SCREENS) {
    assert.deepEqual(pngSize(`public/splash/${startupImageFile(s)}`), { width: s.width * s.ratio, height: s.height * s.ratio }, s.name);
  }
});

test("startup image media queries are unique so each device matches one image", () => {
  const media = pwaStartupImages().map((i) => i.media);
  assert.equal(new Set(media).size, media.length);
});

test("Android 12+ splash branding wordmark is referenced and present", () => {
  const style = readFileSync("android/app/src/main/res/values-v31/styles.xml", "utf8");
  assert.match(style, /windowSplashScreenBrandingImage">@drawable\/zest_splash_wordmark</);
  const vector = readFileSync("android/app/src/main/res/drawable/zest_splash_wordmark.xml", "utf8");
  assert.match(vector, /android:width="200dp"/);
  assert.match(vector, /android:height="80dp"/);
});
