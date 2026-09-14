import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const p = join(process.cwd(), 'www', 'app', 'index.html');
if (!existsSync(p)) throw new Error('www/app/index.html missing. Run npm run build:web first.');

let html = readFileSync(p, 'utf8');

const oldCacheBoot = `const cached=ivReadAppCache(session.user.id);\n                const restored=!!(cached && ivRestoreAppCache(session.user.id));`;
const newCacheBoot = `const cached=ivReadAppCache(session.user.id);\n                const restored=!!(offlineNow && cached && ivRestoreAppCache(session.user.id));`;
if (html.includes(oldCacheBoot)) html = html.replace(oldCacheBoot, newCacheBoot);
else if (!html.includes(newCacheBoot)) throw new Error('Expected boot cache block not found.');

const marker = '<script id="iv-native-pdf-runtime">';
if (!html.includes(marker)) {
  const script = `${marker}
(function ivNativePdfRuntime(){
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!isNative) return;

  let PdfViewer = null;
  try { PdfViewer = window.Capacitor?.Plugins?.PdfViewer || window.Capacitor?.registerPlugin?.('PdfViewer'); } catch (_) {}
  if (!PdfViewer) return;

  const isPdf = (path, name) => /\\.pdf(?:$|[?#])/i.test(String(path || '')) || /\\.pdf(?:$|[?#])/i.test(String(name || ''));

  async function getSignedPdfUrl(path){
    if (/^https?:\\/\\//i.test(path)) return path;
    const { data, error } = await sb.storage.from('materials').createSignedUrl(path, 300);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('لم يتم إنشاء رابط PDF صالح.');
    return data.signedUrl;
  }

  document.addEventListener('click', async (event) => {
    const el = event.target?.closest?.('[data-act="download-file"]');
    if (!el) return;
    const path = el.dataset.file || '';
    const name = el.dataset.name || '';
    if (!isPdf(path, name)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const oldText = el.innerHTML;
    try {
      el.disabled = true;
      el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري فتح PDF…';
      const signedUrl = await getSignedPdfUrl(path);
      await PdfViewer.openUrl({ url: signedUrl, filename: name || 'document.pdf' });
    } catch (error) {
      console.error('native PDF viewer failed', error);
      try { showToast(error?.message || 'تعذر فتح ملف PDF داخل التطبيق.', 'error'); } catch (_) {}
    } finally {
      el.disabled = false;
      el.innerHTML = oldText;
    }
  }, true);
})();
</script>`;
  html = html.replace('</body>', `${script}\n</body>`);
}

writeFileSync(p, html, 'utf8');
console.log('Web runtime patched: online-first startup + native in-app PDF preview.');
