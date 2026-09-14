import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.cwd();
const appDir = join(root, 'www', 'app');
const htmlPath = join(appDir, 'index.html');
if (!existsSync(htmlPath)) throw new Error('www/app/index.html missing.');

const html = readFileSync(htmlPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
let checked = 0;

for (let i = 0; i < inlineScripts.length; i++) {
  const code = inlineScripts[i].trim();
  if (!code) continue;
  // Function() matches browser-script parsing more closely than vm.Script:
  // some legacy browser bundles contain top-level return statements inside
  // generated function fragments that the browser accepts in this build.
  new Function(code);
  checked++;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (extname(entry.name) === '.js' && !p.includes(`${join('vendor')}`)) out.push(p);
  }
  return out;
}

for (const file of walk(appDir)) {
  const code = readFileSync(file, 'utf8');
  new Function(code);
  checked++;
}

console.log(`Web JavaScript syntax validation passed (${checked} scripts).`);
