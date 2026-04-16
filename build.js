import { build } from "esbuild";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";

const BUILD_TMP = "./.build-tmp";
const OUT_PATH = "./screen-fx.html";
mkdirSync(BUILD_TMP, { recursive: true });

// 1. Bundle JS
console.log("[build] Bundling JS with esbuild...");
const jsResult = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  write: false,
  logLevel: "info",
});
const js = jsResult.outputFiles[0].text;
console.log(`[build] JS bundle: ${(js.length / 1024).toFixed(1)} KB`);

// 2. Compile Tailwind CSS
console.log("[build] Compiling Tailwind CSS...");
execSync(
  `npx tailwindcss -c ./tailwind.config.js -i ./tailwind.input.css -o ${BUILD_TMP}/tailwind.css --minify`,
  { stdio: "inherit" },
);
const css = readFileSync(`${BUILD_TMP}/tailwind.css`, "utf8");
console.log(`[build] CSS: ${(css.length / 1024).toFixed(1)} KB`);

// 3. Inline into HTML
console.log("[build] Inlining into HTML...");
let html = readFileSync("./index.html", "utf8");

// Remove CDN tailwind
html = html.replace(
  /\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/,
  "",
);
// Remove importmap
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "");
// Remove module script tag
html = html.replace(
  /\s*<script type="module" src="\.\/src\/main\.js"><\/script>/,
  "",
);

// Insert compiled CSS as its own <style> block immediately before the existing inline <style>.
// The existing inline styles come AFTER, so they win on specificity ties.
html = html.replace(
  /<style>/,
  `<style>\n${css}\n</style>\n    <style>`,
);

// Insert bundled JS before </body>
html = html.replace(
  /<\/body>/,
  `    <script>${js}</script>\n  </body>`,
);

writeFileSync(OUT_PATH, html);
const { size } = statSync(OUT_PATH);
console.log(`[build] Wrote ${OUT_PATH} (${(size / 1024).toFixed(1)} KB)`);
