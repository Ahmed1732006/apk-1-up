import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const p = join(process.cwd(), 'www', 'app', 'index.html');
if (!existsSync(p)) throw new Error('www/app/index.html missing. Run npm run build:web first.');

let html = readFileSync(p, 'utf8');

const oldCacheBoot = `const cached=ivReadAppCache(session.user.id);\n                const restored=!!(cached && ivRestoreAppCache(session.user.id));`;
const newCacheBoot = `const cached=ivReadAppCache(session.user.id);\n                const restored=!!(offlineNow && cached && ivRestoreAppCache(session.user.id));`;
if (html.includes(oldCacheBoot)) html = html.replace(oldCacheBoot, newCacheBoot);
else if (!html.includes(newCacheBoot)) throw new Error('Expected boot cache block not found.');

const oldCoreFallback = 'if(coreFailed && restored) ivRestoreAppCache(state.user.id);';
const newCoreFallback = 'if(coreFailed && cached) ivRestoreAppCache(state.user.id);';
if (html.includes(oldCoreFallback)) html = html.replace(oldCoreFallback, newCoreFallback);
else if (!html.includes(newCoreFallback)) throw new Error('Expected live-refresh fallback block not found.');

// Make the real application's download action (not a separate click listener)
// route PDFs into the native viewer. This is important because onAction() calls
// downloadMaterial() directly and the old preview was a web modal.
const downloadMarker = '        async function downloadMaterial(item) {';
if (!html.includes(downloadMarker)) throw new Error('downloadMaterial function not found.');
const nativePdfBranch = `        async function downloadMaterial(item) {
            const path = item?.filePath || item?.fileData;
            if (!path) return showToast('لا يوجد ملف لهذه المادة', 'error');

            const pdfName = item?.fileName || item?.name || 'محاضرة.pdf';
            const isPdf = /\\.pdf(?:$|[?#])/i.test(String(path)) || /\\.pdf(?:$|[?#])/i.test(String(pdfName));
            const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
            if (isPdf && isNative) {
                try {
                    const PdfViewer = window.Capacitor?.Plugins?.PdfViewer || window.Capacitor?.registerPlugin?.('PdfViewer');
                    if (!PdfViewer) throw new Error('عارض PDF غير متاح داخل التطبيق.');
                    let signedUrl = path;
                    if (!/^https?:\\/\\//i.test(path)) {
                        const { data, error } = await sb.storage.from('materials').createSignedUrl(path, 300);
                        if (error) throw error;
                        signedUrl = data?.signedUrl || '';
                    }
                    if (!signedUrl) throw new Error('لم يتم إنشاء رابط PDF صالح.');
                    await PdfViewer.openUrl({ url: signedUrl, filename: pdfName });
                    return;
                } catch (e) {
                    console.error('Native PDF viewer failed', e);
                    showToast(e?.message || 'تعذر فتح ملف PDF داخل التطبيق', 'error');
                    return;
                }
            }

            if (/^https?:\\/\\//i.test(path)) {
                window.open(path, '_blank', 'noopener');
                return;
            }`;
const oldDownloadPrefix = `        async function downloadMaterial(item) {
            const path = item?.filePath || item?.fileData;
            if (!path) return showToast('لا يوجد ملف لهذه المادة', 'error');
            if (/^https?:\\/\\//i.test(path)) {
                window.open(path, '_blank', 'noopener');
                return;`;
if (!html.includes(oldDownloadPrefix)) throw new Error('Expected downloadMaterial prefix not found.');
html = html.replace(oldDownloadPrefix, nativePdfBranch);

const marker = '<script id="iv-native-pdf-runtime">';
if (!html.includes(marker)) {
  const script = `${marker}
(function ivNativePdfRuntime(){
  // Kept intentionally tiny: PDF routing is implemented in downloadMaterial,
  // which is the application's canonical file-open path.
})();
</script>`;
  html = html.replace('</body>', `${script}\n</body>`);
}

writeFileSync(p, html, 'utf8');
console.log('Web runtime patched: online-first startup + canonical native PDF routing.');
