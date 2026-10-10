/* Onyx library: a fast file browser with tags, search, previews and quick find. */
(function () {
  'use strict';
  const TG = window.OnyxTags, E = window.OnyxEngine;
  const $ = s => document.querySelector(s);
  const DAY = 86400000;
  const ROW = 32, GROUP = 36, OVERSCAN = 400;
  const TILES = { s: [118, 150], m: [150, 178], l: [210, 236] };
  const tileW = () => (TILES[U().tile] || TILES.m)[0], tileH = () => (TILES[U().tile] || TILES.m)[1];
  const EXEC = /\.(exe|msi|bat|cmd|com|ps1|vbs|vbe|js|jse|wsf|wsh|scr|pif|lnk|reg|hta|cpl|jar|msix|appx)$/i;

  let C = null;
  const L = {
    query: '', sel: new Set(), anchor: null, focus: null,
    files: [], rows: [], offsets: [], total: 0, cols: 1, collapsed: new Set(),
    thumbs: new Map(), queue: [], busy: 0,
    run: null, dupsFor: null, dups: new Set(), tagFilter: '', vaultKey: '',
    cwd: '', hist: [], fwd: [], dirs: [], statsFor: null, stats: null,
    loaded: new Set(), loading: new Map(), listErr: new Map(), search: null, searchTimer: null, pendingSelect: null,
  };
  // browse-only locations (drives, system folders): folders load one at a time, search runs in the background
  const BR = () => !!(V() && V().browse);

  // ------------------------------------------------------------------ helpers
  const esc = s => C.esc(s);
  const icon = (n, c) => C.icon(n, c);
  const U = () => Object.assign({ browse: 'folders', view: 'list', sort: 'name', dir: 'asc', group: 'none', details: true, autoTag: 'rules', dblClick: 'preview', thumbs: true, treeTags: true, tagSort: 'count' }, (C.UI().library || {}));
  function setPref(key, value) { C.setUi('library', key, value); refresh(); }
  const V = () => C.S.vault;
  const tagState = () => (V() && V().tags) || { files: {}, colors: {}, saved: [] };
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const entry = p => { const f = tagState().files; return has(f, p) ? f[p] : null; };
  const tagsOf = p => { const e = entry(p); return e && Array.isArray(e.t) ? e.t : []; };
  const autoOf = p => { const e = entry(p); return e && Array.isArray(e.a) ? e.a : []; };
  function palette() { const c = C.T.colors() || {}; return c.groupColors || ['#86b8a0', '#d2a96c', '#8aa3c9', '#c99aa8', '#a9a3c6', '#c8bb93', '#79b4b2', '#c48770', '#a0b97f', '#b7bac4']; }
  function tagColor(t) {
    const cols = tagState().colors || {};
    if (has(cols, t)) return cols[t];
    const root = t.split('/')[0];
    return has(cols, root) ? cols[root] : autoColor(root);
  }
  // tags without a chosen colour: the most-used ones each get a different colour from the palette
  let rankCols = null, rankOf = null;
  function autoColor(root) {
    const ts = tagState();
    if (!rankCols || rankOf !== ts) {
      rankOf = ts; rankCols = new Map();
      const pal = palette(), n = pal.length, counts = new Map();
      for (const e of Object.values(ts.files || {})) for (const t of (e && e.t) || []) { const r = t.split('/')[0]; counts.set(r, (counts.get(r) || 0) + 1); }
      const chosen = new Set(Object.values(ts.colors || {}));
      let used = new Set([...chosen].filter(c => pal.includes(c)));
      for (const [r] of [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
        if (used.size >= n) used = new Set();
        const start = pal.indexOf(TG.hashColor(r, pal));
        let pick = pal[start];
        for (let i = 0; i < n; i++) { const c = pal[(start + i) % n]; if (!used.has(c)) { pick = c; break; } }
        used.add(pick); rankCols.set(r, pick);
      }
    }
    return rankCols.get(root) || TG.hashColor(root, palette());
  }
  function chip(t, opts) {
    opts = opts || {};
    const auto = opts.auto ? ' is-auto' : '';
    return '<span class="tag-chip' + auto + (opts.cls ? ' ' + opts.cls : '') + '" style="--tc:' + tagColor(t) + '" data-tag="' + esc(t) + '"' +
      (opts.auto && opts.tip ? ' data-tip="Added automatically. Remove it and Onyx won’t add it again."' : '') + '><span class="tc-dot"></span><span class="tc-name">' + esc(t) + '</span>' +
      (opts.count ? '<span class="tc-count">' + esc(opts.count) + '</span>' : '') +
      (opts.x ? '<button class="tc-x" data-tag-remove="' + esc(t) + '" aria-label="Remove tag ' + esc(t) + '">' + icon('x', 'xs') + '</button>' : '') + '</span>';
  }
  function ago(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.round(d / 60000) + ' min ago';
    if (d < DAY) return Math.round(d / 3600000) + ' h ago';
    if (d < 2 * DAY) return 'yesterday';
    if (d < 7 * DAY) return Math.round(d / DAY) + ' days ago';
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const fullDate = ts => new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  // one format for the whole column, like Explorer (relative time is in the tooltip)
  const dateTime = ts => ts ? new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const TYPE_NAMES = { txt: 'Text document', md: 'Markdown document', doc: 'Word document', docx: 'Word document', xls: 'Excel spreadsheet', xlsx: 'Excel spreadsheet', csv: 'CSV file',
    ppt: 'PowerPoint presentation', pptx: 'PowerPoint presentation', pdf: 'PDF document', exe: 'Application', msi: 'Windows installer', zip: 'ZIP archive', rar: 'RAR archive', '7z': '7-Zip archive',
    lnk: 'Shortcut', json: 'JSON file', html: 'HTML page', htm: 'HTML page', js: 'JavaScript file', py: 'Python file', css: 'CSS file', crdownload: 'Unfinished download', part: 'Unfinished download' };
  const GROUP_NOUN = { Images: 'image', Documents: 'document', Videos: 'video', Audio: 'audio', Code: 'file', Archives: 'archive', '3D Models': '3D model', Design: 'design file', Installers: 'installer', eBooks: 'e-book', Fonts: 'font' };
  function typeLabel(f) {
    const x = (f.extension || '').toLowerCase();
    if (TYPE_NAMES[x]) return TYPE_NAMES[x];
    const k = E.kindLabel(x);
    if (/[A-Z]/.test(k)) return k;                       // app names: "FL Studio preset"
    return x ? x.toUpperCase() + ' ' + (GROUP_NOUN[E.typeGroup(x)] || 'file') : 'File';
  }
  // tags in the list: a dot per tag and the main tag's name (full chips on request)
  function tagCell(f) {
    const tags = tagsOf(f.path);
    if (!tags.length) return '';
    const auto = new Set(autoOf(f.path));
    if (U().tagStyle === 'chips') return tags.slice(0, 2).map(t => chip(t, { auto: auto.has(t) })).join('') + (tags.length > 2 ? '<span class="tc-more">+' + (tags.length - 2) + '</span>' : '');
    return '<span class="lr-dots" aria-hidden="true">' + tags.slice(0, 4).map(t => '<span style="--tc:' + tagColor(t) + '"></span>').join('') + '</span>' +
      '<span class="lr-tagname">' + esc(tags[0]) + (tags.length > 1 ? '<span class="lr-tagmore"> +' + (tags.length - 1) + '</span>' : '') + '</span>';
  }
  const COLS = {
    name: { label: 'Name', sort: 'name', min: 200 },
    tags: { label: 'Tags', w: 140, min: 70 },
    type: { label: 'Type', sort: 'type', w: 128, min: 70 },
    folder: { label: 'Folder', sort: 'folder', w: 160, min: 70 },
    modified: { label: 'Date modified', sort: 'modified', w: 158, min: 110 },
    size: { label: 'Size', sort: 'size', w: 84, min: 56 },
  };
  const COL_ORDER = ['name', 'tags', 'type', 'folder', 'modified', 'size'];
  const DROP_ORDER = ['folder', 'type', 'tags', 'modified'];        // what goes first when the list gets narrow
  const colPrefs = () => Object.assign({ tags: true, type: true, modified: true, size: true }, U().cols || {});
  const colWidth = k => (L.colwLive && L.colwLive[k]) || (U().colw || {})[k] || COLS[k].w;
  function visibleCols() {
    const p = colPrefs();
    let cols = COL_ORDER.filter(k => k === 'name' || (k === 'folder' ? !browsing() : p[k] !== false));
    const sc = $('#libScroll');
    const avail = (sc && sc.clientWidth ? sc.clientWidth : 900) - 36;
    const need = () => cols.reduce((a, k) => a + (k === 'name' ? COLS.name.min : colWidth(k)) + 12, 0);
    for (const k of DROP_ORDER) { if (need() <= avail) break; cols = cols.filter(c => c !== k); }
    return cols;
  }
  const colTemplate = cols => cols.map(k => k === 'name' ? 'minmax(' + COLS.name.min + 'px, 1fr)' : colWidth(k) + 'px').join(' ');
  const plural = (n, w, p) => n + ' ' + (n === 1 ? w : (p || w + 's'));
  function splitName(name) { const { base, ext } = E.splitExt(name); return ext && base ? { base, ext } : { base: name, ext: '' }; }
  function dupSet() {
    const v = V(); if (!v) return new Set();
    if (L.dupsFor !== v.files) { L.dups = TG.duplicateSet(v.files); L.dupsFor = v.files; }
    return L.dups;
  }
  function fileBy(path) { const v = V(); return v ? v.files.find(f => f.path === path) : null; }
  function selFiles() { const v = V(); if (!v) return []; return v.files.filter(f => L.sel.has(f.path)); }
  function vocab() {
    const counts = new Map();
    for (const e of Object.values(tagState().files)) for (const t of e.t) counts.set(t, (counts.get(t) || 0) + 1);
    return counts;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('onyx.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('onyx.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  function recentKey() { return 'recentFiles.' + ((V() && (V().rootPath || 'demo')) || '').toLowerCase(); }
  function pushRecent(p) { const k = recentKey(); const list = store.get(k, []).filter(x => x !== p); list.unshift(p); store.set(k, list.slice(0, 30)); }

  // ------------------------------------------------------------------ results
  const KIND_ORDER = ['Images', 'Documents', 'Videos', 'Audio', 'Code', 'Archives', '3D Models', 'Design', 'Installers', 'eBooks', 'Fonts'];
  function comparator() {
    const u = U(), col = C.collator;
    let fn;
    if (u.sort === 'modified') fn = (a, b) => a.lastModified - b.lastModified || col.compare(a.name, b.name);
    else if (u.sort === 'size') fn = (a, b) => a.size - b.size || col.compare(a.name, b.name);
    else if (u.sort === 'type') fn = (a, b) => col.compare(a.extension, b.extension) || col.compare(a.name, b.name);
    else if (u.sort === 'folder') fn = (a, b) => col.compare(E.dirname(a.path), E.dirname(b.path)) || col.compare(a.name, b.name);
    else fn = (a, b) => col.compare(a.name, b.name);
    return u.dir === 'desc' ? (a, b) => fn(b, a) : fn;
  }
  // folder sizes, file counts and newest change, for every folder (recursive)
  function dirStats() {
    const v = V();
    if (L.statsFor === v.files && L.stats) return L.stats;
    const st = new Map(), children = new Map();
    const ensure = p => {
      const k = p.toLowerCase();
      if (!st.has(k)) st.set(k, { isDir: true, path: p, name: E.basename(p), extension: '', size: 0, lastModified: 0, count: 0, sub: 0 });
      return st.get(k);
    };
    for (const d of v.dirs) { const x = ensure(d.path); if (d.opaque) x.opaque = true; if (d.lastModified > x.dirTime || !x.dirTime) x.dirTime = d.lastModified || 0; let p = E.dirname(d.path); while (p) { ensure(p); p = E.dirname(p); } }
    for (const f of v.files) {
      let d = E.dirname(f.path);
      while (d) { const x = ensure(d); x.count++; x.size += f.size; if (f.lastModified > x.lastModified) x.lastModified = f.lastModified; d = E.dirname(d); }
    }
    for (const x of st.values()) {
      if (v.browse) x.lastModified = x.dirTime || x.lastModified;
      const parent = E.dirname(x.path).toLowerCase();
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(x);
      if (parent && st.has(parent)) st.get(parent).sub++;
    }
    L.stats = { st, children }; L.statsFor = v.files;
    return L.stats;
  }
  const browsing = () => (BR() || U().browse !== 'flat') && !L.query.trim();
  let cache = null;
  function compute() {
    const v = V();
    if (!v) { L.files = []; L.dirs = []; return; }
    const u = U();
    const stats = dirStats();
    if (v.browse) { computeBrowse(v, u, stats); return; }
    // the folder we were in may have been moved or emptied away
    while (L.cwd && !stats.st.has(L.cwd.toLowerCase())) L.cwd = E.dirname(L.cwd);
    const key = [L.query, u.sort, u.dir, u.browse, L.cwd];
    if (cache && cache.files === v.files && cache.tags === v.tags && cache.key.join('\u0000') === key.join('\u0000') && !/(modified|mod|date):|is:recent/i.test(L.query)) return;
    cache = { files: v.files, tags: v.tags, key };
    const cwdLow = L.cwd.toLowerCase();
    const under = f => !cwdLow || f.path.toLowerCase().startsWith(cwdLow + '/');
    const cmp = comparator();
    if (!L.query.trim()) {
      if (u.browse !== 'flat') {
        L.files = v.files.filter(f => E.dirname(f.path).toLowerCase() === cwdLow).sort(cmp);
        const kids = (stats.children.get(cwdLow) || []).slice();
        const dcmp = u.sort === 'size' || u.sort === 'modified' ? cmp : (a, b) => (u.dir === 'desc' ? -1 : 1) * C.collator.compare(a.name, b.name);
        L.dirs = kids.sort(dcmp);
      } else { L.files = v.files.filter(under).sort(cmp); L.dirs = []; }
    } else {
      // like Explorer: search this folder and everything inside it
      const q = TG.parseQuery(L.query);
      const ctx = { now: Date.now(), dups: q.is.some(x => /dup/.test(x)) ? dupSet() : null };
      L.files = v.files.filter(f => under(f) && TG.matchFile(f, tagsOf(f.path), q, ctx)).sort(cmp);
      L.dirs = [];
    }
    const keep = new Set(L.files.map(f => f.path).concat(L.dirs.map(d => d.path)));
    for (const p of [...L.sel]) if (!keep.has(p)) L.sel.delete(p);
    if (L.focus && !keep.has(L.focus)) L.focus = null;
  }
  function computeBrowse(v, u, stats) {
    cache = null;
    const cwdLow = L.cwd.toLowerCase();
    const cmp = comparator();
    const q = L.query.trim();
    if (!q) {
      L.search = null;
      if (!L.loaded.has(cwdLow)) { L.files = []; L.dirs = []; ensureListed(L.cwd); return; }
      L.files = v.files.filter(f => E.dirname(f.path).toLowerCase() === cwdLow).sort(cmp);
      const dcmp = u.sort === 'modified' ? cmp : (a, b) => (u.dir === 'desc' ? -1 : 1) * C.collator.compare(a.name, b.name);
      L.dirs = (stats.children.get(cwdLow) || []).slice().sort(dcmp);
    } else {
      const key = cwdLow + '\u0000' + q;
      if (!L.search || L.search.key !== key) runSearch(key, L.cwd, q);
      L.files = (L.search.files || []).slice().sort(cmp);
      L.dirs = [];
    }
    const keep = new Set(L.files.map(f => f.path).concat(L.dirs.map(d => d.path)));
    for (const p of [...L.sel]) if (!keep.has(p)) L.sel.delete(p);
    if (L.focus && !keep.has(L.focus)) L.focus = null;
  }
  function dirBy(p) { return dirStats().st.get(String(p).toLowerCase()) || null; }
  function absPath(rel) {
    const root = (V() && V().rootPath) || '';
    const sep = root.includes('\\') ? '\\' : '/';
    return rel ? root.replace(/[\\/]+$/, '') + sep + rel.split('/').join(sep) : root;
  }
  function isListed(rel) { return !BR() || L.loaded.has(String(rel || '').toLowerCase()); }
  function ensureListed(rel) {
    rel = rel || '';
    const k = rel.toLowerCase();
    if (!BR() || L.loaded.has(k)) return Promise.resolve();
    if (L.loading.has(k)) return L.loading.get(k);
    const vault = V();
    const pr = C.api.listDir(rel).then(r => {
      L.loading.delete(k);
      if (V() !== vault || !r) return;
      if (r.error && !r.files) { L.listErr.set(k, r.error); L.loaded.add(k); }
      else mergeListing(r);
      afterListing(k);
    }, () => { L.loading.delete(k); L.listErr.set(k, 'Couldn’t read this folder.'); L.loaded.add(k); afterListing(k); });
    L.loading.set(k, pr);
    return pr;
  }
  function mergeListing(r) {
    const v = V();
    const k = (r.path || '').toLowerCase();
    v.files = v.files.filter(f => E.dirname(f.path).toLowerCase() !== k).concat(r.files || []);
    v.dirs = v.dirs.filter(d => E.dirname(d.path).toLowerCase() !== k).concat(r.dirs || []);
    if (r.tags) v.tags = r.tags;
    L.loaded.add(k);
    if (r.error) L.listErr.set(k, r.error); else L.listErr.delete(k);
    if (r.capped) L.listErr.set(k + '#capped', 'This folder has more than 20,000 items; showing the first 20,000.');
  }
  function mergeFound(files) {
    const v = V();
    const have = new Set(v.files.map(f => f.path.toLowerCase()));
    const add = files.filter(f => !have.has(f.path.toLowerCase()));
    if (add.length) v.files = v.files.concat(add);
  }
  function afterListing(k) {
    if (L.cwd.toLowerCase() === k) {
      refresh();
      if (L.pendingSelect && fileBy(L.pendingSelect)) { const p = L.pendingSelect; L.pendingSelect = null; setSingle(p); }
    }
    renderTagsPanel();
    if (C.renderExplorer) C.renderExplorer();
  }
  function runSearch(key, rel, query) {
    clearTimeout(L.searchTimer);
    L.search = { key, busy: true, files: [], truncated: false };
    const vault = V();
    L.searchTimer = setTimeout(async () => {
      let r;
      try { r = await C.api.searchDir(rel, query, 2000); } catch (e) { r = { files: [], error: e.message }; }
      if (V() !== vault || !L.search || L.search.key !== key || (r && r.cancelled)) return;
      mergeFound(r.files || []);
      L.search = { key, busy: false, files: r.files || [], truncated: !!r.truncated, error: r.error || '' };
      refresh();
    }, 250);
  }

  // ------------------------------------------------------------------ navigation (like File Explorer)
  function go(path, opts) {
    opts = opts || {};
    path = path || '';
    const from = L.cwd;
    if (path === from && !L.query) { if (opts.select) { setSingle(opts.select); } return; }
    if (!opts.noHistory && path !== from) { L.hist.push(from); if (L.hist.length > 100) L.hist.shift(); L.fwd = []; }
    L.cwd = path;
    if (BR() && C.api.fsWatch) C.api.fsWatch(path);
    if (!opts.keepQuery) { L.query = ''; const i = $('#libSearch'); if (i) i.value = ''; }
    L.sel.clear(); L.focus = null; L.anchor = null;
    const sc = $('#libScroll'); if (sc) sc.scrollTop = 0;
    refresh();
    const pick = opts.select || (from && E.dirname(from).toLowerCase() === path.toLowerCase() ? from : null);
    if (pick && L.order && L.order.some(x => x.path === pick)) setSingle(pick);
    else if (pick && BR() && !isListed(path)) L.pendingSelect = pick;
    renderTagsPanel();
    if (C.syncTree) C.syncTree(path);
  }
  function back() { if (!L.hist.length) return up(); const p = L.hist.pop(); L.fwd.push(L.cwd); go(p, { noHistory: true }); }
  function forward() { if (!L.fwd.length) return; const p = L.fwd.pop(); L.hist.push(L.cwd); go(p, { noHistory: true }); }
  function up() { if (!L.cwd) return; go(E.dirname(L.cwd)); }
  function revealFile(path) {
    const d = E.dirname(path);
    if (!C.WS.isVisible('library')) C.WS.activate('library');
    if (L.query || L.cwd !== d) go(d, { select: path });
    else setSingle(path);
  }
  function groupsOf() {
    const g = U().group;
    if (g === 'none') return null;
    const map = new Map();
    const put = (key, label, f, order) => { if (!map.has(key)) map.set(key, { key, label, files: [], order }); map.get(key).files.push(f); };
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const f of L.files) {
      if (g === 'folder') { const d = E.dirname(f.path); put('d:' + d.toLowerCase(), d || V().vaultName, f, d ? 1 : 0); }
      else if (g === 'kind') { const k = E.typeGroup(f.extension); const i = KIND_ORDER.indexOf(k); put('k:' + k, k, f, i < 0 ? 99 : i); }
      else if (g === 'tag') {
        const t = tagsOf(f.path)[0];           // each file once, under its main tag
        if (!t) put('t:', 'No tags', f, 1); else put('t:' + t, '#' + t, f, 0);
      } else if (g === 'date') {
        const m = f.lastModified;
        let key, label, order;
        if (m >= startOfDay) { key = 'today'; label = 'Today'; order = 0; }
        else if (m >= startOfDay - DAY) { key = 'yday'; label = 'Yesterday'; order = 1; }
        else if (m >= startOfDay - 6 * DAY) { key = 'week'; label = 'Earlier this week'; order = 2; }
        else if (m >= startOfDay - 29 * DAY) { key = 'month'; label = 'Earlier this month'; order = 3; }
        else { const y = new Date(m).getFullYear(); key = 'y' + y; label = y === now.getFullYear() ? 'Earlier this year' : String(y); order = 10 + (now.getFullYear() - y); }
        put(key, label, f, order);
      }
    }
    const list = [...map.values()];
    list.sort((a, b) => a.order - b.order || (g === 'tag' ? b.files.length - a.files.length : 0) || C.collator.compare(a.label, b.label));
    return list;
  }
  function buildRows() {
    const grid = U().view === 'grid';
    const rows = [];
    const sc = $('#libScroll');
    if (grid && sc) L.cols = Math.max(1, Math.floor((sc.clientWidth - 16) / tileW()));
    const pushFiles = files => {
      if (!grid) { for (const f of files) rows.push({ t: 'f', f, h: ROW }); return; }
      for (let i = 0; i < files.length; i += L.cols) rows.push({ t: 'tiles', files: files.slice(i, i + L.cols), h: tileH() });
    };
    const groups = groupsOf();
    if (!groups) pushFiles(L.dirs.concat(L.files));
    else {
      if (L.dirs.length) {
        rows.push({ t: 'g', key: 'dirs', label: 'Folders', count: L.dirs.length, size: L.dirs.reduce((a, d) => a + d.size, 0), h: GROUP });
        if (!L.collapsed.has('dirs')) pushFiles(L.dirs);
      }
    }
    if (groups) for (const g of groups) {
      const size = g.files.reduce((a, f) => a + f.size, 0);
      rows.push({ t: 'g', key: g.key, label: g.label, count: g.files.length, size, h: GROUP });
      if (!L.collapsed.has(g.key)) pushFiles(g.files);
    }
    L.rows = rows;
    const seen = new Set();
    L.order = [];
    for (const r of rows) for (const f of r.t === 'f' ? [r.f] : r.t === 'tiles' ? r.files : []) if (!seen.has(f.path)) { seen.add(f.path); L.order.push(f); }
    if (L.anchor && !seen.has(L.anchor)) L.anchor = null;
    L.offsets = new Array(rows.length);
    let y = 6;
    for (let i = 0; i < rows.length; i++) { L.offsets[i] = y; y += rows[i].h; }
    L.total = y + 10;
  }

  // ------------------------------------------------------------------ library view
  function renderLibrary(el) {
    const v = V();
    if (!v) {
      if (C.emptyState) { el.innerHTML = '<div class="lib-welcome">' + C.emptyState() + '</div>'; return; }
      el.innerHTML = '<div class="empty-state"><div class="empty-inner"><img class="logo small" src="icon.png" alt=""><h1 style="font-size:20px">Your library</h1><div class="sub">Open a folder to browse it here: search everything, tag files, and find them again in a second.</div><button class="btn mod-cta" data-action="open-folder">' + icon('folder-open') + 'Open folder</button></div></div>';
      return;
    }
    const key = (v.rootPath || 'demo') + '|' + v.vaultName + '|' + (v.browse ? 'b' : 'f');
    if (L.vaultKey !== key) {
      if (window.OnyxViewer) window.OnyxViewer.close();
      L.vaultKey = key; L.sel.clear(); L.focus = null; L.anchor = null; L.query = ''; L.collapsed.clear(); L.thumbs.clear();
      L.cwd = ''; L.hist = []; L.fwd = []; L.loaded = new Set(); L.loading = new Map(); L.listErr = new Map(); L.search = null; L.pendingSelect = null;
    }
    if (!el.querySelector('.lib')) build(el);
    refresh();
  }
  function build(el) {
    el.innerHTML = '<div class="lib">' +
      '<div class="lib-addr">' +
      '<div class="lib-nav" id="libNav"></div>' +
      '<div class="search-wrap lib-search">' + icon('search', 'xs') + '<input id="libSearch" class="search-input" spellcheck="false" autocomplete="off" aria-label="Search files" placeholder="Search">' +
      '<button class="clickable-icon lib-clear" data-lib="clear" aria-label="Clear search" data-tip="Clear search">' + icon('x', 'xs') + '</button></div>' +
      '</div>' +
      '<div class="lib-cmd" id="libCmd" role="toolbar" aria-label="Commands"></div>' +
      '<div class="lib-chips" id="libChips"></div>' +
      '<div class="lib-progress" id="libProgress"></div>' +
      '<div class="lib-body">' +
      '<div class="lib-main"><div class="lib-head" id="libHead"></div>' +
      '<div class="lib-scroll" id="libScroll" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="Files"><div class="lib-canvas" id="libCanvas"></div></div>' +
      '<div class="lib-foot" id="libFoot"></div></div>' +
      '<aside class="lib-details" id="libDetails" aria-label="Details"></aside>' +
      '</div></div>';
    const input = el.querySelector('#libSearch');
    input.value = L.query;
    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { L.query = input.value; const sc = $('#libScroll'); if (sc) sc.scrollTop = 0; refresh(); }, 70); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (input.value) { input.value = ''; L.query = ''; refresh(); } else input.blur(); e.stopPropagation(); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); const first = (L.order || [])[0]; if (first) { if (!L.focus) setSingle(first.path); $('#libScroll').focus(); } }
    });
    const sc = el.querySelector('#libScroll');
    let raf = 0;
    sc.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); });
    sc.addEventListener('keydown', onKey);
    sc.addEventListener('dragstart', onDragStart);
    if (window.ResizeObserver) {
      let lastW = 0;
      new ResizeObserver(() => {
        const w = sc.clientWidth; if (Math.abs(w - lastW) < 4) return; lastW = w;
        if (U().view === 'grid') { buildRows(); paint(); return; }
        // columns drop out (and come back) as the list gets narrower or wider
        const next = visibleCols();
        if (next.join() !== (L.vcols || []).join()) { L.vcols = next; const lib = el.querySelector('.lib'); lib.style.setProperty('--lib-cols', colTemplate(next)); renderHead(); paint(); }
      }).observe(sc);
      // drag a column's left edge to resize it; double-click to reset
      el.addEventListener('mousedown', e => {
        const h = e.target.closest('[data-colresize]'); if (!h) return;
        e.preventDefault(); e.stopPropagation();
        const k = h.dataset.colresize, x0 = e.clientX, w0 = colWidth(k), lib = el.querySelector('.lib');
        L.colwLive = {}; L.resizing = true;
        const mm = ev => { L.colwLive[k] = Math.max(COLS[k].min, Math.min(520, w0 + (x0 - ev.clientX))); lib.style.setProperty('--lib-cols', colTemplate(L.vcols)); };
        const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); const w = L.colwLive[k]; L.colwLive = null; setTimeout(() => { L.resizing = false; }, 0); if (w) C.setUi('library', 'colw', Object.assign({}, U().colw || {}, { [k]: Math.round(w) })); refresh(); };
        window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
      }, true);
      el.addEventListener('dblclick', e => { const h = e.target.closest('[data-colresize]'); if (!h) return; e.stopPropagation(); const cw = Object.assign({}, U().colw || {}); delete cw[h.dataset.colresize]; C.setUi('library', 'colw', cw); refresh(); }, true);
      el.addEventListener('contextmenu', e => { if (!e.target.closest('#libHead')) return; e.preventDefault(); e.stopPropagation(); columnsMenu(e.clientX, e.clientY); }, true);
    }
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDblClick);
    // mouse back / forward buttons
    el.addEventListener('mouseup', e => { if (e.button === 3) { e.preventDefault(); back(); } else if (e.button === 4) { e.preventDefault(); forward(); } });
    el.addEventListener('keydown', e => {
      if (window.OnyxOps && window.OnyxOps.key(e)) return;
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); forward(); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); up(); }
    });
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('keydown', onDetailsKey);
    el.addEventListener('input', onDetailsInput);
  }
  function refresh() {
    const el = $('#vs-library');
    if (!el || !el.querySelector('.lib') || !V() || !C.WS.isVisible('library')) return;
    compute();
    const u = U();
    const lib = el.querySelector('.lib');
    lib.dataset.mode = u.view;
    lib.dataset.tile = u.tile || 'm';
    lib.classList.toggle('no-details', !u.details);
    lib.classList.toggle('is-browsing', browsing());
    L.vcols = visibleCols();
    lib.style.setProperty('--lib-cols', colTemplate(L.vcols));
    lib.style.setProperty('--tile-h', (tileH() - 8) + 'px');
    const input = el.querySelector('#libSearch');
    if (input.value !== L.query && document.activeElement !== input) input.value = L.query;
    input.placeholder = 'Search ' + (L.cwd ? E.basename(L.cwd) : V().vaultName);
    input.title = 'Names and #tags. Also try type:pdf  size:>10mb  modified:<7d  is:untagged';
    el.querySelector('.lib-clear').style.visibility = L.query ? 'visible' : 'hidden';
    renderNav(); renderCmd(); renderChips(); renderHead(); renderProgress();
    buildRows(); paint(); renderFoot(); renderDetails();
  }
  function renderNav() {
    const el = $('#libNav'); if (!el) return;
    const v = V();
    const segs = L.cwd ? L.cwd.split('/') : [];
    let acc = '';
    const crumbs = (C.openPlaces && !v.demo ? ['<button class="crumb crumb-pc" data-lib="places" title="This PC: drives and folders">' + icon('monitor', 'xs') + '<span>This PC</span></button><span class="crumb-sep">' + icon('chevron-right', 'xs') + '</span>'] : [])
      .concat(['<button class="crumb" data-lib="go" data-p="" title="' + esc(v.rootPath || v.vaultName) + '">' + icon(v.browse ? 'hard-drive' : 'folder-open', 'xs') + '<span>' + esc(v.vaultName) + '</span></button>'])
      .concat(segs.map((sname, i) => { acc = acc ? acc + '/' + sname : sname; return '<span class="crumb-sep">' + icon('chevron-right', 'xs') + '</span><button class="crumb' + (i === segs.length - 1 ? ' is-current' : '') + '" data-lib="go" data-p="' + esc(acc) + '">' + esc(sname) + '</button>'; }));
    el.innerHTML =
      '<button class="clickable-icon" data-lib="back" aria-label="Back" data-tip="Back (Alt+←)"' + (L.hist.length || L.cwd ? '' : ' disabled') + '>' + icon('arrow-left') + '</button>' +
      '<button class="clickable-icon" data-lib="forward" aria-label="Forward" data-tip="Forward (Alt+→)"' + (L.fwd.length ? '' : ' disabled') + '>' + icon('arrow-right') + '</button>' +
      '<button class="clickable-icon" data-lib="up" aria-label="Up one folder" data-tip="Up one folder (Alt+↑)"' + (L.cwd ? '' : ' disabled') + '>' + icon('arrow-up') + '</button>' +
      '<button class="clickable-icon" data-lib="refresh" aria-label="Refresh" data-tip="Refresh (F5)">' + icon('refresh-cw') + '</button>' +
      '<div class="lib-crumbs" role="navigation" aria-label="Folder">' + crumbs.join('') + (L.query.trim() ? '<span class="crumb-search">' + icon('search', 'xs') + 'Search results</span>' : '') +
      (v.browse ? '<span class="lib-browseonly" data-tip="' + esc('Onyx won’t reorganize a whole drive or system folder. Your own changes (rename, copy, delete…) still work. Right-click a folder and choose “Organize this folder” to sort it.') + '">' + icon('shield-check', 'xs') + 'Browse only</span>' : '') + '</div>';
  }
  // the command bar: what Explorer has, in the same order
  function renderCmd() {
    const el = $('#libCmd'); if (!el) return;
    const v = V(), u = U();
    const n = L.sel.size, demo = !!v.demo, q = !!L.query.trim();
    const O = window.OnyxOps;
    const b = (op, ic, label, tip, dis, extra) => '<button class="cmd-btn' + (label ? ' has-label' : '') + (extra || '') + '" data-lib="op" data-op="' + op + '"' + (dis ? ' disabled' : '') + ' aria-label="' + esc(tip) + '" data-tip="' + esc(tip) + '">' + icon(ic) + (label ? '<span>' + esc(label) + '</span>' : '') + '</button>';
    const sortNames = { name: 'Name', modified: 'Date', size: 'Size', type: 'Type', folder: 'Folder' };
    const mk = C.isMac ? '⌘' : 'Ctrl+';
    el.innerHTML =
      b('new', 'plus', 'New', 'New folder or file', demo || q, ' cmd-new') + '<span class="cmd-sep"></span>' +
      b('cut', 'scissors', '', 'Cut (' + mk + 'X)', demo || !n) +
      b('copy', 'copy', '', 'Copy (' + mk + 'C)', demo || !n) +
      b('paste', 'clipboard-paste', '', 'Paste (' + mk + 'V)', demo) +
      b('rename', 'pencil', '', 'Rename (F2)', demo || !n) +
      b('delete', 'trash', '', 'Delete (Del)', demo || !n) +
      '<span class="cmd-sep"></span>' +
      '<button class="cmd-btn has-label" data-lib="sort-menu" aria-label="Sort" data-tip="Sort and group">' + icon('arrow-up-down') + '<span>Sort: ' + esc(sortNames[u.sort] || 'Name') + '</span>' + icon('chevron-down', 'xs') + '</button>' +
      '<button class="cmd-btn has-label" data-lib="view-menu" aria-label="View" data-tip="Layout and panes">' + icon(u.view === 'grid' ? 'layout-grid' : 'list') + '<span>View</span>' + icon('chevron-down', 'xs') + '</button>' +
      '<button class="cmd-btn has-label" data-lib="tag-menu" aria-label="Tags" data-tip="Tag files">' + icon('tag') + '<span>Tags</span>' + icon('chevron-down', 'xs') + '</button>' +
      '<span class="spacer"></span>' +
      (O && O.undoLabel ? b('undo', 'undo-2', '', O.undoLabel + ' (' + mk + 'Z)', false) : '') +
      b('more', 'more-horizontal', '', 'More', false) +
      '<button class="cmd-btn' + (u.details ? ' is-active' : '') + '" data-lib="details" aria-label="Details pane" data-tip="Details pane">' + icon('panel-right') + '</button>';
  }
  // a slim line under the address bar while searching: where it looks, and saving the search
  function renderChips() {
    const el = $('#libChips'); if (!el) return;
    const q = L.query.trim();
    if (!q) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.classList.add('show');
    const saved = (tagState().saved || []).some(s => s.query.trim() === q);
    el.innerHTML = '<span class="q-scope">' + icon('search', 'xs') + (L.cwd ? 'Searching <b>' + esc(E.basename(L.cwd)) + '</b> and its subfolders · <a class="mod-link" data-lib="search-everywhere" tabindex="0">Search everywhere</a>' : 'Searching all of <b>' + esc(V().vaultName) + '</b>') + '</span>' +
      '<span class="spacer"></span>' + (saved ? '<span class="q-saved">' + icon('bookmark', 'xs') + 'Saved search</span>' : '<a class="mod-link" data-lib="save-search" tabindex="0">' + icon('bookmark', 'xs') + 'Save this search</a>');
  }
  function renderHead() {
    const el = $('#libHead'); if (!el) return;
    const u = U();
    if (u.view === 'grid') { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.classList.add('show');
    el.innerHTML = L.vcols.map((k, i) => {
      const c = COLS[k], sorted = c.sort && u.sort === c.sort;
      const handle = i > 0 ? '<span class="lh-resize" data-colresize="' + k + '" aria-hidden="true"></span>' : '';
      const inner = '<span class="lh-label">' + c.label + '</span>' + (sorted ? icon(u.dir === 'desc' ? 'arrow-down' : 'arrow-up', 'xs') : '');
      return c.sort ? '<button class="lh-col lc-' + k + (sorted ? ' is-sorted' : '') + '" data-lib="sort" data-k="' + c.sort + '">' + handle + inner + '</button>'
        : '<div class="lh-col lc-' + k + '">' + handle + inner + '</div>';
    }).join('');
  }
  function renderProgress() {
    const el = $('#libProgress'); if (!el) return;
    const op = window.OnyxOps && window.OnyxOps.op;
    if (op && !L.run) {
      el.classList.add('show');
      const pct = op.total && op.total.bytes ? Math.round(op.done.bytes / op.total.bytes * 100) : 0;
      el.innerHTML = '<span class="spinner"></span><span>' + (op.mode === 'move' ? 'Moving' : 'Copying') + ' · ' + (op.total ? Math.min(op.done.files, op.total.files) + ' of ' + plural(op.total.files, 'file') + ' · ' + C.fmt(op.done.bytes) + ' of ' + C.fmt(op.total.bytes) : C.fmt(op.done.bytes)) + '</span>' +
        '<div class="lp-bar"><div style="width:' + pct + '%"></div></div><a class="mod-link" data-lib="cancel-op" tabindex="0">Cancel</a>';
      return;
    }
    if (!L.run) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.classList.add('show');
    const pct = L.run.of ? Math.round((L.run.batch - 1) / L.run.of * 100) : 0;
    el.innerHTML = '<span class="spinner"></span><span>' + (L.run.mode === 'ai' ? 'Tagging with AI' : 'Tagging') + (L.run.of > 1 ? ' · batch ' + L.run.batch + ' of ' + L.run.of : '') + '…</span>' +
      '<div class="lp-bar"><div style="width:' + pct + '%"></div></div>' + (L.run.mode === 'ai' ? '<a class="mod-link" data-lib="cancel-run" tabindex="0">Stop</a>' : '');
  }
  function renderFoot() {
    const el = $('#libFoot'); if (!el) return;
    const total = L.files.reduce((a, f) => a + f.size, 0) + L.dirs.reduce((a, d) => a + d.size, 0);
    const all = V().files.length;
    let h;
    if (browsing()) h = '<span>' + (L.dirs.length ? plural(L.dirs.length, 'folder') + ' · ' : '') + plural(L.files.length, 'file') + ' · ' + C.fmt(total) + '</span>';
    else if (BR()) h = '<span>' + (L.search && L.search.busy ? 'Searching…' : plural(L.files.length, 'result') + (L.search && L.search.truncated ? ' (stopped early: narrow your search to see more)' : '') + ' · ' + C.fmt(total)) + '</span>';
    else h = '<span>' + (L.files.length === all ? plural(all, 'file') : L.files.length + ' of ' + plural(all, 'file')) + ' · ' + C.fmt(total) + '</span>';
    const sf = selFiles();
    if (sf.length) h += '<span class="lf-sel">' + plural(sf.length, 'file') + ' selected · ' + C.fmt(sf.reduce((a, f) => a + f.size, 0)) + '</span>';
    const tagged = BR() ? Object.keys(tagState().files).length : V().files.filter(f => tagsOf(f.path).length).length;
    h += '<span class="spacer"></span><span class="muted">' + tagged + ' tagged' + (BR() ? ' here and below' : '') + '</span>';
    el.innerHTML = h;
  }

  function thumbKey(f, size) { return f.path + '|' + f.lastModified + '|' + size; }
  function thumbHTML(f, size, cls) {
    const ext = f.extension;
    const fallback = '<span class="ft-icon ft-' + esc(E.typeGroup(ext).replace(/\W+/g, '').toLowerCase()) + '">' + icon(window.fileIconName(ext)) + (ext ? '<span class="ft-ext">' + esc(ext.slice(0, 5)) + '</span>' : '') + '</span>';
    if (!U().thumbs || V().demo) return '<div class="' + cls + '">' + fallback + '</div>';
    const k = thumbKey(f, size);
    const t = L.thumbs.get(k);
    if (t) return '<div class="' + cls + (t.kind === 'icon' ? ' is-icon' : ' is-thumb') + '" data-thumb="' + esc(k) + '"><img src="' + t.url + '" alt="" draggable="false"></div>';
    if (t === undefined) requestThumb(f, size);
    return '<div class="' + cls + '" data-thumb="' + esc(k) + '">' + fallback + '</div>';
  }
  function requestThumb(f, size) {
    const k = thumbKey(f, size);
    if (L.thumbs.has(k) || L.queue.some(q => q.k === k)) return;
    L.queue.push({ k, f, size });
    pump();
  }
  function pump() {
    while (L.busy < 4 && L.queue.length) {
      const job = L.queue.pop();   // newest first: what's on screen now
      L.busy++;
      C.api.thumb(job.f.path, job.size).then(r => {
        L.thumbs.set(job.k, r || null);
        if (r) document.querySelectorAll('[data-thumb="' + CSS.escape(job.k) + '"]').forEach(el => {
          el.classList.add(r.kind === 'icon' ? 'is-icon' : 'is-thumb');
          el.innerHTML = '<img src="' + r.url + '" alt="" draggable="false">';
        });
      }).catch(() => L.thumbs.set(job.k, null)).finally(() => { L.busy--; pump(); });
    }
    if (L.queue.length > 200) L.queue.splice(0, L.queue.length - 200);
  }

  function rowHTML(r, y) {
    if (r.t === 'g') {
      const col = L.collapsed.has(r.key);
      const tag = r.key.startsWith('t:') && r.key.length > 2 ? r.key.slice(2) : null;
      return '<div class="lib-group' + (col ? ' is-collapsed' : '') + '" style="top:' + y + 'px" data-group="' + esc(r.key) + '">' + icon('chevron-down', 'xs') +
        (tag ? '<span class="lg-dot" style="background:' + tagColor(tag) + '"></span>' : '') + '<span class="lg-label">' + esc(r.label) + '</span><span class="lg-count">' + r.count + '</span><span class="lg-size">' + C.fmt(r.size) + '</span></div>';
    }
    if (r.t === 'tiles') {
      return '<div class="lib-tiles" style="top:' + y + 'px;grid-template-columns:repeat(' + L.cols + ',minmax(0,1fr))">' + r.files.map(f => {
        const sel = L.sel.has(f.path), foc = L.focus === f.path;
        if (f.isDir) return '<div class="lib-tile is-dir' + (sel ? ' is-selected' : '') + (foc ? ' is-focus' : '') + '" data-path="' + esc(f.path) + '" data-dir="1" role="option" aria-selected="' + sel + '" title="' + esc(f.path) + '">' +
          '<div class="lt-thumb lt-folder">' + icon('folder') + '</div><div class="lt-name">' + esc(f.name) + '</div><div class="lt-meta"><span>' + (BR() ? 'Folder' : f.opaque ? 'not scanned' : plural(f.count, 'file')) + '</span></div></div>';
        const tags = tagsOf(f.path);
        return '<div class="lib-tile' + (sel ? ' is-selected' : '') + (foc ? ' is-focus' : '') + '" data-path="' + esc(f.path) + '" draggable="true" role="option" aria-selected="' + sel + '" title="' + esc(f.path) + '">' +
          thumbHTML(f, 200, 'lt-thumb') + '<div class="lt-name">' + esc(f.name) + '</div>' +
          '<div class="lt-meta">' + (tags.length ? '<span class="lt-dots">' + tags.slice(0, 4).map(t => '<span style="background:' + tagColor(t) + '" title="#' + esc(t) + '"></span>').join('') + '</span>' : '') + '<span>' + C.fmt(f.size) + '</span></div></div>';
      }).join('') + '</div>';
    }
    const f = r.f;
    const sel = L.sel.has(f.path), foc = L.focus === f.path;
    const cols = L.vcols || ['name', 'modified', 'size'];
    const date = ts => '<div class="lr-date"' + (ts ? ' title="' + esc(ago(ts) + ' · ' + fullDate(ts)) + '"' : '') + '>' + esc(dateTime(ts)) + '</div>';
    if (f.isDir) {
      const pd = E.dirname(f.path);
      const what = BR() ? '' : f.opaque ? 'not scanned' : plural(f.count, 'file') + (f.sub ? ', ' + plural(f.sub, 'folder') : '');
      const cells = {
        name: '<div class="lr-name">' + icon('folder') + '<span class="lr-base">' + esc(f.name) + '</span></div>',
        tags: '<div class="lr-tags"></div>',
        type: '<div class="lr-type" title="' + esc(what) + '">Folder' + (what ? '<span class="lr-sub"> · ' + esc(what) + '</span>' : '') + '</div>',
        folder: '<div class="lr-folder">' + esc(pd || V().vaultName) + '</div>',
        modified: date(f.lastModified),
        size: '<div class="lr-size">' + (f.count && !BR() ? C.fmt(f.size) : '') + '</div>',
      };
      return '<div class="lib-row is-dir' + (sel ? ' is-selected' : '') + (foc ? ' is-focus' : '') + '" style="top:' + y + 'px" data-path="' + esc(f.path) + '" data-dir="1" draggable="true" role="option" aria-selected="' + sel + '">' + cols.map(k => cells[k]).join('') + '</div>';
    }
    const { base, ext } = splitName(f.name);
    const tags = tagsOf(f.path);
    const dir = E.dirname(f.path);
    const cells = {
      name: '<div class="lr-name">' + icon(window.fileIconName(f.extension)) + '<span class="lr-base">' + esc(base) + '</span>' + (ext ? '<span class="lr-ext">.' + esc(ext) + '</span>' : '') + '</div>',
      tags: '<div class="lr-tags"' + (tags.length ? ' title="' + esc(tags.map(x => '#' + x).join('  ')) + '"' : '') + '>' + tagCell(f) + '</div>',
      type: '<div class="lr-type">' + esc(typeLabel(f)) + '</div>',
      folder: '<div class="lr-folder" title="' + esc(dir || V().vaultName) + '">' + esc(dir || V().vaultName) + '</div>',
      modified: date(f.lastModified),
      size: '<div class="lr-size">' + C.fmt(f.size) + '</div>',
    };
    return '<div class="lib-row' + (sel ? ' is-selected' : '') + (foc ? ' is-focus' : '') + '" style="top:' + y + 'px" data-path="' + esc(f.path) + '" draggable="true" role="option" aria-selected="' + sel + '">' + cols.map(k => cells[k]).join('') + '</div>';
  }
  function firstVisible(top) {
    let lo = 0, hi = L.rows.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L.offsets[mid] <= top) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function paint() {
    const sc = $('#libScroll'), canvas = $('#libCanvas');
    if (!sc || !canvas) return;
    canvas.style.height = L.total + 'px';
    if (!L.rows.length) {
      const v = V();
      if (BR()) {
        const k = L.cwd.toLowerCase();
        let msg = '', ic = 'folder-open', spin = false;
        if (L.query.trim() && L.search && L.search.busy) { msg = 'Searching ' + esc(L.cwd ? E.basename(L.cwd) : v.vaultName) + '…'; spin = true; }
        else if (!L.query.trim() && !L.loaded.has(k)) { msg = 'Loading…'; spin = true; }
        else if (!L.query.trim() && L.listErr.has(k)) { msg = esc(L.listErr.get(k)); ic = 'eye-off'; }
        if (msg) { canvas.innerHTML = '<div class="lib-empty">' + (spin ? '<span class="spinner"></span>' : icon(ic)) + '<div>' + msg + '</div></div>'; return; }
      }
      const empty = !L.query.trim() ? 'This folder is empty.' : 'No files match <b>' + esc(L.query) + '</b>' + (L.cwd ? ' in ' + esc(E.basename(L.cwd)) + '. <a class="mod-link" data-lib="search-everywhere">Search everywhere</a>' : '.');
      canvas.innerHTML = '<div class="lib-empty">' + icon(L.query.trim() ? 'search' : 'folder-open') + '<div>' + empty + '</div>' + (L.query ? '<button class="btn small" data-lib="clear">Clear search</button>' : '') +
        (L.query ? '<div class="lib-help">Search tips: <code>#invoice</code> <code>-#draft</code> <code>type:pdf,docx</code> <code>kind:image</code> <code>size:&gt;50mb</code> <code>modified:&lt;30d</code> <code>modified:2024</code> <code>in:Documents</code> <code>is:untagged</code> <code>is:duplicate</code></div>' : '') + '</div>';
      return;
    }
    const top = Math.max(0, sc.scrollTop - OVERSCAN), bottom = sc.scrollTop + sc.clientHeight + OVERSCAN;
    let i = firstVisible(top);
    let h = '';
    for (; i < L.rows.length && L.offsets[i] < bottom; i++) h += rowHTML(L.rows[i], L.offsets[i]);
    const O = window.OnyxOps;
    if (O) O.beforePaint();
    canvas.innerHTML = h;
    if (O) O.afterPaint();
  }

  // ------------------------------------------------------------------ details panel
  function renderDetails() {
    const el = $('#libDetails'); if (!el) return;
    if (!U().details) { el.innerHTML = ''; return; }
    const prevInput = el.querySelector('#libTagInput');
    const keepFocus = prevInput && document.activeElement === prevInput;
    const files = selFiles();
    const VW = window.OnyxViewer;
    if (VW && VW.docked && files.length === 1 && files[0].path !== VW.path) VW.follow(files[0].path);
    const more = '<button class="clickable-icon ld-more" data-lib="details-more" aria-label="More actions" data-tip="More actions">' + icon('more-horizontal') + '</button>';
    let h = '';
    const selDir = !files.length && L.sel.size === 1 ? dirBy([...L.sel][0]) : null;
    if (selDir) {
      h += '<div class="ld-preview ld-folder">' + icon('folder') + '</div><div class="ld-name">' + esc(selDir.name) + '</div><div class="ld-meta">Folder</div>';
      h += '<div class="ld-actions"><button class="btn small mod-cta" data-lib="enter">' + icon('folder-open') + 'Open</button>' + more + '</div>';
      h += '<div class="ld-section ld-props">' + (BR() ? prop('folder', 'Location', esc(absPath(selDir.path)))
        : prop('files', 'Contains', esc(plural(selDir.count, 'file') + (selDir.sub ? ', ' + plural(selDir.sub, 'folder') : ''))) + prop('hard-drive', 'Size', C.fmt(selDir.size))) +
        (selDir.lastModified ? prop('clock', 'Modified', esc(dateTime(selDir.lastModified))) : '') + '</div>';
      if (BR()) h += '<div class="ld-section"><button class="btn small block" data-lib="organize-dir">' + icon('sparkles') + 'Organize this folder…</button><div class="ld-hint">Opens it on its own so Onyx can plan a tidy structure.</div></div>';
      else { const n = filesInside(selDir.path).length; if (n) h += '<div class="ld-section"><button class="btn small block" data-lib="tag-dir">' + icon('tag') + 'Tag the ' + plural(n, 'file') + ' inside…</button></div>'; }
      el.innerHTML = h;
      return;
    }
    if (!files.length) {
      const dirsHere = browsing() ? L.dirs : [];
      const total = L.files.reduce((a, f) => a + f.size, 0) + (BR() ? 0 : dirsHere.reduce((a, d) => a + d.size, 0));
      const title = L.query.trim() ? 'Search results' : L.cwd ? E.basename(L.cwd) : V().vaultName;
      h += '<div class="ld-empty"><div class="ld-empty-title">' + esc(title) + '</div><div class="ld-empty-sub">' + (dirsHere.length ? plural(dirsHere.length, 'folder') + ', ' : '') + plural(L.files.length, 'file') + (total ? ' · ' + C.fmt(total) : '') + '</div>' +
        '<div class="ld-empty-hint">' + icon('mouse-pointer', 'xs') + '<span>Select a file to preview and tag it.</span></div></div>';
      el.innerHTML = h;
      return;
    }
    if (files.length === 1) {
      const f = files[0];
      const tags = tagsOf(f.path), auto = new Set(autoOf(f.path));
      const it = C.S.plan ? C.S.plan.items.find(i => i.source === f.path) : null;
      const can = VW && VW.canPreview(f) && !V().demo;
      const extra = can ? VW.detailsPreview(f) : null;
      if (extra && extra.replace) h += '<div class="ld-ext">' + extra.html + '</div>';
      else h += thumbHTML(f, 320, 'ld-preview');
      if (extra && !extra.replace) h += '<div class="ld-ext">' + extra.html + '</div>';
      h += '<div class="ld-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div><div class="ld-meta">' + esc(typeLabel(f)) + ' · ' + C.fmt(f.size) + '</div>';
      h += '<div class="ld-actions">' + (can ? '<button class="btn small mod-cta" data-lib="preview" data-tip="Preview in Onyx (Space)">' + icon('eye') + 'Preview</button><button class="btn small" data-lib="open" data-tip="Open in its own app">' + icon('external-link') + 'Open</button>'
        : '<button class="btn small mod-cta" data-lib="open">' + icon('external-link') + 'Open</button>') + more + '</div>';
      h += '<div class="ld-section"><div class="ld-title">Tags</div><div class="ld-chips">' + (tags.length ? tags.map(t => chip(t, { auto: auto.has(t), x: true, tip: true })).join('') : '<span class="muted small">No tags yet</span>') + '</div>' + tagInput() +
        '<div class="ld-tag-actions"><a class="mod-link" data-lib="tag-ai-sel" tabindex="0">' + icon('sparkles', 'xs') + 'Suggest with AI</a>' + (auto.size ? '<a class="mod-link" data-lib="retag-ai-sel" tabindex="0" data-tip="Replace the automatic tags with fresh ones">' + icon('refresh-cw', 'xs') + 'Re-tag</a>' : '') + '</div></div>';
      h += '<div class="ld-section ld-props">' +
        prop('folder', 'Folder', '<a class="mod-link" data-lib="go" data-p="' + esc(E.dirname(f.path)) + '" data-sel="' + esc(f.path) + '">' + esc(E.dirname(f.path) || V().vaultName) + '</a>') +
        prop('clock', 'Modified', '<span title="' + esc(ago(f.lastModified)) + '">' + esc(dateTime(f.lastModified)) + '</span>') +
        (dupSet().has(f.path) ? prop('copy', 'Duplicate', '<a class="mod-link" data-lib="query" data-q="&quot;' + esc(f.name) + '&quot;">Show copies</a>') : '') +
        (it && it.kind === 'move' && !it.skip ? prop('folder-input', 'Plan', 'Moves to ' + esc(E.dirname(it.target) || V().vaultName)) : '') +
        '</div>';
    } else {
      const counts = new Map();
      for (const x of files) for (const t of tagsOf(x.path)) counts.set(t, (counts.get(t) || 0) + 1);
      const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      h += '<div class="ld-stack">' + files.slice(0, 3).map((x, i) => thumbHTML(x, 160, 'ld-stack-card ld-stack-' + i)).join('') + '</div>';
      h += '<div class="ld-name">' + plural(files.length, 'file') + ' selected</div><div class="ld-meta">' + C.fmt(files.reduce((a, x) => a + x.size, 0)) + '</div>';
      h += '<div class="ld-actions"><button class="btn small mod-cta" data-lib="move-to">' + icon('folder-input') + 'Move to…</button><button class="btn small" data-lib="delete-sel">' + icon('trash') + 'Delete</button>' + more + '</div>';
      h += '<div class="ld-section"><div class="ld-title">Tags</div><div class="ld-chips">' + (list.length ? list.map(([t, n]) => chip(t, { count: n === files.length ? '' : n + '/' + files.length, x: true, cls: n === files.length ? '' : 'is-partial' })).join('') : '<span class="muted small">None of these have tags</span>') + '</div>' + tagInput() +
        '<div class="ld-tag-actions"><a class="mod-link" data-lib="tag-ai-sel" tabindex="0">' + icon('sparkles', 'xs') + 'Tag with AI</a><a class="mod-link" data-lib="retag-ai-sel" tabindex="0">' + icon('refresh-cw', 'xs') + 'Re-tag</a></div></div>';
    }
    el.innerHTML = h;
    if (files.length === 1 && VW && VW.canPreview(files[0]) && !V().demo) { const pv = el.querySelector('.ld-preview'); if (pv) { pv.dataset.lib = 'preview'; pv.classList.add('is-previewable'); pv.dataset.tip = 'Preview (Space)'; } }
    if (VW) VW.afterDetails(files.length === 1 ? files[0] : null);
    if (keepFocus) { const n = el.querySelector('#libTagInput'); if (n) n.focus(); }
  }
  function prop(ic, k, v) { return '<div class="ld-prop"><span class="ld-k">' + icon(ic, 'xs') + esc(k) + '</span><span class="ld-v">' + v + '</span></div>'; }
  function tagInput() {
    return '<div class="tag-input"><span class="ti-hash">#</span><input id="libTagInput" placeholder="Add a tag and press Enter" spellcheck="false" autocomplete="off" aria-label="Add a tag"><div class="ti-suggest" id="libTagSuggest" role="listbox"></div></div>';
  }
  let sugg = [], suggSel = 0;
  function drawSuggest(input) {
    const box = $('#libTagSuggest'); if (!box) return;
    const q = TG.normTag(input.value);
    const files = selFiles();
    const onAll = t => files.every(f => tagsOf(f.path).includes(t));
    const counts = vocab();
    const all = [...counts.keys()].filter(t => !onAll(t));
    sugg = [];
    if (q) {
      const ranked = all.map(t => ({ t, r: C.fuzzy(q, t) })).filter(x => x.r).sort((a, b) => b.r.score - a.r.score || (counts.get(b.t) - counts.get(a.t)));
      if (!counts.has(q)) sugg.push({ t: q, html: 'Create <b>#' + esc(q) + '</b>', create: true });
      for (const x of ranked.slice(0, 7)) sugg.push({ t: x.t, html: '#' + x.r.html, n: counts.get(x.t) });
    } else for (const t of all.sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 7)) sugg.push({ t, html: '#' + esc(t), n: counts.get(t) });
    suggSel = Math.min(suggSel, Math.max(0, sugg.length - 1));
    if (!sugg.length || document.activeElement !== input) { box.classList.remove('show'); box.innerHTML = ''; return; }
    box.classList.add('show');
    box.innerHTML = sugg.map((s, i) => '<div class="ti-item' + (i === suggSel ? ' is-selected' : '') + '" data-sugg="' + i + '"><span class="tc-dot" style="background:' + tagColor(s.t) + '"></span><span>' + s.html + '</span>' + (s.n ? '<span class="muted">' + s.n + '</span>' : '') + '</div>').join('');
  }
  function onDetailsInput(e) { if (e.target.id === 'libTagInput') { suggSel = 0; drawSuggest(e.target); } }
  function onDetailsKey(e) {
    const input = e.target.closest && e.target.closest('#libTagInput');
    if (!input) return;
    if (e.key === 'ArrowDown') { suggSel = (suggSel + 1) % Math.max(1, sugg.length); drawSuggest(input); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { suggSel = (suggSel - 1 + sugg.length) % Math.max(1, sugg.length); drawSuggest(input); e.preventDefault(); }
    else if (e.key === 'Enter' || (e.key === 'Tab' && input.value)) {
      e.preventDefault();
      const s = sugg[suggSel];
      const t = s && (input.value || e.key === 'Enter') ? s.t : TG.normTag(input.value);
      if (t) { input.value = ''; addTags([...L.sel], [t]).then(() => { const n = $('#libTagInput'); if (n) { n.focus(); drawSuggest(n); } }); }
    } else if (e.key === 'Escape') { input.value = ''; input.blur(); const b = $('#libTagSuggest'); if (b) b.classList.remove('show'); e.stopPropagation(); }
    else if (e.key === 'Backspace' && !input.value && L.sel.size === 1) {
      const p = [...L.sel][0]; const tags = tagsOf(p);
      if (tags.length) { removeTag([p], tags[tags.length - 1]).then(() => { const n = $('#libTagInput'); if (n) n.focus(); }); e.preventDefault(); }
    }
  }
  document.addEventListener('focusin', e => { if (e.target && e.target.id === 'libTagInput') drawSuggest(e.target); });
  document.addEventListener('focusout', e => { if (e.target && e.target.id === 'libTagInput') setTimeout(() => { const b = $('#libTagSuggest'); if (b && document.activeElement !== e.target) b.classList.remove('show'); }, 150); });
  document.addEventListener('mousedown', e => {
    const it = e.target.closest && e.target.closest('[data-sugg]');
    if (!it) return;
    e.preventDefault();
    const s = sugg[+it.dataset.sugg];
    const input = $('#libTagInput');
    if (s) { if (input) input.value = ''; addTags([...L.sel], [s.t]).then(() => { const n = $('#libTagInput'); if (n) { n.focus(); drawSuggest(n); } }); }
  });

  // ------------------------------------------------------------------ selection + interaction
  function rowEl(path) { return document.querySelector('#libCanvas [data-path="' + CSS.escape(path) + '"]'); }
  function setSingle(path) { L.sel = new Set([path]); L.focus = path; L.anchor = path; afterSelect(); }
  function afterSelect(scroll) {
    if (scroll !== false && L.focus) ensureVisible(L.focus);
    // update highlight in place: replacing the rows would break double-click (both clicks must hit the same element)
    const canvas = $('#libCanvas');
    if (canvas) canvas.querySelectorAll('[data-path]').forEach(el => {
      const p = el.dataset.path, sel = L.sel.has(p);
      el.classList.toggle('is-selected', sel); el.classList.toggle('is-focus', L.focus === p); el.setAttribute('aria-selected', sel);
    });
    renderFoot(); renderDetails(); renderCmd();
  }
  function indexOfPath(p) { return (L.order || L.files).findIndex(f => f.path === p); }
  function ensureVisible(path) {
    const sc = $('#libScroll'); if (!sc) return;
    let ri = -1;
    for (let i = 0; i < L.rows.length; i++) {
      const r = L.rows[i];
      if ((r.t === 'f' && r.f.path === path) || (r.t === 'tiles' && r.files.some(f => f.path === path))) { ri = i; break; }
    }
    if (ri < 0) return;
    const y = L.offsets[ri], h = L.rows[ri].h;
    if (y < sc.scrollTop + 4) sc.scrollTop = y - 4;
    else if (y + h > sc.scrollTop + sc.clientHeight - 4) sc.scrollTop = y + h - sc.clientHeight + 4;
  }
  function clickSelect(path, e) {
    if (e.shiftKey && L.anchor && indexOfPath(L.anchor) >= 0) {
      const a = indexOfPath(L.anchor), b = indexOfPath(path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        if (!(e.ctrlKey || e.metaKey)) L.sel.clear();
        for (let i = lo; i <= hi; i++) L.sel.add(L.order[i].path);
      }
      L.focus = path;
    } else if (e.ctrlKey || e.metaKey) {
      if (L.sel.has(path)) L.sel.delete(path); else L.sel.add(path);
      L.focus = path; L.anchor = path;
    } else { L.sel = new Set([path]); L.focus = path; L.anchor = path; }
    afterSelect(false);
  }
  function onClick(e) {
    const rm = e.target.closest('[data-tag-remove]');
    if (rm) { e.stopPropagation(); removeTag([...L.sel], rm.dataset.tagRemove); return; }
    const a = e.target.closest('[data-lib]');
    if (a) { e.preventDefault(); act(a.dataset.lib, a, e); return; }
    const ch = e.target.closest('.tag-chip.is-link[data-tag]');
    if (ch) { e.stopPropagation(); toggleTagQuery(ch.dataset.tag, e.ctrlKey || e.metaKey || e.shiftKey); return; }
    const g = e.target.closest('.lib-group');
    if (g) { const k = g.dataset.group; if (L.collapsed.has(k)) L.collapsed.delete(k); else L.collapsed.add(k); buildRows(); paint(); return; }
    const r = e.target.closest('.lib-row, .lib-tile');
    if (r) { clickSelect(r.dataset.path, e); $('#libScroll').focus({ preventScroll: true }); return; }
    if (e.target.closest('#libScroll') && !e.target.closest('.lib-empty')) { L.sel.clear(); L.focus = null; afterSelect(false); }
  }
  function onDblClick(e) {
    const r = e.target.closest('.lib-row, .lib-tile');
    if (!r) return;
    if (r.dataset.dir) { go(r.dataset.path); return; }
    defaultAction(r.dataset.path);
  }
  // double-click and Enter: preview in Onyx when an extension can show it (the default), open it, or show it in its folder
  function defaultAction(path) {
    const d = U().dblClick, VW = window.OnyxViewer;
    if (d === 'reveal') reveal(path);
    else if (d === 'preview' && VW && VW.canPreview(fileBy(path))) VW.open(path);
    else openFile(path);
  }
  function onContext(e) {
    const r = e.target.closest('.lib-row, .lib-tile');
    const ch = e.target.closest('.tag-chip[data-tag]');
    if (ch) { e.preventDefault(); e.stopPropagation(); C.showMenu(tagMenuItems(ch.dataset.tag), e.clientX, e.clientY); return; }
    if (!r) {
      // empty space in the list: Explorer's background menu
      if (e.target.closest('#libScroll') && window.OnyxOps) { e.preventDefault(); e.stopPropagation(); L.sel.clear(); L.focus = null; afterSelect(false); C.showMenu(window.OnyxOps.backgroundMenu(), e.clientX, e.clientY); }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (!L.sel.has(r.dataset.path)) { L.sel = new Set([r.dataset.path]); L.focus = r.dataset.path; L.anchor = r.dataset.path; afterSelect(false); }
    menuAt = { x: e.clientX, y: e.clientY };
    C.showMenu(window.OnyxOps ? window.OnyxOps.itemMenu() : r.dataset.dir ? dirMenuItems(r.dataset.path) : fileMenuItems(), e.clientX, e.clientY);
  }
  let menuAt = { x: 200, y: 200 };
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const list = L.order || L.files;
    if (!list.length) return;
    const grid = U().view === 'grid';
    const i = L.focus ? indexOfPath(L.focus) : -1;
    const step = grid ? L.cols : 1;
    let next = null;
    const k = e.key;
    if (k === 'ArrowDown') next = i < 0 ? 0 : Math.min(list.length - 1, i + step);
    else if (k === 'ArrowUp') next = i < 0 ? 0 : Math.max(0, i - step);
    else if (k === 'ArrowRight' && grid) next = Math.min(list.length - 1, i + 1);
    else if (k === 'ArrowLeft' && grid) next = Math.max(0, i - 1);
    else if (k === 'Home') next = 0;
    else if (k === 'End') next = list.length - 1;
    else if (k === 'PageDown') next = Math.min(list.length - 1, Math.max(0, i) + Math.floor(($('#libScroll').clientHeight / (grid ? tileH() : ROW))) * step);
    else if (k === 'PageUp') next = Math.max(0, Math.max(0, i) - Math.floor(($('#libScroll').clientHeight / (grid ? tileH() : ROW))) * step);
    if (e.altKey) return;      // Alt+arrows are back / forward / up
    if (next != null) {
      e.preventDefault(); e.stopPropagation();
      const p = list[next].path;
      const a = L.anchor ? indexOfPath(L.anchor) : -1;
      if (e.shiftKey && a >= 0) {
        const [lo, hi] = a < next ? [a, next] : [next, a];
        L.sel = new Set(list.slice(lo, hi + 1).map(f => f.path)); L.focus = p;
      } else if (e.ctrlKey || e.metaKey) L.focus = p;
      else { L.sel = new Set([p]); L.focus = p; L.anchor = p; }
      afterSelect();
      return;
    }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); selectAll(); return; }
    if (k === ' ' && L.focus && !mod && !e.shiftKey && window.OnyxViewer && fileBy(L.focus)) { e.preventDefault(); e.stopPropagation(); window.OnyxViewer.toggle(L.focus); return; }
    if (k === ' ' && L.focus && mod) { e.preventDefault(); if (L.sel.has(L.focus)) L.sel.delete(L.focus); else L.sel.add(L.focus); afterSelect(false); return; }
    if (k === 'Enter' && L.focus) { e.preventDefault(); e.stopPropagation(); if (dirBy(L.focus) && !fileBy(L.focus)) go(L.focus); else if (e.shiftKey) reveal(L.focus); else if (mod) openFile(L.focus); else defaultAction(L.focus); return; }
    if (k === 'Backspace' && !mod) { e.preventDefault(); e.stopPropagation(); back(); return; }
    if (k === 'Escape') { if (L.sel.size) { e.preventDefault(); e.stopPropagation(); L.sel.clear(); afterSelect(false); } return; }
    if (k === '#' || (k === '3' && e.shiftKey)) { e.preventDefault(); tagEditor(); return; }
    if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      e.preventDefault();
      if (!L.sel.size && L.focus) L.sel.add(L.focus);
      const r = L.focus && rowEl(L.focus); const b = r ? r.getBoundingClientRect() : $('#libScroll').getBoundingClientRect();
      menuAt = { x: b.left + 30, y: b.bottom };
      C.showMenu(window.OnyxOps ? (L.sel.size ? window.OnyxOps.itemMenu() : window.OnyxOps.backgroundMenu()) : fileMenuItems(), b.left + 30, b.bottom, { keyboard: true });
      return;
    }
    if (!mod && !e.altKey && k.length === 1 && /\S/.test(k)) {
      // type-ahead: jump to the next file starting with that letter
      const from = Math.max(0, i + 1), lk = k.toLowerCase();
      const hit = list.slice(from).concat(list.slice(0, from)).find(f => f.name.toLowerCase().startsWith(lk));
      if (hit) { e.preventDefault(); setSingle(hit.path); }
    }
  }
  function onDragStart(e) {
    const r = e.target.closest('.lib-row, .lib-tile');
    if (!r) return;
    if (!L.sel.has(r.dataset.path)) { L.sel = new Set([r.dataset.path]); L.focus = r.dataset.path; afterSelect(false); }
    const paths = selection();
    if (window.OnyxOps && window.OnyxOps.dragStart(e, paths)) return;
    e.dataTransfer.setData('application/x-onyx-files', JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.effectAllowed = 'all';
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = paths.length === 1 ? E.basename(paths[0]) : plural(paths.length, 'file');
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 12);
    setTimeout(() => ghost.remove(), 0);
    document.body.classList.add('dragging-files');
  }
  document.addEventListener('dragend', () => document.body.classList.remove('dragging-files'));

  function act(name, el, e) {
    const u = U();
    if (name === 'clear') { L.query = ''; const i = $('#libSearch'); if (i) { i.value = ''; i.focus(); } refresh(); }
    else if (name === 'mode') setPref('view', el.dataset.v);
    else if (name === 'browse') { L.query = L.query; cache = null; setPref('browse', el.dataset.v); }
    else if (name === 'go') go(el.dataset.p || '', { select: el.dataset.sel || null });
    else if (name === 'back') back();
    else if (name === 'forward') forward();
    else if (name === 'up') up();
    else if (name === 'enter') { const d = [...L.sel][0]; if (d) go(d); }
    else if (name === 'places') { if (C.openPlaces) C.openPlaces(); }
    else if (name === 'organize-dir') { const d = [...L.sel][0]; if (d) organizeDir(d); }
    else if (name === 'reveal-dir') { const d = [...L.sel][0]; if (d) revealDir(d); }
    else if (name === 'tag-dir') { const d = [...L.sel][0]; if (d) tagEditor(filesInside(d)); }
    else if (name === 'search-everywhere') { const q = L.query; L.hist.push(L.cwd); L.fwd = []; L.cwd = ''; L.query = q; refresh(); renderTagsPanel(); }
    else if (name === 'details') setPref('details', !u.details);
    else if (name === 'sort' && L.resizing) { /* the end of a column resize */ }
    else if (name === 'sort') { if (u.sort === el.dataset.k) setPref('dir', u.dir === 'asc' ? 'desc' : 'asc'); else { C.setUi('library', 'dir', el.dataset.k === 'name' || el.dataset.k === 'folder' || el.dataset.k === 'type' ? 'asc' : 'desc'); setPref('sort', el.dataset.k); } }
    else if (name === 'sort-menu') sortMenu(el);
    else if (name === 'group-menu') {
      const b = el.getBoundingClientRect();
      const items = [{ heading: 'Group by' }];
      for (const [k, l, ic] of [['none', 'Nothing', 'list'], ['tag', 'Tag', 'tag'], ['folder', 'Folder', 'folder'], ['kind', 'Kind', 'layers'], ['date', 'Date modified', 'calendar']]) items.push({ label: l, icon: ic, check: u.group === k, action: () => { L.collapsed.clear(); setPref('group', k); } });
      C.showMenu(items, b.left, b.bottom + 4);
    } else if (name === 'drop-token') {
      const toks = TG.tokenize(L.query); toks.splice(+el.dataset.i, 1);
      L.query = toks.map(t => /\s/.test(t) && !/^"/.test(t) ? '"' + t + '"' : t).join(' '); refresh();
    } else if (name === 'save-search') saveSearch();
    else if (name === 'query') { L.query = el.dataset.q; refresh(); }
    else if (name === 'open') { if (L.focus || L.sel.size) openFile(L.focus || [...L.sel][0]); }
    else if (name === 'preview') { const p = L.focus && fileBy(L.focus) ? L.focus : selFiles().map(f => f.path)[0]; if (p && window.OnyxViewer) window.OnyxViewer.open(p); }
    else if (name === 'reveal') { if (L.focus || L.sel.size) reveal(L.focus || [...L.sel][0]); }
    else if (name === 'copy') { C.api.copyText([...L.sel].map(p => V().rootPath ? V().rootPath.replace(/[\\/]+$/, '') + (V().rootPath.includes('\\') ? '\\' + p.replace(/\//g, '\\') : '/' + p) : p).join('\n')); C.notice('Copied ' + (L.sel.size === 1 ? 'path' : plural(L.sel.size, 'path')), 'success', 1800); }
    else if (name === 'tag-ai-sel') autoTag('ai', { paths: selFiles().map(f => f.path) });
    else if (name === 'retag-ai-sel') autoTag('ai', { paths: selFiles().map(f => f.path), retag: true });
    else if (name === 'tag-rules-sel') autoTag('rules', { paths: [...L.sel] });
    else if (name === 'cancel-run') { C.api.tagsCancel(); C.notice('Stopping after the current batch…', '', 2500); }
    else if (name === 'cancel-op') { if (window.OnyxOps) window.OnyxOps.cancelOp(); }
    else if (name === 'move-to') { if (window.OnyxOps) window.OnyxOps.moveTo(); }
    else if (name === 'delete-sel') { if (window.OnyxOps) window.OnyxOps.del(false); }
    else if (name === 'details-more') { const b = el.getBoundingClientRect(); menuAt = { x: b.left, y: b.bottom + 4 }; C.showMenu(window.OnyxOps ? window.OnyxOps.detailsMenu() : [], b.right - 230, b.bottom + 4); }
    else if (name === 'refresh') reloadNow();
    else if (name === 'view-menu') viewMenu(el);
    else if (name === 'tag-menu') autoTagMenu(el, true);
    else if (name === 'op') {
      const O = window.OnyxOps; if (!O) return;
      const op = el.dataset.op;
      if (op === 'new') O.newMenu(el);
      else if (op === 'cut') O.toClipboard('move');
      else if (op === 'copy') O.toClipboard('copy');
      else if (op === 'paste') O.pasteHere();
      else if (op === 'rename') O.startRename();
      else if (op === 'delete') O.del(e && e.shiftKey);
      else if (op === 'undo') O.undo();
      else if (op === 'more') O.moreMenu(el);
    }
  }
  function sortItems() {
    const u = U();
    const items = [{ heading: 'Sort by' }];
    for (const [k, l, d, ic] of [['name', 'Name', 'asc', 'file'], ['modified', 'Date modified', 'desc', 'clock'], ['size', 'Size', 'desc', 'hard-drive'], ['type', 'Type', 'asc', 'layers'], ['folder', 'Folder', 'asc', 'folder']]) items.push({ label: l, icon: ic, check: u.sort === k, action: () => { C.setUi('library', 'dir', d); setPref('sort', k); } });
    items.push({ label: u.dir === 'asc' ? 'Ascending' : 'Descending', icon: u.dir === 'asc' ? 'arrow-up' : 'arrow-down', sub: 'click to flip', action: () => setPref('dir', u.dir === 'asc' ? 'desc' : 'asc') });
    items.push({ heading: 'Group by' });
    for (const [k, l, ic] of [['none', 'Nothing', 'list'], ['tag', 'Main tag', 'tag'], ['folder', 'Folder', 'folder'], ['kind', 'Kind', 'layers'], ['date', 'Date modified', 'calendar']]) items.push({ label: l, icon: ic, check: u.group === k, action: () => { L.collapsed.clear(); setPref('group', k); } });
    return items;
  }
  function sortMenu(el) {
    const b = el ? el.getBoundingClientRect() : { left: menuAt.x, bottom: menuAt.y - 4 };
    C.showMenu(sortItems(), b.left, b.bottom + 4);
  }
  function viewMenu(el) {
    const b = el ? el.getBoundingClientRect() : { left: menuAt.x, bottom: menuAt.y - 4 };
    C.showMenu(viewItems(), b.left, b.bottom + 4);
  }
  function viewItems() {
    const u = U();
    const items = [{ heading: 'Layout' },
      { label: 'List', icon: 'list', check: u.view !== 'grid', action: () => setPref('view', 'list') },
      { label: 'Grid with previews', icon: 'layout-grid', check: u.view === 'grid', action: () => setPref('view', 'grid') }];
    if (!BR()) items.push({ heading: 'Show' },
      { label: 'Folder by folder', icon: 'folder', check: u.browse !== 'flat', action: () => { cache = null; setPref('browse', 'folders'); } },
      { label: 'Every file inside, in one list', icon: 'files', check: u.browse === 'flat', action: () => { cache = null; setPref('browse', 'flat'); } });
    if (u.view === 'grid') items.push({ heading: 'Size' }, ...[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, l]) => ({ label: l, icon: 'layout-grid', check: (u.tile || 'm') === k, action: () => setPref('tile', k) })));
    else items.push({ label: 'Columns', icon: 'list', submenu: () => columnItems() });
    items.push('sep',
      { label: 'Tag names as chips', icon: 'tag', check: u.tagStyle === 'chips', action: () => setPref('tagStyle', u.tagStyle === 'chips' ? 'dots' : 'chips') },
      { label: 'Details pane', icon: 'panel-right', check: u.details, action: () => setPref('details', !u.details) },
      { label: 'Thumbnails', icon: 'image', check: u.thumbs, action: () => { L.thumbs.clear(); setPref('thumbs', !u.thumbs); } });
    return items;
  }
  function columnItems() {
    const p = colPrefs();
    const items = [{ heading: 'Columns' }];
    for (const k of ['tags', 'type', 'modified', 'size']) items.push({ label: COLS[k].label, check: p[k] !== false, action: () => setPref('cols', Object.assign({}, p, { [k]: p[k] === false })) });
    items.push('sep', { label: 'Reset column widths', icon: 'rotate-ccw', action: () => setPref('colw', {}) });
    return items;
  }
  function columnsMenu(x, y) { C.showMenu(columnItems(), x, y);
  }
  function reloadNow() {
    const v = V(); if (!v) return;
    if (v.browse) { const k = L.cwd.toLowerCase(); L.loaded.delete(k); L.listErr.delete(k); ensureListed(L.cwd); C.notice('Refreshed', '', 1200); return; }
    if (C.rescan) C.rescan();
  }

  // ------------------------------------------------------------------ actions on files
  async function openFile(path) {
    const v = V(); if (!v) return;
    if (v.demo) { C.notice('The demo folder only exists in memory, so there’s nothing to open. Open a real folder to open files.', 'warn', 4500); return; }
    const go = async () => { const r = await C.api.openFile(path); if (r && r.error) C.notice(esc(r.error), 'error'); else pushRecent(path); };
    if (EXEC.test(path)) C.confirmModal('Run this program?', '<p><b>' + esc(E.basename(path)) + '</b> is a program or script. Only run it if you trust where it came from.</p>', 'Run', go, true);
    else go();
  }
  function reveal(path) { if (V().demo) { C.notice('The demo folder only exists in memory.', 'warn', 2500); return; } C.api.reveal(path); }
  async function addTags(paths, tags) {
    if (!paths.length || !tags.length) return;
    const view = await C.api.tagsEdit(paths, tags, []);
    V().tags = view; changed();
  }
  async function removeTag(paths, tag) {
    if (!paths.length) return;
    const view = await C.api.tagsEdit(paths, [], [tag]);
    V().tags = view; changed();
  }
  function changed() { rankCols = null; refresh(); renderTagsPanel(); if (C.renderExplorer) C.renderExplorer(); }
  function toggleTagQuery(tag, additive) {
    const toks = TG.tokenize(L.query);
    const isTag = t => /^#|^tags?:/i.test(t) && TG.normTag(t.replace(/^tags?:/i, '')) === tag;
    let next;
    if (toks.some(isTag)) next = toks.filter(t => !isTag(t));
    else if (additive) next = toks.concat(['#' + tag]);
    else next = toks.filter(t => !/^-?(#|tags?:)/i.test(t)).concat(['#' + tag]);
    if (L.cwd) { L.hist.push(L.cwd); L.fwd = []; L.cwd = ''; }
    L.query = next.join(' ');
    showLibrary();
  }
  function setQuery(q) { if (L.cwd) { L.hist.push(L.cwd); L.fwd = []; L.cwd = ''; } L.query = q; showLibrary(); }
  function showLibrary() {
    if (!C.WS.isVisible('library')) C.WS.activate('library');
    const sc = $('#libScroll'); if (sc) sc.scrollTop = 0;
    refresh(); renderTagsPanel();
  }
  function fileMenuItems() {
    const files = selFiles();
    const one = files.length === 1 ? files[0] : null;
    const items = [];
    if (one) {
      items.push({ label: 'Open', icon: 'external-link', sub: hk('Enter'), action: () => openFile(one.path) });
      items.push({ label: 'Show in system explorer', icon: 'folder-open', action: () => reveal(one.path) });
    }
    items.push({ label: one ? 'Copy path' : 'Copy ' + files.length + ' paths', icon: 'copy', action: () => act('copy') });
    items.push('sep');
    items.push({ label: 'Add tags…', icon: 'tag', sub: '#', action: () => tagEditor() });
    const present = new Map();
    for (const f of files) for (const t of tagsOf(f.path)) present.set(t, (present.get(t) || 0) + 1);
    for (const t of [...present.keys()].slice(0, 6)) items.push({ label: 'Remove #' + t, icon: 'x', action: () => removeTag(files.map(f => f.path), t) });
    items.push({ label: 'Suggest tags with AI', icon: 'sparkles', action: () => autoTag('ai', { paths: files.map(f => f.path) }) });
    items.push({ label: 'Re-tag with AI', icon: 'refresh-cw', sub: 'replaces automatic tags', action: () => autoTag('ai', { paths: files.map(f => f.path), retag: true }) });
    items.push({ label: 'Suggest tags from names', icon: 'zap', action: () => autoTag('rules', { paths: files.map(f => f.path) }) });
    if ([...present.keys()].length) items.push({ label: 'Remove automatic tags', icon: 'eraser' in window.ICONS ? 'eraser' : 'rotate-ccw', action: () => clearAuto(files.map(f => f.path)) });
    items.push('sep');
    if (one) {
      items.push({ label: 'Show in Files tree', icon: 'files', action: () => { C.WS.activate('files'); C.select(one.path, 'graph'); } });
      const d = E.dirname(one.path);
      if (L.query || L.cwd !== d) items.push({ label: 'Open its folder', icon: 'folder-open', action: () => go(d, { select: one.path }) });
      items.push({ label: 'More like this', icon: 'search', sub: '.' + (one.extension || '?'), action: () => setQuery(one.extension ? 'type:' + one.extension : 'kind:other') });
    }
    return items;
  }
  function hk(k) { return k; }
  // "Tags ›" in the right-click menu
  function tagMenu(p, dir) { C.showMenu(tagItems(p, dir), menuAt.x, menuAt.y); }
  function tagItems(p, dir) {
    let items;
    if (dir) {
      const n = filesInside(p).length;
      items = [{ heading: 'Files inside ' + E.basename(p) },
        { label: 'Tag all ' + plural(n, 'file') + '…', icon: 'tag', action: () => tagEditor(filesInside(p)) },
        { label: 'Suggest tags with AI', icon: 'sparkles', action: () => autoTag('ai', { paths: filesInside(p) }) },
        { label: 'Re-tag with AI', icon: 'refresh-cw', sub: 'replaces automatic tags', action: () => autoTag('ai', { paths: filesInside(p), retag: true }) },
        'sep',
        { label: 'Search in this folder', icon: 'search', action: () => { go(p); const i = $('#libSearch'); if (i) i.focus(); } }];
      if (!BR()) items.push({ label: 'Every file inside, in one list', icon: 'files', action: () => { go(p); setPref('browse', 'flat'); } });
    } else {
      const files = selFiles();
      const one = files.length === 1 ? files[0] : null;
      items = [{ heading: one ? 'Tags for ' + one.name : 'Tags for ' + plural(files.length, 'file') },
        { label: 'Add tags…', icon: 'tag', sub: '#', action: () => tagEditor(files.map(f => f.path)) }];
      const present = new Map();
      for (const f of files) for (const t of tagsOf(f.path)) present.set(t, (present.get(t) || 0) + 1);
      for (const t of [...present.keys()].slice(0, 6)) items.push({ label: 'Remove #' + t, icon: 'x', action: () => removeTag(files.map(f => f.path), t) });
      items.push('sep',
        { label: 'Suggest tags with AI', icon: 'sparkles', action: () => autoTag('ai', { paths: files.map(f => f.path) }) },
        { label: 'Re-tag with AI', icon: 'refresh-cw', sub: 'replaces automatic tags', action: () => autoTag('ai', { paths: files.map(f => f.path), retag: true }) },
        { label: 'Suggest tags from names', icon: 'zap', action: () => autoTag('rules', { paths: files.map(f => f.path) }) });
      if (present.size) items.push({ label: 'Remove automatic tags', icon: 'rotate-ccw', action: () => clearAuto(files.map(f => f.path)) });
      if (one) items.push('sep', { label: 'More like this', icon: 'search', sub: '.' + (one.extension || '?'), action: () => setQuery(one.extension ? 'type:' + one.extension : 'kind:other') });
    }
    return items;
  }
  function filesInside(d) { const low = d.toLowerCase() + '/'; return V().files.filter(f => f.path.toLowerCase().startsWith(low)).map(f => f.path); }
  function revealDir(d) { if (V().demo) { C.notice('The demo folder only exists in memory.', 'warn', 2500); return; } C.api.reveal(d); }
  function organizeDir(d) { if (C.openFolderPath) C.openFolderPath(absPath(d)); }
  function dirMenuItems(d) {
    if (BR()) return [
      { label: 'Open', icon: 'folder-open', sub: 'Enter', action: () => go(d) },
      { label: 'Show in system explorer', icon: 'external-link', action: () => revealDir(d) },
      { label: 'Copy path', icon: 'copy', action: () => { C.api.copyText(absPath(d)); C.notice('Copied path', 'success', 1800); } },
      'sep',
      { label: 'Search in this folder', icon: 'search', action: () => { go(d); const i = $('#libSearch'); if (i) i.focus(); } },
      { label: 'Organize this folder', icon: 'sparkles', action: () => organizeDir(d) },
    ];
    const n = filesInside(d).length;
    return [
      { label: 'Open', icon: 'folder-open', sub: 'Enter', action: () => go(d) },
      { label: 'Show in system explorer', icon: 'external-link', action: () => revealDir(d) },
      { label: 'Copy path', icon: 'copy', action: () => { const v = V(); C.api.copyText(v.rootPath ? v.rootPath.replace(/[\\/]+$/, '') + (v.rootPath.includes('\\') ? '\\' + d.replace(/\//g, '\\') : '/' + d) : d); C.notice('Copied path', 'success', 1800); } },
      'sep',
      { label: 'Search in this folder', icon: 'search', action: () => { go(d); const i = $('#libSearch'); if (i) i.focus(); } },
      { label: 'Every file inside, in one list', icon: 'files', action: () => { go(d); setPref('browse', 'flat'); } },
      { label: 'Tag all ' + plural(n, 'file') + ' inside…', icon: 'tag', action: () => tagEditor(filesInside(d)) },
      { label: 'Suggest tags for these with AI', icon: 'sparkles', action: () => autoTag('ai', { paths: filesInside(d) }) },
      { label: 'Re-tag these with AI', icon: 'refresh-cw', sub: 'replaces automatic tags', action: () => autoTag('ai', { paths: filesInside(d), retag: true }) },
    ];
  }
  async function clearAuto(paths) {
    const view = await C.api.tagsClearAuto(paths || null);
    V().tags = view; changed();
    C.notice('Removed automatic tags' + (paths ? ' from ' + plural(paths.length, 'file') : '') + '. Onyx won’t add them back.', 'success', 3500);
  }

  // ------------------------------------------------------------------ tag editor (Mod+T / #)
  function tagEditor(paths) {
    paths = paths || [...L.sel];
    if (!paths.length) { C.notice('Select files in the Library first', 'warn', 2500); return; }
    const m = C.modal({ cls: 'mod-prompt mod-tags', noClose: true, html: null });
    m.box.innerHTML = '<div class="prompt-input-container"><div class="prompt-title te-title">Tags for <b>' + (paths.length === 1 ? esc(E.basename(paths[0])) : plural(paths.length, 'file')) + '</b></div><div class="te-chips"></div>' +
      '<input class="prompt-input" placeholder="Type a tag, like invoice or iceland-trip" spellcheck="false" aria-label="Tag"></div><div class="prompt-results" role="listbox"></div>' +
      '<div class="prompt-instructions"><span><b>↵</b>add tag</span><span><b>⌫</b>remove last</span><span><b>esc</b>done</span></div>';
    const input = m.box.querySelector('input'), list = m.box.querySelector('.prompt-results'), chipsEl = m.box.querySelector('.te-chips');
    let shown = [], sel = 0;
    function current() {
      const counts = new Map();
      for (const p of paths) for (const t of tagsOf(p)) counts.set(t, (counts.get(t) || 0) + 1);
      return counts;
    }
    function drawChips() {
      const cur = [...current().entries()];
      chipsEl.innerHTML = cur.length ? cur.map(([t, n]) => chip(t, { x: true, count: n === paths.length ? '' : n + '/' + paths.length, cls: n === paths.length ? '' : 'is-partial' })).join('') : '<span class="muted small">No tags yet</span>';
    }
    function draw() {
      const q = TG.normTag(input.value);
      const counts = vocab();
      const cur = current();
      const avail = [...counts.keys()].filter(t => cur.get(t) !== paths.length);
      shown = [];
      if (q && !counts.has(q)) shown.push({ t: q, html: 'Create <b>#' + esc(q) + '</b>', note: 'new tag' });
      const ranked = avail.map(t => ({ t, r: C.fuzzy(q, t) })).filter(x => x.r);
      ranked.sort((a, b) => (q ? b.r.score - a.r.score : 0) || counts.get(b.t) - counts.get(a.t));
      for (const x of ranked.slice(0, 40)) shown.push({ t: x.t, html: '#' + x.r.html, note: plural(counts.get(x.t), 'file') });
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((s, i) => '<div class="suggestion-item' + (i === sel ? ' is-selected' : '') + '" role="option" data-i="' + i + '"><span class="tc-dot" style="background:' + tagColor(s.t) + '"></span><span>' + s.html + '</span><span class="note">' + esc(s.note) + '</span></div>').join('') : '<div class="prompt-empty">Type to create a tag.</div>';
      const s = list.querySelector('.is-selected'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    async function choose(i) { const s = shown[i]; if (!s) return; input.value = ''; await addTags(paths, [s.t]); drawChips(); sel = 0; draw(); input.focus(); }
    chipsEl.addEventListener('click', async e => { const x = e.target.closest('[data-tag-remove]'); if (!x) return; e.stopPropagation(); await removeTag(paths, x.dataset.tagRemove); drawChips(); draw(); input.focus(); });
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', async e => {
      if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, shown.length); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = (sel - 1 + shown.length) % Math.max(1, shown.length); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown.length) choose(sel); }
      else if (e.key === 'Backspace' && !input.value) { const cur = [...current().keys()]; if (cur.length) { e.preventDefault(); await removeTag(paths, cur[cur.length - 1]); drawChips(); draw(); } }
      else if (e.key === 'Escape') { m.close(); e.preventDefault(); e.stopPropagation(); }
    });
    list.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) choose(+it.dataset.i); });
    drawChips(); draw(); input.focus();
  }

  // ------------------------------------------------------------------ auto-tagging
  async function autoTag(mode, opts) {
    opts = opts || {};
    const v = V(); if (!v) { C.notice('Open a folder first', 'warn'); return; }
    if (L.run) { C.notice('Already tagging. Wait for it to finish or stop it.', 'warn', 2500); return; }
    L.run = { mode, batch: 1, of: 0 };
    renderProgress(); renderTagsPanel();
    let r;
    try { r = await C.api.tagsAuto({ mode, paths: opts.paths || null, scope: opts.scope || 'untagged', retag: !!opts.retag }); } catch (e) { r = { error: e.message }; }
    L.run = null;
    if (r.error) {
      renderProgress(); renderTagsPanel();
      C.notice(esc(r.error), 'error', 7000, mode === 'ai' ? { label: 'AI settings', run: () => C.openSettings('ai') } : null);
      return;
    }
    v.tags = r.view; changed();
    if (!r.checked) C.notice(mode === 'ai' ? 'Every file already has AI tags. Use “Re-tag everything with AI” to ask again.' : 'Nothing new to tag.', '', 4000);
    else if (!r.added) C.notice('Checked ' + plural(r.checked, 'file') + '. No new tags found' + (mode === 'rules' ? ' in their names. Try AI tagging for smarter tags.' : '.'), '', 5000);
    else C.notice('Added <b>' + plural(r.added, 'tag') + '</b> to ' + plural(r.files, 'file') + (r.model ? ' with ' + esc(r.model) : '') + (r.cancelled ? ' before stopping' : '') + (r.failedBatches ? ' (' + r.failedBatches + ' batch' + (r.failedBatches > 1 ? 'es' : '') + ' failed)' : '') + (r.capped ? '. Onyx tags up to 3,000 files per run; run it again for the rest.' : '.'), 'success', 6000);
  }
  function autoTagMenu(el, fromBar) {
    const v = V();
    const b = el.getBoundingClientRect();
    const untagged = v ? v.files.filter(f => !tagsOf(f.path).length).length : 0;
    const prov = C.S.settings && C.S.settings.providers ? (C.S.settings.providers[C.S.settings.ai.provider] || {}).label : '';
    const items = [];
    const sf = selFiles();
    if (fromBar) items.push(sf.length ? { label: 'Add tags to ' + plural(sf.length, 'selected file') + '…', icon: 'tag', sub: '#', action: () => tagEditor() } : { label: 'Add tags…', icon: 'tag', sub: 'select files first', disabled: true }, 'sep');
    if (v && v.browse) {
      items.push({ heading: 'Tag automatically' });
      if (sf.length) items.push({ label: 'Tag the ' + plural(sf.length, 'selected file') + ' with AI', icon: 'sparkles', action: () => autoTag('ai', { paths: sf.map(f => f.path) }) }, { label: 'Re-tag them with AI', icon: 'refresh-cw', action: () => autoTag('ai', { paths: sf.map(f => f.path), retag: true }) });
      else items.push({ label: 'Select files to tag them with AI', icon: 'sparkles', action: () => C.notice('Select files first. Whole drives are too big to tag at once.', '', 3000) });
      items.push('sep', { label: 'Tagging settings…', icon: 'settings', action: () => C.openSettings('library') });
      C.showMenu(items, fromBar ? b.left : b.right - 300, b.bottom + 4);
      return;
    }
    items.push({ heading: 'Tag automatically' });
    items.push({ label: 'Tag untagged files with AI', icon: 'sparkles', sub: prov ? 'using ' + prov : '', action: () => autoTag('ai', { scope: 'untagged' }) });
    items.push({ label: 'Re-tag everything with AI', icon: 'sparkles', sub: v ? plural(v.files.length, 'file') : '', action: () => C.confirmModal('Re-tag every file with AI?', '<p>Onyx sends the names of <b>' + plural(v.files.length, 'file') + '</b> to ' + esc(prov || 'your AI provider') + ' and adds the tags it suggests. Your own tags stay, and tags you removed won’t come back.</p>', 'Tag with AI', () => autoTag('ai', { scope: 'all' })) });
    items.push({ label: 'Suggest tags from names (offline)', icon: 'zap', sub: untagged + ' untagged', action: () => autoTag('rules', { scope: 'all' }) });
    if (L.sel.size) items.push('sep', { label: 'Tag the ' + plural(L.sel.size, 'selected file') + ' with AI', icon: 'sparkles', action: () => autoTag('ai', { paths: [...L.sel] }) });
    items.push('sep', { label: 'Remove all automatic tags…', icon: 'rotate-ccw', action: () => C.confirmModal('Remove automatic tags?', '<p>Removes every tag Onyx or AI added. Tags you added yourself stay. Onyx won’t add the removed tags again.</p>', 'Remove', () => clearAuto(null), true) });
    items.push({ label: 'Tagging settings…', icon: 'settings', action: () => C.openSettings('library') });
    C.showMenu(items, fromBar ? b.left : b.right - 300, b.bottom + 4);
  }

  // ------------------------------------------------------------------ saved searches
  function saveSearch() {
    const q = L.query.trim(); if (!q) return;
    C.textPrompt({
      title: 'Save search', ok: 'Save', value: q.replace(/[#"]/g, '').replace(/\w+:/g, '').trim().slice(0, 40) || 'My search',
      desc: 'Saved searches appear in the Tags panel and update as files change. <code>' + esc(q) + '</code>',
      validate: v => v.trim() ? '' : 'Give it a name.',
      run: async name => { const list = (tagState().saved || []).concat([{ name: name.trim(), query: q }]); V().tags = await C.api.tagsSaved(list); refresh(); renderTagsPanel(); C.notice('Saved <b>' + esc(name.trim()) + '</b>', 'success', 2500); },
    });
  }
  async function setSaved(list) { V().tags = await C.api.tagsSaved(list); refresh(); renderTagsPanel(); }

  // ------------------------------------------------------------------ tag management
  function tagMenuItems(t) {
    return [
      { label: 'Show files tagged #' + t, icon: 'search', action: () => setQuery('#' + t) },
      { label: 'Add to current search', icon: 'filter', action: () => toggleTagQuery(t, true) },
      { label: 'Exclude from search', icon: 'eye-off', action: () => setQuery((L.query + ' -#' + t).trim()) },
      'sep',
      { label: 'Remove where Onyx added it', icon: 'eraser' in window.ICONS ? 'eraser' : 'rotate-ccw', sub: autoCount(t) + ' files', action: () => removeAutoTagEverywhere(t) },
      { label: 'Rename…', icon: 'pencil', action: () => renameTagPrompt(t) },
      { label: 'Change color…', icon: 'palette', action: () => colorPicker(t) },
      { label: 'Tag the selected files', icon: 'tag', action: () => L.sel.size ? addTags([...L.sel], [t]) : C.notice('Select files in the Library first', 'warn', 2500) },
      'sep',
      { label: 'Delete tag…', icon: 'trash', danger: true, action: () => deleteTagConfirm(t) },
    ];
  }
  function autoCount(t) { return Object.values(tagState().files).filter(e => (e.a || []).includes(t)).length; }
  async function removeAutoTagEverywhere(t) {
    const n = autoCount(t);
    if (!n) { C.notice('Onyx didn’t add <b>#' + esc(t) + '</b> anywhere. It’s only on files you tagged yourself.', '', 3500); return; }
    V().tags = await C.api.tagsRemoveAuto(t);
    changed();
    C.notice('Removed <b>#' + esc(t) + '</b> from ' + plural(n, 'file') + ' where Onyx added it. Tags you added yourself stay, and Onyx won’t add it back there.', 'success', 5000);
  }
  function renameTagPrompt(t) {
    C.textPrompt({
      title: 'Rename tag', value: t, ok: 'Rename',
      desc: 'Renames <b>#' + esc(t) + '</b> on every file. Renaming to an existing tag merges them. Use <code>/</code> to nest, like <code>school/math</code>.',
      validate: v => TG.normTag(v) ? '' : 'Enter a tag name.',
      run: async v => {
        const to = TG.normTag(v);
        V().tags = await C.api.tagsRename(t, to);
        const toks = TG.tokenize(L.query).map(x => /^#|^tags?:/i.test(x) && TG.normTag(x.replace(/^tags?:/i, '')) === t ? '#' + to : x);
        L.query = toks.join(' ');
        changed(); C.notice('Renamed to <b>#' + esc(to) + '</b>', 'success', 2500);
      },
    });
  }
  function deleteTagConfirm(t) {
    const n = Object.values(tagState().files).filter(e => e.t.some(x => x === t || x.startsWith(t + '/'))).length;
    C.confirmModal('Delete #' + esc(t) + '?', '<p>Removes the tag from <b>' + plural(n, 'file') + '</b>. The files themselves aren’t touched, and Onyx won’t add this tag automatically again.</p>', 'Delete tag', async () => {
      V().tags = await C.api.tagsDelete(t);
      L.query = TG.tokenize(L.query).filter(x => !(/^-?(#|tags?:)/i.test(x) && TG.normTag(x.replace(/^-?(tags?:)?/i, '')) === t)).join(' ');
      changed();
    }, true);
  }
  function colorPicker(t) {
    const pal = palette();
    const sem = C.T.colors() || {};
    const extra = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'].map(k => sem[k]).filter(Boolean);
    const all = [...new Set(pal.concat(extra))];
    const cur = (tagState().colors || {})[t] || '';
    const m = C.modal({
      title: 'Color for #' + esc(t),
      html: '<div class="swatches">' + all.map(c => '<button class="swatch' + (c.toLowerCase() === cur.toLowerCase() ? ' is-active' : '') + '" style="background:' + c + '" data-c="' + c + '" aria-label="' + c + '"></button>').join('') + '</div>' +
        '<p class="muted small" style="margin-top:10px">Nested tags like <code>' + esc(t) + '/…</code> use this color too unless they have their own.</p>',
      buttons: [{ label: 'Automatic', action: () => { C.api.tagsColor(t, '').then(v => { V().tags = v; changed(); }); } }, { label: 'Done', cls: 'mod-cta' }],
    });
    m.box.addEventListener('click', async e => { const s = e.target.closest('[data-c]'); if (!s) return; V().tags = await C.api.tagsColor(t, s.dataset.c); changed(); m.box.querySelectorAll('.swatch').forEach(x => x.classList.toggle('is-active', x === s)); });
  }

  // ------------------------------------------------------------------ tags panel (sidebar)
  function renderTagsPanel(el) {
    el = el || $('#vs-tags');
    if (!el || !C.WS.isVisible('tags')) return;
    const v = V();
    const head = $('#tagsHeader');
    if (head) { head.innerHTML = ''; head.hidden = true; }
    if (!v) { el.innerHTML = '<div class="nav-empty">No folder open.<br><a class="mod-link" data-action="open-folder">Open a folder</a></div>'; return; }
    const prevFilter = el.querySelector('#tagFilter');
    const hadFocus = prevFilter && document.activeElement === prevFilter;
    const y = el.scrollTop;
    const q = L.query.trim();
    const now = Date.now();
    const br = !!v.browse;
    const untagged = br ? 0 : v.files.filter(f => !tagsOf(f.path).length).length;
    const tagged = v.files.length - untagged;
    const item = (ic, label, query, count, extra) => (!br && !count && q !== query) ? '' : '<div class="tp-item' + (q === query ? ' is-active' : '') + '" data-q="' + esc(query) + '" tabindex="0" role="button">' + icon(ic) + '<span class="tp-label">' + esc(label) + '</span>' + (extra || '') + '<span class="tp-count">' + (br ? '' : count) + '</span></div>';
    let h = '';
    if (L.run) h += '<div class="tp-run"><span class="spinner"></span><span>' + (L.run.mode === 'ai' ? 'Tagging with AI' : 'Tagging') + (L.run.of > 1 ? ' · ' + L.run.batch + '/' + L.run.of : '') + '…</span>' + (L.run.mode === 'ai' ? '<a class="mod-link" data-tp="cancel">Stop</a>' : '') + '</div>';
    else if (!br && (untagged && (!tagged || untagged / v.files.length > 0.5) && !v.demo || untagged && !tagged)) {
      h += '<div class="tp-cta"><div class="tp-cta-title">' + icon('sparkles') + plural(untagged, 'file') + ' without tags</div><div class="tp-cta-sub">Let AI read the names and tag them, so you can find anything by topic, project or purpose.</div>' +
        '<div class="tp-cta-row"><button class="btn small mod-cta" data-tp="ai">Tag with AI</button><button class="btn small" data-tp="rules">Offline</button></div></div>';
    }
    h += '<div class="tp-section"><div class="tp-title">Places</div>' +
      (!v.demo && C.openPlaces ? '<div class="tp-item' + (C.S.pcOpen ? ' is-active' : '') + '" data-tp="places" tabindex="0" role="button">' + icon('monitor') + '<span class="tp-label">This PC</span><span class="tp-count"></span></div>' : '') +
      '<div class="tp-item' + (!q && !L.cwd && !C.S.pcOpen ? ' is-active' : '') + '" data-tp="home" tabindex="0" role="button">' + icon(br ? 'hard-drive' : 'folder-open') + '<span class="tp-label">' + esc(v.vaultName) + '</span><span class="tp-count">' + (br ? '' : v.files.length) + '</span></div></div>';
    const filters = item('clock', 'Changed this week', 'modified:<7d', br ? 0 : v.files.filter(f => now - f.lastModified <= 7 * DAY).length) +
      (br ? '' : item('inbox', 'Untagged', 'is:untagged', untagged) + item('copy', 'Duplicates', 'is:duplicate', dupSet().size)) +
      item('hard-drive', 'Large files', 'size:>100mb', br ? 0 : v.files.filter(f => f.size >= 100 * 1048576).length);
    if (filters) h += '<div class="tp-section"><div class="tp-title">Filters</div>' + filters + '</div>';
    const saved = tagState().saved || [];
    if (saved.length) h += '<div class="tp-section"><div class="tp-title">Saved searches<span class="spacer"></span>' + (q && !saved.some(s => s.query.trim() === q) ? '<button class="clickable-icon" data-tp="save" data-tip="Save current search" aria-label="Save current search">' + icon('plus') + '</button>' : '') + '</div>' +
      (saved.length ? saved.map((s, i) => {
        const r = TG.parseQuery(s.query); const ctx = { now, dups: br ? null : dupSet() };
        const n = br ? '' : v.files.filter(f => TG.matchFile(f, tagsOf(f.path), r, ctx)).length;
        return '<div class="tp-item' + (q === s.query.trim() ? ' is-active' : '') + '" data-q="' + esc(s.query) + '" data-saved="' + i + '" tabindex="0" role="button" title="' + esc(s.query) + '">' + icon('bookmark') + '<span class="tp-label">' + esc(s.name) + '</span><span class="tp-count">' + n + '</span></div>';
      }).join('') : '<div class="tp-empty">Search in the Library, then save it here. Try <a class="mod-link" data-q="modified:<30d kind:document">recent documents</a>.</div>') + '</div>';
    const kinds = new Map();
    for (const f of v.files) { const k = E.typeGroup(f.extension); kinds.set(k, (kinds.get(k) || 0) + 1); }
    const kindRows = TG.KINDS.filter(([g]) => br ? g !== 'Other' : kinds.get(g)).map(([g, alias, label]) => item(window.fileIconName(alias === '3d' ? 'obj' : ({ image: 'jpg', document: 'pdf', video: 'mp4', audio: 'mp3', code: 'js', archive: 'zip', installer: 'exe', design: 'psd', ebook: 'epub', font: 'ttf' })[alias] || ''), label, 'kind:' + alias, kinds.get(g)));
    if (kindRows.length) h += '<div class="tp-section' + (store.get('tp.kinds2', false) ? '' : ' is-collapsed') + '"><div class="tp-title tp-toggle" data-tp="toggle-kinds">' + icon('chevron-down', 'xs') + 'Kinds</div><div class="tp-body">' + kindRows.join('') + '</div></div>';
    const counts = new Map();
    if (br) { for (const e of Object.values(tagState().files)) for (const t of e.t || []) counts.set(t, (counts.get(t) || 0) + 1); }
    else for (const f of v.files) for (const t of tagsOf(f.path)) counts.set(t, (counts.get(t) || 0) + 1);
    let tags = [...counts.entries()];
    if (U().tagSort === 'name') tags.sort((a, b) => C.collator.compare(a[0], b[0])); else tags.sort((a, b) => b[1] - a[1] || C.collator.compare(a[0], b[0]));
    const f = L.tagFilter.trim().toLowerCase();
    const shownTags = f ? tags.filter(([t]) => t.includes(f)) : tags;
    const activeTags = new Set(TG.tokenize(L.query).filter(x => /^#|^tags?:/i.test(x)).map(x => TG.normTag(x.replace(/^tags?:/i, ''))));
    const sortTip = U().tagSort === 'name' ? 'Sorted A–Z (click for most used)' : 'Sorted by most used (click for A–Z)';
    h += '<div class="tp-section tp-tags"><div class="tp-title">Tags<span class="tp-count">' + tags.length + '</span><span class="spacer"></span>' +
      '<button class="clickable-icon tp-mini" data-tp="auto" data-tip="Tag automatically" aria-label="Tag automatically">' + icon('sparkles', 'xs') + '</button>' +
      '<button class="clickable-icon tp-mini" data-tp="sort" data-tip="' + sortTip + '" aria-label="' + sortTip + '">' + icon(U().tagSort === 'name' ? 'arrow-down-a-z' : 'arrow-down-wide-narrow', 'xs') + '</button></div>';
    if (tags.length > 12 || f) h += '<div class="search-wrap tp-filter">' + icon('search', 'xs') + '<input id="tagFilter" class="search-input" placeholder="Filter tags…" spellcheck="false" aria-label="Filter tags" value="' + esc(L.tagFilter) + '"></div>';
    const tagRow = ([t, n]) => '<div class="tp-item tp-tag' + (activeTags.has(t) ? ' is-active' : '') + '" data-tag="' + esc(t) + '" tabindex="0" role="button" style="--tc:' + tagColor(t) + '"><span class="tc-dot"></span><span class="tp-label">' + esc(t) + '</span><span class="tp-count">' + n + '</span></div>';
    // years (2019, 2020…) are grouped into one row so they don't push real topics down the list
    const isYear = t => /^(19|20)\d\d$/.test(t);
    const years = f ? [] : shownTags.filter(([t]) => isYear(t)).sort((a, b) => b[0].localeCompare(a[0]));
    const topics = f ? shownTags : shownTags.filter(([t]) => !isYear(t));
    const showAll = f || L.allTags;
    const LIMIT = 12;
    h += topics.length || years.length ? (showAll ? topics : topics.slice(0, LIMIT)).map(tagRow).join('') : '<div class="tp-empty">' + (f ? 'No tags match.' : 'No tags yet. Select files in the Library and press <kbd>#</kbd>, or drag files onto a tag.') + '</div>';
    if (!showAll && topics.length > LIMIT) h += '<button class="tp-more" data-tp="all-tags">Show all ' + topics.length + '</button>';
    else if (!f && L.allTags && topics.length > LIMIT) h += '<button class="tp-more" data-tp="all-tags">Show fewer</button>';
    if (years.length) {
      const open = store.get('tp.years', false) || years.some(([t]) => activeTags.has(t));
      h += '<div class="tp-group' + (open ? '' : ' is-collapsed') + '"><div class="tp-item tp-toggle" data-tp="toggle-years" tabindex="0" role="button">' + icon('calendar') + '<span class="tp-label">Years</span><span class="tp-count">' + years.length + '</span>' + icon('chevron-down', 'xs') + '</div>' +
        '<div class="tp-years">' + years.map(([t, n]) => '<button class="tp-year' + (activeTags.has(t) ? ' is-active' : '') + '" data-tag="' + esc(t) + '" title="' + plural(n, 'file') + '">' + esc(t) + '</button>').join('') + '</div></div>';
    }
    h += '</div>';
    el.innerHTML = h;
    el.scrollTop = y;
    const inp = el.querySelector('#tagFilter');
    if (inp) {
      inp.addEventListener('input', () => { L.tagFilter = inp.value; const p = inp.selectionStart; renderTagsPanel(); const n = $('#tagFilter'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
      inp.addEventListener('keydown', e => { if (e.key === 'Escape') { L.tagFilter = ''; renderTagsPanel(); e.stopPropagation(); } });
      if (hadFocus) inp.focus();
    }
  }
  function tagsPanelClick(e) {
    const panel = e.target.closest('.view-root[data-view="tags"]');
    if (!panel) return false;
    if (C.closePlaces && e.target.closest('[data-tp="home"], [data-q], .tp-tag, .tp-year')) C.closePlaces();
    const b = e.target.closest('[data-tp]');
    if (b) {
      const k = b.dataset.tp;
      if (k === 'auto') autoTagMenu(b);
      else if (k === 'quick') quickFind();
      else if (k === 'library') showLibrary();
      else if (k === 'home') { showLibrary(); go(''); }
      else if (k === 'sort') { C.setUi('library', 'tagSort', U().tagSort === 'name' ? 'count' : 'name'); renderTagsPanel(); }
      else if (k === 'ai') autoTag('ai', { scope: 'untagged' });
      else if (k === 'rules') autoTag('rules', { scope: 'all' });
      else if (k === 'cancel') C.api.tagsCancel();
      else if (k === 'save') { showLibrary(); saveSearch(); }
      else if (k === 'all-tags') { L.allTags = !L.allTags; renderTagsPanel(); }
      else if (k === 'toggle-years') { store.set('tp.years', !store.get('tp.years', false)); renderTagsPanel(); }
      else if (k === 'toggle-kinds') { store.set('tp.kinds2', !store.get('tp.kinds2', false)); renderTagsPanel(); }
      else if (k === 'places') { if (C.openPlaces) C.openPlaces(); }
      return true;
    }
    const t = e.target.closest('.tp-tag, .tp-year');
    if (t) { toggleTagQuery(t.dataset.tag, e.ctrlKey || e.metaKey || e.shiftKey); return true; }
    const it = e.target.closest('[data-q]');
    if (it) { setQuery(it.dataset.q); return true; }
    return false;
  }
  document.addEventListener('click', e => { if (tagsPanelClick(e)) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement && document.activeElement.matches('.tp-item')) { e.preventDefault(); document.activeElement.click(); }
  });
  document.addEventListener('contextmenu', e => {
    const t = e.target.closest('.view-root[data-view="tags"] .tp-tag');
    if (t) { e.preventDefault(); e.stopPropagation(); C.showMenu(tagMenuItems(t.dataset.tag), e.clientX, e.clientY); return; }
    const s = e.target.closest('.view-root[data-view="tags"] [data-saved]');
    if (s) {
      e.preventDefault(); e.stopPropagation();
      const i = +s.dataset.saved, list = (tagState().saved || []).slice();
      C.showMenu([
        { label: 'Rename…', icon: 'pencil', action: () => C.textPrompt({ title: 'Rename saved search', value: list[i].name, ok: 'Rename', validate: v => v.trim() ? '' : 'Give it a name.', run: v => { list[i] = Object.assign({}, list[i], { name: v.trim() }); setSaved(list); } }) },
        { label: 'Edit search…', icon: 'search', action: () => C.textPrompt({ title: 'Edit search', value: list[i].query, ok: 'Save', validate: v => v.trim() ? '' : 'Enter a search.', run: v => { list[i] = Object.assign({}, list[i], { query: v.trim() }); setSaved(list); } }) },
        'sep',
        { label: 'Delete', icon: 'trash', danger: true, action: () => { list.splice(i, 1); setSaved(list); } },
      ], e.clientX, e.clientY);
    }
  }, true);
  // drag files from the library onto a tag to tag them
  document.addEventListener('dragover', e => {
    const t = e.target.closest && e.target.closest('.tp-tag');
    if (!t || ![...(e.dataTransfer.types || [])].includes('application/x-onyx-files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'link';
    document.querySelectorAll('.tp-tag.is-drop').forEach(x => x !== t && x.classList.remove('is-drop'));
    t.classList.add('is-drop');
  });
  document.addEventListener('dragleave', e => { const t = e.target.closest && e.target.closest('.tp-tag'); if (t) t.classList.remove('is-drop'); });
  document.addEventListener('drop', e => {
    const t = e.target.closest && e.target.closest('.tp-tag');
    if (!t) return;
    const raw = e.dataTransfer.getData('application/x-onyx-files');
    if (!raw) return;
    e.preventDefault(); e.stopPropagation();
    t.classList.remove('is-drop');
    let paths = []; try { paths = JSON.parse(raw); } catch { return; }
    addTags(paths, [t.dataset.tag]).then(() => C.notice('Tagged ' + plural(paths.length, 'file') + ' <b>#' + esc(t.dataset.tag) + '</b>', 'success', 2200));
  }, true);

  // ------------------------------------------------------------------ quick find (Mod+K)
  function quickFind() {
    const v = V();
    if (!v) { C.notice('Open a folder first', 'warn'); return; }
    if (document.querySelector('.mod-quickfind')) return;
    const m = C.modal({ cls: 'mod-prompt mod-quickfind', noClose: true, html: null });
    m.box.innerHTML = '<div class="prompt-input-container"><input class="prompt-input" placeholder="Find a file by name or #tag…" aria-label="Find a file" spellcheck="false"></div><div class="prompt-results" role="listbox"></div>' +
      '<div class="prompt-instructions"><span><b>↑↓</b>navigate</span><span><b>↵</b>show in Library</span><span><b>' + (C.isMac ? '⌘' : 'Ctrl') + '↵</b>open</span><span><b>⇧↵</b>show in folder</span></div>';
    const input = m.box.querySelector('input'), list = m.box.querySelector('.prompt-results');
    let shown = [], sel = 0;
    const recent = store.get(recentKey(), []);
    function draw() {
      const raw = input.value.trim();
      shown = [];
      if (!raw) {
        const seen = new Set();
        for (const p of recent) { const f = fileBy(p); if (f && !seen.has(p)) { shown.push({ f, html: esc(f.name), note: 'recently opened' }); seen.add(p); } }
        for (const f of v.files.slice().sort((a, b) => b.lastModified - a.lastModified)) { if (shown.length >= 30) break; if (!seen.has(f.path)) { shown.push({ f, html: esc(f.name), note: ago(f.lastModified) }); seen.add(f.path); } }
      } else {
        const r = TG.parseQuery(raw);
        const words = r.text.join(' ');
        const filtered = Object.assign({}, r, { text: [] });
        const ctx = { now: Date.now(), dups: dupSet() };
        const out = [];
        for (const f of v.files) {
          if (!TG.matchFile(f, tagsOf(f.path), filtered, ctx)) continue;
          if (!words) { out.push({ f, html: esc(f.name), score: -f.lastModified / 1e13 }); continue; }
          const n = C.fuzzy(words, f.name);
          const p = n ? null : C.fuzzy(words, f.path);
          const tg = tagsOf(f.path).some(t => t.includes(words.replace(/^#/, '')));
          if (n) out.push({ f, html: n.html, score: n.score + 50 });
          else if (p) out.push({ f, html: esc(f.name), score: p.score });
          else if (tg) out.push({ f, html: esc(f.name), score: 20 });
        }
        out.sort((a, b) => b.score - a.score);
        shown = out.slice(0, 60);
        if (v.browse) shown.unshift({ search: raw, html: 'Search <b>' + esc(L.cwd ? E.basename(L.cwd) : v.vaultName) + '</b> for “' + esc(raw) + '”', note: 'looks through every folder' });
      }
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((s, i) => {
        if (s.search) return '<div class="suggestion-item' + (i === sel ? ' is-selected' : '') + '" role="option" data-i="' + i + '">' + icon('search') + '<span>' + s.html + '</span><span class="note">' + esc(s.note) + '</span></div>';
        const tags = tagsOf(s.f.path);
        return '<div class="suggestion-item qf-item' + (i === sel ? ' is-selected' : '') + '" role="option" data-i="' + i + '">' + icon(window.fileIconName(s.f.extension)) +
          '<div class="qf-main"><div class="qf-name">' + s.html + '</div><div class="qf-path">' + esc(E.dirname(s.f.path) || 'Top level') + '</div></div>' +
          '<div class="qf-tags">' + tags.slice(0, 3).map(t => chip(t)).join('') + '</div>' + (s.note ? '<span class="note">' + esc(s.note) + '</span>' : '') + '</div>';
      }).join('') : '<div class="prompt-empty">No files found.</div>';
      const s = list.querySelector('.is-selected'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    function choose(i, how) {
      const s = shown[i]; if (!s) return; m.close();
      if (s.search) { showLibrary(); L.query = s.search; const inp = $('#libSearch'); if (inp) inp.value = s.search; refresh(); return; }
      const p = s.f.path;
      if (how === 'open') { openFile(p); return; }
      if (how === 'reveal') { reveal(p); return; }
      revealFile(p);
      const sc = $('#libScroll'); if (sc) sc.focus({ preventScroll: true });
    }
    let qt = null;
    input.addEventListener('input', () => { sel = 0; clearTimeout(qt); if (v.files.length > 4000) qt = setTimeout(draw, 60); else draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, shown.length); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = (sel - 1 + shown.length) % Math.max(1, shown.length); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(qt); if (qt) draw(); choose(sel, e.ctrlKey || e.metaKey ? 'open' : e.shiftKey ? 'reveal' : 'show'); }
      else if (e.key === 'Escape') { m.close(); e.preventDefault(); e.stopPropagation(); }
    });
    list.addEventListener('mousemove', e => { const it = e.target.closest('[data-i]'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; list.querySelectorAll('.suggestion-item').forEach((x, i) => x.classList.toggle('is-selected', i === sel)); } });
    list.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) choose(+it.dataset.i, e.ctrlKey || e.metaKey ? 'open' : 'show'); });
    draw(); input.focus();
  }

  // ------------------------------------------------------------------ public API
  function selection() {
    const order = (L.order || []).map(f => f.path).filter(p => L.sel.has(p));
    for (const p of L.sel) if (!order.includes(p)) order.push(p);
    return order;
  }
  function selectPaths(paths) {
    const list = (paths || []).filter(Boolean);
    const low = new Set(list.map(p => p.toLowerCase()));
    const real = (L.order || []).filter(f => low.has(f.path.toLowerCase())).map(f => f.path);
    L.sel = new Set(real.length ? real : list);
    const last = real[real.length - 1] || list[list.length - 1] || null;
    L.focus = last; L.anchor = last;
    afterSelect();
  }
  function selectAll() { L.sel = new Set((L.order || []).map(f => f.path)); afterSelect(false); }
  function invertSelection() { L.sel = new Set((L.order || []).map(f => f.path).filter(p => !L.sel.has(p))); afterSelect(false); }
  // after deleting: Explorer selects the item that took the deleted one's place
  function neighbourAfter(paths) {
    const list = (L.order || []).map(f => f.path), gone = new Set(paths);
    const idx = list.findIndex(p => gone.has(p));
    if (idx < 0) return null;
    for (let i = idx; i < list.length; i++) if (!gone.has(list[i])) return list[i];
    for (let i = idx - 1; i >= 0; i--) if (!gone.has(list[i])) return list[i];
    return null;
  }
  function dropDirs(rels) {
    const v = V(); if (!v) return;
    const lows = rels.map(r => r.toLowerCase());
    const under = p => { const l = p.toLowerCase(); return lows.some(r => l === r || l.startsWith(r + '/')); };
    v.files = v.files.filter(f => !under(f.path));
    v.dirs = v.dirs.filter(d => !under(d.path));
    for (const k of [...L.loaded]) if (under(k)) L.loaded.delete(k);
    if (under(L.cwd)) { let c = L.cwd; while (c && under(c)) c = E.dirname(c); L.cwd = c; }
  }
  function relist(dirs) {
    const v = V(); if (!v || !v.browse) return;
    for (const d of dirs) { const k = (d || '').toLowerCase(); if (L.loaded.has(k)) { L.loaded.delete(k); ensureListed(d); } }
  }
  function reveal(path) { L.focus = path; ensureVisible(path); paint(); }
  function focusList() { const sc = $('#libScroll'); if (sc) sc.focus({ preventScroll: true }); }
  function revealPath(p) { if (V().demo) { C.notice('The demo folder only exists in memory.', 'warn', 2500); return; } C.api.reveal(p || ''); }
  function init(ctx) {
    C = ctx;
    C.api.onTagProgress(p => { if (L.run) { L.run.batch = p.batch; L.run.of = p.of; renderProgress(); renderTagsPanel(); } });
    if (window.OnyxOps) window.OnyxOps.init(ctx, {
      selection, selectPaths, selectAll, invertSelection, neighbourAfter, dropDirs, relist, reveal, focusList, revealPath,
      mergeListing: r => { mergeListing(r); cache = null; }, changed: () => { cache = null; L.statsFor = null; changed(); },
      renderCmd, renderProgress, rowEl, dirBy, fileBy, absPath, go, openFile, organizeDir, addTags, tagMenu, tagItems, viewMenu, viewItems, sortMenu, sortItems, reloadNow, selFiles,
      allDirs: () => { const v = V(); return v ? v.dirs.map(d => d.path) : []; },
      cwd: () => L.cwd, query: () => L.query.trim(), focus: () => L.focus,
      showDetails: () => { if (!U().details) setPref('details', true); },
    });
    if (window.OnyxExtensions) window.OnyxExtensions.init(ctx);
    if (window.OnyxViewer) window.OnyxViewer.init(ctx, {
      fileBy, openFile, focusList,
      previewList: () => (L.order || []).filter(f => !f.isDir && fileBy(f.path)),
      selectPath: p => { if ((L.order || []).some(f => f.path === p)) setSingle(p); },
    });
  }
  window.OnyxLibrary = {
    init, renderLibrary, renderTagsPanel, refresh, quickFind, go, back, forward, up, revealFile, ensureListed, isListed,
    get cwd() { return L.cwd; }, tagEditor, autoTag, autoTagMenu, saveSearch, setQuery, showLibrary,
    tagColor, tagsOf, clearAuto,
    reload() { const v = V(); if (!v) return; if (v.browse) { v.files = []; v.dirs = []; L.loaded = new Set(); L.loading = new Map(); L.listErr = new Map(); L.search = null; } refresh(); renderTagsPanel(); if (C.renderExplorer) C.renderExplorer(); if (v.browse) ensureListed(L.cwd); },
    get selection() { return [...L.sel]; },
    get query() { return L.query; },
    toggleView() { setPref('view', U().view === 'grid' ? 'list' : 'grid'); },
    focusSearch() { showLibrary(); const i = $('#libSearch'); if (i) { i.focus(); i.select(); } },
  };
})();
