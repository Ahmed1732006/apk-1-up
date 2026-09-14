import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const javaBase = join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inthevoid', 'platform');
const pluginPath = join(javaBase, 'PdfViewerPlugin.java');
const activityPath = join(javaBase, 'PdfViewerActivity.java');
const htmlPath = join(root, 'www', 'app', 'index.html');

if (!existsSync(javaBase)) throw new Error('Android Java source directory is missing.');
if (!existsSync(htmlPath)) throw new Error('www/app/index.html missing. Run npm run build:web first.');

// -----------------------------------------------------------------------------
// 1) Canonical Android bridge.
//    The bridge owns the complete URL -> local file -> validated PDF pipeline.
//    It never sends PDF bytes through JavaScript/base64.
// -----------------------------------------------------------------------------
writeFileSync(pluginPath, `package com.inthevoid.platform;

import android.content.Intent;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import androidx.core.content.FileProvider;

@CapacitorPlugin(name = "PdfViewer")
public class PdfViewerPlugin extends Plugin {
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final long MAX_PDF_BYTES = 80L * 1024L * 1024L;

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        String name = call.getString("filename", "document.pdf");
        if (url == null || url.trim().isEmpty()) {
            call.reject("PDF URL is empty", "PDF_URL_EMPTY");
            return;
        }
        final String safeUrl = url.trim();
        final String safeName = sanitizeName(name);

        getBridge().execute(() -> {
            try {
                File file = downloadAndValidatePdf(safeUrl, safeName);
                Intent intent = new Intent(getContext(), PdfViewerActivity.class);
                intent.putExtra("pdf_path", file.getAbsolutePath());
                intent.putExtra("pdf_name", safeName);
                getActivity().runOnUiThread(() -> {
                    getActivity().startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("opened", true);
                    ret.put("isPdf", true);
                    call.resolve(ret);
                });
            } catch (NotPdfException e) {
                JSObject ret = new JSObject();
                ret.put("opened", false);
                ret.put("isPdf", false);
                call.resolve(ret);
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject("تعذر تحميل ملف PDF بشكل صحيح: " + e.getMessage(), "PDF_LOAD_FAILED", e));
            }
        });
    }

    private File downloadAndValidatePdf(String urlString, String name) throws Exception {
        HttpURLConnection connection = null;
        File dir = new File(getContext().getCacheDir(), "pdf");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("تعذر إنشاء مجلد PDF");
        File temp = File.createTempFile("pdf_", ".part", dir);
        File finalFile = new File(dir, System.currentTimeMillis() + "_" + name);

        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1");
            connection.connect();

            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);

            String contentType = connection.getContentType();
            if (contentType != null) {
                String ct = contentType.toLowerCase(Locale.US);
                if (ct.contains("text/html") || ct.contains("application/json") || ct.contains("text/plain")) {
                    throw new Exception("رابط PDF أعاد استجابة غير PDF (" + contentType + ")");
                }
            }

            long expected = connection.getContentLengthLong();
            if (expected > MAX_PDF_BYTES) throw new Exception("حجم PDF أكبر من الحد المسموح");

            long total = 0;
            boolean headerChecked = false;
            byte[] buffer = new byte[BUFFER_SIZE];
            try (InputStream raw = connection.getInputStream(); BufferedInputStream in = new BufferedInputStream(raw); FileOutputStream out = new FileOutputStream(temp)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (read == 0) continue;
                    if (!headerChecked) {
                        headerChecked = true;
                        if (read < 5 || buffer[0] != '%' || buffer[1] != 'P' || buffer[2] != 'D' || buffer[3] != 'F' || buffer[4] != '-') {
                            throw new NotPdfException();
                        }
                    }
                    total += read;
                    if (total > MAX_PDF_BYTES) throw new Exception("حجم PDF أكبر من الحد المسموح");
                    out.write(buffer, 0, read);
                }
                out.flush();
            }

            if (!headerChecked || total < 5) throw new Exception("ملف PDF فارغ أو ناقص");
            if (expected > 0 && total != expected) throw new Exception("اكتمل تنزيل PDF بشكل غير كامل");

            // Strong validation: the exact file that will be rendered must be a
            // document that Android's PdfRenderer can actually open and enumerate.
            try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY)) {
                PdfRenderer renderer = new PdfRenderer(fd);
                int pages = renderer.getPageCount();
                if (pages < 1) {
                    renderer.close();
                    throw new Exception("PDF لا يحتوي على صفحات");
                }
                PdfRenderer.Page first = renderer.openPage(0);
                int width = first.getWidth();
                int height = first.getHeight();
                first.close();
                renderer.close();
                if (width <= 0 || height <= 0) throw new Exception("أبعاد أول صفحة غير صالحة");
            }

            if (finalFile.exists() && !finalFile.delete()) throw new Exception("تعذر استبدال ملف PDF القديم");
            if (!temp.renameTo(finalFile)) {
                try (FileInputStream in = new FileInputStream(temp); FileOutputStream out = new FileOutputStream(finalFile)) {
                    byte[] copy = new byte[BUFFER_SIZE];
                    int n;
                    while ((n = in.read(copy)) != -1) out.write(copy, 0, n);
                }
                if (!temp.delete()) temp.deleteOnExit();
            }
            return finalFile;
        } finally {
            if (connection != null) connection.disconnect();
            if (temp.exists()) temp.delete();
        }
    }

    private String sanitizeName(String value) {
        String name = value == null ? "document.pdf" : value.trim();
        if (name.isEmpty()) name = "document.pdf";
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!name.toLowerCase(Locale.US).endsWith(".pdf")) name += ".pdf";
        return name;
    }

    private static class NotPdfException extends Exception {}

    public static void openExternal(android.content.Context context, File file) {
        try {
            android.net.Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, "application/pdf");
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(Intent.createChooser(view, "فتح باستخدام تطبيق آخر"));
        } catch (Exception e) {
            android.widget.Toast.makeText(context, "لا يوجد تطبيق مثبت لفتح ملف PDF.", android.widget.Toast.LENGTH_SHORT).show();
        }
    }
}
`, 'utf8');

