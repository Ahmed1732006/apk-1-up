import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const android = join(root, 'android');
const app = join(android, 'app');
const res = join(app, 'src', 'main', 'res');

if (!existsSync(app)) throw new Error('Android project was not generated. Run npx cap add android first.');

// Firebase Android config belongs in android/app, never inside the web bundle.
const gs = join(root, 'google-services.json');
if (existsSync(gs)) copyFileSync(gs, join(app, 'google-services.json'));

// Keep the current app identity and bump the release metadata. The current release APK is
// versionCode 2 / versionName 1.1.0; the next release uses a higher versionCode and 1.2.0.
const versionCode = Number(process.env.ANDROID_VERSION_CODE || 6);
const versionName = process.env.ANDROID_VERSION_NAME || '1.2.0';
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

// Keep the existing application icon unchanged. Capacitor Assets is invoked by CI
// for launcher/adaptive variants from the existing resources/icon.png.
const iconSource = join(root, 'resources', 'icon.png');
if (existsSync(iconSource)) {
  for (const dir of ['mipmap-mdpi','mipmap-hdpi','mipmap-xhdpi','mipmap-xxhdpi','mipmap-xxxhdpi']) {
    const targetDir = join(res, dir); mkdirSync(targetDir, { recursive: true });
    copyFileSync(iconSource, join(targetDir, 'ic_launcher.png'));
    copyFileSync(iconSource, join(targetDir, 'ic_launcher_round.png'));
  }
}

// Keep the generated project from accidentally bundling any service-account JSON.
const forbidden = ['firebase-adminsdk', 'service-account', 'private-key'];
const rootFiles = [];
for (const name of rootFiles) {
  if (forbidden.some(x => name.toLowerCase().includes(x))) throw new Error(`Refusing to package secret file: ${name}`);
}


// Native PDF viewer + safe "open with another app" bridge.
// This is injected only into the generated Android project; the web build remains unchanged.
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
import android.graphics.drawable.GradientDrawable;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.util.ArrayList;

