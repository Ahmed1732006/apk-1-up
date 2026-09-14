import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const p = join(process.cwd(), 'android', 'app', 'src', 'main', 'java', 'com', 'inthevoid', 'platform', 'PdfViewerActivity.java');
if (!existsSync(p)) throw new Error('PdfViewerActivity.java missing');
let s = readFileSync(p, 'utf8');

const start = s.indexOf('        private void requestPage(final int index) {');
const end = s.indexOf('        private void evictFarPages(int center) {', start);
if (start < 0 || end < 0) throw new Error('requestPage block not found');

const replacement = `        private void requestPage(final int index) {
            if (index < 0 || index >= pageCount || stopped || pdfFile == null || loading.contains(index)) return;
            Bitmap cached = cache.get(index);
            if (cached != null && !cached.isRecycled()) return;
            loading.add(index);
            executor.execute(() -> {
                Bitmap result = null;
                ParcelFileDescriptor fd = null;
                PdfRenderer renderer = null;
                try {
                    fd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY);
                    renderer = new PdfRenderer(fd);
                    if (index >= renderer.getPageCount()) throw new Exception("Invalid PDF page index");
                    PdfRenderer.Page page = renderer.openPage(index);
                    int viewWidth = Math.max(1, getWidth());
                    int targetWidth = Math.max(900, Math.min(1800, viewWidth * 2));
                    float ratio = page.getHeight() / (float)Math.max(1, page.getWidth());
                    int targetHeight = Math.max(900, Math.min(3200, Math.round(targetWidth * ratio)));
                    result = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
                    result.eraseColor(Color.WHITE);
                    page.render(result, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    page.close();
                } catch (Throwable error) {
                    android.util.Log.e("IN_THE_VOID_PDF", "render page " + index + " failed", error);
                    if (result != null && !result.isRecycled()) result.recycle();
                    result = null;
                } finally {
                    try { if (renderer != null) renderer.close(); } catch (Throwable ignored) {}
                    try { if (fd != null) fd.close(); } catch (Throwable ignored) {}
                }
                final Bitmap rendered = result;
                main.post(() -> {
                    loading.remove(index);
                    if (stopped) {
                        if (rendered != null && !rendered.isRecycled()) rendered.recycle();
                        return;
                    }
                    if (rendered != null && !rendered.isRecycled()) {
                        Bitmap old = cache.put(index, rendered);
                        if (old != null && !old.isRecycled()) old.recycle();
                        evictFarPages(index);
                    }
                    invalidate();
                });
            });
        }
`;
s = s.slice(0, start) + replacement + s.slice(end);
writeFileSync(p, s, 'utf8');
console.log('PDF pages now render through isolated PdfRenderer instances.');
