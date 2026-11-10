// Build only the isolated SpreadsheetView fixture. Does not change app/.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
if (!output) throw new Error('Usage: node tests/sheet-smoke-build.mjs <temporary-directory>');
await mkdir(output, { recursive: true });
await build({
  stdin: {
    contents: `
      import { SpreadsheetView } from './src/ui/spreadsheet.js';
      import { createWorkbook } from './src/core/workbook.js';
      window.notices = [];
      window.changes = 0;
      window.sheet = new SpreadsheetView({
        element: document.querySelector('#sheet-content'),
        workbook: createWorkbook(),
        onChange: () => window.changes++,
        onNotice: message => window.notices.push(message),
      });
    `,
    resolveDir: root,
  },
  bundle: true,
  outfile: join(output, 'fixture.js'),
  format: 'iife',
});
const stylesheet = pathToFileURL(join(root, 'src', 'styles.css')).href;
await writeFile(join(output, 'fixture.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Markpad spreadsheet verification</title>
<link rel="stylesheet" href="${stylesheet}"></head>
<body><div id="sheet-content" style="height:500px;width:400px;flex:none"></div>
<script src="fixture.js"></script></body></html>`);
