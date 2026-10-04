// Sets the app version everywhere from one command:
//   npm run mobile:version -- 1.0.1        → version 1.0.1, build number +1
//   npm run mobile:version -- 1.0.1 12     → version 1.0.1, build 12
//   npm run mobile:version                 → keep version, build number +1
// Updates mobile/version.json (read by Android Gradle), package.json, and the iOS MARKETING_VERSION /
// CURRENT_PROJECT_VERSION build settings (which feed CFBundleShortVersionString / CFBundleVersion).
import { readFileSync, writeFileSync } from "node:fs";

const [nextVersion, nextBuild] = process.argv.slice(2);
const versionFile = "mobile/version.json";
const current = JSON.parse(readFileSync(versionFile, "utf8"));
const version = nextVersion || current.version;
const build = nextBuild ? Number(nextBuild) : current.build + 1;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Version must look like 1.2.3 (got ${version})`);
if (!Number.isInteger(build) || build < 1 || build > 2_100_000_000) throw new Error(`Build must be a positive integer (got ${nextBuild})`);
if (build <= current.build && !nextBuild) throw new Error("Build numbers must increase");

writeFileSync(versionFile, JSON.stringify({ version, build }, null, 2) + "\n");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
const pbx = "ios/App/App.xcodeproj/project.pbxproj";
writeFileSync(
  pbx,
  readFileSync(pbx, "utf8")
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`),
);
console.log(`Zest Snap ${version} (${build}) — package.json, Android (mobile/version.json) and iOS updated.`);
