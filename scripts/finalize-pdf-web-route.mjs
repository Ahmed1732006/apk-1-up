import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const htmlPath = join(process.cwd(), 'www', 'app', 'index.html');
if (!existsSync(htmlPath)) throw new Error('www/app/index.html missing.');

let html = readFileSync(htmlPath, 'utf8');

// The older PDF patch can leave the previous downloadMaterial() tail behind.
// Replace the whole function in one deterministic operation so there can be
// never be an orphan `try/await` block that prevents the SPA from booting.
const functionRegex = /function\s+downloadMaterial\s*\([^)]*\)\s*\{[\s\S]*?\n\s*function\s+downloadFile/;
if (!functionRegex.test(html)) {
  throw new Error('Could not locate downloadMaterial() before downloadFile().');
}

const replacement = `function downloadMaterial(item) {
            const path = item?.filePath || item?.fileData;
            const fileName = item?.fileName || 'document.pdf';
            if (!path) {
                showToast('لا يوجد ملف لهذه المادة', 'error');
                return;
            }

            try {
                let url = path;
                if (!/^https?:\\/\\//i.test(url)) {
                    const signed = await sb.storage.from('materials').createSignedUrl(url, 300);
                    if (signed.error) throw signed.error;
                    url = signed.data?.signedUrl;
                }
                if (!url) throw new Error('تعذر إنشاء رابط PDF');

                const isPdf = /\\.pdf(?:[?#].*)?$/i.test(String(fileName)) || /\\.pdf(?:[?#].*)?$/i.test(String(url));
                if (isPdf && window.Capacitor?.isNativePlatform?.() && window.PdfViewer?.openUrl) {
                    const result = await window.PdfViewer.openUrl({ url, filename: fileName });
                    if (result?.opened) return;
                }

                window.open(url, '_blank', 'noopener');
            } catch (e) {
                console.error('PDF open failed', e);
                showToast(e?.message || 'تعذّر تحميل الملف', 'error');
            }
        }

        function downloadFile`;

// The function must be async because it awaits Supabase/native bridge work.
const asyncReplacement = replacement.replace('function downloadMaterial(item)', 'async function downloadMaterial(item)');
html = html.replace(functionRegex, asyncReplacement);
writeFileSync(htmlPath, html, 'utf8');
console.log('Final PDF web route applied: one valid async downloadMaterial() function.');
