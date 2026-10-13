#!/usr/bin/env node
// UX.0.10 / UX-T0 / CC-55 item 17: "no hex literals outside the token file".
// Scans app/, lib/, styles/ and packages/ui/src for #rgb/#rrggbb/#rrggbbaa literals in .ts/.tsx/.css; only
// packages/ui/src/brand-tokens.ts may contain them. The delivered pack (packages/ui/brand/) is not code and is
// not scanned. Exit 1 on any violation. (Same rule and regex as salesos packages/ui/scripts/check-no-hex.mjs.)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = resolve(repo, 'packages/ui/src/brand-tokens.ts');
const roots = (process.argv.slice(2).length ? process.argv.slice(2) : ['app', 'lib', 'styles', 'packages/ui/src']).map((p) => resolve(repo, p));
const hex = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(name)) yield p;
  }
}

const hits = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const f of walk(root)) {
    if (resolve(f) === allowed) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(hex)) hits.push(`${relative(repo, f)}:${i + 1}: ${m[0]}`);
    });
  }
}
if (hits.length) {
  console.error(`no-hex: ${hits.length} hex literal(s) outside brand-tokens.ts:\n` + hits.join('\n'));
  process.exit(1);
}
console.log('no-hex: OK');
