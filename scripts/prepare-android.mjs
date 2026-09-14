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

// Generate one complete, balanced Gradle file instead of performing regex
// edits inside nested Groovy closures.
const gradleText = `apply plugin: 'com.android.application'\n\nandroid {\n    namespace = "com.inthevoid.platform"\n    compileSdk = 36\n    compileSdkExtension = 19\n\n    defaultConfig {\n        applicationId "com.inthevoid.platform"\n        minSdkVersion 28\n        targetSdkVersion 36\n        versionCode ${versionCode}\n        versionName "${versionName}"\n        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"\n\n        aaptOptions {\n            ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'\n        }\n    }\n\n    buildTypes {\n        release {\n            minifyEnabled false\n            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'\n        }\n    }\n}\n\nrepositories {\n    flatDir {\n        dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'\n    }\n}\n\ndependencies {\n    implementation fileTree(include: ['*.jar'], dir: 'libs')\n    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"\n    implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"\n    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"\n    implementation project(':capacitor-android')\n    implementation project(':capacitor-cordova-android-plugins')\n    implementation "androidx.pdf:pdf-viewer-fragment:1.0.0-beta01"\n    testImplementation "junit:junit:$junitVersion"\n    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"\n    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"\n}\n\napply from: 'capacitor.build.gradle'\n\ntry {\n    def servicesJSON = file('google-services.json')\n    if (servicesJSON.text) {\n        apply plugin: 'com.google.gms.google-services'\n    }\n} catch(Exception e) {\n    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")\n}\n`;
writeFileSync(gradle, gradleText);

// AndroidX PDF beta01 requires AGP 8.9.1+.
const rootGradle = join(android, 'build.gradle');
if (existsSync(rootGradle)) {
  let rootText = readFileSync(rootGradle, 'utf8');
  rootText = rootText.replace(/com\.android\.tools\.build:gradle:8\.7\.2/g, 'com.android.tools.build:gradle:8.9.1');
  rootText = rootText.replace(/com\.android\.tools\.build:gradle['"]\s*version\s*['"]8\.7\.2['"]/g, 'com.android.tools.build:gradle version "8.9.1"');
  writeFileSync(rootGradle, rootText);
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
    t=t.replace('public class MainActivity extends BridgeActivity {',`public class MainActivity extends BridgeActivity {\n    private void ivSystemBars() {\n        android.view.Window w = getWindow();\n        w.setStatusBarColor(android.graphics.Color.rgb(3,10,20));\n        w.setNavigationBarColor(android.graphics.Color.rgb(255,248,252));\n        if (android.os.Build.VERSION.SDK_INT >= 26) w.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);\n        if (android.os.Build.VERSION.SDK_INT >= 29) w.setNavigationBarContrastEnforced(false);\n    }`);
  }
  writeFileSync(mainActivity,t);
}
