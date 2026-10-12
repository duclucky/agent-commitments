import { readFile } from "node:fs/promises";
const [html, css] = await Promise.all([readFile("src/index.html", "utf8"), readFile("src/styles.css", "utf8")]);
const required = [
  ['name="viewport"', "responsive viewport"], ['class="skip-link"', "skip link"],
  ['id="main"', "main landmark target"], ['aria-live="polite"', "live status"],
  ['UNKNOWN', "unknown transaction state"], ['<button', "keyboard-native controls"],
  ['id="demo-status"', "visible demo status"],
];
for (const [needle, label] of required) if (!html.includes(needle)) throw new Error(`Missing ${label}`);
if (!css.includes(":focus-visible")) throw new Error("Missing visible keyboard focus");
if (!css.includes("prefers-reduced-motion")) throw new Error("Missing reduced motion support");
if (!css.includes("@media (max-width: 700px)")) throw new Error("Missing small-screen layout");
const app = await readFile("src/app.js", "utf8");
if (!app.includes('"Withdrawn · W"')) throw new Error("Missing withdrawn ledger metric");
if (!app.includes('/api/local-chain/settle')) throw new Error("Missing local-chain demo boundary");
console.log("Console structure, status semantics and responsive accessibility checks passed.");