// -----------------------------------------------------------------------------
// 2) Canonical native viewer.
//    One PdfRenderer document is opened for the lifetime of the Activity and
//    every page is rendered from that same validated source on one worker queue.
// -----------------------------------------------------------------------------
writeFileSync(activityPath, `package com.inthevoid.platform;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PdfViewerActivity extends Activity {
    private PdfDocumentView documentView;
    private TextView pageLabel;
    private TextView titleView;
    private File pdfFile;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        applySystemBars();
        String path = getIntent().getStringExtra("pdf_path");
        if (path == null || path.isEmpty()) { fail("مسار PDF فارغ"); return; }
        pdfFile = new File(path);
        if (!pdfFile.isFile() || pdfFile.length() < 5) { fail("ملف PDF غير موجود أو ناقص"); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(3, 10, 20));

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(8), dp(6), dp(8), dp(6));
        top.setBackgroundColor(Color.rgb(10, 22, 38));

        Button close = makeButton("×", 25, Color.rgb(45, 55, 70));
        Button external = makeButton("فتح باستخدام تطبيق آخر", 12, Color.rgb(37, 99, 235));
        titleView = new TextView(this);
        titleView.setText(getIntent().getStringExtra("pdf_name"));
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(15);
        titleView.setGravity(Gravity.CENTER);
        titleView.setSingleLine(true);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);
        pageLabel = new TextView(this);
        pageLabel.setTextColor(Color.rgb(190, 205, 225));
        pageLabel.setTextSize(12);
        pageLabel.setGravity(Gravity.CENTER);
        pageLabel.setText("جاري فتح PDF…");

        top.addView(close, weight(0.65f));
        top.addView(pageLabel, weight(1.0f));
        top.addView(titleView, weight(2.4f));
        top.addView(external, weight(2.25f));
        root.addView(top, new LinearLayout.LayoutParams(-1, dp(64)));

        documentView = new PdfDocumentView();
        root.addView(documentView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);

        close.setOnClickListener(v -> finish());
        external.setOnClickListener(v -> PdfViewerPlugin.openExternal(this, pdfFile));
        documentView.start();
    }

    private void fail(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }

    private Button makeButton(String text, int size, int color) {
        Button b = new Button(this);
        b.setText(text); b.setTextColor(Color.WHITE); b.setTextSize(size); b.setAllCaps(false);
        b.setMinHeight(dp(46)); b.setMinWidth(dp(text.equals("×") ? 48 : 120));
        GradientDrawable bg = new GradientDrawable(); bg.setColor(color); bg.setCornerRadius(dp(11)); b.setBackground(bg);
        return b;
    }

    private LinearLayout.LayoutParams weight(float w) { return new LinearLayout.LayoutParams(0, -1, w); }
    private int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density + 0.5f); }
    private void applySystemBars() {
        getWindow().setStatusBarColor(Color.rgb(3,10,20));
        getWindow().setNavigationBarColor(Color.WHITE);
        if (android.os.Build.VERSION.SDK_INT >= 26) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (android.os.Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
    }

    @Override protected void onDestroy() {
        if (documentView != null) documentView.shutdown();
        super.onDestroy();
    }

    private class PdfDocumentView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Handler main = new Handler(Looper.getMainLooper());
        private final ExecutorService worker = Executors.newSingleThreadExecutor();
        private final Map<Integer, Bitmap> cache = new LinkedHashMap<Integer, Bitmap>(8, 0.75f, true);
        private final Set<Integer> loading = new HashSet<>();
        private final ScaleGestureDetector scaleDetector;
        private final GestureDetector gestureDetector;
        private ParcelFileDescriptor descriptor;
        private PdfRenderer renderer;
        private float[] pageWidths;
        private float[] pageHeights;
        private float fitScale = 1f;
        private float scale = 1f;
        private float scrollY = 0f;
        private float panX = 0f;
        private float downX;
        private float downY;
        private boolean ready = false;
        private boolean scaling = false;
        private boolean shuttingDown = false;
        private int pageCount = 0;
        private int centeredPage = 0;

        PdfDocumentView() {
            super(PdfViewerActivity.this);
            setBackgroundColor(Color.rgb(25, 32, 42));
            setFocusable(true); setClickable(true);

            scaleDetector = new ScaleGestureDetector(PdfViewerActivity.this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                @Override public boolean onScaleBegin(ScaleGestureDetector d) {
                    if (!ready) return false;
                    scaling = true;
                    getParent().requestDisallowInterceptTouchEvent(true);
                    return true;
                }
                @Override public boolean onScale(ScaleGestureDetector d) {
                    if (!ready) return true;
                    float old = scale;
                    float next = Math.max(fitScale, Math.min(5f, old * d.getScaleFactor()));
                    if (Math.abs(next - old) < 0.0005f) return true;
                    float fx = d.getFocusX(), fy = d.getFocusY();
                    float docX = (fx - centeredLeft(old) - panX) / old;
                    float docY = (scrollY + fy) / old;
                    scale = next;
                    scrollY = docY * scale - fy;
                    panX = fx - centeredLeft(scale) - docX * scale;
                    clamp(); invalidate(); return true;
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
                    zoomTo(target, e.getX(), e.getY()); return true;
                }
            });
        }

        void start() {
            worker.execute(() -> {
                ParcelFileDescriptor fd = null; PdfRenderer r = null;
                try {
                    fd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY);
                    r = new PdfRenderer(fd);
                    int count = r.getPageCount();
                    if (count < 1) throw new Exception("PDF has no pages");
                    float[] ws = new float[count], hs = new float[count];
                    for (int i = 0; i < count; i++) {
                        PdfRenderer.Page p = r.openPage(i);
                        ws[i] = p.getWidth(); hs[i] = p.getHeight(); p.close();
                    }
                    descriptor = fd; renderer = r;
                    main.post(() -> {
                        if (shuttingDown) return;
                        pageWidths = ws; pageHeights = hs; pageCount = count;
                        fitScale = computeFitScale(); scale = fitScale; scrollY = 0; panX = 0;
                        ready = true; updateLabel(); invalidate();
                    });
                } catch (Throwable e) {
                    try { if (r != null) r.close(); } catch (Throwable ignored) {}
                    try { if (fd != null) fd.close(); } catch (Throwable ignored) {}
                    main.post(() -> fail("تعذر فتح PDF: " + safeMessage(e)));
                }
            });
        }

        private float computeFitScale() {
            if (pageWidths == null || pageWidths.length == 0 || getWidth() <= dp(20)) return 1f;
            return Math.max(0.05f, Math.min(1f, (getWidth() - dp(20)) / maxPageWidth()));
        }
        private float maxPageWidth() { float m = 1f; for (float w : pageWidths) m = Math.max(m, w); return m; }
        private float gap() { return dp(12); }
        private float centeredLeft(float s) { return (getWidth() - maxPageWidth() * s) / 2f; }
        private float pageHeight(int i) { return pageHeights[i] * scale; }
        private float totalHeight() { float total = gap(); for (float h : pageHeights) total += h * scale + gap(); return total; }
        private void clamp() {
            float maxY = Math.max(0f, totalHeight() - getHeight());
            scrollY = Math.max(0f, Math.min(maxY, scrollY));
            float maxX = Math.max(0f, (maxPageWidth() * scale - getWidth()) / 2f);
            panX = Math.max(-maxX, Math.min(maxX, panX));
        }

        private void zoomTo(float target, float fx, float fy) {
            float old = scale, next = Math.max(fitScale, Math.min(5f, target));
            float docX = (fx - centeredLeft(old) - panX) / old;
            float docY = (scrollY + fy) / old;
            scale = next;
            scrollY = docY * scale - fy;
            panX = fx - centeredLeft(scale) - docX * scale;
            clamp(); invalidate();
        }

        private int visiblePage() {
            if (!ready) return 0;
            float y = gap() - scrollY;
            float marker = getHeight() * 0.30f;
            for (int i = 0; i < pageCount; i++) {
                float h = pageHeight(i);
                if (y + h >= marker) return i;
                y += h + gap();
            }
            return pageCount - 1;
        }
        private void updateLabel() { if (pageLabel != null && pageCount > 0) pageLabel.setText("صفحة " + (visiblePage() + 1) + " / " + pageCount); }

        private void requestPage(final int index) {
            if (!ready || index < 0 || index >= pageCount || shuttingDown || loading.contains(index)) return;
            Bitmap existing = cache.get(index);
            if (existing != null && !existing.isRecycled()) return;
            loading.add(index);
            worker.execute(() -> {
                Bitmap result = null; PdfRenderer.Page page = null;
                try {
                    if (renderer == null) throw new Exception("PDF renderer is closed");
                    page = renderer.openPage(index);
                    int targetWidth = Math.max(dp(900), Math.min(1600, Math.max(900, getWidth() * 2)));
                    float ratio = page.getHeight() / (float)Math.max(1, page.getWidth());
                    int targetHeight = Math.max(dp(900), Math.min(3000, Math.round(targetWidth * ratio)));
                    result = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
                    result.eraseColor(Color.WHITE);
                    page.render(result, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                } catch (Throwable e) {
                    android.util.Log.e("IN_THE_VOID_PDF", "render page " + index + " failed", e);
                } finally {
                    try { if (page != null) page.close(); } catch (Throwable ignored) {}
                }
                final Bitmap rendered = result;
                main.post(() -> {
                    loading.remove(index);
                    if (shuttingDown) { if (rendered != null && !rendered.isRecycled()) rendered.recycle(); return; }
                    if (rendered != null && !rendered.isRecycled()) cache.put(index, rendered);
                    else Toast.makeText(PdfViewerActivity.this, "تعذر رسم صفحة " + (index + 1), Toast.LENGTH_SHORT).show();
                    evictFarPages(visiblePage()); invalidate();
                });
            });
        }

        private void evictFarPages(int center) {
            Iterator<Map.Entry<Integer, Bitmap>> it = cache.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<Integer, Bitmap> e = it.next();
                if (Math.abs(e.getKey() - center) > 3) {
                    Bitmap b = e.getValue(); if (b != null && !b.isRecycled()) b.recycle();
                    it.remove();
                }
            }
        }

        @Override protected void onDraw(Canvas c) {
            super.onDraw(c);
            if (!ready || pageHeights == null) return;
            int center = visiblePage();
            for (int i = Math.max(0, center - 1); i <= Math.min(pageCount - 1, center + 3); i++) requestPage(i);

            float y = gap() - scrollY;
            for (int i = 0; i < pageCount; i++) {
                float h = pageHeight(i);
                if (y + h >= 0 && y <= getHeight()) {
                    float left = centeredLeft(scale) + panX;
                    RectF dst = new RectF(left, y, left + pageWidths[i] * scale, y + h);
                    Bitmap b = cache.get(i);
                    paint.setColor(Color.WHITE);
                    if (b != null && !b.isRecycled()) {
                        c.drawBitmap(b, null, dst, paint);
                    } else {
                        c.drawRect(dst, paint);
                        paint.setColor(Color.rgb(100, 115, 135));
                        paint.setTextSize(dp(14)); paint.setTextAlign(Paint.Align.CENTER);
                        c.drawText("جارٍ تجهيز الصفحة…", dst.centerX(), dst.centerY(), paint);
                    }
                }
                y += h + gap();
                if (y > getHeight() && i > center + 4) break;
            }
            updateLabel();
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            scaleDetector.onTouchEvent(e);
            gestureDetector.onTouchEvent(e);
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getX(); downY = e.getY();
                    getParent().requestDisallowInterceptTouchEvent(true); return true;
                case MotionEvent.ACTION_MOVE:
                    if (!scaling && e.getPointerCount() == 1) {
                        float dx = e.getX() - downX, dy = e.getY() - downY;
                        if (scale > fitScale * 1.001f) panX += dx;
                        scrollY -= dy;
                        clamp();
                        downX = e.getX(); downY = e.getY();
                        invalidate();
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    getParent().requestDisallowInterceptTouchEvent(false);
                    updateLabel(); return true;
                default: return true;
            }
        }

        @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            if (ready) { float oldFit = fitScale; fitScale = computeFitScale(); if (scale <= oldFit * 1.01f) scale = fitScale; clamp(); }
        }

        private String safeMessage(Throwable e) { String m = e == null ? null : e.getMessage(); return m == null || m.isEmpty() ? "خطأ غير معروف" : m; }

        void shutdown() {
            if (shuttingDown) return;
            shuttingDown = true; worker.shutdownNow();
            for (Bitmap b : cache.values()) if (b != null && !b.isRecycled()) b.recycle();
            cache.clear(); loading.clear();
            try { if (renderer != null) renderer.close(); } catch (Throwable ignored) {}
            try { if (descriptor != null) descriptor.close(); } catch (Throwable ignored) {}
            renderer = null; descriptor = null;
        }
    }
}
`, 'utf8');

