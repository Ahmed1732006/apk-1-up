import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const p = join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inthevoid', 'platform', 'PdfViewerPlugin.java');
if (!existsSync(p)) throw new Error('PdfViewerPlugin.java missing');

let s = readFileSync(p, 'utf8');

if (!s.includes('import java.io.InputStream;')) {
  s = s.replace('import java.io.FileOutputStream;\n', 'import java.io.FileOutputStream;\nimport java.io.InputStream;\nimport java.net.HttpURLConnection;\nimport java.net.URL;\n');
}

if (!s.includes('public void openUrl(PluginCall call)')) {
  const marker = '    public static void openExternal(android.content.Context context, File file) {';
  if (!s.includes(marker)) throw new Error('openExternal marker not found');
  const method = `    @PluginMethod\n    public void openUrl(PluginCall call) {\n        String url = call.getString("url", "");\n        String name = call.getString("filename", "file.pdf");\n        if (url == null || url.trim().isEmpty()) { call.reject("PDF URL is empty"); return; }\n        final String safeUrl = url.trim();\n        try {\n            if (name == null || name.trim().isEmpty()) name = "file.pdf";\n            name = name.replaceAll("[^A-Za-z0-9._-]", "_");\n            if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";\n            File dir = new File(getContext().getCacheDir(), "pdf");\n            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create PDF cache");\n            File file = new File(dir, System.currentTimeMillis() + "_" + name);\n\n            HttpURLConnection connection = (HttpURLConnection) new URL(safeUrl).openConnection();\n            connection.setInstanceFollowRedirects(true);\n            connection.setConnectTimeout(15000);\n            connection.setReadTimeout(45000);\n            connection.setRequestProperty("Accept", "application/pdf,*/*");\n            connection.connect();\n            int code = connection.getResponseCode();\n            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);\n            try (InputStream input = connection.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {\n                byte[] buffer = new byte[64 * 1024];\n                int read;\n                while ((read = input.read(buffer)) != -1) out.write(buffer, 0, read);\n            } finally {\n                connection.disconnect();\n            }\n            Intent intent = new Intent(getContext(), PdfViewerActivity.class);\n            intent.putExtra("pdf_path", file.getAbsolutePath());\n            intent.putExtra("pdf_name", name);\n            getActivity().startActivity(intent);\n            JSObject ret = new JSObject(); ret.put("opened", true); call.resolve(ret);\n        } catch (Exception e) { call.reject("تعذر تنزيل وفتح ملف PDF", e); }\n    }\n\n`;
  s = s.replace(marker, method + marker);
}

writeFileSync(p, s, 'utf8');
console.log('PDF URL bridge added without loading the whole PDF into JavaScript memory.');