public class PdfViewerActivity extends Activity {
    private PdfRenderer renderer;
    private ParcelFileDescriptor descriptor;
    private PdfPagesView pages;
    private TextView pageLabel;
    private int pageCount;
    private int currentPage = 0;
    private File pdfFile;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(3,10,20));
        getWindow().setNavigationBarColor(Color.rgb(3,10,20));
        if (android.os.Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);

        try {
            String path = getIntent().getStringExtra("pdf_path");
            if (path == null || path.isEmpty()) throw new Exception("PDF path is empty");
            pdfFile = new File(path);
            descriptor = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(descriptor);
            pageCount = renderer.getPageCount();

            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.rgb(3,10,20));

            LinearLayout bar = new LinearLayout(this);
            bar.setGravity(Gravity.CENTER_VERTICAL);
            bar.setPadding(dp(8),dp(6),dp(8),dp(6));
            bar.setBackgroundColor(Color.rgb(10,22,38));

            Button close = button("×", false);
            Button prev = button("‹", false);
            Button next = button("›", false);
            Button external = button("فتح باستخدام تطبيق آخر", true);

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

            bar.addView(close, weight(0.62f));
            bar.addView(prev, weight(0.62f));
            bar.addView(pageLabel, weight(1.05f));
            bar.addView(next, weight(0.62f));
            bar.addView(title, weight(2.0f));
            bar.addView(external, weight(2.35f));

            root.addView(bar, new LinearLayout.LayoutParams(-1, dp(64)));

            ScrollView scroll = new ScrollView(this);
            scroll.setFillViewport(true);
            scroll.setClipToPadding(false);
            pages = new PdfPagesView(scroll);
            scroll.addView(pages, new ScrollView.LayoutParams(-1,-2));
            root.addView(scroll, new LinearLayout.LayoutParams(-1,0,1));

            setContentView(root);

            close.setOnClickListener(v -> finish());
            prev.setOnClickListener(v -> goToPage(currentPage - 1, scroll));
            next.setOnClickListener(v -> goToPage(currentPage + 1, scroll));
            external.setOnClickListener(v -> PdfViewerPlugin.openExternal(this, pdfFile));

            scroll.getViewTreeObserver().addOnScrollChangedListener(() -> {
                int y = scroll.getScrollY();
                currentPage = pages.pageAtY(y);
                updateLabel();
            });
        } catch(Exception e) {
            Toast.makeText(this,"تعذر فتح ملف PDF",Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void goToPage(int p, ScrollView s) {
        p=Math.max(0,Math.min(pageCount-1,p));
        currentPage=p;
        s.smoothScrollTo(0,pages.pageTop(p));
        updateLabel();
    }

    private void updateLabel() {
        if(pageLabel!=null) pageLabel.setText((currentPage+1)+" / "+pageCount+"   •   Pinch zoom");
    }

    private Button button(String text, boolean wide) {
        Button b=new Button(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setTextSize(wide ? 12 : 22);
        b.setAllCaps(false);
        b.setMinHeight(dp(46));
        b.setMinWidth(dp(wide ? 120 : 46));
        b.setPadding(dp(wide ? 10 : 4),0,dp(wide ? 10 : 4),0);
        GradientDrawable bg=new GradientDrawable();
        bg.setColor(wide ? Color.rgb(38,99,235) : Color.rgb(25,42,64));
        bg.setCornerRadius(dp(10));
        b.setBackground(bg);
        return b;
    }

    private LinearLayout.LayoutParams weight(float w) {
        return new LinearLayout.LayoutParams(0,-1,w);
    }

    private int dp(int v) {
        return (int)(v*getResources().getDisplayMetrics().density+0.5f);
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        try {
            if(renderer!=null)renderer.close();
            if(descriptor!=null)descriptor.close();
        }catch(Exception ignored){}
    }

    private class PdfPagesView extends View {
        Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
        ArrayList<Integer> baseHeights=new ArrayList<>();
        ArrayList<Bitmap> bitmaps=new ArrayList<>();
        float scale=1f;
        float focusContentX=0f;
        float focusContentY=0f;
        float oldScaleAtGesture=1f;
        ScaleGestureDetector detector;
        ScrollView parentScroll;

        PdfPagesView(ScrollView scroll) {
            super(PdfViewerActivity.this);
            parentScroll=scroll;
            setBackgroundColor(Color.rgb(25,32,42));
            for(int i=0;i<pageCount;i++){ baseHeights.add(dp(500)); bitmaps.add(null); }

            detector=new ScaleGestureDetector(PdfViewerActivity.this,
                new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                    @Override public boolean onScaleBegin(ScaleGestureDetector d) {
                        oldScaleAtGesture=scale;
                        focusContentX=(d.getFocusX()-getWidth()/2f)/Math.max(0.01f,scale)+getWidth()/2f;
                        focusContentY=(parentScroll.getScrollY()+d.getFocusY())/Math.max(0.01f,scale);
                        parentScroll.requestDisallowInterceptTouchEvent(true);
                        return true;
                    }

                    @Override public boolean onScale(ScaleGestureDetector d) {
                        float next=Math.max(0.75f,Math.min(4f,scale*d.getScaleFactor()));
                        if(Math.abs(next-scale)<0.001f) return true;
                        scale=next;
                        requestLayout();
                        invalidate();

                        final float targetY=focusContentY*scale-d.getFocusY();
                        post(() -> {
                            int max=Math.max(0,getHeight()-parentScroll.getHeight());
                            parentScroll.scrollTo(parentScroll.getScrollX(),Math.max(0,Math.min(max,(int)targetY)));
                        });
                        return true;
                    }

                    @Override public void onScaleEnd(ScaleGestureDetector d) {
                        parentScroll.requestDisallowInterceptTouchEvent(false);
                    }
                });
        }

        int pageTop(int p) {
            int y=0;
            for(int i=0;i<p;i++) y+=baseHeights.get(i)+dp(14);
            return (int)(y*scale);
        }

        int pageAtY(int y) {
            int unscaled=(int)(y/Math.max(0.01f,scale));
            int acc=0;
            for(int i=0;i<pageCount;i++){
                int h=baseHeights.get(i)+dp(14);
                if(unscaled<acc+h) return i;
                acc+=h;
            }
            return Math.max(0,pageCount-1);
        }

        @Override protected void onMeasure(int ws,int hs) {
            int width=MeasureSpec.getSize(ws);
            int contentWidth=Math.max(dp(280),width-dp(24));
            int total=0;
            for(int i=0;i<pageCount;i++){
                if(bitmaps.get(i)==null){
                    try{
                        PdfRenderer.Page page=renderer.openPage(i);
                        float ratio=(float)page.getHeight()/Math.max(1,page.getWidth());
                        int h=(int)(contentWidth*ratio);
                        baseHeights.set(i,Math.max(dp(200),h));
                        page.close();
                    }catch(Exception ignored){}
                } else {
                    baseHeights.set(i,bitmaps.get(i).getHeight());
                }
                total+=baseHeights.get(i)+dp(14);
            }
            setMeasuredDimension(width,Math.max(dp(100),(int)(total*scale)));
        }

        @Override protected void onDraw(Canvas c) {
            super.onDraw(c);
            if(parentScroll==null || renderer==null) return;

            int viewportTop=parentScroll.getScrollY();
            int viewportBottom=viewportTop+parentScroll.getHeight();
            float topContent=viewportTop/Math.max(0.01f,scale)-dp(250);
            float bottomContent=viewportBottom/Math.max(0.01f,scale)+dp(250);

            c.save();
            float pivotX=(focusContentX>0?focusContentX:getWidth()/2f);
            float pivotY=(focusContentY>0?focusContentY:topContent);
            c.scale(scale,scale,pivotX,pivotY);

            int y=0;
            int width=getWidth()-dp(24);
            for(int i=0;i<pageCount;i++){
                int h=baseHeights.get(i);
                if(y+h>=topContent && y<=bottomContent){
                    Bitmap bm=render(i,width,h);
                    if(bm!=null){
                        float left=(getWidth()-bm.getWidth())/2f;
                        android.graphics.RectF dst=new android.graphics.RectF(left,y,left+bm.getWidth(),y+bm.getHeight());
                        paint.setFilterBitmap(true);
                        c.drawBitmap(bm,null,dst,paint);
                    }
                }
                y+=h+dp(14);
            }
            c.restore();
        }

        Bitmap render(int i,int width,int targetH) {
            Bitmap old=bitmaps.get(i);
            if(old!=null) return old;
            try{
                PdfRenderer.Page page=renderer.openPage(i);
                int w=Math.max(dp(280),width);
                int h=Math.max(dp(280),(int)(w*((float)page.getHeight()/Math.max(1,page.getWidth()))));
                Bitmap b=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);
                b.eraseColor(Color.WHITE);
                page.render(b,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                page.close();
                bitmaps.set(i,b);
                baseHeights.set(i,h);
                return b;
            }catch(Exception e){ return null; }
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            if(e.getPointerCount()>1) parentScroll.requestDisallowInterceptTouchEvent(true);
            boolean handled=detector.onTouchEvent(e);
            if(e.getActionMasked()==MotionEvent.ACTION_UP || e.getActionMasked()==MotionEvent.ACTION_CANCEL)
                parentScroll.requestDisallowInterceptTouchEvent(false);
            return handled || e.getPointerCount()>1 || super.onTouchEvent(e);
        }
    }
}
`);
const providerDir = join(res, 'xml'); mkdirSync(providerDir, {recursive:true});
writeFileSync(join(providerDir,'file_paths.xml'), `<?xml version="1.0" encoding="utf-8"?><paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="pdf_cache" path="pdf/" /></paths>`);
const mainJavaRoot = join(app, 'src', 'main', 'java');
function findMainActivity(dir){
  if(!existsSync(dir)) return null;
  for(const n of readdirSync(dir,{withFileTypes:true})){
    const p=join(dir,n.name); if(n.isDirectory()){const f=findMainActivity(p); if(f)return f;} else if(n.name==='MainActivity.java') return p;
  } return null;
}
const mainActivity=findMainActivity(mainJavaRoot);
if(mainActivity){
  let t=readFileSync(mainActivity,'utf8');
  if(!t.includes('ivSystemBars')){
    if(!t.includes('import com.inthevoid.platform.PdfViewerPlugin;')){
      t=t.replace(/(package [^;]+;)/, '$1\n\nimport com.inthevoid.platform.PdfViewerPlugin;');
    }
    t=t.replace(/public class MainActivity extends BridgeActivity \{/,
`public class MainActivity extends BridgeActivity {
    private void ivSystemBars() {
        android.view.Window w = getWindow();
        w.setStatusBarColor(android.graphics.Color.rgb(3,10,20));
        w.setNavigationBarColor(android.graphics.Color.rgb(255,248,252));
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            w.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            w.setNavigationBarContrastEnforced(false);
        }
    }

    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        ivSystemBars();
        registerPlugin(PdfViewerPlugin.class);
        super.onCreate(savedInstanceState);
        ivSystemBars();
    }

    @Override public void onResume() {
        super.onResume();
        ivSystemBars();
    }`);
    writeFileSync(mainActivity,t);
  }
}

// Standalone internal admin/scanner pages need the same native Back behavior as the SPA.
// This is intentionally a tiny bridge: it only runs inside the Capacitor Android app and
// leaves normal web-browser navigation untouched.
const standalonePages = ['admin-manager.html','admin-videos.html','pdf-forensic-scanner.html'];
const standaloneBackScript = `<script>
(function ivStandaloneBack(){
  if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
  try {
    const App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App || !App.addListener) return;
    let lastBackAt = 0;
    App.addListener('backButton', function(){
      try {
        const visibleModal = Array.from(document.querySelectorAll('.modal,.modal-back,[role="dialog"]')).some(el => {
          const s = getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        });
        if (visibleModal) {
          const close = document.querySelector('.modal.show .close, .modal-back .close, [role="dialog"] .close');
          if (close) { close.click(); return; }
          if (typeof window.closeModal === 'function') { window.closeModal(); return; }
        }
      } catch (_) {}
      if (window.history && window.history.length > 1) {
        window.history.back();
        return;
      }
      const now = Date.now();
      if (now - lastBackAt < 2200) {
        if (App.exitApp) App.exitApp();
        else if (App.minimizeApp) App.minimizeApp();
        return;
      }
      lastBackAt = now;
      const toast = document.createElement('div');
      toast.textContent = 'اضغط مرة أخرى للخروج من التطبيق';
      toast.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;background:rgba(15,23,42,.94);color:#fff;padding:11px 16px;border-radius:12px;font:800 13px Cairo,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 1800);
    });
  } catch (_) {}
})();
</script>`;
for (const page of standalonePages) {
  const pagePath = join(root, page);
  if (existsSync(pagePath)) {
    let html = readFileSync(pagePath, 'utf8');
    if (!html.includes('ivStandaloneBack')) {
      html = html.includes('</body>') ? html.replace('</body>', standaloneBackScript + '\n</body>') : html + standaloneBackScript;
      writeFileSync(pagePath, html);
    }
  }
}
// Keep the Android launch window neutral and remove any old custom image splash.
// Android 12+ may still show the platform-mandated system splash, but this project
// no longer requests the Capacitor SplashScreen plugin/resource.
const ivNavigationColor = '@color/iv_navigation_bar';
const ivColorsPath = join(res, 'values', 'colors.xml');
mkdirSync(join(res, 'values'), { recursive: true });
let ivColors = existsSync(ivColorsPath) ? readFileSync(ivColorsPath,'utf8') : '<resources>\n</resources>\n';
if (!ivColors.includes('iv_navigation_bar')) {
  ivColors = ivColors.replace('</resources>', '    <color name="iv_navigation_bar">#FFF8FC</color>\n</resources>');
  writeFileSync(ivColorsPath, ivColors);
}
function patchStyleFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const path = join(dir,entry.name);
    if (entry.isDirectory()) { patchStyleFiles(path); continue; }
    if (entry.name !== 'styles.xml') continue;
    let styles = readFileSync(path,'utf8');
    styles = styles.replace(/<item name="android:windowSplashScreenAnimatedIcon">[^<]*<\/item>\s*/g, '');
    styles = styles.replace(/<item name="windowSplashScreenAnimatedIcon">[^<]*<\/item>\s*/g, '');
    styles = styles.replace(/<item name="android:navigationBarColor">[^<]*<\/item>\s*/g, '');
    styles = styles.replace(/<item name="android:windowLightNavigationBar">[^<]*<\/item>\s*/g, '');
    styles = styles.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, (full, open, body, close) => {
      if (!body.includes('android:navigationBarColor')) {
        body = '\n        <item name="android:navigationBarColor">' + ivNavigationColor + '</item>' + body;
      }
      if (!body.includes('android:windowLightNavigationBar')) {
        body = '\n        <item name="android:windowLightNavigationBar">true</item>' + body;
      }
      return open + body + close;
    });
    writeFileSync(path,styles);
  }
}
patchStyleFiles(res);

const providerManifest = `\n        <provider android:name="androidx.core.content.FileProvider" android:authorities="${'${applicationId}'}.fileprovider" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" /></provider>`;
const manifestPath=join(app,'src','main','AndroidManifest.xml');
if(existsSync(manifestPath)){
 let t=readFileSync(manifestPath,'utf8');
 if(!t.includes('androidx.core.content.FileProvider')) t=t.replace('</application>', providerManifest+'\n    </application>');
 if(!t.includes('PdfViewerActivity')) t=t.replace('</application>', '        <activity android:name=".PdfViewerActivity" android:exported="false" android:screenOrientation="portrait" />\n    </application>');
 writeFileSync(manifestPath,t);
}

console.log(`Prepared Android: com.inthevoid.platform versionCode=${versionCode} versionName=${versionName}`);
