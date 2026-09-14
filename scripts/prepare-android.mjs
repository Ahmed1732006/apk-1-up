import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const android = join(root, 'android');
const app = join(android, 'app');
const res = join(app, 'src', 'main', 'res');

if (!existsSync(app)) throw new Error('Android project was not generated. Run npx cap add android first.');

const gs = join(root, 'google-services.json');
if (existsSync(gs)) copyFileSync(gs, join(app, 'google-services.json'));

const versionCode = Number(process.env.ANDROID_VERSION_CODE || 7);
const versionName = process.env.ANDROID_VERSION_NAME || '1.2.1';
const gradle = join(app, 'build.gradle');
if (existsSync(gradle)) {
  let text = readFileSync(gradle, 'utf8');
  text = text.replace(/versionCode\s+\d+/g, `versionCode ${versionCode}`);
  text = text.replace(/versionName\s+['"][^'"]+['"]/g, `versionName '${versionName}'`);
  text = text.replace(/applicationId\s+['"][^'"]+['"]/g, `applicationId 'com.inthevoid.platform'`);
  if (!text.includes('inTheVoidRelease')) {
    const androidBlock = text.indexOf('android {');
    if (androidBlock >= 0) {
      text = text.slice(0, androidBlock) + `android {
    signingConfigs {
        inTheVoidRelease {
            def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            storeFile file(keystorePath ?: "in_the_void_release.jks")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
            keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: "in-the-void-release"
            keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: ""
        }
    }
` + text.slice(androidBlock + 'android {'.length);
      const buildTypesAt = text.indexOf('buildTypes {');
      if (buildTypesAt >= 0) {
        const releaseAt = text.indexOf('release {', buildTypesAt);
        if (releaseAt >= 0) {
          text = text.slice(0, releaseAt) + 'release {\n            signingConfig signingConfigs.inTheVoidRelease\n        ' + text.slice(releaseAt + 'release {'.length);
        } else {
          text = text.slice(0, buildTypesAt) + 'buildTypes {\n        release { signingConfig signingConfigs.inTheVoidRelease }' + text.slice(buildTypesAt + 'buildTypes {'.length);
        }
      }
    }
  }
  writeFileSync(gradle, text);
}

// Preserve the existing launcher icon. CI may generate density/adaptive resources,
// but this script never replaces the source icon with the splash GIF.
const iconSource = join(root, 'resources', 'icon.png');
if (existsSync(iconSource)) {
  for (const dir of ['mipmap-mdpi','mipmap-hdpi','mipmap-xhdpi','mipmap-xxhdpi','mipmap-xxxhdpi']) {
    const targetDir = join(res, dir); mkdirSync(targetDir, { recursive: true });
    copyFileSync(iconSource, join(targetDir, 'ic_launcher.png'));
    copyFileSync(iconSource, join(targetDir, 'ic_launcher_round.png'));
  }
}

const forbidden = ['firebase-adminsdk', 'service-account', 'private-key'];
for (const name of readdirSync(root)) {
  if (['node_modules','.git','.github','android','www'].includes(name)) continue;
  if (forbidden.some(x => name.toLowerCase().includes(x))) throw new Error(`Refusing to package secret file: ${name}`);
}

const javaBase = join(app, 'src', 'main', 'java', 'com', 'inthevoid', 'platform');
mkdirSync(javaBase, { recursive: true });
writeFileSync(join(javaBase, 'PdfViewerPlugin.java'), `package com.inthevoid.platform;

import android.content.Intent;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

@CapacitorPlugin(name = "PdfViewer")
public class PdfViewerPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String base64 = call.getString("base64", "");
        String name = call.getString("filename", "file.pdf");
        if (base64 == null || base64.isEmpty()) { call.reject("PDF data is empty"); return; }
        try {
            if (name == null || name.trim().isEmpty()) name = "file.pdf";
            name = name.replaceAll("[^A-Za-z0-9._-]", "_");
            if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
            File dir = new File(getContext().getCacheDir(), "pdf");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create PDF cache");
            File file = new File(dir, System.currentTimeMillis() + "_" + name);
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
            Intent intent = new Intent(getContext(), PdfViewerActivity.class);
            intent.putExtra("pdf_path", file.getAbsolutePath());
            intent.putExtra("pdf_name", name);
            getActivity().startActivity(intent);
            JSObject ret = new JSObject(); ret.put("opened", true); call.resolve(ret);
        } catch (Exception e) { call.reject("تعذر فتح ملف PDF", e); }
    }

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
`);

