import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const htmlPath = join(process.cwd(), 'www', 'app', 'index.html');
if (!existsSync(htmlPath)) throw new Error('www/app/index.html missing. Run npm run build:web first.');

let html = readFileSync(htmlPath, 'utf8');

// patch-pdf-canonical replaces downloadMaterial() in the generated web bundle.
// Its old implementation tail can survive after the function, creating an
// orphan async `try` block. That single syntax error prevents bootApp() from
// running while later theme scripts still execute — exactly the blank screen
// regression seen in the APK. Remove only the orphan block after the function.
const orphanRegex = /\n\s*}\s*\n\s*try\s*\{\s*const\s*\{\s*data\s*,\s*error\s*\}\s*=\s*await\s+sb\.storage\.from\('materials'\)\.createSignedUrl\(path\s*,\s*300\);[\s\S]*?\n\s*}\s*\n\s*function downloadFile/;

const beforeCount = (html.match(/await\s+sb\.storage\.from\('materials'\)\.createSignedUrl\(path\s*,\s*300\);/g) || []).length;
const fixed = html.replace(orphanRegex, `\n        }\n\n        function downloadFile`);
const afterCount = (fixed.match(/await\s+sb\.storage\.from\('materials'\)\.createSignedUrl\(path\s*,\s*300\);/g) || []).length;

if (fixed !== html) {
  html = fixed;
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`Removed stale PDF downloadMaterial tail (${beforeCount} -> ${afterCount} signed-url calls).`);
} else {
  console.log(`No stale PDF downloadMaterial tail found (${beforeCount} signed-url calls).`);
}

// The canonical downloadMaterial() implementation should contain exactly two
// path-based signed-url calls: one native fallback and one website fallback.
// A third call is the known orphan-tail regression and must stop the build.
const finalCount = (html.match(/await\s+sb\.storage\.from\('materials'\)\.createSignedUrl\(path\s*,\s*300\);/g) || []).length;
if (finalCount > 2) {
  throw new Error(`PDF web patch is unsafe: found ${finalCount} path signed-url calls; expected at most 2.`);
}
