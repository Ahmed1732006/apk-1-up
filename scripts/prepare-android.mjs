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
  // The official Jetpack PDF viewer requires Android API 28+.
  text = text.replace(/minSdkVersion\s+[^\n]+/g, 'minSdkVersion 28');
  if (!text.includes('androidx.pdf:pdf-viewer-fragment:1.0.0-beta01')) {
    const deps = text.indexOf('dependencies {');
    if (deps >= 0) text = text.slice(0, deps) + 'dependencies {\n    implementation "androidx.pdf:pdf-viewer-fragment:1.0.0-beta01"' + text.slice(deps + 'dependencies {'.length);
    else throw new Error('Android dependencies block not found.');
  }
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

// System-bar stability is unrelated to PDF rendering, but must remain unchanged.
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
  if(t.includes('public class MainActivity extends BridgeActivity') && !t.includes('ivSystemBars')){
    t=t.replace('public class MainActivity extends BridgeActivity {',`public class MainActivity extends BridgeActivity {
    private void ivSystemBars() {
        android.view.Window w = getWindow();
        w.setStatusBarColor(android.graphics.Color.rgb(3,10,20));
        w.setNavigationBarColor(android.graphics.Color.rgb(255,248,252));
        if (android.os.Build.VERSION.SDK_INT >= 26) w.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (android.os.Build.VERSION.SDK_INT >= 29) w.setNavigationBarContrastEnforced(false);
    }`);
  }
  if(!t.includes('public void onResume()')){
    const idx=t.lastIndexOf('\n}');
    if(idx<0) throw new Error('Could not patch MainActivity onResume.');
    t=t.slice(0,idx)+`\n    @Override public void onResume() {\n        super.onResume();\n        ivSystemBars();\n    }\n`+t.slice(idx);
  }
  writeFileSync(mainActivity,t);
}