writeFileSync(join(javaBase, 'PdfViewerActivity.java'), `package com.inthevoid.platform;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;

public class PdfViewerActivity extends Activity {
    private PdfRenderer renderer;
    private ParcelFileDescriptor descriptor;
    private PdfPageView pageView;
    private TextView pageLabel;
    private int pageCount;
    private int currentPage = 0;
    private File pdfFile;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        applySystemBars();
        try {
            String path = getIntent().getStringExtra("pdf_path");
            if (path == null || path.isEmpty()) throw new Exception("PDF path is empty");
            pdfFile = new File(path);
            descriptor = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(descriptor);
            pageCount = renderer.getPageCount();
            if (pageCount < 1) throw new Exception("PDF has no pages");

            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.rgb(3,10,20));

            LinearLayout top = new LinearLayout(this);
            top.setGravity(Gravity.CENTER_VERTICAL);
            top.setPadding(dp(8), dp(6), dp(8), dp(6));
            top.setBackgroundColor(Color.rgb(10,22,38));

            Button close = button("×", false, Color.rgb(220,38,38));
            Button external = button("فتح باستخدام تطبيق آخر", true, Color.rgb(37,99,235));
            TextView title = new TextView(this);
            title.setText(getIntent().getStringExtra("pdf_name"));
            title.setTextColor(Color.WHITE);
            title.setTextSize(14);
            title.setGravity(Gravity.CENTER);
            title.setSingleLine(true);
            title.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);

            pageLabel = new TextView(this);
            pageLabel.setTextColor(Color.WHITE);
            pageLabel.setTextSize(12);
            pageLabel.setGravity(Gravity.CENTER);
            updateLabel();

            top.addView(close, weight(0.7f));
            top.addView(pageLabel, weight(1.0f));
            top.addView(title, weight(2.5f));
            top.addView(external, weight(2.2f));
            root.addView(top, new LinearLayout.LayoutParams(-1, dp(62)));

            pageView = new PdfPageView();
            root.addView(pageView, new LinearLayout.LayoutParams(-1, 0, 1));
            setContentView(root);

            close.setOnClickListener(v -> finish());
            external.setOnClickListener(v -> PdfViewerPlugin.openExternal(this, pdfFile));
            pageView.setPageChangedListener(p -> { currentPage = p; updateLabel(); });
            pageView.loadPage();
        } catch (Exception e) {
            Toast.makeText(this, "تعذر فتح ملف PDF", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void applySystemBars() {
        getWindow().setStatusBarColor(Color.rgb(3,10,20));
        getWindow().setNavigationBarColor(Color.rgb(255,248,252));
        if (android.os.Build.VERSION.SDK_INT >= 26) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (android.os.Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
    }

    private void updateLabel() { if (pageLabel != null) pageLabel.setText((currentPage + 1) + " / " + pageCount + "   •   Pinch / Pan"); }
    private Button button(String text, boolean wide, int color) {
        Button b = new Button(this); b.setText(text); b.setTextColor(Color.WHITE); b.setTextSize(wide ? 12 : 25); b.setAllCaps(false);
        b.setMinHeight(dp(46)); b.setMinWidth(dp(wide ? 120 : 48)); b.setPadding(dp(wide ? 10 : 2), 0, dp(wide ? 10 : 2), 0);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(color); bg.setCornerRadius(dp(10)); b.setBackground(bg); return b;
    }
    private LinearLayout.LayoutParams weight(float w) { return new LinearLayout.LayoutParams(0, -1, w); }
    private int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density + 0.5f); }

    @Override protected void onDestroy() {
        try { if (pageView != null) pageView.releaseBitmap(); if (renderer != null) renderer.close(); renderer = null; if (descriptor != null) descriptor.close(); descriptor = null; }
        catch (Exception ignored) {}
        super.onDestroy();
    }

    private class PdfPageView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final ScaleGestureDetector scaleDetector;
        private final GestureDetector gestureDetector;
        private Bitmap bitmap;
        private float fitScale = 1f;
        private float scale = 1f;
        private float offsetX = 0f;
        private float offsetY = 0f;
        private float lastFocusX;
        private float lastFocusY;
        private OnPageChanged pageChanged;

        PdfPageView() {
            super(PdfViewerActivity.this);
            setBackgroundColor(Color.rgb(25,32,42));
            scaleDetector = new ScaleGestureDetector(PdfViewerActivity.this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                @Override public boolean onScaleBegin(ScaleGestureDetector d) {
                    lastFocusX = d.getFocusX(); lastFocusY = d.getFocusY(); getParent().requestDisallowInterceptTouchEvent(true); return true;
                }
                @Override public boolean onScale(ScaleGestureDetector d) {
                    if (bitmap == null) return true;
                    float old = scale, next = Math.max(fitScale, Math.min(5f, old * d.getScaleFactor()));
                    if (Math.abs(next-old) < 0.0005f) return true;
                    float contentX=(lastFocusX-pageLeft(old))/old, contentY=(lastFocusY-pageTop(old))/old;
                    scale=next; offsetX=lastFocusX-contentX*scale-centeredLeft(scale); offsetY=lastFocusY-contentY*scale-centeredTop(scale); clampOffsets();
                    lastFocusX=d.getFocusX(); lastFocusY=d.getFocusY(); invalidate(); return true;
                }
                @Override public void onScaleEnd(ScaleGestureDetector d) { getParent().requestDisallowInterceptTouchEvent(false); }
            });
            gestureDetector = new GestureDetector(PdfViewerActivity.this, new GestureDetector.SimpleOnGestureListener() {
                @Override public boolean onDown(MotionEvent e) { return true; }
                @Override public boolean onDoubleTap(MotionEvent e) { float target=scale<fitScale*1.5f?Math.min(5f,fitScale*2.2f):fitScale; zoomTo(target,e.getX(),e.getY()); return true; }
                @Override public boolean onScroll(MotionEvent e1, MotionEvent e2, float dx, float dy) {
                    if (scale <= fitScale * 1.001f) return false;
                    offsetX -= dx; offsetY -= dy; clampOffsets(); invalidate(); return true;
                }
                @Override public boolean onFling(MotionEvent e1, MotionEvent e2, float vx, float vy) { return false; }
            });
        }

        interface OnPageChanged { void changed(int page); }
        void setPageChangedListener(OnPageChanged l) { pageChanged=l; }

        void loadPage() {
            if(renderer==null) return;
            post(() -> {
                try {
                    PdfRenderer.Page page=renderer.openPage(currentPage);
                    int targetWidth=Math.max(dp(1000),getWidth()*2);
                    float ratio=page.getHeight()/(float)Math.max(1,page.getWidth());
                    int targetHeight=Math.max(dp(1000),(int)(targetWidth*ratio));
                    Bitmap b=Bitmap.createBitmap(targetWidth,targetHeight,Bitmap.Config.ARGB_8888);
                    b.eraseColor(Color.WHITE); page.render(b,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); page.close();
                    releaseBitmap(); bitmap=b; fitScale=Math.min(getWidth()/(float)b.getWidth(),getHeight()/(float)b.getHeight());
                    if(!Float.isFinite(fitScale)||fitScale<=0) fitScale=1f; scale=fitScale; offsetX=offsetY=0f; invalidate();
                }catch(Exception e){ bitmap=null; invalidate(); }
            });
        }
        private void goToPage(int p) { int next=Math.max(0,Math.min(pageCount-1,p)); if(next==currentPage)return; currentPage=next; if(pageChanged!=null)pageChanged.changed(currentPage); loadPage(); }
        private void zoomTo(float target,float focusX,float focusY){ if(bitmap==null)return; float old=scale,next=Math.max(fitScale,Math.min(5f,target)); float contentX=(focusX-pageLeft(old))/old,contentY=(focusY-pageTop(old))/old; scale=next; offsetX=focusX-contentX*scale-centeredLeft(scale); offsetY=focusY-contentY*scale-centeredTop(scale); clampOffsets(); invalidate(); }
        private float centeredLeft(float s){return(getWidth()-bitmap.getWidth()*s)/2f;}
        private float centeredTop(float s){return(getHeight()-bitmap.getHeight()*s)/2f;}
        private float pageLeft(float s){return centeredLeft(s)+offsetX;}
        private float pageTop(float s){return centeredTop(s)+offsetY;}
        private void clampOffsets(){if(bitmap==null)return;float maxX=Math.max(0,(bitmap.getWidth()*scale-getWidth())/2f),maxY=Math.max(0,(bitmap.getHeight()*scale-getHeight())/2f);offsetX=Math.max(-maxX,Math.min(maxX,offsetX));offsetY=Math.max(-maxY,Math.min(maxY,offsetY));}
        @Override protected void onSizeChanged(int w,int h,int ow,int oh){super.onSizeChanged(w,h,ow,oh);if(bitmap!=null){fitScale=Math.min(w/(float)bitmap.getWidth(),h/(float)bitmap.getHeight());if(!Float.isFinite(fitScale)||fitScale<=0)fitScale=1f;if(scale<fitScale)scale=fitScale;clampOffsets();}}
        @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);if(bitmap==null)return;float left=pageLeft(scale),top=pageTop(scale);RectF dst=new RectF(left,top,left+bitmap.getWidth()*scale,top+bitmap.getHeight()*scale);paint.setFilterBitmap(true);canvas.drawBitmap(bitmap,null,dst,paint);}
        @Override public boolean onTouchEvent(MotionEvent event){int action=event.getActionMasked();if(action==MotionEvent.ACTION_DOWN)getParent().requestDisallowInterceptTouchEvent(true);boolean scaled=scaleDetector.onTouchEvent(event),gestured=gestureDetector.onTouchEvent(event);if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL)getParent().requestDisallowInterceptTouchEvent(false);return scaled||gestured||true;}
        void releaseBitmap(){if(bitmap!=null&&!bitmap.isRecycled())bitmap.recycle();bitmap=null;}
    }
}
`);

