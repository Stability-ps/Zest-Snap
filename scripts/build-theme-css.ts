// Writes app/theme.css from lib/appearance/palette.ts. Run after changing any theme colour.
import fs from "node:fs";
import { buildThemeCss } from "../lib/appearance/palette";

fs.writeFileSync("app/theme.css", buildThemeCss());
console.log("app/theme.css updated");
