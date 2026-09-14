import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const javaBase = join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inthevoid', 'platform');
const pluginPath = join(javaBase, 'PdfViewerPlugin.java');
const activityPath = join(javaBase, 'PdfViewerActivity.java');
const htmlPath = join(root, 'www', 'app', 'index.html');
const manifestPath = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const xmlDir = join(root, 'android', 'app', 'src', 'main', 'res', 'xml');

if (!existsSync(javaBase)) throw new Error('Android Java source directory is missing.');
if (!existsSync(htmlPath)) throw new Error('www/app/index.html missing. Run npm run build:web first.');

// -----------------------------------------------------------------------------
// Canonical PDF architecture
// -----------------------------------------------------------------------------
// Web layer: one downloadMaterial() entry point.
// Android bridge: downloads the complete file to a private cache file, validates
// the PDF signature/trailer, then opens ONE dedicated Android PDF Activity.
// Viewer: official AndroidX PdfViewerFragment/PdfView. No custom PdfRenderer,
// no HTML PDF modal, no iframe/embed/object, no page-slider implementation.
// -----------------------------------------------------------------------------

writeFileSync(pluginPath, `package com.inthevoid.platform;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.core.content.FileProvider;
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
import java.nio.charset.StandardCharsets;
import java.util.Locale;

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
                // The URL was a real file, but its bytes are not a PDF. This is
                // intentionally returned to JS so non-PDF attachments keep their
                // existing website/app behavior without entering the PDF viewer.
                JSObject ret = new JSObject();
                ret.put("opened", false);
                ret.put("isPdf", false);
                call.resolve(ret);
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(
                    "تعذر تحميل ملف PDF بالكامل: " + safeMessage(e),
                    "PDF_LOAD_FAILED",
                    e
                ));
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
                    throw new NotPdfException();
                }
            }

            long expected = connection.getContentLengthLong();
            if (expected > MAX_PDF_BYTES) throw new Exception("حجم PDF أكبر من 80MB");

            long total = 0;
            byte[] firstBytes = new byte[1024];
            int firstCount = 0;
            byte[] tail = new byte[4096];
            int tailCount = 0;
            byte[] buffer = new byte[BUFFER_SIZE];

            try (InputStream raw = connection.getInputStream();
                 BufferedInputStream in = new BufferedInputStream(raw);
                 FileOutputStream out = new FileOutputStream(temp)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (read == 0) continue;
                    if (firstCount < firstBytes.length) {
                        int take = Math.min(read, firstBytes.length - firstCount);
                        System.arraycopy(buffer, 0, firstBytes, firstCount, take);
                        firstCount += take;
                    }
                    if (read >= tail.length) {
                        System.arraycopy(buffer, read - tail.length, tail, 0, tail.length);
                        tailCount = tail.length;
                    } else {
                        int keep = Math.min(tail.length, tailCount + read);
                        if (tailCount + read > tail.length) {
                            int shift = tailCount + read - tail.length;
                            System.arraycopy(tail, shift, tail, 0, tailCount - shift);
                            tailCount -= shift;
                        }
                        System.arraycopy(buffer, 0, tail, tailCount, read);
                        tailCount += read;
                    }
                    total += read;
                    if (total > MAX_PDF_BYTES) throw new Exception("حجم PDF أكبر من 80MB");
                    out.write(buffer, 0, read);
                }
                out.flush();
            }

            if (expected > 0 && total != expected) throw new Exception("اكتمل تنزيل PDF بشكل غير كامل");
            if (total < 5) throw new NotPdfException();
            if (!containsPdfHeader(firstBytes, firstCount)) throw new NotPdfException();
            if (!containsPdfEof(tail, tailCount)) throw new Exception("ملف PDF ناقص: لم يتم العثور على EOF");

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

    private boolean containsPdfHeader(byte[] bytes, int count) {
        byte[] magic = "%PDF-".getBytes(StandardCharsets.US_ASCII);
        for (int i = 0; i <= count - magic.length; i++) {
            boolean ok = true;
            for (int j = 0; j < magic.length; j++) if (bytes[i + j] != magic[j]) { ok = false; break; }
            if (ok && i < 1024) return true;
        }
        return false;
    }

    private boolean containsPdfEof(byte[] bytes, int count) {
        String tail = new String(bytes, 0, count, StandardCharsets.ISO_8859_1);
        return tail.contains("%%EOF") || tail.contains("%EOF");
    }

    private String sanitizeName(String value) {
        String name = value == null ? "document.pdf" : value.trim();
        if (name.isEmpty()) name = "document.pdf";
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!name.toLowerCase(Locale.US).endsWith(".pdf")) name += ".pdf";
        return name;
    }

    private String safeMessage(Throwable e) {
        String m = e == null ? null : e.getMessage();
        return m == null || m.isEmpty() ? "خطأ غير معروف" : m;
    }

    private static class NotPdfException extends Exception {}

    public static void openExternal(android.content.Context context, File file) {
        try {
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
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

writeFileSync(activityPath, `package com.inthevoid.platform;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.pdf.PdfDocument;
import androidx.pdf.view.PdfView;
import androidx.pdf.viewer.fragment.PdfViewerFragment;
import java.io.File;

public class PdfViewerActivity extends AppCompatActivity {
    private PdfViewerFragment viewer;
    private TextView pageLabel;
    private TextView errorView;
    private File pdfFile;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        applySystemBars();

        String path = getIntent().getStringExtra("pdf_path");
        String name = getIntent().getStringExtra("pdf_name");
        if (path == null || path.isEmpty()) { fail("مسار PDF فارغ"); return; }
        pdfFile = new File(path);
        if (!pdfFile.isFile() || pdfFile.length() < 5) { fail("ملف PDF غير موجود أو ناقص"); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(3,10,20));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(8), dp(6), dp(8), dp(6));
        toolbar.setBackgroundColor(Color.rgb(10,22,38));

        Button close = makeButton("×", 25, Color.rgb(45,55,70), false);
        Button external = makeButton("فتح باستخدام تطبيق آخر", 12, Color.rgb(37,99,235), true);
        pageLabel = new TextView(this);
        pageLabel.setText("جاري فتح PDF…");
        pageLabel.setTextColor(Color.rgb(190,205,225));
        pageLabel.setTextSize(12);
        pageLabel.setGravity(Gravity.CENTER);

        TextView title = new TextView(this);
        title.setText(name == null ? "PDF" : name);
        title.setTextColor(Color.WHITE);
        title.setTextSize(15);
        title.setGravity(Gravity.CENTER);
        title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);

        toolbar.addView(close, weight(0.7f));
        toolbar.addView(pageLabel, weight(1.0f));
        toolbar.addView(title, weight(2.4f));
        toolbar.addView(external, weight(2.25f));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(64)));

        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(Color.rgb(28,35,45));
        int contentId = View.generateViewId();
        content.setId(contentId);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));

        errorView = new TextView(this);
        errorView.setVisibility(View.GONE);
        errorView.setTextColor(Color.WHITE);
        errorView.setTextSize(15);
        errorView.setGravity(Gravity.CENTER);
        errorView.setPadding(dp(24), dp(24), dp(24), dp(24));
        errorView.setBackgroundColor(Color.rgb(28,35,45));
        content.addView(errorView, new FrameLayout.LayoutParams(-1, -1));

        setContentView(root);
        close.setOnClickListener(v -> finish());
        external.setOnClickListener(v -> PdfViewerPlugin.openExternal(this, pdfFile));

        if (state == null) {
            viewer = new PdfViewerFragment() {
                @Override public void onLoadDocumentSuccess(PdfDocument document) {
                    super.onLoadDocumentSuccess(document);
                    if (errorView != null) errorView.setVisibility(View.GONE);
                    if (pageLabel != null) pageLabel.setText("" + document.getPageCount() + " صفحة");
                }

                @Override public void onLoadDocumentError(Throwable error) {
                    super.onLoadDocumentError(error);
                    showViewerError(error);
                }

                @Override public void onPdfViewCreated(PdfView pdfView) {
                    super.onPdfViewCreated(pdfView);
                    pdfView.setPagesPerRow(1);
                    pdfView.setVerticalAlignment(PdfView.VERTICAL_ALIGNMENT_TOP);
                    pdfView.setVerticalPageSpacing(dp(12));
                    pdfView.setMinZoom(1f);
                    pdfView.setMaxZoom(5f);
                    pdfView.setZoom(1f);
                }
            };
            getSupportFragmentManager().beginTransaction().replace(contentId, viewer).commitNow();
        } else {
            viewer = (PdfViewerFragment) getSupportFragmentManager().findFragmentById(contentId);
        }

        if (viewer == null) { fail("تعذر إنشاء PDF Viewer"); return; }
        viewer.setToolboxVisible(false);
        viewer.setDocumentUri(Uri.fromFile(pdfFile));
    }

    private void showViewerError(Throwable error) {
        String message = error == null || error.getMessage() == null ? "تعذر قراءة ملف PDF." : error.getMessage();
        if (errorView != null) {
            errorView.setVisibility(View.VISIBLE);
            errorView.setText("تعذر عرض ملف PDF\n\n" + message + "\n\nالملف تم تنزيله كاملًا، لكن محرك PDF لم يستطع قراءته.");
        }
        if (pageLabel != null) pageLabel.setText("فشل فتح PDF");
    }

    private void fail(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }

    private Button makeButton(String text, int size, int color, boolean wide) {
        Button b = new Button(this);
        b.setText(text); b.setTextColor(Color.WHITE); b.setTextSize(size); b.setAllCaps(false);
        b.setMinHeight(dp(46)); b.setMinWidth(dp(wide ? 120 : 48));
        b.setPadding(dp(wide ? 10 : 2), 0, dp(wide ? 10 : 2), 0);
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
}
`, 'utf8');

mkdirSync(xmlDir, { recursive: true });
writeFileSync(join(xmlDir, 'file_paths.xml'), `<?xml version="1.0" encoding="utf-8"?><paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="pdf_cache" path="pdf/" /></paths>`);

if (existsSync(manifestPath)) {
    let manifest = readFileSync(manifestPath, 'utf8');
    if (!manifest.includes('.PdfViewerActivity')) {
        manifest = manifest.replace('</application>', '<activity android:name=".PdfViewerActivity" android:screenOrientation="portrait" android:exported="false" android:theme="@style/Theme.AppCompat.Light.NoActionBar" />\n</application>');
    }
    if (!manifest.includes('androidx.core.content.FileProvider')) {
        manifest = manifest.replace('</application>', '<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" /></provider>\n</application>');
    }
    writeFileSync(manifestPath, manifest, 'utf8');
}

// -----------------------------------------------------------------------------
// Web -> Android: replace the old generic download handler with one canonical
// route. Android always tries the native bridge first. The bridge only reports
// opened=true when the downloaded bytes are actually a complete PDF.
// -----------------------------------------------------------------------------
let html = readFileSync(htmlPath, 'utf8');
const oldMapping = "fileName: m.title || null, fileData: m.file_path || null, filePath: m.file_path || null";
const newMapping = "fileName: (m.file_path ? String(m.file_path).split('/').pop() : null) || m.title || null, fileData: m.file_path || null, filePath: m.file_path || null";
if (html.includes(oldMapping)) html = html.replace(oldMapping, newMapping);

const marker = 'async function downloadMaterial(item) {';
const start = html.indexOf(marker);
if (start < 0) throw new Error('downloadMaterial function not found.');
let depth = 0, inString = null, escaped = false, inLineComment = false, inBlockComment = false, bodyEnd = -1;
for (let i = start; i < html.length; i++) {
    const ch = html[i], next = html[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inString) { if (escaped) { escaped = false; continue; } if (ch === '\\') { escaped = true; continue; } if (ch === inString) inString = null; continue; }
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
            const fileName = item?.fileName || item?.name || 'document.pdf';
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
                    if (result?.opened) return;

                    // The native bridge proved that this was not a PDF. Keep the
                    // previous non-PDF behavior; never send a PDF around this path.
                    if (/^https?:\\/\\//i.test(path)) { window.open(path, '_blank', 'noopener'); return; }
                    const { data, error } = await sb.storage.from('materials').createSignedUrl(path, 300);
                    if (error) throw error;
                    if (data?.signedUrl) { window.open(data.signedUrl, '_blank', 'noopener'); return; }
                    throw new Error('تعذر فتح الملف.');
                } catch (e) {
                    console.error('Canonical native PDF route failed', e);
                    showToast(e?.message || 'تعذر فتح الملف داخل التطبيق.', 'error');
                    return;
                }
            }

            // Website behavior remains unchanged: PDFs and other files are opened
            // by the existing web browser flow. No Android-only viewer is loaded.
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
html = html.replace(/<script id="iv-native-pdf-runtime">[\s\S]*?<\/script>/g, '');
writeFileSync(htmlPath, html, 'utf8');
console.log('Canonical PDF architecture applied: complete native download + official AndroidX PDF viewer + single Android PDF route.');
