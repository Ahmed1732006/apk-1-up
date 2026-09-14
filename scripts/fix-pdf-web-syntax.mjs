import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const htmlPath = join(process.cwd(), 'www', 'app', 'index.html');
if (!existsSync(htmlPath)) throw new Error('www/app/index.html missing. Run npm run build:web first.');

let html = readFileSync(htmlPath, 'utf8');

// patch-pdf-canonical replaces downloadMaterial() in the generated web bundle.
// Older generated bundles can retain the tail of the previous implementation,
// leaving an orphan `try` block and making the entire app JavaScript invalid.
// Remove only that exact orphan block; never touch the real canonical function.
const orphan = `        }\n            try {\n                const { data, error } = await sb.storage.from('materials').createSignedUrl(path, 300);\n                if (error) throw error;\n                window.open(data.signedUrl, '_blank', 'noopener');\n            } catch (e) {\n                showToast(e.message || 'تعذّر تحميل الملف', 'error');\n            }\n        }\n\n        function downloadFile`;

if (html.includes(orphan)) {
  html = html.replace(orphan, `        }\n\n        function downloadFile`);
  writeFileSync(htmlPath, html, 'utf8');
  console.log('Removed stale PDF downloadMaterial tail from generated web bundle.');
} else {
  console.log('No stale PDF downloadMaterial tail found.');
}
