/**
 * Copy runtime assets into dist/ so Vercel static hosting can serve HTML + JS + config.
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const dist = path.join(root, 'dist');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(dist)) {
  console.error('[vercel-postbuild] dist/ missing — run vite build first');
  process.exit(1);
}

fs.copyFileSync(path.join(root, 'config.js'), path.join(dist, 'config.js'));

for (const dir of ['JS', 'CSS', 'assets']) {
  copyRecursive(path.join(root, dir), path.join(dist, dir));
}

console.log('[vercel-postbuild] Copied config.js, JS/, CSS/, assets/ → dist/');
