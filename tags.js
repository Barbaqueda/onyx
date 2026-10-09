/*
 * Onyx tags: naming, the offline auto-tagger, the AI tagging prompt, the search
 * query language and the tag database helpers.
 * Pure functions only (no fs / electron) so it runs in Node tests, the main
 * process and the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.OnyxTags = factory(root.OnyxEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const DAY = 86400000;

  // ---------------------------------------------------------------- naming
  // Tags are lowercase, use hyphens for spaces and "/" for nesting: "school/math".
  function normTag(s) {
    let t = String(s == null ? '' : s).trim().replace(/^#+/, '').toLowerCase();
    t = t.replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}\-/&+.]/gu, '').replace(/-{2,}/g, '-').replace(/\/{2,}/g, '/');
    t = t.split('/').map(seg => seg.replace(/^[-.]+|[-.]+$/g, '')).filter(Boolean).slice(0, 3).join('/');
    if (t.length > 40) t = t.slice(0, 40).replace(/[-/]+$/, '');
    return t;
  }
  function tagLabel(t) { return String(t || ''); }
  // "school/math" -> "School/Math" (for the "By tag" organize strategy)
  function tagFolder(t) {
    return normTag(t).split('/').map(seg => E.titleCase(seg.replace(/-/g, ' '))).join('/');
  }
  function hashColor(name, palette) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }

  // ---------------------------------------------------------------- offline auto-tagger
  const IRREGULAR = { taxes: 'tax', research: 'research', insurance: 'insurance', travel: 'travel', identity: 'identity', career: 'career', journal: 'journal', medical: 'medical', fitness: 'fitness', health: 'health' };
  function singular(w) {
    const l = w.toLowerCase();
    if (IRREGULAR[l]) return IRREGULAR[l];
    if (/ies$/.test(l)) return l.slice(0, -3) + 'y';
    if (/(x|ch|sh)es$/.test(l)) return l.slice(0, -2);
    if (/[^su]s$/.test(l)) return l.slice(0, -1);
    return l;
  }
  // "Finance/Bank Statements" -> ["finance", "bank-statement"]
  function folderToTags(folder) {
    const segs = folder.split('/');
    const out = [];
    segs.forEach(seg => {
      if (/^(documents|images|videos)$/i.test(seg)) return;             // type buckets aren't topics
      const words = seg.split(' ');
      words[words.length - 1] = singular(words[words.length - 1]);
      const t = normTag(words.join(' '));
      if (t) out.push(t);
    });
    return out;
  }
  const MEDIA_TAGS = {
    'Images/Screenshots': ['screenshot'], 'Images/WhatsApp': ['whatsapp'], 'Images/Wallpapers': ['wallpaper'],
    'Images/Camera': ['camera'], 'Videos/Screen Recordings': ['screen-recording'], 'Videos/WhatsApp': ['whatsapp'], 'Videos/Camera': ['camera'],
  };
  const STATUS_WORDS = [
    ['draft', ['draft', 'drafts', 'wip']], ['final', ['final']], ['backup', ['backup', 'bak']], ['template', ['template', 'templates']],
    ['signed', ['signed']], ['scan', ['scan', 'scanned']], ['copy', []],
  ];
  const BUNDLE_TAGS = [
    [/web project/, 'website'], [/code project|project folder/, 'code-project'], [/app or game/, 'app'],
    [/3D model/, '3d-asset'], [/music project/, 'music-project'],
  ];
  function yearsIn(name) {
    const now = new Date().getFullYear();
    const out = new Set();
    const re = /(^|[^0-9])((19[89]\d|20\d\d))(?=[^0-9]|$|(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01]))/g;
    let m;
    while ((m = re.exec(name))) { const y = +m[2]; if (y >= 1980 && y <= now + 1) out.add(String(y)); }
    return [...out];
  }

  /**
   * Suggest tags from names, types and folders. Never guesses wildly: a file
   * only gets a tag when its name, its series or its folder says so.
   * files: [{path, name, extension, size, lastModified}], dirs: [{path}]
   * returns Map(path -> [tags])
   */
  function autoTags(files, dirs, opts) {
    opts = opts || {};
    const out = new Map();
    const add = (p, t) => { t = normTag(t); if (!t) return; if (!out.has(p)) out.set(p, []); const a = out.get(p); if (!a.includes(t)) a.push(t); };
    // series: excavatorio1.obj, excavatorio2.obj -> "excavatorio"
    const series = E.detectSeries(files.filter(f => !E.untouchableReason(f)), 2);
    for (const g of series.values()) {
      const t = normTag(singularLabel(g.label));
      if (t && t.length >= 3) for (const f of g.files) add(f.path, t);
    }
    // bundles: files inside a web project, a 3D asset folder…
    let kinds = null;
    try { kinds = E.classifyDirs(files, dirs || [], E.DEFAULTS); } catch (e) { kinds = null; }
    for (const f of files) {
      const group = E.typeGroup(f.extension);
      const texts = E.nameTexts(f.name);
      // what it's for: invoice, tax, school…
      if (E.MEDIA_GROUPS.has(group)) {
        for (const r of E.MEDIA_RULES) {
          if (r.exts !== group) continue;
          if ((r.re && r.re.test(f.name)) || r.kw.some(k => E.hasKeyword(texts, k))) { for (const t of MEDIA_TAGS[r.folder] || []) add(f.path, t); break; }
        }
      }
      if (E.CONTENT_GROUPS.has(group) || group === 'Images' && /scan/.test(texts[1])) {
        for (const r of E.KEYWORD_RULES) if (r.kw.some(k => E.hasKeyword(texts, k))) for (const t of folderToTags(r.folder)) add(f.path, t);
        for (const y of yearsIn(f.name)) add(f.path, y);
      }
      for (const [tag, words] of STATUS_WORDS) if (words.some(w => E.hasKeyword(texts, w))) add(f.path, tag);
      // unfinished downloads and temp files
      if (/\.(crdownload|part|partial|download|opdownload)$/i.test(f.name)) add(f.path, 'incomplete');
      if (/^~\$|\.tmp$/i.test(f.name)) add(f.path, 'temp');
      if (kinds) {
        let d = E.dirname(f.path);
        while (d) {
          const k = kinds.get(d.toLowerCase());
          if (k && k.kind === 'bundle' && k.root.toLowerCase() === d.toLowerCase()) {
            for (const [re, t] of BUNDLE_TAGS) if (re.test(k.why)) { add(f.path, t); break; }
            break;
          }
          d = E.dirname(d);
        }
      }
    }
    if (opts.only) for (const p of [...out.keys()]) if (!opts.only.has(p)) out.delete(p);
    return out;
  }
  function singularLabel(label) {
    const w = String(label).split(' ');
    w[w.length - 1] = singular(w[w.length - 1]);
    return w.join(' ');
  }

  // ---------------------------------------------------------------- AI tagging
  const AI_TAG_SYSTEM = [
    'You tag files for a personal file manager so they are easy to find later.',
    'For each numbered file, choose 1 to 4 short tags describing what the file is FOR or ABOUT: its topic, project, purpose, place, event, person or status.',
    'Rules:',
    '1. Never tag the file type or format (no "pdf", "image", "document", "video", "file"). Onyx shows types separately.',
    '2. Reuse tags from EXISTING TAGS whenever they fit, so the same idea always gets the same tag.',
    '3. Tags are lowercase singular nouns; use hyphens instead of spaces: "tax-return", "iceland-trip", "invoice".',
    '4. Files that clearly belong together (a series, the same project) share a tag.',
    '5. If the name tells you nothing, give an empty list. Do not invent details.',
    'Reply with strict JSON only, no prose: {"tags": {"1": ["tag", "tag"], "2": []}}',
  ].join('\n');

  function aiTagBatches(files, vocab, opts) {
    opts = opts || {};
    const size = opts.batchSize || 150;
    const extra = String(opts.instructions || '').trim().slice(0, 1500);
    const system = extra ? AI_TAG_SYSTEM + '\n\nThe user\'s own preferences (follow them when they apply):\n' + extra : AI_TAG_SYSTEM;
    const batches = [];
    for (let i = 0; i < files.length; i += size) batches.push(files.slice(i, i + size));
    return batches.map(batch => ({
      ids: batch.map(f => f.path),
      system,
      user: (used) => {
        const v = [...new Set([...(vocab || []), ...(used || [])])].slice(0, 120);
        return ['EXISTING TAGS:', v.length ? v.join(', ') : '(none yet)',
          '\nFILES (' + batch.length + '):',
          batch.map((f, i) => (i + 1) + '. ' + f.path + '  (' + E.fmtSize(f.size) + ', ' + new Date(f.lastModified).toISOString().slice(0, 10) + ')').join('\n')].join('\n');
      },
    }));
  }
  const BANNED = new Set(['pdf', 'file', 'files', 'image', 'images', 'document', 'documents', 'doc', 'docx', 'video', 'videos', 'audio', 'jpg', 'jpeg', 'png', 'txt', 'misc', 'other', 'unknown', 'none', 'untitled']);
  function parseAiTags(text, ids) {
    let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    let obj = null;
    try { obj = JSON.parse(s); } catch (e) {
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a >= 0 && b > a) { try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e2) { obj = null; } }
    }
    if (!obj || typeof obj !== 'object') throw new Error('AI reply was not valid JSON');
    const map = obj.tags && typeof obj.tags === 'object' ? obj.tags : obj;
    const out = {};
    const arr = Array.isArray(map);
    for (const [k, v] of Object.entries(map)) {
      const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
      const n = parseInt(k, 10);
      const id = arr ? (ids[n] != null ? ids[n] : null) : n >= 1 && n <= ids.length && String(n) === String(k).trim() ? ids[n - 1] : ids.includes(k) ? k : null;
      if (!id) continue;
      const tags = [...new Set(list.map(normTag).filter(t => t && t.length >= 2 && !BANNED.has(t) && !/^\d{1,3}$/.test(t)))].slice(0, 4);
      put(out, id, tags);
    }
    return out;
  }

  // ---------------------------------------------------------------- search queries
  // Plain words, "#tag" / "tag:x", "-#tag", "type:pdf", "kind:image", "size:>10mb",
  // "modified:<7d" / "modified:2024", "in:Folder", "is:untagged|tagged|duplicate|recent|large"
  const KIND_ALIASES = {
    image: 'Images', images: 'Images', photo: 'Images', photos: 'Images', picture: 'Images', pictures: 'Images',
    video: 'Videos', videos: 'Videos', movie: 'Videos', movies: 'Videos',
    audio: 'Audio', music: 'Audio', sound: 'Audio', song: 'Audio', songs: 'Audio',
    document: 'Documents', documents: 'Documents', doc: 'Documents', docs: 'Documents',
    code: 'Code', archive: 'Archives', archives: 'Archives', zip: 'Archives',
    '3d': '3D Models', model: '3D Models', models: '3D Models', installer: 'Installers', installers: 'Installers', app: 'Installers',
    font: 'Fonts', fonts: 'Fonts', ebook: 'eBooks', ebooks: 'eBooks', book: 'eBooks', design: 'Design', other: 'Other',
  };
  const KIND_SUB = { spreadsheet: 'Documents/Spreadsheets', spreadsheets: 'Documents/Spreadsheets', presentation: 'Documents/Presentations', presentations: 'Documents/Presentations', note: 'Documents/Notes', notes: 'Documents/Notes' };
  const KINDS = [
    ['Images', 'image', 'Images'], ['Documents', 'document', 'Documents'], ['Videos', 'video', 'Videos'], ['Audio', 'audio', 'Audio'],
    ['Code', 'code', 'Code'], ['Archives', 'archive', 'Archives'], ['3D Models', '3d', '3D models'], ['Installers', 'installer', 'Installers'],
    ['Design', 'design', 'Design'], ['eBooks', 'ebook', 'eBooks'], ['Fonts', 'font', 'Fonts'], ['Other', 'other', 'Other'],
  ];
  function tokenize(q) {
    const out = [];
    const re = /(-?)([a-z]+:)?"([^"]*)"|(\S+)/gi;
    let m;
    while ((m = re.exec(q))) out.push(m[4] != null ? m[4] : (m[1] || '') + (m[2] || '') + m[3]);
    return out;
  }
  const UNITS = { b: 1, kb: 1024, k: 1024, mb: 1048576, m: 1048576, gb: 1073741824, g: 1073741824, tb: 1099511627776 };
  function parseSize(s) { const m = String(s).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g|tb)?$/); return m ? parseFloat(m[1]) * (UNITS[m[2] || 'mb']) : null; }
  function parseAge(s) {
    const m = String(s).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(h|d|w|m|mo|y)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return n * ({ h: DAY / 24, d: DAY, w: 7 * DAY, m: 30 * DAY, mo: 30 * DAY, y: 365 * DAY }[m[2] || 'd']);
  }
  function parseQuery(q) {
    const r = { text: [], tags: [], notTags: [], exts: [], kinds: [], size: [], mod: [], inDirs: [], is: [], notText: [] };
    for (const tok of tokenize(String(q || ''))) {
      const neg = tok.startsWith('-') && tok.length > 1;
      const t = neg ? tok.slice(1) : tok;
      const low = t.toLowerCase();
      let m;
      if (t.startsWith('#') && t.length > 1) { (neg ? r.notTags : r.tags).push(normTag(t)); continue; }
      if ((m = low.match(/^tags?:(.+)$/))) { (neg ? r.notTags : r.tags).push(normTag(m[1])); continue; }
      if ((m = low.match(/^(type|ext):(.+)$/))) { r.exts.push(...m[2].split(',').map(x => x.replace(/^\./, '')).filter(Boolean)); continue; }
      if ((m = low.match(/^kind:(.+)$/))) { for (const k of m[1].split(',')) { const g = KIND_SUB[k] || KIND_ALIASES[k]; if (g) r.kinds.push(g); } continue; }
      if ((m = low.match(/^size:(>=|<=|>|<)?(.+)$/))) {
        const range = m[2].split('..');
        if (range.length === 2) { const a = parseSize(range[0]), b = parseSize(range[1]); if (a != null) r.size.push(['>=', a]); if (b != null) r.size.push(['<=', b]); }
        else { const v = parseSize(m[2]); if (v != null) r.size.push([m[1] || '>=', v]); }
        continue;
      }
      if ((m = low.match(/^(modified|mod|date):(.+)$/))) {
        const v = m[2];
        if (/^(19|20)\d\d$/.test(v)) r.mod.push(['year', +v]);
        else if (v === 'today') r.mod.push(['<', DAY]);
        else if (v === 'yesterday') r.mod.push(['<', 2 * DAY]);
        else if (v === 'week' || v === 'thisweek') r.mod.push(['<', 7 * DAY]);
        else if (v === 'month' || v === 'thismonth') r.mod.push(['<', 30 * DAY]);
        else if (v === 'year' || v === 'thisyear') r.mod.push(['<', 365 * DAY]);
        else { const mm = v.match(/^(<|>)?(.+)$/); const age = parseAge(mm[2]); if (age != null) r.mod.push([mm[1] || '<', age]); }
        continue;
      }
      if ((m = t.match(/^in:(.+)$/i))) { r.inDirs.push(m[1].replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()); continue; }
      if ((m = low.match(/^is:(.+)$/))) { r.is.push((neg ? '!' : '') + m[1]); continue; }
      if (neg) r.notText.push(low); else r.text.push(low);
    }
    return r;
  }
  function isEmptyQuery(r) { return !Object.values(r).some(a => a.length); }
  function tagMatches(have, want) { return have.some(t => t === want || t.startsWith(want + '/')); }

  /**
   * f: file, tags: its tag list, ctx: { now, dups: Set(paths) }
   */
  function matchFile(f, tags, r, ctx) {
    const now = (ctx && ctx.now) || Date.now();
    tags = tags || [];
    for (const w of r.tags) if (!tagMatches(tags, w)) return false;
    for (const w of r.notTags) if (tagMatches(tags, w)) return false;
    if (r.exts.length && !r.exts.includes(f.extension)) return false;
    if (r.kinds.length) {
      const tf = E.typeFolder(f.extension);
      if (!r.kinds.some(k => tf === k || tf.startsWith(k + '/'))) return false;
    }
    for (const [op, v] of r.size) {
      if (op === '>' && !(f.size > v)) return false;
      if (op === '>=' && !(f.size >= v)) return false;
      if (op === '<' && !(f.size < v)) return false;
      if (op === '<=' && !(f.size <= v)) return false;
    }
    for (const [op, v] of r.mod) {
      const age = now - f.lastModified;
      if (op === 'year' && new Date(f.lastModified).getFullYear() !== v) return false;
      if (op === '<' && !(age <= v)) return false;
      if (op === '>' && !(age > v)) return false;
    }
    if (r.inDirs.length) {
      const d = E.dirname(f.path).toLowerCase();
      if (!r.inDirs.some(x => d === x || d.startsWith(x + '/') || d.split('/').includes(x))) return false;
    }
    for (const raw of r.is) {
      const neg = raw.startsWith('!'), k = neg ? raw.slice(1) : raw;
      let v = true;
      if (k === 'untagged') v = !tags.length;
      else if (k === 'tagged') v = tags.length > 0;
      else if (k === 'duplicate' || k === 'dup' || k === 'duplicates') v = !!(ctx && ctx.dups && ctx.dups.has(f.path));
      else if (k === 'recent') v = now - f.lastModified <= 7 * DAY;
      else if (k === 'large' || k === 'big') v = f.size >= 100 * 1048576;
      else if (k === 'loose' || k === 'top') v = !f.path.includes('/');
      if (v === neg) return false;
    }
    if (r.text.length || r.notText.length) {
      const hay = (f.path + ' ' + tags.map(t => '#' + t).join(' ')).toLowerCase();
      for (const w of r.text) if (!hay.includes(w)) return false;
      for (const w of r.notText) if (hay.includes(w)) return false;
    }
    return true;
  }
  // Same name and size in more than one place
  function duplicateSet(files) {
    const by = new Map();
    for (const f of files) { if (!f.size) continue; const k = f.name.toLowerCase() + '|' + f.size; if (!by.has(k)) by.set(k, []); by.get(k).push(f.path); }
    const out = new Set();
    for (const list of by.values()) if (list.length > 1) for (const p of list) out.add(p);
    // also "report (2).pdf" next to "report.pdf" with the same size
    const bySize = new Map();
    for (const f of files) { if (f.size < 1024) continue; const base = f.name.toLowerCase().replace(/\s*\((\d+)\)(?=\.[^.]+$|$)/, '').replace(/\s*-\s*copy(?=\.[^.]+$|$)/, ''); const k = base + '|' + f.size; if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(f.path); }
    for (const list of bySize.values()) if (list.length > 1) for (const p of list) out.add(p);
    return out;
  }

  // ---------------------------------------------------------------- tag database
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // file names like "__proto__" or "constructor" must stay plain keys
  function put(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); return v; }
  // { v: 1, files: { path: { t: [tags], a: [auto tags], x: [removed by you], s, m, ad, ai, g } }, colors: { tag: '#hex' }, saved: [{ name, query }] }
  function emptyDb() { return { v: 1, files: {}, colors: {}, saved: [] }; }
  function cleanDb(db) {
    db = db && typeof db === 'object' ? db : emptyDb();
    db.v = 1;
    if (!db.files || typeof db.files !== 'object') db.files = {};
    if (!db.colors || typeof db.colors !== 'object') db.colors = {};
    if (!Array.isArray(db.saved)) db.saved = [];
    if (!Array.isArray(db.blocked)) db.blocked = [];
    return db;
  }
  function index(db) { const m = new Map(); for (const k of Object.keys(db.files)) m.set(k.toLowerCase(), k); return m; }
  function entryFor(db, idx, p, create) {
    const k = idx.get(p.toLowerCase());
    if (k != null) return db.files[k];
    if (!create) return null;
    put(db.files, p, { t: [], a: [], x: [] });
    idx.set(p.toLowerCase(), p);
    return db.files[p];
  }
  function tidy(e) { e.t = e.t || []; e.a = (e.a || []).filter(t => e.t.includes(t)); e.x = e.x || []; return e; }
  function isBare(e) { return !e.t.length && !e.x.length && !e.ai; }

  /**
   * Bring the database in line with a fresh scan. Tags follow files that were
   * moved outside Onyx when the name and size still match. Entries for files
   * that vanished are kept for 30 days in case they come back.
   */
  function reconcile(db, files, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    db = cleanDb(db);
    const scanned = new Map(files.map(f => [f.path.toLowerCase(), f]));
    const idx = index(db);
    let changed = false, relinked = 0;
    const orphans = [];
    for (const [low, key] of idx) {
      const e = db.files[key];
      const f = scanned.get(low);
      if (f) {
        if (key !== f.path) { delete db.files[key]; put(db.files, f.path, e); changed = true; }
        if (e.g) { delete e.g; changed = true; }
        if (e.s !== f.size || e.m !== f.lastModified) { e.s = f.size; e.m = f.lastModified; changed = true; }
      } else orphans.push(key);
    }
    if (orphans.length) {
      const free = new Map();
      const known = new Set(Object.keys(db.files).map(k => k.toLowerCase()));
      for (const f of files) {
        if (known.has(f.path.toLowerCase())) continue;
        const k = f.name.toLowerCase() + '|' + f.size;
        if (!free.has(k)) free.set(k, []);
        free.get(k).push(f);
      }
      for (const key of orphans) {
        const e = db.files[key];
        const name = E.basename(key).toLowerCase();
        const cand = e.s != null ? free.get(name + '|' + e.s) : null;
        if (cand && cand.length === 1 && ((e.t && e.t.length) || (e.x && e.x.length))) {
          const f = cand.shift();
          delete db.files[key];
          put(db.files, f.path, Object.assign(e, { s: f.size, m: f.lastModified }));
          delete e.g; relinked++; changed = true;
          continue;
        }
        if (!opts.complete) continue;
        if ((!e.t || !e.t.length) && (!e.x || !e.x.length)) { delete db.files[key]; changed = true; continue; }
        if (!e.g) { e.g = now; changed = true; }
        else if (now - e.g > 30 * DAY) { delete db.files[key]; changed = true; }
      }
    }
    return { db, changed, relinked };
  }
  // after Onyx moves files: [{from, to}]
  function applyMoves(db, moves) {
    db = cleanDb(db);
    const idx = index(db);
    let n = 0;
    for (const mv of moves) {
      const from = String(mv.from).replace(/\\/g, '/'), to = String(mv.to).replace(/\\/g, '/');
      const k = idx.get(from.toLowerCase());
      if (k == null) continue;
      const e = db.files[k];
      delete db.files[k]; idx.delete(from.toLowerCase());
      const clash = idx.get(to.toLowerCase());
      if (clash != null) delete db.files[clash];        // an old entry (e.g. in its grace period) at the destination
      put(db.files, to, e); idx.set(to.toLowerCase(), to); n++;
    }
    return n;
  }
  function edit(db, paths, add, remove) {
    db = cleanDb(db);
    const idx = index(db);
    add = (add || []).map(normTag).filter(Boolean);
    remove = (remove || []).map(normTag).filter(Boolean);
    if (add.length) db.blocked = db.blocked.filter(t => !add.includes(t));
    let n = 0;
    for (const p of paths) {
      const e = tidy(entryFor(db, idx, p, true));
      for (const t of add) { if (!e.t.includes(t)) { e.t.push(t); n++; } e.x = e.x.filter(x => x !== t); e.a = e.a.filter(x => x !== t); }
      for (const t of remove) {
        const before = e.t.length;
        e.t = e.t.filter(x => x !== t && !x.startsWith(t + '/'));
        if (e.t.length !== before) n++;
        e.a = e.a.filter(x => e.t.includes(x));
        if (!e.x.includes(t)) e.x.push(t);
      }
      if (isBare(e)) delete db.files[idx.get(p.toLowerCase())];
    }
    return n;
  }
  // map: { path: [tags] }; source: 'rules' | 'ai'
  function applyAuto(db, map, source, files) {
    db = cleanDb(db);
    const idx = index(db);
    const info = files ? new Map(files.map(f => [f.path.toLowerCase(), f])) : null;
    const blocked = new Set(db.blocked);
    const isBlocked = t => blocked.has(t) || [...blocked].some(b => t.startsWith(b + '/'));
    let added = 0, touched = 0;
    for (const [p, tags] of Object.entries(map)) {
      if (info && !info.has(p.toLowerCase())) continue;           // file no longer exists
      if (source !== 'ai') {
        const cur = entryFor(db, idx, p, false);
        const fresh = (tags || []).map(normTag).filter(t => t && !isBlocked(t) && !(cur && ((cur.t || []).includes(t) || (cur.x || []).includes(t))));
        if (!fresh.length) continue;
      }
      const e = tidy(entryFor(db, idx, p, true));
      let any = false;
      for (const raw of tags || []) {
        const t = normTag(raw);
        if (!t || e.t.includes(t) || e.x.includes(t) || isBlocked(t)) continue;
        e.t.push(t); e.a.push(t); added++; any = true;
      }
      if (source === 'ai') e.ai = Date.now();
      const f = info && info.get(p.toLowerCase());
      if (f) { e.s = f.size; e.m = f.lastModified; }
      if (any) touched++;
    }
    return { added, files: touched };
  }
  function clearAuto(db, paths) {
    db = cleanDb(db);
    const idx = index(db);
    let n = 0;
    const keys = paths ? paths.map(p => idx.get(p.toLowerCase())).filter(k => k != null) : Object.keys(db.files);
    for (const k of keys) {
      const e = tidy(db.files[k]);
      if (!e.a.length) continue;
      n += e.a.length;
      e.t = e.t.filter(t => !e.a.includes(t));
      for (const t of e.a) if (!e.x.includes(t)) e.x.push(t);
      e.a = [];
      delete e.ai;
    }
    return n;
  }
  function renameTag(db, from, to) {
    db = cleanDb(db);
    from = normTag(from); to = normTag(to);
    if (!from || !to || from === to) return 0;
    const sub = t => t === from ? to : t.startsWith(from + '/') ? to + t.slice(from.length) : t;
    let n = 0;
    for (const e of Object.values(db.files)) {
      tidy(e);
      const t2 = [...new Set(e.t.map(sub))];
      if (t2.join('|') !== e.t.join('|')) n++;
      e.t = t2; e.a = [...new Set(e.a.map(sub))].filter(t => e.t.includes(t)); e.x = [...new Set(e.x.map(sub))];
    }
    for (const k of Object.keys(db.colors)) { const k2 = sub(k); if (k2 !== k) { if (!db.colors[k2]) db.colors[k2] = db.colors[k]; delete db.colors[k]; } }
    return n;
  }
  function deleteTag(db, name) {
    db = cleanDb(db);
    name = normTag(name);
    let n = 0;
    const gone = t => t === name || t.startsWith(name + '/');
    for (const [k, e] of Object.entries(db.files)) {
      tidy(e);
      if (e.t.some(gone)) n++;
      e.t = e.t.filter(t => !gone(t)); e.a = e.a.filter(t => !gone(t));
      if (!e.x.includes(name)) e.x.push(name);
      if (isBare(e)) delete db.files[k];
    }
    for (const k of Object.keys(db.colors)) if (gone(k)) delete db.colors[k];
    if (name && !db.blocked.includes(name)) db.blocked.push(name);
    return n;
  }
  // what the renderer needs
  function view(db, files) {
    db = cleanDb(db);
    const idx = index(db);
    const out = {};
    for (const f of files) {
      const k = idx.get(f.path.toLowerCase());
      const e = k != null ? db.files[k] : null;
      if (e && e.t && e.t.length) put(out, f.path, { t: e.t.slice(), a: (e.a || []).filter(t => e.t.includes(t)) });
    }
    return { files: out, colors: Object.assign({}, db.colors), saved: db.saved.slice() };
  }
  // for "re-tag everything": never-tagged first, then the ones AI saw longest ago, so repeated runs work through big folders
  function aiOrder(db, files) {
    db = cleanDb(db);
    const idx = index(db);
    const at = f => { const k = idx.get(f.path.toLowerCase()); const e = k != null ? db.files[k] : null; return e && e.ai ? +e.ai : 0; };
    return files.map(f => [f, at(f)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  }
  function needsAuto(db, files, source) {
    db = cleanDb(db);
    const idx = index(db);
    return files.filter(f => { const k = idx.get(f.path.toLowerCase()); const e = k != null ? db.files[k] : null; return !e || !e.ai; });
  }
  // the order files' tags are tried for the "By tag" strategy: your own tags first
  function primaryTag(entry) {
    if (!entry || !entry.t || !entry.t.length) return null;
    const auto = new Set(entry.a || []);
    const mine = entry.t.filter(t => !auto.has(t) && !/^\d{4}$/.test(t));
    if (mine.length) return mine[0];
    const rest = entry.t.filter(t => !/^\d{4}$/.test(t) && !['draft', 'final', 'backup', 'copy', 'signed', 'temp', 'incomplete', 'template', 'scan'].includes(t));
    return rest[0] || null;
  }

  return {
    normTag, tagLabel, tagFolder, hashColor, autoTags, aiTagBatches, parseAiTags, AI_TAG_SYSTEM,
    parseQuery, isEmptyQuery, matchFile, duplicateSet, tokenize, KINDS, tagMatches,
    emptyDb, cleanDb, reconcile, applyMoves, edit, applyAuto, clearAuto, renameTag, deleteTag, view, needsAuto, aiOrder, primaryTag,
  };
});
