// Builds dist/index.html: template + styles + the real @weight-ai/core (bundled as an IIFE) + app script.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => join(here, 'src', f);

const core = await build({
  entryPoints: [join(here, '../../packages/core/src/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'WeightCore',
  target: 'es2020',
  minify: true,
  write: false,
});

const [template, css, app] = await Promise.all([
  readFile(src('index.html'), 'utf8'),
  readFile(src('styles.css'), 'utf8'),
  readFile(src('app.js'), 'utf8'),
]);

const html = template
  .replace('/*__STYLES__*/', () => css)
  .replace('/*__CORE__*/', () => core.outputFiles[0].text)
  .replace('/*__APP__*/', () => app);

await mkdir(join(here, 'dist'), { recursive: true });
await writeFile(join(here, 'dist/index.html'), html);
console.log(`dist/index.html — ${(html.length / 1024).toFixed(1)} KB`);
