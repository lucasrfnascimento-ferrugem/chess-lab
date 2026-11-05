import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('node_modules/stockfish');
const out = path.resolve('public/engine');
fs.mkdirSync(out, { recursive: true });

function find(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = find(full, name);
      if (found) return found;
    } else if (entry.name === name) return full;
  }
  return null;
}

for (const name of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  const source = find(root, name);
  if (source) fs.copyFileSync(source, path.join(out, name));
}

const js = path.join(out, 'stockfish-19-lite-single.js');
const wasm = path.join(out, 'stockfish-19-lite-single.wasm');
if (!fs.existsSync(js) || !fs.existsSync(wasm)) {
  console.warn('Stockfish browser files were not found in the installed package. See README troubleshooting.');
}