// -----------------------------------------------------------------------------
// 3) Canonical Web -> Android routing.
//    The existing app action is kept as the single entry point. On Android,
//    every attachment first goes through the native bridge; the bridge decides
//    whether the response is a PDF. A PDF can never fall through to the old web
//    modal or external browser. Non-PDF attachments retain the old web behavior.
// -----------------------------------------------------------------------------
let html = readFileSync(htmlPath, 'utf8');

// The database maps fileName to material title, so a title like "المحاضرة 1"
// loses the .pdf extension. Preserve the real storage filename for PDF routing.
const oldMapping = "fileName: m.title || null, fileData: m.file_path || null, filePath: m.file_path || null";
const newMapping = "fileName: (m.file_path ? String(m.file_path).split('/').pop() : null) || m.title || null, fileData: m.file_path || null, filePath: m.file_path || null";
if (html.includes(oldMapping)) html = html.replace(oldMapping, newMapping);

const marker = 'async function downloadMaterial(item) {';
const start = html.indexOf(marker);
if (start < 0) throw new Error('downloadMaterial function not found.');
const bodyStart = start;
let depth = 0;
let inString = null, escaped = false, inLineComment = false, inBlockComment = false;
let bodyEnd = -1;
for (let i = bodyStart; i < html.length; i++) {
    const ch = html[i], next = html[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === inString) inString = null;
        continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) { bodyEnd = i + 1; break; }
}
if (bodyEnd < 0) throw new Error('Could not find end of downloadMaterial function.');

