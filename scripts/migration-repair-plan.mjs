// Prints the `supabase migration repair` commands that make production's migration history list exactly the
// versions of the files in supabase/migrations, using supabase/migration-history.json. It only prints; it never
// connects to a database. See supabase/MIGRATION_HISTORY.md for when and how to run the commands.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function repairPlan(mapping) {
  const applied = Object.entries(mapping.files).filter(([, v]) => Array.isArray(v));
  const repoVersions = new Set(applied.map(([file]) => file.split("_")[0]));
  const prodVersions = new Set(applied.flatMap(([, v]) => v));
  return {
    // Production rows whose version has no file of the same version: their changes live in the mapped file.
    revert: [...prodVersions].filter((v) => !repoVersions.has(v)).sort(),
    // Files already reflected in production (mapped or verified present) but not recorded under their own version.
    apply: [...repoVersions].filter((v) => !prodVersions.has(v)).sort(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = repairPlan(JSON.parse(readFileSync(new URL("../supabase/migration-history.json", import.meta.url), "utf8")));
  console.log(`supabase migration repair --status reverted ${plan.revert.join(" ")}`);
  console.log(`supabase migration repair --status applied ${plan.apply.join(" ")}`);
}
