import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const p = join(process.cwd(), 'android', 'app', 'src', 'main', 'java', 'com', 'inthevoid', 'platform', 'PdfViewerActivity.java');
if (!existsSync(p)) throw new Error('PdfViewerActivity.java missing');
let s = readFileSync(p, 'utf8');
if (!s.includes('void releaseBitmap()')) {
  const marker = '        void shutdown() {';
  if (!s.includes(marker)) throw new Error('shutdown method not found');
  s = s.replace(marker, '        void releaseBitmap() { shutdown(); }\n\n' + marker);
  writeFileSync(p, s, 'utf8');
}
console.log('PDF cleanup compatibility method verified.');
