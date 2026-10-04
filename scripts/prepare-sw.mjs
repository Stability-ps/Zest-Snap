import fs from "node:fs";
import crypto from "node:crypto";
import cp from "node:child_process";
let revision = process.env.VERCEL_GIT_COMMIT_SHA;
try {
  revision ||= cp.execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  revision = "local";
}
const version = crypto
  .createHash("sha256")
  .update(revision + Date.now())
  .digest("hex")
  .slice(0, 16);
const template = fs.readFileSync("scripts/sw-template.js", "utf8");
if (!template.includes("__ZEST_SW_VERSION__"))
  throw new Error("sw-template.js is missing the __ZEST_SW_VERSION__ placeholder");
fs.writeFileSync("public/sw.js", template.replaceAll("__ZEST_SW_VERSION__", version));
