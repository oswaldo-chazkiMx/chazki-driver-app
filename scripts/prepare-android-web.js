const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const target = path.join(root, "driver-app");
const files = [
  ["driver-app.html", "index.html"],
  ["app.js", "app.js"],
  ["config.js", "config.js"],
  ["icon.svg", "icon.svg"],
  ["manifest.webmanifest", "manifest.webmanifest"],
  ["sw.js", "sw.js"],
  ["vendor/supabase-js-2.118.0.js", "vendor/supabase-js-2.118.0.js"],
];

for (const [source, destination] of files) {
  const from = path.join(root, source);
  if (!fs.existsSync(from)) throw new Error(`Missing Android app source: ${source}`);
  const to = path.join(target, destination);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

console.log(`Prepared Android web assets in ${target}`);
