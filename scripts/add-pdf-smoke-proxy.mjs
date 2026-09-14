import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const javaDir = join(root, 'android/app/src/main/java/com/inthevoid/platform');
const javaPath = join(javaDir, 'PdfSmokeProxyActivity.java');
const manifestPath = join(root, 'android/app/src/main/AndroidManifest.xml');
if (!existsSync(javaDir) || !existsSync(manifestPath)) throw new Error('Android project missing.');

mkdirSync(javaDir, { recursive: true });
writeFileSync(javaPath, `package com.inthevoid.platform;\n\nimport android.app.Activity;\nimport android.content.Intent;\nimport android.os.Bundle;\n\npublic final class PdfSmokeProxyActivity extends Activity {\n    @Override protected void onCreate(Bundle state) {\n        super.onCreate(state);\n        Intent i = new Intent(this, PdfViewerActivity.class);\n        i.putExtra("pdf_path", getFilesDir().getAbsolutePath() + "/smoke.pdf");\n        i.putExtra("pdf_name", "smoke-test.pdf");\n        startActivity(i);\n        finish();\n    }\n}\n`, 'utf8');

let manifest = readFileSync(manifestPath, 'utf8');
if (!manifest.includes('PdfSmokeProxyActivity')) {
  manifest = manifest.replace('</application>', '    <activity android:name=".PdfSmokeProxyActivity" android:exported="true" />\n    </application>');
  writeFileSync(manifestPath, manifest, 'utf8');
}
console.log('Added test-only exported PDF smoke proxy; it is used only for debug emulator validation after the release APK is already built.');
