// Writes the rendered portfolio into the static pages, so everything is
// readable before, or without, any JavaScript: link previews, text-only
// readers, crawlers and Google Scholar see the same content as a visitor.
//
// data.json stays the single source of truth and assets/site.js the single
// renderer; this script only runs that renderer under Node. It is safe to run
// any number of times. Usage: node scripts/prerender.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const site = require(join(root, 'assets/site.js'));
const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
const check = process.argv.includes('--check');

const pages = [
  { file: 'index.html', page: 'industry', base: '' },
  { file: 'research/index.html', page: 'research', base: '../' },
];

function replaceOnce(html, re, fn, what, file) {
  if (!re.test(html)) throw new Error(`${file}: could not find ${what}`);
  return html.replace(re, fn);
}

let stale = [];
for (const { file, page, base } of pages) {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const r = site.build(data, page, base);
  const P = r.P || {};
  let html = before;

  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, () => `<title>${site.esc(r.title)}</title>`, '<title>', file);
  html = replaceOnce(html, /(<span id="brandName">)[\s\S]*?(<\/span>\s*<\/a>)/,
    (_, a, b) => a + r.brand + b, 'brandName', file);
  // The notice for readers without JavaScript is obsolete once the content is in the page.
  html = html.replace(/\n?<noscript>[\s\S]*?<\/noscript>\n?/, '\n');
  html = replaceOnce(html, /<main id="app"[^>]*>[\s\S]*?<\/main>/,
    () => `<main id="app" data-sum="${r.sum}">${r.html}</main>`, '<main id="app">', file);
  html = replaceOnce(html, /<div class="load-state" id="loading"( hidden)?>/,
    () => '<div class="load-state" id="loading" hidden>', '#loading', file);
  html = replaceOnce(html, /<footer class="foot" id="foot"( hidden)?>/,
    () => '<footer class="foot" id="foot">', '#foot', file);
  html = html
    .replace(/<span id="yr">[^<]*<\/span>/, `<span id="yr">${new Date().getFullYear()}</span>`)
    .replace(/<span id="footName">[^<]*<\/span>/, `<span id="footName">${site.esc(P.name)}</span>`)
    .replace(/<span id="footLoc">[^<]*<\/span>/, `<span id="footLoc">${site.esc(P.location)}</span>`);

  if (html !== before) {
    stale.push(file);
    if (!check) writeFileSync(path, html);
  }
  console.log(`${file}: ${html === before ? 'up to date' : check ? 'STALE' : 'written'} (${r.html.length} chars, data ${r.sum})`);
}

if (check && stale.length) {
  console.error(`Pre-rendered pages are out of date: ${stale.join(', ')}. Run node scripts/prerender.mjs`);
  process.exit(1);
}
