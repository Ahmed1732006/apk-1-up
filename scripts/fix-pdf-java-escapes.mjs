import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const path = 'android/app/src/main/java/com/inthevoid/platform/PdfViewerActivity.java';
if (!existsSync(path)) throw new Error(`Missing generated PDF activity: ${path}`);

let source = readFileSync(path, 'utf8');
const brokenPattern = /errorView\.setText\("تعذر عرض ملف PDF[\s\S]*?الملف تم تنزيله كاملًا، لكن محرك PDF لم يستطع قراءته\."\);/;
const fixed = String.raw`errorView.setText("تعذر عرض ملف PDF\n\n" + message + "\n\nالملف تم تنزيله كاملًا، لكن محرك PDF لم يستطع قراءته.");`;

if (brokenPattern.test(source)) {
  source = source.replace(brokenPattern, fixed);
  writeFileSync(path, source);
}

if (!source.includes('errorView.setText("تعذر عرض ملف PDF\\n\\n" + message')) {
  throw new Error('PDF activity error string is not Java-escaped correctly.');
}

console.log('PDF Java string escapes validated.');
