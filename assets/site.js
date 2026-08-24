/* ============================================================================
   Shared renderer for both portfolios.

   data.json stays the single source of truth (edit it at /edit/). This file
   turns it into either the industry page or the research page, decided by
   document.body.dataset.page. Everything is vanilla JS with no dependencies
   and no network calls beyond the one same-origin fetch of data.json.
   ========================================================================== */
(function () {
  'use strict';

  var BODY = document.body;
  var PAGE = BODY.dataset.page || 'industry';
  var BASE = BODY.dataset.base || '';           // '' on the root page, '../' under /research/
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /* data.json marks emphasis with **double asterisks** */
  function rich(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong class="kw">$1</strong>'); }
  function plain(s) { return String(s == null ? '' : s).replace(/\*\*(.+?)\*\*/g, '$1'); }

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* Publication status is the one thing that must never be overstated, so it
     is always derived from the data rather than written out by hand. */
  /* Four real states, ranked by how close the work is to being public:
     published (it is, and linked) > in press (accepted, typeset, awaiting the
     issue) > accepted (accepted for the venue, not yet presented or indexed) >
     under review (decision pending). Never collapse "accepted" into
     "published" — the paper has no DOI yet and that distinction is the one
     a reviewer actually cares about. */
  function pubState(p) {
    var s = String(p.status || '').toLowerCase();
    if (s.indexOf('review') > -1) return 'review';
    if (s.indexOf('press') > -1) return 'press';
    if (s.indexOf('accept') > -1) return 'accepted';
    return 'published';
  }
  function pubRank(p) { return { published: 0, press: 1, accepted: 2, review: 3 }[pubState(p)]; }
  function sortPubs(list) {
    return (list || []).slice().sort(function (a, b) { return pubRank(a) - pubRank(b); });
  }
  function pubBreakdown(d) {
    var c = { published: 0, press: 0, accepted: 0, review: 0 };
    (d.publications || []).forEach(function (p) { c[pubState(p)]++; });
    var bits = [];
    if (c.published) bits.push(c.published + ' published');
    if (c.press) bits.push(c.press + ' in press');
    if (c.accepted) bits.push(c.accepted + ' accepted');
    if (c.review) bits.push(c.review + ' under review');
    return bits.join(', ').replace(/,([^,]*)$/, ' and$1');
  }
  function statusLabel(p) {
    return { published: 'Published', press: 'In press', accepted: 'Accepted',
      review: 'Under review' }[pubState(p)];
  }
  function statusChip(p) {
    return { published: 'chip--accent', press: 'chip--gold', accepted: 'chip--accent2',
      review: 'chip--warn' }[pubState(p)];
  }

  function bibtex(p, name) {
    var venue = String(p.venue || '').split('·')[0].trim();
    return '@inproceedings{' + (p.bibkey || 'rayhan' + (p.year || '')) + ',\n' +
      '  title     = {' + p.title + '},\n' +
      '  author    = {' + (name || 'Rayhan, Md Abu Sayeb') + ' and others},\n' +
      '  booktitle = {' + venue + '},\n' +
      '  year      = {' + (p.year || '') + '}\n}';
  }

  /* True only when the most recent role has no end date yet. The portrait tag
     reads off this, so the page can never imply a job that has ended. */
  function isOngoing(e) {
    return /present|now|current|ongoing/i.test(String((e || {}).end || ''));
  }

  function linkAttrs(href) {
    return 'href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"';
  }
  function chips(list, cls) {
    return (list || []).map(function (t) {
      return '<span class="chip ' + (cls || '') + '">' + esc(t) + '</span>';
    }).join('');
  }
  function splitSkills(items) {
    return String(items || '').split('·').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  var ARROW = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 12h13M13 6l6 6-6 6"/></svg>';

  /* -------------------------------------------------------- section head */

  var secN = 0;
  function head(id, title, sub, aside) {
    secN++;
    var n = (secN < 10 ? '0' : '') + secN;
    return '<div class="sec-head" data-reveal>' +
      '<div class="sec-head-main">' +
        '<span class="eyebrow">' + n + ' — ' + esc(title) + '</span>' +
        '<h2 class="sec-title" id="' + id + '-title">' + esc(title) + '</h2>' +
        (sub ? '<p class="sec-sub">' + sub + '</p>' : '') +
      '</div>' +
      (aside ? '<div class="sec-aside">' + esc(aside) + '</div>' : '') +
    '</div>';
  }
  function section(id, cls, inner) {
    return '<section id="' + id + '" class="section ' + (cls || '') + '" ' +
      'aria-labelledby="' + id + '-title"><div class="shell">' + inner + '</div></section>';
  }

  /* ----------------------------------------------------- project helpers */

  var CATEGORY_ORDER = ['Computer Vision', 'Generative AI', 'LLM / RAG', 'Research', 'Deployment', 'Other'];

  function projCats(p) {
    var c = Array.isArray(p.categories) ? p.categories.filter(Boolean) : [];
    return c.length ? c : ['Other'];
  }

  /* A project card doubles as a case study: every block is rendered only when
     the underlying field exists, so nothing is ever padded out with invention. */
  function projectCard(p, opts) {
    opts = opts || {};
    var cats = projCats(p);
    var title = p.link
      ? '<a ' + linkAttrs(p.link) + '>' + esc(p.title) + '</a>'
      : esc(p.title);

    /* Every block below is rendered only when its field exists, so a card is
       never padded out with a heading that has nothing behind it. On the
       research page the labels follow the academic problem-to-contribution
       arc; on the industry page they stay plain. */
    var caseBlocks = [];
    function block(label, html, cls) {
      caseBlocks.push('<div class="case-block' + (cls ? ' ' + cls : '') + '">' +
        '<h4>' + label + '</h4>' + html + '</div>');
    }
    if (opts.academic && p.problem) block('Problem', '<p>' + rich(p.problem) + '</p>', 'case-block--lead');
    if ((p.details || []).length) {
      block(opts.academic ? 'Approach' : 'How it works',
        '<ul class="bullets">' + p.details.map(function (b) {
          return '<li>' + rich(b) + '</li>';
        }).join('') + '</ul>');
    }
    if (opts.academic && p.experiment) block('Experiment', '<p>' + rich(p.experiment) + '</p>');
    if (p.challenge) block(opts.academic ? 'Hard part' : 'Hard part', '<p>' + rich(p.challenge) + '</p>');
    if (opts.researchNote && p.researchNote) {
      block(opts.academic ? 'Contribution' : 'Why it matters for my research',
        '<p>' + rich(p.researchNote) + '</p>');
    }

    return '<article class="proj' + (p.featured ? ' is-featured' : '') + '"' +
        ' data-cats="' + esc(cats.join('|')) + '" data-reveal>' +
      '<div class="proj-head">' +
        '<h3 class="proj-title">' + title + '</h3>' +
        (p.date ? '<span class="proj-when">' + esc(p.date) + '</span>' : '') +
      '</div>' +
      (p.role ? '<div class="proj-role">' + esc(p.role) + '</div>' : '') +
      '<p class="proj-desc">' + rich(p.desc) + '</p>' +
      (p.impact ? '<div class="proj-impact"><span aria-hidden="true">⚡</span>' + esc(p.impact) + '</div>' : '') +
      (caseBlocks.length
        ? '<details class="case"><summary>' + (opts.academic ? 'Case study' : 'Case study') +
            '</summary><div class="case-body' + (opts.academic ? ' case-steps' : '') + '">' +
            caseBlocks.join('') + '</div></details>'
        : '') +
      '<div class="chips">' + chips(p.tags) + '</div>' +
      '<div class="proj-foot">' +
        (p.link
          ? '<a class="btn-link" ' + linkAttrs(p.link) + '>View on GitHub ' + ARROW + '</a>'
          : '<span class="proj-private">Proprietary — code not public</span>') +
        (p.demo ? '<a class="btn-link" ' + linkAttrs(p.demo) + '>Demo ' + ARROW + '</a>' : '') +
        '<span class="chips">' + chips(cats, 'chip--accent') + '</span>' +
      '</div>' +
    '</article>';
  }

  function filterBar(list) {
    var counts = {};
    list.forEach(function (p) {
      projCats(p).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    var cats = CATEGORY_ORDER.filter(function (c) { return counts[c]; });
    Object.keys(counts).forEach(function (c) {
      if (cats.indexOf(c) === -1) cats.push(c);
    });
    if (cats.length < 2) return '';
    var btns = ['<button class="filter" type="button" data-filter="*" aria-pressed="true">' +
      'All<span class="n">' + list.length + '</span></button>'];
    cats.forEach(function (c) {
      btns.push('<button class="filter" type="button" data-filter="' + esc(c) + '" aria-pressed="false">' +
        esc(c) + '<span class="n">' + counts[c] + '</span></button>');
    });
    return '<div class="filters" role="group" aria-label="Filter projects by area">' +
      btns.join('') + '</div>';
  }

  /* ============================================================ INDUSTRY */

  function renderIndustry(d) {
    var P = d.profile || {}, E = d.education || {}, out = [];
    var parts = String(P.name || '').trim().split(' ');
    var first = parts.slice(0, -1).join(' '), last = parts[parts.length - 1] || '';

    document.title = P.name + ' | ' + P.roleIndustry + ' — ' + P.specialismIndustry;
    $('brandName').innerHTML = '<b>' + esc(first) + '</b> <i>' + esc(last) + '</i>';

    var focus = (P.focusAreas || []);
    var lead = (d.experience || [])[0] || {};

    /* ---- hero ---- */
    out.push('<header class="hero" id="home">' +
      '<canvas class="hero-viz" id="viz" aria-hidden="true"></canvas>' +
      '<div class="shell"><div class="hero-grid">' +
        '<div>' +
          (P.availabilityIndustry
            ? '<p class="hero-badge"><span class="badge-dot"></span>' + esc(P.availabilityIndustry) + '</p>' : '') +
          '<h1>' + esc(first) + '<br><span class="grad">' + esc(last) + '</span></h1>' +
          '<p class="hero-role">' + esc(P.roleIndustry) + ' · <em>' + esc(P.specialismIndustry) + '</em></p>' +
          (focus.length ? '<div class="hero-focus">' + chips(focus, 'chip--accent') + '</div>' : '') +
          '<p class="hero-desc">' + rich(P.summaryIndustry) + '</p>' +
          '<div class="hero-cta">' +
            '<a class="btn btn-primary" href="#contact">Get in touch ' + ARROW + '</a>' +
            '<a class="btn btn-ghost" href="' + esc((d.cv || {}).industry || '') + '" ' +
              'target="_blank" rel="noopener">Download CV</a>' +
            '<a class="btn btn-ghost" href="research/">Explore my research ' + ARROW + '</a>' +
          '</div>' +
          '<div class="hero-meta">' +
            '<span>📍 ' + esc(P.location) + '</span>' +
            '<span>🎓 ' + esc(E.degree) + '</span>' +
            '<span>📄 ' + (d.publications || []).length + ' conference papers · ' + esc(pubBreakdown(d)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="portrait" id="portraitWrap" hidden>' +
          '<div class="portrait-frame">' +
            '<img id="portraitImg" alt="Portrait of ' + esc(P.name) + '" width="640" height="640" ' +
              'style="object-position:' + esc(P.photoFocus || '50% 50%') +
              ';transform:scale(' + (parseFloat(P.photoZoom) || 1) + ')">' +
          '</div>' +
          '<p class="portrait-tag">' +
            (isOngoing(lead) ? esc(P.roleIndustry) : 'Most recently') + '<br><b>' +
            esc(lead.org || '') + (lead.location ? ', ' + esc(lead.location) : '') +
            '</b></p>' +
        '</div>' +
      '</div></div>' +
    '</header>');

    /* ---- impact strip (full-bleed) ---- */
    if ((d.metrics || []).length) {
      out.push('<section class="stats-band" aria-label="Impact at a glance">' +
        '<div class="shell"><div class="stats">' +
        d.metrics.map(function (m) {
          return '<div class="stat" data-reveal>' +
            '<div class="stat-n" data-count="' + esc(m.value) + '">' + esc(m.value) + '</div>' +
            '<p class="stat-l">' + esc(m.label) + '</p></div>';
        }).join('') + '</div></div></section>');
    }

    /* ---- experience ---- */
    out.push(section('experience', 'section--band',
      head('experience', 'Experience',
        'Where the systems actually shipped — production perception pipelines, ' +
        'multilingual retrieval and the teams around them.',
        (d.experience || []).length + ' roles') +
      '<div class="timeline">' + (d.experience || []).map(function (e, i) {
        return '<article class="tl-item' + (i === 0 ? ' is-lead' : '') + '" data-reveal>' +
          '<div>' +
            '<div class="tl-when">' + esc(e.start) + ' – ' + esc(e.end) + '</div>' +
            '<div class="tl-where">' + esc(e.location || '') + '</div>' +
            (i === 0 ? '<span class="tl-flag">Most recent</span>' : '') +
          '</div>' +
          '<div>' +
            '<h3 class="tl-role">' + esc(e.role) +
              (e.note ? '<small>' + esc(e.note) + '</small>' : '') + '</h3>' +
            '<p class="tl-org">' + esc(e.org) + (e.team ? ' · ' + esc(e.team) : '') + '</p>' +
            '<ul class="bullets">' + (e.bullets || []).map(function (b) {
              return '<li>' + rich(b) + '</li>';
            }).join('') + '</ul>' +
          '</div>' +
        '</article>';
      }).join('') + '</div>'));

    /* ---- projects ---- */
    var projects = (d.projects || []).filter(function (p) { return p.pages !== 'research'; });
    out.push(section('projects', '',
      head('projects', 'Projects',
        'Production systems and research prototypes, presented as case studies. ' +
        'Open the case study on any card for the technical detail; code is on ' +
        '<a ' + linkAttrs(P.github) + '>GitHub</a> wherever the work was not proprietary.',
        projects.length + ' selected') +
      filterBar(projects) +
      '<div class="projects" id="projGrid">' +
        projects.map(function (p) { return projectCard(p, {}); }).join('') +
      '</div>' +
      '<p class="sec-sub" id="projEmpty" hidden>No projects in this area yet.</p>'));

    /* ---- skills ---- */
    out.push(section('skills', 'section--band',
      head('skills', 'Skills',
        'Grouped by what they are actually used for rather than listed as a logo wall.',
        (d.skills || []).length + ' groups') +
      '<div class="grid-auto" style="--col:clamp(17rem,20vw,26rem)">' +
        (d.skills || []).map(function (s) {
          return '<div class="card skill-cat" data-reveal>' +
            '<h3>' + esc(s.label) + '</h3>' +
            '<div class="chips">' + chips(splitSkills(s.items)) + '</div>' +
          '</div>';
        }).join('') + '</div>'));

    /* ---- publications ---- */
    out.push(section('publications', '',
      head('publications', 'Research & publications',
        'Peer-reviewed conference papers: ' + esc(pubBreakdown(d)) +
        '. Full method and result detail lives on the ' +
        '<a href="research/">research portfolio</a>.',
        (d.publications || []).length + ' papers') +
      '<div class="pubs">' + sortPubs(d.publications).map(function (p) {
        var t = p.link ? '<a ' + linkAttrs(p.link) + '>' + esc(p.title) + '</a>' : esc(p.title);
        return '<article class="pub" data-state="' + pubState(p) + '" data-reveal>' +
          '<h3 class="pub-title">' + t + '</h3>' +
          (p.authors ? '<p class="pub-authors">' + rich(p.authors) +
            (p.authorRole ? '<span class="pub-role">' + esc(p.authorRole) + '</span>' : '') + '</p>'
            : (p.authorRole ? '<p class="pub-authors"><span class="pub-role" style="margin-left:0;' +
                'padding-left:0;border-left:0">' + esc(p.authorRole) + '</span></p>' : '')) +
          '<p class="pub-venue">' + esc(p.venue) + '</p>' +
          '<div class="pub-meta">' +
            '<span class="chip ' + statusChip(p) + '">' + statusLabel(p) + '</span>' +
            chips(p.tags) +
          '</div>' +
          (p.note ? '<p class="pub-note">' + rich(p.note) + '</p>' : '') +
        '</article>';
      }).join('') + '</div>' +
      '<div style="margin-top:clamp(1.75rem,3vw,2.75rem)" data-reveal>' +
        '<a class="btn btn-ghost" href="research/">Read the full research portfolio ' + ARROW + '</a>' +
      '</div>'));

    /* ---- achievements ---- */
    var awards = (d.awards || []).slice();
    var hero = null;
    awards.forEach(function (a) {
      if (!hero && /best presenter/i.test(a.title)) hero = a;
    });
    out.push(section('achievements', 'section--band',
      head('achievements', 'Achievements',
        'Recognition, leadership and certification — kept out in the open rather than ' +
        'buried inside a paragraph.',
        awards.length + ' entries') +
      '<div class="awards">' +
        (hero ? '<article class="award is-hero" data-reveal>' +
          '<div class="trophy" aria-hidden="true">🏆</div>' +
          '<div><span class="award-yr">' + esc(hero.year) + '</span>' +
            '<h3>' + esc(hero.title) + '</h3>' +
            '<p>' + esc(hero.detail) + '</p></div></article>' : '') +
        awards.filter(function (a) { return a !== hero; }).map(function (a) {
          return '<article class="award" data-reveal>' +
            '<span class="award-yr">' + esc(a.year) + '</span>' +
            '<h3>' + esc(a.title) + '</h3>' +
            '<p>' + rich(a.detail) + '</p></article>';
        }).join('') +
      '</div>' +
      ((d.talks || []).length ? '<div style="margin-top:var(--sp-gap)" data-reveal>' +
        '<div class="card"><h3 class="eyebrow" style="margin-bottom:1rem">Conference presentations</h3>' +
        '<ul class="list-plain">' + d.talks.map(function (t) {
          return '<li><b>' + esc(t.title) + '</b>' + esc(t.venue) +
            (t.type ? ' · ' + esc(t.type) : '') + '</li>';
        }).join('') + '</ul></div></div>' : '')));

    /* ---- about (education, thesis, languages, news) ---- */
    out.push(section('about', '',
      head('about', 'About',
        'Education, the thesis that started the generative-model thread, and a ' +
        'running log of what has happened recently.') +
      '<div class="split">' +
        '<div class="card edu-card" data-reveal>' +
          '<div class="edu-top"><div>' +
            '<h3 class="edu-deg">' + esc(E.degree) + '</h3>' +
            '<p class="edu-school">' + esc(E.school) + ' · ' + esc(E.start) + ' – ' + esc(E.end) + '</p>' +
          '</div><span class="edu-grade">' + esc(E.grade) + '</span></div>' +
          (E.coursework ? '<p class="edu-meta"><b>Relevant coursework</b>' + esc(E.coursework) + '</p>' : '') +
          (E.thesisTitle ? '<div class="thesis">' +
            '<div class="thesis-l">' + esc(E.thesisLabel) + '</div>' +
            '<div class="thesis-t">' + esc(E.thesisTitle) + '</div>' +
            '<p class="thesis-d">' + rich(E.thesisDesc) + '</p></div>' : '') +
        '</div>' +
        '<div class="card" data-reveal>' +
          '<h3 class="eyebrow" style="margin-bottom:1.25rem">News & updates</h3>' +
          '<ul class="news">' + (d.news || []).map(function (n) {
            return '<li><span class="news-date">' + esc(n.date) + '</span>' +
              '<span class="news-text">' + rich(n.text) + '</span></li>';
          }).join('') + '</ul>' +
        '</div>' +
      '</div>'));

    /* ---- contact ---- */
    out.push('<section id="contact" class="section contact-band" aria-labelledby="contact-title">' +
      '<div class="shell"><div class="contact-in">' +
        '<div data-reveal>' +
          '<span class="eyebrow">Contact</span>' +
          '<h2 id="contact-title" style="margin-top:.75rem">Let’s build something that has to work</h2>' +
          '<p>I’m open to AI engineering and data science roles, especially anything involving ' +
          'applied computer vision, real-time perception systems or retrieval-augmented language ' +
          'models. If that sounds like your team, I’d be glad to hear from you.</p>' +
          '<div class="contact-links">' +
            '<a class="btn btn-primary" href="mailto:' + esc(P.email) + '">✉ ' + esc(P.email) + '</a>' +
            '<a class="btn btn-ghost" ' + linkAttrs(P.linkedin) + '>LinkedIn</a>' +
            '<a class="btn btn-ghost" ' + linkAttrs(P.github) + '>GitHub</a>' +
          '</div>' +
        '</div>' +
        '<div class="contact-side" data-reveal>' +
          '<a class="contact-row" href="mailto:' + esc(P.email) + '">' +
            '<span class="k">Email</span><span class="v">' + esc(P.email) + '</span></a>' +
          '<a class="contact-row" ' + linkAttrs(P.linkedin) + '>' +
            '<span class="k">LinkedIn</span><span class="v">md-abu-sayeb-rayhan</span></a>' +
          '<a class="contact-row" ' + linkAttrs(P.github) + '>' +
            '<span class="k">GitHub</span><span class="v">@abusayeb</span></a>' +
          '<a class="contact-row" href="' + esc((d.cv || {}).industry || '') + '" target="_blank" rel="noopener">' +
            '<span class="k">CV</span><span class="v">Industry CV (PDF)</span></a>' +
          '<a class="contact-row" href="research/">' +
            '<span class="k">Research</span><span class="v">Research portfolio →</span></a>' +
        '</div>' +
      '</div></div></section>');

    mount(out, P, d);
  }

  /* ============================================================ RESEARCH */

  /* Ordered for the reader this page is written for: a supervisor or an
     admissions committee deciding, in about two minutes, whether this applicant
     can do research. Who I am, what I studied, what I have researched, what I
     have published, what I built, where I want to go, what I have been given
     credit for. */
  function renderResearch(d) {
    var P = d.profile || {}, E = d.education || {}, out = [];
    var parts = String(P.name || '').trim().split(' ');
    var first = parts.slice(0, -1).join(' '), last = parts[parts.length - 1] || '';

    document.title = P.name + ' | Research — computer vision & reliable AI';
    $('brandName').innerHTML = '<b>' + esc(first) + '</b> <i>' + esc(last) + '</i>';

    /* Academics write to the academic address; the professional one is the
       fallback so a blank field can never leave the page without a contact. */
    var mail = P.emailAcademic || P.email;

    var focus = (P.researchFocusAreas || []);
    var abroad = (d.experience || []).filter(function (e) {
      return e.kind !== 'research' && e.location && e.location !== P.location;
    })[0] || null;

    /* ---- hero ---- */
    out.push('<header class="hero" id="top">' +
      '<canvas class="hero-viz" id="viz" aria-hidden="true"></canvas>' +
      '<div class="shell"><div class="hero-grid">' +
        '<div>' +
          (P.availabilityResearch
            ? '<p class="hero-badge"><span class="badge-dot"></span>' + esc(P.availabilityResearch) + '</p>' : '') +
          '<h1>' + esc(first) + '<br><span class="grad">' + esc(last) + '</span></h1>' +
          '<p class="hero-role">' + esc(P.titleResearch || 'AI Engineer · Researcher') + '</p>' +
          '<p class="hero-lead">' + esc(P.roleResearch) + '</p>' +
          (focus.length ? '<div class="hero-focus">' + chips(focus, 'chip--accent') + '</div>' : '') +
          '<p class="hero-desc">' + rich(P.summaryResearch) + '</p>' +
          '<div class="hero-cta">' +
            '<a class="btn btn-primary" href="#publications">Publications ' + ARROW + '</a>' +
            '<a class="btn btn-ghost" href="' + BASE + esc((d.cv || {}).academic || '') + '" ' +
              'target="_blank" rel="noopener">Academic CV</a>' +
            '<a class="btn btn-ghost" href="' + BASE + '">Explore my engineering work ' + ARROW + '</a>' +
          '</div>' +
          '<div class="hero-meta">' +
            '<span>📍 ' + esc(P.location) + '</span>' +
            (abroad ? '<span>🌏 ' + esc(abroad.role) + ' in ' + esc(abroad.location) +
              ' · ' + esc(abroad.start) + ' – ' + esc(abroad.end) + '</span>' : '') +
            '<span>✉ <a href="mailto:' + esc(mail) + '">' + esc(mail) + '</a></span>' +
            (P.scholar ? '<span><a ' + linkAttrs(P.scholar) + '>Google Scholar</a></span>' : '') +
            (P.orcid ? '<span><a ' + linkAttrs(P.orcid) + '>ORCID</a></span>' : '') +
            '<span><a ' + linkAttrs(P.linkedin) + '>LinkedIn</a></span>' +
            '<span><a ' + linkAttrs(P.github) + '>GitHub</a></span>' +
          '</div>' +
        '</div>' +
        '<div class="portrait" id="portraitWrap" hidden>' +
          '<div class="portrait-frame">' +
            '<img id="portraitImg" alt="Portrait of ' + esc(P.name) + '" width="640" height="640" ' +
              'style="object-position:' + esc(P.photoFocus || '50% 50%') +
              ';transform:scale(' + (parseFloat(P.photoZoom) || 1) + ')">' +
          '</div>' +
          '<p class="portrait-tag">' +
            (E.end ? 'Graduated ' + esc(E.end) : 'Research profile') +
            '<br><b>' + esc(E.school || '') + '</b></p>' +
        '</div>' +
      '</div></div>' +
    '</header>');

    /* ---- profile at a glance (full-bleed) ---- */
    if ((d.quickFacts || []).length) {
      out.push('<section class="stats-band" aria-label="Research profile at a glance">' +
        '<div class="shell"><div class="stats">' +
        d.quickFacts.map(function (f) {
          return '<div class="stat" data-reveal>' +
            '<div class="stat-n">' + esc(f.k) + '</div>' +
            '<p class="stat-l">' + rich(f.v) + '</p></div>';
        }).join('') + '</div></div></section>');
    }

    /* ---- 1. research profile: the transition ---- */
    out.push(section('profile', 'section--band',
      head('profile', 'Research profile',
        'How the engineering and the research fit together, and where the two are heading.') +
      ((d.researchProfile || []).length
        ? '<div class="arc" style="margin-bottom:clamp(2rem,3.5vw,3.25rem)">' +
          d.researchProfile.map(function (r, i, arr) {
            var n = (i + 1 < 10 ? '0' : '') + (i + 1);
            return '<article class="arc-step' + (i === arr.length - 1 ? ' is-future' : '') + '" data-reveal>' +
              '<span class="arc-n">' + n + ' · ' + esc(r.stage) + '</span>' +
              '<h3>' + esc(r.title) + '</h3>' +
              '<p>' + rich(r.body) + '</p></article>';
          }).join('') + '</div>'
        : '') +
      ((d.researchStatement || []).length
        ? '<div class="statement" data-reveal>' +
            '<div class="statement-head">' +
              '<h3 class="eyebrow">Research statement</h3>' +
              '<span class="note">' + d.researchStatement.length + ' paragraphs</span>' +
            '</div>' +
            '<div class="statement-cols">' +
              d.researchStatement.map(function (para) {
                return '<p>' + rich(para) + '</p>';
              }).join('') +
            '</div>' +
          '</div>'
        : '')));

    /* ---- 2. academic background ---- */
    out.push(section('education', '',
      head('education', 'Academic background', '') +
      '<div class="split">' +
        '<div class="card edu-card" data-reveal>' +
          '<div class="edu-top"><div>' +
            '<h3 class="edu-deg">' + esc(E.degree) + '</h3>' +
            '<p class="edu-school">' + esc(E.school) + ' · ' + esc(E.start) + ' – ' + esc(E.end) + '</p>' +
          '</div><span class="edu-grade">' + esc(E.grade) + '</span></div>' +
          (E.coursework ? '<p class="edu-meta"><b>Relevant coursework</b>' + esc(E.coursework) + '</p>' : '') +
          (E.thesisTitle ? '<div class="thesis">' +
            '<div class="thesis-l">' + esc(E.thesisLabel) + '</div>' +
            '<div class="thesis-t">' + esc(E.thesisTitle) + '</div>' +
            '<p class="thesis-d">' + rich(E.thesisDesc) + '</p></div>' : '') +
        '</div>' +
        '<div class="card" data-reveal>' +
          '<h3 class="eyebrow" style="margin-bottom:1.25rem">Languages</h3>' +
          '<div class="chips">' + chips(splitSkills(
            ((d.skills || []).filter(function (x) { return x.label === 'Languages'; })[0] || {}).items
          )) + '</div>' +
          '<h3 class="eyebrow" style="margin:1.75rem 0 1.25rem">References</h3>' +
          '<p style="color:var(--muted);font-size:var(--t-sm);margin-bottom:1rem">' +
          'Contact details available on request.</p>' +
          '<ul class="list-plain">' + (d.references || []).map(function (r) {
            return '<li><b>' + esc(r.name) + '</b>' + esc(r.role) + ' · ' + esc(r.org) + '</li>';
          }).join('') + '</ul>' +
        '</div>' +
      '</div>'));

    /* ---- 3. research experience ---- */
    function entry(e, lead) {
      return '<article class="tl-item' + (lead ? ' is-lead' : '') + '" data-reveal>' +
        '<div>' +
          '<div class="tl-when">' + esc(e.start) + ' – ' + esc(e.end) + '</div>' +
          '<div class="tl-where">' + esc(e.location || '') + '</div>' +
        '</div>' +
        '<div>' +
          '<h3 class="tl-role">' + esc(e.role) +
            (e.note ? '<small>' + esc(e.note) + '</small>' : '') + '</h3>' +
          '<p class="tl-org">' + esc(e.org) + (e.team ? ' · ' + esc(e.team) : '') + '</p>' +
          '<ul class="bullets">' + (e.bullets || []).map(function (b) {
            return '<li>' + rich(b) + '</li>';
          }).join('') + '</ul>' +
        '</div></article>';
    }
    var researchExp = (d.experience || []).filter(function (e) { return e.kind === 'research'; });
    var appliedExp = (d.experience || []).filter(function (e) { return e.kind !== 'research'; });
    if (researchExp.length) {
      out.push(section('experience', 'section--band',
        head('experience', 'Academic research experience',
          'Supervised research at university: dataset design, experimental protocol and ' +
          'quantitative analysis, with results carried through to peer review. My industry ' +
          'roles are further down, under Industry experience.',
          researchExp.length + (researchExp.length === 1 ? ' role' : ' roles')) +
        '<div class="timeline">' + researchExp.map(function (e) { return entry(e, true); }).join('') + '</div>'));
    }

    /* ---- 4. publications ---- */
    out.push(section('publications', '',
      head('publications', 'Publications',
        'Peer-reviewed conference papers: ' + esc(pubBreakdown(d)) +
        '. Status is stated per paper and never rounded up. ' +
        'Use <em>BibTeX</em> to copy a citation.',
        (d.publications || []).length + ' papers') +
      '<div class="pubs">' + sortPubs(d.publications).map(function (p, i) {
        var t = p.link ? '<a ' + linkAttrs(p.link) + '>' + esc(p.title) + '</a>' : esc(p.title);
        return '<article class="pub" data-state="' + pubState(p) + '" data-reveal>' +
          '<h3 class="pub-title">' + t + '</h3>' +
          ((p.authors || p.authorRole)
            ? '<p class="pub-authors">' + (p.authors ? rich(p.authors) : '') +
              (p.authorRole ? '<span class="pub-role"' + (p.authors ? '' :
                ' style="margin-left:0;padding-left:0;border-left:0"') + '>' +
                esc(p.authorRole) + '</span>' : '') + '</p>'
            : '') +
          '<p class="pub-venue">' + esc(p.venue) + (p.year ? ' · ' + esc(p.year) : '') + '</p>' +
          '<div class="pub-meta">' +
            '<span class="chip ' + statusChip(p) + '">' + statusLabel(p) + '</span>' +
            chips(p.tags) +
            '<button class="bib-btn" type="button" data-bib="bib' + i + '" aria-expanded="false">BibTeX</button>' +
          '</div>' +
          (p.note ? '<p class="pub-note">' + rich(p.note) + '</p>' : '') +
          (p.contribution ? '<p class="pub-contrib"><b>My contribution:</b> ' + rich(p.contribution) + '</p>' : '') +
          ((p.link || p.code) ? '<div class="proj-foot">' +
            (p.link ? '<a class="btn-link" ' + linkAttrs(p.link) + '>Read the paper ' + ARROW + '</a>' : '') +
            (p.code ? '<a class="btn-link" ' + linkAttrs(p.code) + '>Code ' + ARROW + '</a>' : '') +
          '</div>' : '') +
          '<pre class="bib" id="bib' + i + '">' + esc(bibtex(p, P.name)) + '</pre>' +
        '</article>';
      }).join('') + '</div>'));

    /* ---- 5. industry experience ---- */
    var engMetrics = (d.metrics || []).filter(function (m) {
      return !/papers?|publication/i.test(m.label);
    });
    var engSkills = (d.skills || []).filter(function (sk) { return sk.research === false; });
    out.push(section('engineering', 'section--band',
      head('engineering', 'Industry experience',
        'My professional roles outside the university: two years building and shipping ' +
        'production AI systems, the measured results they produced, and the stack behind ' +
        'them. Research ideas are only worth as much as the systems you can get them into.',
        appliedExp.length + (appliedExp.length === 1 ? ' role' : ' roles')) +
      /* Publication counts belong to the academic sections, not to a strip
         introduced as production results. */
      (engMetrics.length
        ? '<div class="stats" style="margin-bottom:var(--sp-gap)">' +
          engMetrics.map(function (m) {
            return '<div class="stat" data-reveal>' +
              '<div class="stat-n" data-count="' + esc(m.value) + '">' + esc(m.value) + '</div>' +
              '<p class="stat-l">' + esc(m.label) + '</p></div>';
          }).join('') + '</div>'
        : '') +
      (appliedExp.length
        ? '<div class="timeline">' + appliedExp.map(function (e, i) {
            return entry(e, i === 0);
          }).join('') + '</div>'
        : '') +
      /* The deployment and storage stack is deliberately kept out of "Methods
         & tools"; it belongs here, as evidence that the research can be built. */
      (engSkills.length
        ? '<h3 class="eyebrow" style="margin:clamp(2rem,3.5vw,3rem) 0 1.25rem">Deployment stack</h3>' +
          '<div class="grid-auto" style="--col:clamp(17rem,20vw,26rem)">' +
          engSkills.map(function (sk) {
            return '<div class="card skill-cat" data-reveal>' +
              '<h3>' + esc(sk.label) + '</h3>' +
              '<div class="chips">' + chips(splitSkills(sk.items)) + '</div></div>';
          }).join('') + '</div>'
        : '')));

    /* ---- 6. research projects ---- */
    var rel = (d.projects || []).filter(function (p) {
      return p.pages === 'research' || p.pages === 'both';
    });
    out.push(section('projects', 'section--band',
      head('projects', 'Research projects',
        'Selected for what they evidence rather than for scale. Open a case study for ' +
        'the approach, the result and what it contributes. Code is public wherever the ' +
        'work was not proprietary.',
        rel.length + ' projects') +
      filterBar(rel) +
      '<div class="projects" id="projGrid">' +
        rel.map(function (p) { return projectCard(p, { researchNote: true, academic: true }); }).join('') +
      '</div>' +
      '<p class="sec-sub" id="projEmpty" hidden>No projects in this area yet.</p>'));

    /* ---- 7. research interests + methods ---- */
    var rskills = (d.skills || []).filter(function (s) { return s.research !== false; });
    out.push(section('interests', '',
      head('interests', 'Research interests',
        P.researchInterestsLine ? esc(P.researchInterestsLine) : '',
        (d.researchAreas || []).length + ' clusters') +
      '<div class="areas">' + (d.researchAreas || []).map(function (a, i) {
        var n = (i + 1 < 10 ? '0' : '') + (i + 1);
        return '<article class="area' + (a.next ? ' is-next' : '') + '" data-reveal>' +
          '<span class="area-n">' + n + (a.next ? ' · DIRECTION' : '') + '</span>' +
          '<h3>' + esc(a.title) + '</h3><p>' + rich(a.desc) + '</p></article>';
      }).join('') + '</div>' +
      (rskills.length
        ? '<h3 class="eyebrow" style="margin:clamp(2.25rem,4vw,3.5rem) 0 1.25rem">Methods &amp; tools</h3>' +
          '<div class="grid-auto" style="--col:clamp(17rem,20vw,26rem)">' +
          rskills.map(function (s) {
            return '<div class="card skill-cat" data-reveal>' +
              '<h3>' + esc(s.label) + '</h3>' +
              '<div class="chips">' + chips(splitSkills(s.items)) + '</div></div>';
          }).join('') + '</div>'
        : '')));

    /* ---- 8. research direction ---- */
    if ((d.futureDirections || []).length) {
      out.push(section('direction', '',
        head('direction', 'Research direction',
          'What I want to investigate during a Master’s — one question per research ' +
          'interest above. Each extends something I have already built rather than ' +
          'starting from scratch.',
          d.futureDirections.length + ' questions') +
        '<div class="qa">' + d.futureDirections.map(function (f) {
          return '<article class="qa-item" data-reveal>' +
            (f.area ? '<span class="qa-area">' + esc(f.area) + '</span>' : '') +
            '<h3 class="qa-q">' + rich(f.q) + '</h3>' +
            '<p class="qa-a">' + rich(f.a) + '</p></article>';
        }).join('') + '</div>'));
    }

    /* ---- 9. academic achievements ---- */
    var awards = (d.awards || []).filter(function (a) { return a.pages !== 'industry'; });
    var venues = [];
    (d.publications || []).forEach(function (p) {
      (p.tags || []).forEach(function (t) { if (venues.indexOf(t) === -1) venues.push(t); });
    });
    out.push(section('achievements', 'section--band',
      head('achievements', 'Academic achievements', '') +
      '<div class="grid-auto" style="--col:clamp(18rem,22vw,28rem)">' +
        '<div class="ach" data-reveal>' +
          '<h3>Peer-reviewed output</h3>' +
          '<div class="ach-n">' + (d.publications || []).length + '</div>' +
          '<p style="color:var(--muted);font-size:var(--t-sm);line-height:1.6">' +
            'Conference papers — ' + esc(pubBreakdown(d)) + '.</p>' +
          (venues.length ? '<div class="chips">' + chips(venues) + '</div>' : '') +
        '</div>' +
        ((d.talks || []).length ? '<div class="ach" data-reveal>' +
          '<h3>Conference presentations</h3>' +
          '<ul class="list-plain">' + d.talks.map(function (t) {
            return '<li><b>' + esc(t.title) + '</b>' + esc(t.venue) + ' · ' + esc(t.year) +
              (t.type ? ' · ' + esc(t.type) : '') + '</li>';
          }).join('') + '</ul></div>' : '') +
        (awards.length ? '<div class="ach" data-reveal>' +
          '<h3>Awards &amp; activities</h3>' +
          '<ul class="list-plain">' + awards.map(function (a) {
            var key = /best presenter/i.test(a.title);
            return '<li' + (key ? ' class="is-key"' : '') + '><b>' + esc(a.title) +
              ' (' + esc(a.year) + ')</b>' + rich(a.detail) + '</li>';
          }).join('') + '</ul></div>' : '') +
      '</div>'));

    /* ---- 10. news ---- */
    if ((d.news || []).length) {
      out.push(section('news', '',
        head('news', 'News', '') +
        '<div class="card" data-reveal><ul class="news">' + d.news.map(function (n) {
          return '<li><span class="news-date">' + esc(n.date) + '</span>' +
            '<span class="news-text">' + rich(n.text) + '</span></li>';
        }).join('') + '</ul></div>'));
    }

    /* ---- contact ---- */
    out.push('<section id="contact" class="section contact-band" aria-labelledby="contact-title">' +
      '<div class="shell"><div class="contact-in">' +
        '<div data-reveal>' +
          '<span class="eyebrow">Contact</span>' +
          '<h2 id="contact-title" style="margin-top:.75rem">Get in touch</h2>' +
          '<p>' + esc(P.availabilityResearch || '') + '. I would be glad to discuss potential ' +
          'supervision, collaboration, or any of the open questions above — and I am happy to ' +
          'send transcripts, full texts or code on request.</p>' +
          '<div class="contact-links">' +
            '<a class="btn btn-primary" href="mailto:' + esc(mail) + '">✉ ' + esc(mail) + '</a>' +
            '<a class="btn btn-ghost" href="' + BASE + esc((d.cv || {}).academic || '') + '" ' +
              'target="_blank" rel="noopener">Academic CV (PDF)</a>' +
            '<a class="btn btn-ghost" href="' + BASE + '">Engineering portfolio ' + ARROW + '</a>' +
          '</div>' +
        '</div>' +
        '<div class="contact-side" data-reveal>' +
          '<a class="contact-row" href="mailto:' + esc(mail) + '">' +
            '<span class="k">Email</span><span class="v">' + esc(mail) + '</span></a>' +
          (P.scholar ? '<a class="contact-row" ' + linkAttrs(P.scholar) + '>' +
            '<span class="k">Scholar</span><span class="v">Google Scholar</span></a>' : '') +
          (P.orcid ? '<a class="contact-row" ' + linkAttrs(P.orcid) + '>' +
            '<span class="k">ORCID</span><span class="v">ORCID record</span></a>' : '') +
          '<a class="contact-row" ' + linkAttrs(P.linkedin) + '>' +
            '<span class="k">LinkedIn</span><span class="v">md-abu-sayeb-rayhan</span></a>' +
          '<a class="contact-row" ' + linkAttrs(P.github) + '>' +
            '<span class="k">GitHub</span><span class="v">@abusayeb</span></a>' +
          '<a class="contact-row" href="' + BASE + '">' +
            '<span class="k">Industry</span><span class="v">Engineering portfolio →</span></a>' +
        '</div>' +
      '</div></div></section>');

    mount(out, P, d);
  }

  /* -------------------------------------------------------------- mount */

  function mount(out, P, d) {
    var app = $('app');
    app.innerHTML = out.join('');
    app.hidden = false;
    $('loading').hidden = true;

    $('footName').textContent = P.name || '';
    $('footLoc').textContent = P.location || '';
    $('yr').textContent = new Date().getFullYear();
    $('foot').hidden = false;

    loadPortrait(P.photo);
    wireUp();
    heroViz();
  }

  /* Try the configured filename, then common variants, so a photo uploaded
     under a slightly different name still shows instead of silently failing. */
  function loadPortrait(configured) {
    var img = $('portraitImg'), wrap = $('portraitWrap');
    if (!img || !wrap) return;
    var names = [];
    if (configured) names.push(configured);
    ['photo.jpg', 'photo.jpeg', 'photo.png', 'photo.webp',
     'photos.jpg', 'photos.jpeg', 'photos.png',
     'profile.jpg', 'profile.jpeg', 'profile.png', 'me.jpg', 'me.jpeg']
      .forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
    var i = 0;
    function tryNext() {
      if (i >= names.length) { wrap.hidden = true; return; }
      img.src = BASE + names[i++];
    }
    img.addEventListener('load', function () { if (img.naturalWidth > 1) wrap.hidden = false; });
    img.addEventListener('error', tryNext);
    tryNext();
  }

  /* --------------------------------------------------------- interactions */

  function wireUp() {
    var nav = $('nav'), btn = $('menuBtn'), links = $('navLinks');

    /* nav background on scroll */
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        nav.classList.toggle('is-scrolled', window.scrollY > 24);
        updateSpy();
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* mobile menu */
    function setMenu(open) {
      links.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      BODY.style.overflow = open ? 'hidden' : '';
    }
    btn.addEventListener('click', function () {
      setMenu(btn.getAttribute('aria-expanded') !== 'true');
    });
    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        setMenu(false); btn.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1150) setMenu(false);   // must match the CSS drawer breakpoint
    });

    /* scroll-spy: pick whichever tracked section owns the 40% line, so fast
       scrolling and hash jumps can never leave two links looking active */
    var spy = [];
    links.querySelectorAll('a[href^="#"]').forEach(function (a) {
      var sec = document.getElementById(a.getAttribute('href').slice(1));
      if (sec) spy.push({ a: a, sec: sec });
    });
    function updateSpy() {
      if (!spy.length) return;
      var line = window.innerHeight * 0.4, best = null;
      spy.forEach(function (it) {
        var r = it.sec.getBoundingClientRect();
        if (r.top <= line && r.bottom > line) best = it;
      });
      spy.forEach(function (it) {
        if (it === best) it.a.setAttribute('aria-current', 'true');
        else it.a.removeAttribute('aria-current');
      });
    }

    /* section reveal */
    var reveals = document.querySelectorAll('[data-reveal]');
    if (REDUCED || !('IntersectionObserver' in window)) {
      reveals.forEach(function (n) { n.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en, i) {
          if (!en.isIntersecting) return;
          en.target.style.setProperty('--d', Math.min(i, 6) * 60 + 'ms');
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: .06 });
      reveals.forEach(function (n) { io.observe(n); });
    }

    /* counters on the impact strip */
    document.querySelectorAll('[data-count]').forEach(function (n) {
      var raw = n.getAttribute('data-count');
      var m = raw.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/);
      if (!m || REDUCED) return;
      var pre = m[1], target = parseFloat(m[2]), post = m[3];
      var dec = (m[2].split('.')[1] || '').length;
      var seen = false;
      var co = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting || seen) return;
        seen = true; co.disconnect();
        var t0 = null, dur = 1100;
        function step(t) {
          if (t0 === null) t0 = t;
          var k = Math.min((t - t0) / dur, 1);
          var eased = 1 - Math.pow(1 - k, 3);
          n.textContent = pre + (target * eased).toFixed(dec) + post;
          if (k < 1) requestAnimationFrame(step);
          else n.textContent = raw;
        }
        requestAnimationFrame(step);
      }, { threshold: .4 });
      co.observe(n);
    });

    /* project filtering — no reload, and the count stays honest */
    var grid = $('projGrid');
    if (grid) {
      var empty = $('projEmpty');
      document.querySelectorAll('.filter').forEach(function (b) {
        b.addEventListener('click', function () {
          var want = b.dataset.filter;
          document.querySelectorAll('.filter').forEach(function (o) {
            o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
          });
          var shown = 0;
          grid.querySelectorAll('.proj').forEach(function (card) {
            var cats = (card.dataset.cats || '').split('|');
            var on = want === '*' || cats.indexOf(want) > -1;
            card.classList.toggle('is-hidden', !on);
            if (on) {
              shown++;
              card.classList.remove('is-in');
              requestAnimationFrame(function () { card.classList.add('is-in'); });
            }
          });
          if (empty) empty.hidden = shown > 0;
        });
      });
    }

    /* BibTeX toggle + copy */
    document.querySelectorAll('.bib-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var pre = document.getElementById(b.dataset.bib);
        if (!pre) return;
        var open = pre.classList.toggle('is-open');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && navigator.clipboard) {
          navigator.clipboard.writeText(pre.textContent).then(function () {
            var was = b.textContent;
            b.textContent = 'Copied ✓';
            setTimeout(function () { b.textContent = was; }, 1600);
          }, function () { /* clipboard blocked: the citation is visible anyway */ });
        }
      });
    });
  }

  /* ------------------------------------------------------------ hero viz */

  /* A light node-and-edge field standing in for perception / data flow.
     Capped node count, capped DPR, paused when off-screen, and a single
     static frame when the visitor prefers reduced motion. */
  function heroViz() {
    var cv = $('viz');
    if (!cv) return;
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;

    var css = getComputedStyle(document.documentElement);
    var dot = (css.getPropertyValue('--viz-dot') || '#18C6A3').trim();
    var line = (css.getPropertyValue('--viz-line') || 'rgba(24,198,163,.35)').trim();

    var nodes = [], w = 0, h = 0, dpr = 1, raf = null, running = false;

    function resize() {
      var r = cv.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var target = Math.round(Math.min(70, Math.max(18, (w * h) / 26000)));
      nodes = [];
      for (var i = 0; i < target; i++) {
        nodes.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - .5) * .16, vy: (Math.random() - .5) * .16,
          r: Math.random() * 1.6 + .8
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      var maxD = Math.min(190, Math.max(110, w * 0.085));
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j], dx = a.x - b.x, dy = a.y - b.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > maxD) continue;
          ctx.globalAlpha = (1 - d / maxD) * .5;
          ctx.strokeStyle = line; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      ctx.globalAlpha = .85; ctx.fillStyle = dot;
      nodes.forEach(function (n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function tick() {
      nodes.forEach(function (n) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
      });
      draw();
      raf = requestAnimationFrame(tick);
    }

    function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

    resize();
    if (REDUCED) { draw(); return; }              // static fallback

    var vis = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting && !document.hidden) start(); else stop();
    }, { threshold: 0 });
    vis.observe(cv);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (cv.getBoundingClientRect().bottom > 0) start();
    });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { resize(); if (!running) draw(); }, 180);
    });
  }

  /* ---------------------------------------------------------------- boot */

  function fail(err) {
    $('loading').hidden = true;
    var box = $('loadError');
    box.hidden = false;
    if (window.console) console.error('data.json failed to load:', err);
  }

  function boot(attempt) {
    fetch(BASE + 'data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        try {
          if (PAGE === 'research') renderResearch(d); else renderIndustry(d);
        } catch (e) { fail(e); }
      })
      .catch(function (e) {
        if (attempt < 1) { setTimeout(function () { boot(attempt + 1); }, 600); return; }
        fail(e);
      });
  }

  /* Keep the sticky nav height in sync with what it actually measures, so
     scroll-margin and the mobile drawer never drift out of step. */
  function syncNavHeight() {
    var nav = $('nav');
    if (!nav) return;
    document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
  }
  window.addEventListener('resize', syncNavHeight);
  window.addEventListener('load', syncNavHeight);
  syncNavHeight();

  boot(0);
})();