const canonicalFunction = `async function downloadMaterial(item) {
            const path = item?.filePath || item?.fileData;
            if (!path) return showToast('لا يوجد ملف لهذه المادة', 'error');
            const fileName = item?.fileName || item?.name || 'document';
            const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform?.() || window.Capacitor.getPlatform?.() !== 'web'));

            if (isNative) {
                try {
                    const PdfViewer = window.Capacitor?.Plugins?.PdfViewer || window.Capacitor?.registerPlugin?.('PdfViewer');
                    if (!PdfViewer?.openUrl) throw new Error('عارض PDF الأصلي غير متاح داخل التطبيق.');
                    let url = String(path);
                    if (!/^https?:\\/\\//i.test(url)) {
                        const { data, error } = await sb.storage.from('materials').createSignedUrl(url, 300);
                        if (error) throw error;
                        url = data?.signedUrl || '';
                    }
                    if (!url) throw new Error('لم يتم إنشاء رابط صالح للملف.');
                    const result = await PdfViewer.openUrl({ url, filename: fileName });
                    if (result?.isPdf === false) {
                        // Non-PDF attachments keep their previous behavior.
                        if (/^https?:\\/\\//i.test(path)) { window.open(path, '_blank', 'noopener'); return; }
                        const { data, error } = await sb.storage.from('materials').createSignedUrl(path, 300);
                        if (error) throw error;
                        if (data?.signedUrl) { window.open(data.signedUrl, '_blank', 'noopener'); return; }
                        throw new Error('تعذر فتح الملف.');
                    }
                    if (result?.opened) return;
                    throw new Error('لم يتم فتح ملف PDF داخل التطبيق.');
                } catch (e) {
                    console.error('Canonical native PDF/file route failed', e);
                    showToast(e?.message || 'تعذر فتح الملف داخل التطبيق.', 'error');
                    return;
                }
            }

            // Website behavior stays separate from Android behavior.
            if (/^https?:\\/\\//i.test(path)) {
                window.open(path, '_blank', 'noopener');
                return;
            }
            const { data, error } = await sb.storage.from('materials').createSignedUrl(path, 300);
            if (error) return showToast(error.message || 'تعذر تجهيز الملف', 'error');
            if (!data?.signedUrl) return showToast('تعذر تجهيز رابط الملف', 'error');
            window.open(data.signedUrl, '_blank', 'noopener');
        }`;

html = html.slice(0, start) + canonicalFunction + html.slice(bodyEnd);

// Remove every old native-runtime marker so there is only one routing owner.
html = html.replace(/<script id="iv-native-pdf-runtime">[\s\S]*?<\/script>/g, '');
writeFileSync(htmlPath, html, 'utf8');
console.log('Canonical PDF architecture applied: validated native download + one continuous viewer + canonical Android routing.');
