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
fs.writeFileSync(
  "public/sw.js",
  fs
    .readFileSync("scripts/sw-template.js", "utf8")
    .replace("zest-snap-shell-v2", "zest-snap-shell-" + version),
);
