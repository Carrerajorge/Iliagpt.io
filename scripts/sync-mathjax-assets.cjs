const fs = require('fs');
const path = require('path');

const mathjaxSrc = path.join(__dirname, '..', 'node_modules', 'mathjax', 'es5');
const mathjaxDest = path.join(__dirname, '..', 'client', 'public', 'mathjax');

if (!fs.existsSync(mathjaxSrc)) {
  console.log('[sync-mathjax] mathjax not installed, skipping.');
  process.exit(0);
}

fs.mkdirSync(mathjaxDest, { recursive: true });

const filesToSync = ['tex-mml-chtml.js', 'tex-chtml.js', 'tex-svg.js'];

for (const file of filesToSync) {
  const src = path.join(mathjaxSrc, file);
  const dest = path.join(mathjaxDest, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[sync-mathjax] Synced ${file}`);
  }
}

console.log('[sync-mathjax] Done.');
