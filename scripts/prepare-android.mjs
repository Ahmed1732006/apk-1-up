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
  text = text.replace(/compileSdkVersion\s+[^\n]+/g, 'compileSdkVersion 36');
  text = text.replace(/minSdkVersion\s+[^\n]+/g, 'minSdkVersion 28');

  if (!text.includes('androidx.pdf:pdf-viewer-fragment:1.0.0-beta01')) {
    const deps = text.indexOf('dependencies {');
    if (deps < 0) throw new Error('Android dependencies block not found.');
    text = text.slice(0, deps) + 'dependencies {\n    implementation "androidx.pdf:pdf-viewer-fragment:1.0.0-beta01"' + text.slice(deps + 'dependencies {'.length);
  }

  // Configure release signing without rebuilding/replacing the generated
  // buildTypes block. The previous string-splice approach could leave an
  // extra closing brace in Gradle and caused the release build to fail before
  // Java compilation.
  if (!text.includes('inTheVoidRelease')) {
    const androidOpen = text.indexOf('android {');
    if (androidOpen < 0) throw new Error('Android block not found.');
    const signingBlock = `android {\n    signingConfigs {\n        inTheVoidRelease {\n            def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")\n            storeFile file(keystorePath ?: "in_the_void_release.jks")\n            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""\n            keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: "in-the-void-release"\n            keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: ""\n        }\n    }\n`;
    text = text.slice(0, androidOpen) + signingBlock + text.slice(androidOpen + 'android {'.length);
  }

  if (!text.includes('signingConfig signingConfigs.inTheVoidRelease')) {
    const buildTypesOpen = text.indexOf('buildTypes {');
    if (buildTypesOpen < 0) throw new Error('Android buildTypes block not found.');
    const releaseOpen = text.indexOf('release {', buildTypesOpen);
    if (releaseOpen < 0) throw new Error('Android release buildType block not found.');
    text = text.slice(0, releaseOpen) + 'release {\n            signingConfig signingConfigs.inTheVoidRelease\n        ' + text.slice(releaseOpen + 'release {'.length);
  }

  writeFileSync(gradle, text);
}

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

// Keep the existing app system-bar setup. PDF-specific lifecycle/plugin wiring
// is owned exclusively by patch-main-activity.mjs so there is one owner.
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
  writeFileSync(mainActivity,t);
}
