// Writes the rendered portfolio into the static pages, so everything is
// readable before, or without, any JavaScript: link previews, text-only
// readers, crawlers and Google Scholar see the same content as a visitor.
//
// data.json stays the single source of truth and assets/site.js the single
// renderer; this script only runs that renderer under Node. It is safe to run
// any number of times. Usage: node scripts/prerender.mjs [--check]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const stale = [];
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

/* ------------------------------------------------------------ paper pages */
// One page per publication at papers/<bibkey>/: abstract, figure, slides,
// videos and BibTeX, so a supervisor has something to open and Google
// Scholar has one URL per paper. Media files (figure.png, slides.pdf, *.mp4)
// live in the same folder and are referenced by name in data.json.

const SITE = 'https://abusayeb.github.io/';
const researchHtml = readFileSync(join(root, 'research/index.html'), 'utf8');
const tokens = (researchHtml.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const cssVersion = (researchHtml.match(/assets\/base\.css\?v=(\d+)/) || [, '1'])[1];
const P = data.profile || {};
const mail = P.emailAcademic || P.email || '';
const plainNames = (s) => site.plain(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const attr = (s) => site.esc(site.plain(s || '')).replace(/\s+/g, ' ').trim();
const isUrl = (s) => /^https?:/.test(s || '');

function writeIfChanged(rel, content) {
  const path = join(root, rel);
  let before = null;
  try { before = readFileSync(path, 'utf8'); } catch {}
  if (before === content) return console.log(`${rel}: up to date`);
  stale.push(rel);
  if (!check) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  console.log(`${rel}: ${check ? 'STALE' : 'written'}`);
}

function paperPage(p) {
  const key = p.bibkey;
  const url = `${SITE}papers/${encodeURIComponent(key)}/`;
  const state = site.pubState(p);
  const journal = site.isJournal(p);
  const venue = String(p.venue || '').split('·')[0].trim();
  const summary = p.abstract || site.plain(p.note || '');
  const desc = attr(summary).slice(0, 300);
  const image = p.figure ? url + p.figure : SITE + (P.photo || 'photos.jpeg');

  // Highwire tags let Google Scholar index the paper; only for work that is
  // published or accepted, never for manuscripts still under review.
  const scholar = state === 'review' ? [] : [
    ['citation_title', site.plain(p.title)],
    ...plainNames(p.authors).map((a) => ['citation_author', a]),
    ['citation_publication_date', p.year],
    [journal ? 'citation_journal_title' : 'citation_conference_title', venue],
    p.doi ? ['citation_doi', p.doi] : null,
    p.pdf ? ['citation_pdf_url', isUrl(p.pdf) ? p.pdf : url + p.pdf] : null,
    ['citation_abstract_html_url', url],
  ].filter(Boolean);

  const links = [
    p.link && `<a class="btn-link" href="${site.esc(p.link)}" target="_blank" rel="noopener noreferrer">Read the paper →</a>`,
    p.doi && `<a class="btn-link" href="https://doi.org/${site.esc(p.doi)}" target="_blank" rel="noopener noreferrer">DOI →</a>`,
    p.pdf && `<a class="btn-link" href="${site.esc(p.pdf)}" target="_blank" rel="noopener">PDF →</a>`,
    p.arxiv && `<a class="btn-link" href="${site.esc(p.arxiv)}" target="_blank" rel="noopener noreferrer">Preprint →</a>`,
    p.slides && `<a class="btn-link" href="${site.esc(p.slides)}" target="_blank" rel="noopener">Slides (PDF) →</a>`,
    (p.videos || []).length && `<a class="btn-link" href="#video">Video ↓</a>`,
    p.code && `<a class="btn-link" href="${site.esc(p.code)}" target="_blank" rel="noopener noreferrer">Code →</a>`,
  ].filter(Boolean).join('');

  const videos = (p.videos || []).map((v) =>
    `<figure class="paper-media"><video controls preload="metadata" playsinline src="${site.esc(v.src)}"></video>` +
    (v.title ? `<figcaption>${site.esc(v.title)}</figcaption>` : '') + '</figure>').join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>document.documentElement.className+=' js'</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${site.esc(site.plain(p.title))} | ${site.esc(P.name)}</title>
<meta name="description" content="${desc}">
<meta name="author" content="${site.esc(P.name)}">
<meta name="theme-color" content="#0A1220">
<link rel="canonical" href="${url}">
${scholar.map(([n, c]) => `<meta name="${n}" content="${attr(c)}">`).join('\n')}
<meta property="og:type" content="article">
<meta property="og:site_name" content="${site.esc(P.name)} — Research">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${attr(p.title)}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${site.esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../../assets/favicon-research.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="../../assets/base.css?v=${cssVersion}">
${tokens}
<style>
.paper-top{display:flex;gap:1.25rem;flex-wrap:wrap;align-items:center;padding-block:1.25rem;border-bottom:1px solid var(--line)}
.paper-top a{color:var(--muted);font-size:var(--t-sm)}
.paper-top a:hover{color:var(--accent)}
.paper-top .brand-mini{color:var(--text);font-weight:700;margin-right:auto}
.paper{max-width:52rem;padding-block:clamp(2rem,5vw,4rem)}
.paper h1{font-size:clamp(1.5rem,1.1rem + 1.6vw,2.4rem);line-height:1.25;letter-spacing:-.02em;margin:.75rem 0 1rem}
.paper h2{font-size:var(--t-h3);margin:clamp(2rem,4vw,3rem) 0 .9rem}
.paper p{color:var(--muted);line-height:1.75}
.paper .pub-meta,.paper .proj-foot{margin-top:1rem}
.paper .proj-foot{display:flex;flex-wrap:wrap;gap:1.25rem;border-top:0;padding-top:0}
.paper-fig,.paper-media{margin:clamp(1.75rem,3.5vw,2.5rem) 0 0;background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:clamp(.75rem,2vw,1.25rem)}
.paper-fig img{width:100%;height:auto;border-radius:6px;background:#fff}
.paper-media video{width:100%;max-height:80vh;border-radius:6px;background:#000}
.paper figcaption{color:var(--dim);font-size:var(--t-sm);line-height:1.6;margin-top:.75rem}
.paper-bib{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:1rem 1.25rem;overflow-x:auto;font-family:var(--mono, 'JetBrains Mono', monospace);font-size:.82rem;line-height:1.6;color:var(--soft);white-space:pre}
.paper-note{border-left:2px solid var(--accent-line);padding-left:1rem}
</style>
</head>
<body data-page="paper">
<div class="shell paper-top">
  <a class="brand-mini" href="../../research/">${site.esc(P.name)}</a>
  <a href="../../research/#publications">All publications</a>
  <a href="../../research/#contact">Contact</a>
  <a href="../../${site.esc((data.cv || {}).academic || '')}" target="_blank" rel="noopener">CV</a>
</div>
<main class="shell paper">
  <span class="eyebrow">${journal ? 'Journal paper' : 'Conference paper'} · ${site.esc(p.year)}</span>
  <h1>${site.esc(p.title)}</h1>
  <p class="pub-authors">${site.rich(p.authors || '')}${p.authorRole ? `<span class="pub-role">${site.esc(p.authorRole)}</span>` : ''}</p>
  <p class="pub-venue">${site.esc(p.venue)}</p>
  <div class="pub-meta"><span class="chip ${site.statusChip(p)}">${site.statusLabel(p)}</span>${(p.tags || []).map((t) => `<span class="chip">${site.esc(t)}</span>`).join('')}</div>
  ${links ? `<div class="proj-foot">${links}</div>` : ''}
  ${p.figure ? `<figure class="paper-fig"><img src="${site.esc(p.figure)}" alt="${attr(p.figureCaption || p.title)}" loading="lazy"><figcaption>${site.esc(p.figureCaption || '')}</figcaption></figure>` : ''}
  <h2>${p.abstract ? 'Abstract' : 'Summary'}</h2>
  <p>${p.abstract ? site.esc(p.abstract) : site.rich(p.note || '')}</p>
  ${state === 'review' ? `<p class="paper-note">Under review. The full manuscript is available on request: <a href="mailto:${site.esc(mail)}">${site.esc(mail)}</a>.</p>` : ''}
  ${p.contribution ? `<h2>My contribution</h2><p>${site.rich(p.contribution)}</p>` : ''}
  ${p.notes ? `<h2>Notes</h2><p>${site.rich(p.notes)}</p>` : ''}
  ${videos ? `<h2 id="video">Video</h2>${videos}` : ''}
  <h2>Cite</h2>
  <pre class="paper-bib">${site.esc(site.bibtex(p, P.name))}</pre>
</main>
<footer class="foot"><div class="shell foot-in"><span>© ${new Date().getFullYear()} ${site.esc(P.name)}</span>
  <nav aria-label="Footer"><a href="../../research/">Research portfolio</a><a href="mailto:${site.esc(mail)}">${site.esc(mail)}</a><a href="${site.esc(P.github || '')}" target="_blank" rel="noopener">GitHub</a></nav></div></footer>
</body>
</html>
`;
}

const pubs = data.publications || [];
for (const p of pubs) {
  if (!p.bibkey) throw new Error(`publication without bibkey: ${p.title}`);
  writeIfChanged(`papers/${p.bibkey}/index.html`, paperPage(p));
}

/* ---------------------------------------------------- sitemap and robots */
const urls = ['', 'research/', ...pubs.map((p) => `papers/${encodeURIComponent(p.bibkey)}/`)];
writeIfChanged('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n') + '\n</urlset>\n');
writeIfChanged('robots.txt', `User-agent: *\nAllow: /\nDisallow: /edit/\nSitemap: ${SITE}sitemap.xml\n`);

if (check && stale.length) {
  console.error(`Pre-rendered pages are out of date: ${stale.join(', ')}. Run node scripts/prerender.mjs`);
  process.exit(1);
}
