import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const p = join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inthevoid', 'platform', 'PdfViewerActivity.java');
if (!existsSync(p)) throw new Error('PdfViewerActivity.java missing');

let s = readFileSync(p, 'utf8');
const start = s.indexOf('    private class PdfPageView extends View {');
if (start < 0) throw new Error('PdfPageView not found');
const end = s.indexOf('\n    }\n}\n', start);
if (end < 0) throw new Error('viewer class end not found');

s = s.replace(/import android\\.view\\.ViewConfiguration;\\n/g, '');
s = s.replace(/private PdfPageView pageView;/g, 'private PdfDocumentView pageView;');
s = s.replace(/pageView = new PdfPageView\\(\\);/g, 'pageView = new PdfDocumentView();');
s = s.replace(/\\s*pageView\\.setPageChangedListener\\(p -> \\{ currentPage = p; updateLabel\\(\\); \\}\\);\\s*/g, '\\n            ');
s = s.replace(/pageView\\.loadPage\\(\\);/g, 'pageView.loadDocument();');

const cls = `    private class PdfDocumentView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
        private final java.util.Map<Integer, Bitmap> cache = new java.util.HashMap<>();
        private final java.util.Set<Integer> loading = new java.util.HashSet<>();
        private ScaleGestureDetector scaleDetector;
        private GestureDetector gestureDetector;
        private float[] widths;
        private float[] heights;
        private float fitScale = 1f;
        private float scale = 1f;
        private float scrollY = 0f;
        private float offsetX = 0f;
        private float lastX, lastY;
        private float lastFocusX, lastFocusY;
        private boolean ready = false;
        private boolean scaling = false;
        private boolean stopped = false;
        private boolean renderingStarted = false;
        private ParcelFileDescriptor bgDescriptor;
        private PdfRenderer bgRenderer;

        PdfDocumentView() {
            super(PdfViewerActivity.this);
            setBackgroundColor(Color.rgb(25, 32, 42));
            setFocusable(true);
            setClickable(true);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);

            scaleDetector = new ScaleGestureDetector(PdfViewerActivity.this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                @Override public boolean onScaleBegin(ScaleGestureDetector d) {
                    if (!ready) return false;
                    scaling = true;
                    lastFocusX = d.getFocusX();
                    lastFocusY = d.getFocusY();
                    getParent().requestDisallowInterceptTouchEvent(true);
                    return true;
                }
                @Override public boolean onScale(ScaleGestureDetector d) {
                    if (!ready) return true;
                    float old = scale;
                    float next = Math.max(fitScale, Math.min(5f, old * d.getScaleFactor()));
                    if (Math.abs(next - old) < 0.0005f) return true;
                    float docY = (scrollY + lastFocusY) / old;
                    float contentX = (lastFocusX - centeredLeft(old) - offsetX) / old;
                    scale = next;
                    scrollY = docY * scale - lastFocusY;
                    offsetX = lastFocusX - centeredLeft(scale) - contentX * scale;
                    clamp();
                    lastFocusX = d.getFocusX();
                    lastFocusY = d.getFocusY();
                    invalidate();
                    return true;
                }
                @Override public void onScaleEnd(ScaleGestureDetector d) {
                    scaling = false;
                    getParent().requestDisallowInterceptTouchEvent(false);
                }
            });

            gestureDetector = new GestureDetector(PdfViewerActivity.this, new GestureDetector.SimpleOnGestureListener() {
                @Override public boolean onDown(MotionEvent e) { return true; }
                @Override public boolean onDoubleTap(MotionEvent e) {
                    if (!ready) return true;
                    float target = scale < fitScale * 1.5f ? Math.min(5f, fitScale * 2.2f) : fitScale;
                    zoomTo(target, e.getX(), e.getY());
                    return true;
                }
            });
        }

        void loadDocument() {
            if (renderingStarted) return;
            renderingStarted = true;
            executor.execute(() -> {
                ParcelFileDescriptor fd = null;
                PdfRenderer r = null;
                try {
                    fd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY);
                    r = new PdfRenderer(fd);
                    bgDescriptor = fd;
                    bgRenderer = r;
                    final int count = r.getPageCount();
                    final float[] ws = new float[count];
                    final float[] hs = new float[count];
                    for (int i = 0; i < count; i++) {
                        PdfRenderer.Page page = r.openPage(i);
                        ws[i] = Math.max(1, page.getWidth());
                        hs[i] = Math.max(1, page.getHeight());
                        page.close();
                    }
                    main.post(() -> {
                        if (stopped) return;
                        widths = ws;
                        heights = hs;
                        pageCount = count;
                        ready = count > 0;
                        fitScale = computeFitScale();
                        scale = fitScale;
                        scrollY = 0f;
                        offsetX = 0f;
                        invalidate();
                    });
                } catch (Throwable e) {
                    try { if (r != null) r.close(); } catch (Throwable ignored) {}
                    try { if (fd != null) fd.close(); } catch (Throwable ignored) {}
                    main.post(() -> {
                        ready = false;
                        Toast.makeText(PdfViewerActivity.this, "تعذر عرض صفحات PDF", Toast.LENGTH_LONG).show();
                    });
                }
            });
        }

        private float computeFitScale() {
            if (widths == null || widths.length == 0 || getWidth() <= 0) return 1f;
            return Math.max(0.08f, Math.min(1f, (getWidth() - dp(20)) / maxWidth()));
        }
        private float maxWidth() {
            float m = 1f;
            if (widths != null) for (float w : widths) m = Math.max(m, w);
            return m;
        }
        private float gap() { return dp(10); }
        private float pageHeight(int i, float s) { return heights[i] * s; }
        private float totalHeight(float s) {
            float total = gap();
            if (heights != null) for (int i = 0; i < heights.length; i++) total += pageHeight(i, s) + gap();
            return total;
        }
        private float centeredLeft(float s) { return (getWidth() - maxWidth() * s) / 2f; }
        private float maxPanX() { return Math.max(0f, (maxWidth() * scale - getWidth()) / 2f); }
        private void clamp() {
            float maxY = Math.max(0f, totalHeight(scale) - getHeight());
            scrollY = Math.max(0f, Math.min(maxY, scrollY));
            float mx = maxPanX();
            offsetX = Math.max(-mx, Math.min(mx, offsetX));
        }
        private void zoomTo(float next, float fx, float fy) {
            float old = scale;
            if (Math.abs(next - old) < 0.0005f) return;
            float docY = (scrollY + fy) / old;
            float cx = (fx - centeredLeft(old) - offsetX) / old;
            scale = Math.max(fitScale, Math.min(5f, next));
            scrollY = docY * scale - fy;
            offsetX = fx - centeredLeft(scale) - cx * scale;
            clamp();
            invalidate();
        }

        private void requestPage(final int index, final float drawScale) {
            if (index < 0 || index >= pageCount || loading.contains(index) || stopped || bgRenderer == null) return;
            Bitmap existing = cache.get(index);
            if (existing != null && !existing.isRecycled()) return;
            loading.add(index);
            executor.execute(() -> {
                Bitmap b = null;
                try {
                    PdfRenderer.Page page = bgRenderer.openPage(index);
                    int targetWidth = Math.max(dp(900), Math.min(1800, (int)(getWidth() * 1.75f)));
                    float ratio = page.getHeight() / (float)Math.max(1, page.getWidth());
                    int targetHeight = Math.max(dp(900), Math.min(2600, (int)(targetWidth * ratio)));
                    b = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
                    b.eraseColor(Color.WHITE);
                    page.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    page.close();
                } catch (Throwable e) {
                    if (b != null && !b.isRecycled()) b.recycle();
                    b = null;
                }
                final Bitmap result = b;
                main.post(() -> {
                    loading.remove(index);
                    if (stopped) {
                        if (result != null && !result.isRecycled()) result.recycle();
                        return;
                    }
                    if (result != null && !result.isRecycled()) {
                        Bitmap old = cache.put(index, result);
                        if (old != null && !old.isRecycled()) old.recycle();
                        evictFarPages(index);
                    }
                    invalidate();
                });
            });
        }

        private void evictFarPages(int center) {
            java.util.Iterator<java.util.Map.Entry<Integer, Bitmap>> it = cache.entrySet().iterator();
            while (it.hasNext()) {
                java.util.Map.Entry<Integer, Bitmap> e = it.next();
                if (Math.abs(e.getKey() - center) > 4) {
                    Bitmap b = e.getValue();
                    if (b != null && !b.isRecycled()) b.recycle();
                    it.remove();
                }
            }
        }

        private void updateCurrentPage(float firstY) {
            if (pageLabel == null || heights == null || heights.length == 0) return;
            float y = gap() - scrollY;
            int current = 0;
            float marker = getHeight() * 0.30f;
            for (int i = 0; i < heights.length; i++) {
                float h = pageHeight(i, scale);
                if (y + h >= marker) { current = i; break; }
                y += h + gap();
            }
            if (currentPage != current) {
                currentPage = current;
                pageLabel.setText("صفحة " + (current + 1) + " / " + pageCount);
            }
        }

        @Override protected void onDraw(Canvas c) {
            super.onDraw(c);
            if (!ready || heights == null) return;
            float y = gap() - scrollY;
            int firstVisible = 0;
            for (int i = 0; i < pageCount; i++) {
                float ph = pageHeight(i, scale);
                if (y + ph >= 0) { firstVisible = i; break; }
                y += ph + gap();
            }
            for (int i = Math.max(0, firstVisible - 1); i < Math.min(pageCount, firstVisible + 4); i++) {
                requestPage(i, scale);
            }
            y = gap() - scrollY;
            for (int i = 0; i < pageCount; i++) {
                float ph = pageHeight(i, scale);
                if (y + ph >= 0 && y <= getHeight()) {
                    float left = (getWidth() - widths[i] * scale) / 2f + offsetX;
                    RectF dst = new RectF(left, y, left + widths[i] * scale, y + ph);
                    Bitmap b = cache.get(i);
                    paint.setColor(Color.WHITE);
                    if (b != null && !b.isRecycled()) c.drawBitmap(b, null, dst, paint);
                    else {
                        c.drawRect(dst, paint);
                        paint.setColor(Color.rgb(120, 130, 145));
                        paint.setTextSize(dp(14));
                        paint.setTextAlign(Paint.Align.CENTER);
                        c.drawText("جارٍ تحميل الصفحة…", dst.centerX(), dst.centerY(), paint);
                    }
                }
                y += ph + gap();
                if (y > getHeight() && i > firstVisible + 4) break;
            }
            updateCurrentPage(firstVisible == 0 ? 0 : firstVisible);
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            scaleDetector.onTouchEvent(e);
            gestureDetector.onTouchEvent(e);
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    lastX = e.getX();
                    lastY = e.getY();
                    getParent().requestDisallowInterceptTouchEvent(true);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (!scaling && e.getPointerCount() == 1) {
                        float dx = e.getX() - lastX;
                        float dy = e.getY() - lastY;
                        scrollY -= dy;
                        if (scale > fitScale * 1.001f) offsetX += dx;
                        clamp();
                        lastX = e.getX();
                        lastY = e.getY();
                        invalidate();
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    getParent().requestDisallowInterceptTouchEvent(false);
                    return true;
                default:
                    return true;
            }
        }

        @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            if (ready) {
                float oldFit = fitScale;
                fitScale = computeFitScale();
                if (scale <= oldFit * 1.01f) scale = fitScale;
                clamp();
            }
        }

        void releaseBitmap() { shutdown(); }
        void shutdown() {
            if (stopped) return;
            stopped = true;
            executor.shutdownNow();
            for (Bitmap b : cache.values()) if (b != null && !b.isRecycled()) b.recycle();
            cache.clear();
            loading.clear();
            try { if (bgRenderer != null) bgRenderer.close(); } catch (Throwable ignored) {}
            try { if (bgDescriptor != null) bgDescriptor.close(); } catch (Throwable ignored) {}
            bgRenderer = null;
            bgDescriptor = null;
        }
    }`;

s = s.slice(0, start) + cls + s.slice(end + 6);
writeFileSync(p, s, 'utf8');
console.log('Stable continuous vertical PDF viewer generated.');
