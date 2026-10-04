// Writes the server URL into the bundled boot/offline pages (they retry it), then runs `cap sync`.
// Production is the default; CAP_SERVER_URL is only for local device testing.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const serverUrl = process.env.CAP_SERVER_URL ?? "https://app.zestsnap.app/app";
for (const file of ["mobile/www/offline.html", "mobile/www/index.html"]) {
  const html = readFileSync(file, "utf8").replace(/window\.ZEST_SERVER_URL = "[^"]*";/, `window.ZEST_SERVER_URL = ${JSON.stringify(serverUrl)};`);
  writeFileSync(file, html);
}
const platforms = process.argv.slice(2);
execFileSync("npx", ["cap", "sync", ...platforms], { stdio: "inherit", env: process.env });
