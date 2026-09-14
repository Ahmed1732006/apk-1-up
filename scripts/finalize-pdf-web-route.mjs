import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const htmlPath = join(process.cwd(), 'www', 'app', 'index.html');
if (!existsSync(htmlPath)) throw new Error('www/app/index.html missing.');

let html = readFileSync(htmlPath, 'utf8');

// Replace the complete generated downloadMaterial() function, including an
// optional existing `async` prefix, so the final bundle can never contain
// `async async function` or an orphan try/await tail.
const functionRegex = /(?:async\s+)?function\s+downloadMaterial\s*\([^)]*\)\s*\{[\s\S]*?\n\s*function\s+downloadFile/;
if (!functionRegex.test(html)) {
  throw new Error('Could not locate downloadMaterial() before downloadFile().');
}

const replacement = `async function downloadMaterial(item) {
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

html = html.replace(functionRegex, replacement);
writeFileSync(htmlPath, html, 'utf8');
console.log('Final PDF web route applied: one valid async downloadMaterial() function.');
