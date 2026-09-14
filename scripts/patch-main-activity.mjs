import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'android', 'app', 'src', 'main', 'java');
function findMain(dir) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findMain(p); if (hit) return hit; }
    else if (entry.name === 'MainActivity.kt' || entry.name === 'MainActivity.java') return p;
  }
  return null;
}

const file = findMain(root);
if (!file) throw new Error('MainActivity.kt/java was not generated.');
let text = readFileSync(file, 'utf8');

if (file.endsWith('.kt')) {
  if (!text.includes('import android.os.Bundle')) {
    const pkg = text.match(/^package\s+[^\n]+\n/);
    if (pkg) text = text.replace(pkg[0], pkg[0] + '\nimport android.os.Bundle\n');
  }
  const pluginLine = '        registerPlugin(PdfViewerPlugin::class.java)';
  const bars = `    private fun ivSystemBars() {
        val w = window
        w.statusBarColor = android.graphics.Color.rgb(3, 10, 20)
        w.navigationBarColor = android.graphics.Color.rgb(255, 248, 252)
        if (android.os.Build.VERSION.SDK_INT >= 26) w.decorView.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if (android.os.Build.VERSION.SDK_INT >= 29) w.isNavigationBarContrastEnforced = false
    }
`;
  if (!text.includes('private fun ivSystemBars()')) text = text.replace(/\n}\s*$/, '\n' + bars + '}\n');

  if (/class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{?\s*\}?\s*$/.test(text)) {
    text = text.replace(/class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{?\s*\}?\s*$/, `class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
${pluginLine}
        ivSystemBars()
    }

    override fun onResume() {
        super.onResume()
        ivSystemBars()
    }

${bars}}
`);
  } else {
    if (!text.includes('override fun onCreate(')) {
      text = text.replace(/class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{/, `class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
${pluginLine}
        ivSystemBars()
    }

`);
    } else if (!text.includes(pluginLine)) {
      text = text.replace(/(override fun onCreate\(savedInstanceState: Bundle\?\)\s*\{[\s\S]*?super\.onCreate\(savedInstanceState\))/, `$1\n${pluginLine}\n        ivSystemBars()`);
    }
    if (!text.includes('override fun onResume()')) {
      text = text.replace(/\n}\s*$/, `\n    override fun onResume() {
        super.onResume()
        ivSystemBars()
    }
}\n`);
    }
  }
} else {
  if (!text.includes('registerPlugin(PdfViewerPlugin.class)')) {
    text = text.replace(/(super\.onCreate\(savedInstanceState\);)/, `$1\n        registerPlugin(PdfViewerPlugin.class);\n        ivSystemBars();`);
  }
  if (text.includes('protected void onResume()')) text = text.replace('protected void onResume()', 'public void onResume()');
  if (!text.includes('public void onResume()')) {
    text = text.replace(/\n}\s*$/, '\n    @Override public void onResume() {\n        super.onResume();\n        ivSystemBars();\n    }\n}\n');
  }
}

writeFileSync(file, text, 'utf8');
console.log(`Patched ${file} for native PDF plugin registration and stable system bars.`);