const providerDir = join(res, 'xml');
mkdirSync(providerDir, { recursive: true });
writeFileSync(join(providerDir, 'file_paths.xml'), `<?xml version="1.0" encoding="utf-8"?><paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="pdf_cache" path="pdf/" /></paths>`);

const mainJavaRoot = join(app, 'src', 'main', 'java');
function findMainActivity(dir){
  if(!existsSync(dir)) return null;
  for(const n of readdirSync(dir,{withFileTypes:true})){
    const p=join(dir,n.name);
    if(n.isDirectory()){const f=findMainActivity(p); if(f)return f;}
    else if(n.name==='MainActivity.java') return p;
  }
  return null;
}
const mainActivity=findMainActivity(mainJavaRoot);
if(mainActivity){
  let t=readFileSync(mainActivity,'utf8');
  if(!t.includes('import com.inthevoid.platform.PdfViewerPlugin;')) t=t.replace(/(package [^;]+;)/,'$1\n\nimport com.inthevoid.platform.PdfViewerPlugin;');
  const originalClass='public class MainActivity extends BridgeActivity {';
  if(t.includes(originalClass) && !t.includes('ivSystemBars')){
    t=t.replace(originalClass,`public class MainActivity extends BridgeActivity {
    private void ivSystemBars() {
        android.view.Window w = getWindow();
        w.setStatusBarColor(android.graphics.Color.rgb(3,10,20));
        w.setNavigationBarColor(android.graphics.Color.rgb(255,248,252));
        if (android.os.Build.VERSION.SDK_INT >= 26) w.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (android.os.Build.VERSION.SDK_INT >= 29) w.setNavigationBarContrastEnforced(false);
    }`);
  }
  if(!t.includes('registerPlugin(PdfViewerPlugin.class)')){
    t=t.replace(/(super\.onCreate\(savedInstanceState\);)/,'$1\n        registerPlugin(PdfViewerPlugin.class);\n        ivSystemBars();');
  }
  if(t.includes('protected void onResume()')) t=t.replace('protected void onResume()','public void onResume()');
  if(!t.includes('public void onResume()')){
    t=t.replace(/\n\}/s,'\n    @Override public void onResume() {\n        super.onResume();\n        ivSystemBars();\n    }\n}\n');
  }
  writeFileSync(mainActivity,t);
}

const manifest = join(app, 'src', 'main', 'AndroidManifest.xml');
if(existsSync(manifest)){
  let m=readFileSync(manifest,'utf8');
  if(!m.includes('PdfViewerActivity')) m=m.replace('</application>',`<activity android:name=".PdfViewerActivity" android:screenOrientation="portrait" android:exported="false" />\n    <provider android:name="androidx.core.content.FileProvider" android:authorities="${'${applicationId}'}.fileprovider" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" /></provider>\n</application>`);
  writeFileSync(manifest,m);
}
