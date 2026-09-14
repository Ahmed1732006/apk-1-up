import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'www');

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const skip = new Set([
  'node_modules', '.git', '.github', 'android', 'www',
  'package.json', 'package-lock.json', 'capacitor.config.json',
  'scripts', 'resources', 'google-services.json', 'android-debug.keystore'
]);

for (const name of readdirSync(root)) {
  if (skip.has(name)) continue;
  const src = join(root, name);
  const dest = join(out, name);
  cpSync(src, dest, { recursive: true });
}

// ---------------------------------------------------------------------
// Vendor every external CDN dependency so the packaged Android app keeps
// working with no internet connection at all. This step runs here, in
// CI (which has internet), once per build - the downloaded files are
// bundled straight into the APK, so the phone never needs to fetch them.
// If a fetch fails (e.g. CI has no network that day) we log a warning
// and leave the original CDN <script>/<link> tag in place instead of
// breaking the build.
// ---------------------------------------------------------------------
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const urlToLocal = new Map();

async function vendorScript(url, relPath, localCandidates = []) {
  const candidates = [join(root, relPath), ...localCandidates.map(p => join(root, p))];
  const local = candidates.find(existsSync);
  if (local) {
    urlToLocal.set(url, relPath);
    if (local !== join(root, relPath)) {
      mkdirSync(join(out, 'vendor'), { recursive: true });
      cpSync(local, join(out, relPath));
    }
    console.log(`Using local vendor ${url} -> ${relPath}`);
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    mkdirSync(join(out, 'vendor'), { recursive: true });
    writeFileSync(join(out, relPath), text);
    urlToLocal.set(url, relPath);
    console.log(`Vendored ${url} -> ${relPath}`);
  } catch (err) {
    console.warn(`WARNING: could not vendor ${url}: ${err.message}`);
  }
}

async function vendorCssWithFonts(cssUrl, cssRelPath, fontsRelDir) {
  const localCss = join(root, cssRelPath);
  if (existsSync(localCss)) {
    urlToLocal.set(cssUrl, cssRelPath);
    console.log(`Using local vendor ${cssUrl} -> ${cssRelPath}`);
    return;
  }
  try {
    const res = await fetch(cssUrl, { headers: { 'User-Agent': CHROME_UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let css = await res.text();
    const found = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, ''));
    mkdirSync(join(out, fontsRelDir), { recursive: true });
    for (const raw of [...new Set(found)]) {
      const absUrl = new URL(raw, cssUrl).toString();
      const fname = absUrl.split('/').pop().split('?')[0];
      try {
        const fres = await fetch(absUrl);
        if (!fres.ok) throw new Error(`HTTP ${fres.status}`);
        const buf = Buffer.from(await fres.arrayBuffer());
        writeFileSync(join(out, fontsRelDir, fname), buf);
        css = css.split(raw).join(`./${fontsRelDir.split('/').pop()}/${fname}`);
      } catch (err) {
        console.warn(`WARNING: could not vendor font asset ${absUrl}: ${err.message}`);
      }
    }
    writeFileSync(join(out, cssRelPath), css);
    urlToLocal.set(cssUrl, cssRelPath);
    console.log(`Vendored ${cssUrl} -> ${cssRelPath}`);
  } catch (err) {
    console.warn(`WARNING: could not vendor ${cssUrl}: ${err.message}`);
  }
}

await vendorScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', 'vendor/supabase-js.min.js');
await vendorScript('https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js', 'vendor/gsap.min.js');
await vendorScript('https://cdn.jsdelivr.net/npm/gsap@3/dist/Draggable.min.js', 'vendor/gsap-draggable.min.js');
await vendorScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'vendor/jszip.min.js');
await vendorScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'vendor/pdf-lib.min.js');
await vendorCssWithFonts(
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Outfit:wght@300;400;500;600;700&display=swap',
  'vendor/google-fonts.css',
  'vendor/webfonts-google'
);
await vendorCssWithFonts(
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'vendor/fontawesome.css',
  'vendor/webfonts-fa'
);

function rewriteAssetRefs(filePath) {
  if (!existsSync(filePath)) return;
  const fileDepth = filePath === join(out, 'index.html') ? 0 : 1; // app/index.html is one folder deeper
  const prefix = fileDepth === 0 ? './' : '../';
  let html = readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [url, localRelPath] of urlToLocal) {
    if (html.includes(url)) {
      html = html.split(url).join(prefix + localRelPath);
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(filePath, html);
    console.log(`Rewrote CDN references in ${filePath}`);
  }
}

rewriteAssetRefs(join(out, 'index.html'));
rewriteAssetRefs(join(out, 'app', 'index.html'));

console.log(`Prepared web assets in ${out}`);
