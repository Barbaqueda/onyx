/* Onyx renderer */
(() => {
  'use strict';
  const api = window.onyx;
  const E = window.OnyxEngine;
  const T = window.OnyxTheme;
  const WS = window.OnyxWorkspace;
  const LIB = window.OnyxLibrary;
  const MAIN_VIEWS = ['structure', 'changes', 'graph', 'library', 'tags'];
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMac = api.platform === 'darwin';
  if (isMac) document.body.classList.add('mac');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('onyx.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('onyx.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const STRATEGIES = [
    { id: 'smart', name: 'AI smart', icon: 'sparkles', desc: 'Reads names and your existing folders, groups files by what they’re for', badge: 'AI' },
    { id: 'rules', name: 'Smart rules', icon: 'zap', desc: 'Same idea, fully offline: keywords, series and file types' },
    { id: 'type', name: 'By type', icon: 'layers', desc: 'Images, Documents, 3D Models, Installers…' },
    { id: 'date', name: 'By date', icon: 'calendar', desc: 'Year and month each file was last changed' },
    { id: 'size', name: 'By size', icon: 'hard-drive', desc: 'Small, medium, large and huge files' },
    { id: 'tags', name: 'By tag', icon: 'tag', desc: 'A folder for each file’s main tag. Your own tags come first' },
    { id: 'flatten', name: 'Flatten', icon: 'arrow-up-to-line', desc: 'Pull files out of subfolders to the top level' },
  ];

  const S = {
    vault: null, plan: null, settings: null,
    strategy: store.get('strategy', 'smart'),
    busy: false, progress: null, aiTest: null,
    selected: null, kindsKey: '', kinds: null,
    explorerOpen: new Set(), proposedOpen: new Set(),
    explorerFilter: '', changesFilter: '',
    graphMode: 'proposed', graphPanel: true, graphInst: null,
  };

  // ======================================================================= utils
  function hydrate(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => {
      if (el.dataset.hydrated) return;
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.dataset.size));
      el.dataset.hydrated = '1';
    });
  }
  const fmt = E.fmtSize;
  const dirname = E.dirname, basename = E.basename;
  function plural(n, w, p) { return n + ' ' + (n === 1 ? w : (p || w + 's')); }
  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(ts).toLocaleDateString();
  }
  function stratById(id) { return STRATEGIES.find(s => s.id === id) || STRATEGIES[0]; }
  function effTarget(it) { return it.kind === 'move' && !it.skip ? it.target : it.source; }
  function isMoving(it) { return it.kind === 'move' && !it.skip; }
  function planBySource() { const m = new Map(); if (S.plan) for (const it of S.plan.items) m.set(it.source, it); return m; }
  function existingDirSet() { return new Set((S.vault ? S.vault.dirs : []).map(d => d.path.toLowerCase())); }
  function openAncestors(set, p) { let d = dirname(p); while (d) { set.add(d); d = dirname(d); } }
  function orgSettings() { return Object.assign({}, E.DEFAULTS, (S.settings && S.settings.organize) || {}); }
  function kindsMap() {
    if (!S.vault) return new Map();
    const o = orgSettings();
    const key = JSON.stringify([o.keepFolders, o.openFolders]);
    if (S.vault._kindsKey !== key) { S.vault._kinds = E.classifyDirs(S.vault.files, S.vault.dirs, o); S.vault._kindsKey = key; }
    return S.vault._kinds;
  }
  function bundlePill(path, kinds) {
    const k = kinds && kinds.get(path.toLowerCase());
    return k && k.kind === 'bundle' && k.root === k.path ? '<span class="pill bundle" data-tip="' + esc('Kept together: ' + k.why) + '">bundle</span>' : '';
  }
  function splitName(name) { const { base, ext } = E.splitExt(name); return ext && base ? { base, ext } : { base: name, ext: '' }; }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  // ======================================================================= preferences
  function UI() { return T.merge(T.UI_DEFAULTS, S.settings ? S.settings.ui : {}); }
  const saveTimers = {};
  function persist(section, kind) {
    clearTimeout(saveTimers[kind + section]);
    saveTimers[kind + section] = setTimeout(() => {
      const value = kind === 'ui' ? S.settings.ui[section] : S.settings.organize[section];
      api.replaceSetting(kind, section, value);
    }, 250);
  }
  function setUi(section, key, value) {
    const cur = UI()[section];
    S.settings.ui[section] = key == null ? value : Object.assign({}, cur, { [key]: value });
    persist(section, 'ui');
    applyTheme();
    uiChanged(section, key);
  }
  function setOrg(key, value) {
    S.settings.organize[key] = value;
    persist(key, 'organize');
    renderSide();
  }
  function applyTheme() {
    T.apply(S.settings ? S.settings.ui : {}, api);
    if (S.graphInst) S.graphInst.setColors(graphColors());
  }
  function uiChanged(section, key) {
    if (section === 'graph' && S.graphInst && ['repel', 'linkDistance', 'nodeSize', 'textFade'].includes(key)) { S.graphInst.setForces({ [key]: UI().graph[key] }); return; }
    if (section === 'graph' && S.graphInst && key === 'labels') { S.graphInst.setLabels(UI().graph.labels); renderView(); return; }
    if (section === 'graph') { if (S.graphInst) { S.graphInst.destroy(); S.graphInst = null; } }
    if (section === 'appearance' && !['zoom', 'radius', 'readingSize', 'accent'].includes(key)) { renderAll(); return; }
    if (section === 'explorer' || section === 'layout' || section === 'graph' || section === 'hotkeys') renderAll();
    if (section === 'library' && (key === 'treeTags' || key === 'thumbs' || key === 'details')) renderAll();
  }
  T.onSystemChange(() => applyTheme());

  // ======================================================================= notices / tooltip
  function notice(msg, type, ms, action) {
    const el = document.createElement('div');
    el.className = 'notice ' + (type || '');
    el.setAttribute('role', 'status');
    const ic = { success: 'check-circle', error: 'alert-triangle', warn: 'alert-triangle' }[type] || 'info';
    el.innerHTML = icon(ic) + '<div>' + msg + (action ? '<a class="n-action">' + esc(action.label) + '</a>' : '') + '</div>';
    const box = $('#notices');
    box.appendChild(el);
    const live = [...box.querySelectorAll('.notice:not(.out)')];
    for (const old of live.slice(0, Math.max(0, live.length - 3))) { old.classList.add('out'); setTimeout(() => old.remove(), 200); }
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
    el.addEventListener('click', e => { if (action && e.target.closest('.n-action')) action.run(); close(); });
    setTimeout(close, ms || (UI().layout.noticeSeconds || 5) * 1000 * (action ? 1.6 : 1));
  }

  const tip = $('#tooltip');
  let tipEl = null;
  function showTip(el, text, x, y) {
    tip.innerHTML = text;
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    if (x == null) {
      const b = el.getBoundingClientRect();
      if (el.closest('.ribbon')) { x = b.right + 8; y = b.top + b.height / 2 - r.height / 2; }
      else { x = b.left + b.width / 2 - r.width / 2; y = b.bottom + 6; }
    } else { x += 14; y += 14; }
    x = Math.max(6, Math.min(window.innerWidth - r.width - 6, x));
    if (y + r.height > window.innerHeight - 6) y = window.innerHeight - r.height - 6;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.classList.remove('show'); tipEl = null; }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (el === tipEl) return;
    if (!el) { hideTip(); return; }
    tipEl = el;
    const cmd = el.dataset.cmd ? hotkeyLabel(effectiveHotkey(el.dataset.cmd)) : '';
    const k = cmd ? '<span class="kbd">' + esc(cmd) + '</span>' : '';
    clearTimeout(showTip.t);
    showTip.t = setTimeout(() => { if (tipEl === el) showTip(el, esc(el.dataset.tip) + k); }, el.closest('.tree') ? 450 : 250);
  });
  document.addEventListener('mousedown', hideTip);

  // ======================================================================= menus
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function showMenu(items, x, y, opts) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = items.map((it, i) => {
      if (it === 'sep') return '<div class="menu-sep"></div>';
      if (it.heading) return '<div class="menu-label">' + esc(it.heading) + '</div>';
      return '<button class="menu-item' + (it.danger ? ' danger' : '') + '" role="menuitem" data-i="' + i + '">' + (it.icon ? icon(it.icon) : '') + '<span>' + esc(it.label) + '</span>' +
        (it.sub ? '<span class="sub">' + esc(it.sub) + '</span>' : '') + (it.check ? icon('check', 'xs') : '') + '</button>';
    }).join('');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    if (opts && opts.above) y = y - r.height - 6;
    m.style.left = Math.max(6, Math.min(window.innerWidth - r.width - 6, x)) + 'px';
    m.style.top = Math.max(6, Math.min(window.innerHeight - r.height - 6, y)) + 'px';
    m.addEventListener('click', e => {
      const b = e.target.closest('.menu-item'); if (!b) return;
      const it = items[+b.dataset.i]; closeMenu(); it.action && it.action();
    });
    m.addEventListener('keydown', e => {
      const btns = [...m.querySelectorAll('.menu-item')];
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { btns[(i + 1) % btns.length].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { btns[(i - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
      else if (e.key === 'Escape') { closeMenu(); e.stopPropagation(); }
    });
    menuEl = m;
    if (opts && opts.keyboard) { const f = m.querySelector('.menu-item'); f && f.focus(); }
  }
  document.addEventListener('mousedown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  window.addEventListener('blur', closeMenu);

  // ======================================================================= modals
  const modals = [];
  function modal(o) {
    const c = document.createElement('div');
    c.className = 'modal-container';
    c.innerHTML = '<div class="modal-bg"></div><div class="modal ' + (o.cls || '') + '" role="dialog" aria-modal="true">' +
      (o.noClose ? '' : '<button class="clickable-icon modal-close" data-close aria-label="Close">' + icon('x') + '</button>') +
      (o.title ? '<div class="modal-title">' + o.title + '</div>' : '') +
      (o.html != null ? '<div class="modal-content">' + o.html + '</div>' : '') +
      (o.buttons ? '<div class="modal-button-container">' + o.buttons.map((b, i) => '<button class="btn ' + (b.cls || '') + '" data-b="' + i + '">' + b.label + '</button>').join('') + '</div>' : '') +
      '</div>';
    const prevFocus = document.activeElement;
    document.body.appendChild(c);
    const m = { el: c, box: c.querySelector('.modal'), close };
    function close() {
      c.remove(); const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1);
      o.onClose && o.onClose();
      if (prevFocus && prevFocus.isConnected) try { prevFocus.focus(); } catch { /* ignore */ }
    }
    c.querySelector('.modal-bg').addEventListener('mousedown', close);
    c.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) close();
      const b = e.target.closest('[data-b]');
      if (b) { const def = o.buttons[+b.dataset.b]; if (def.action) { if (def.action(m) !== false) close(); } else close(); }
    });
    // keep Tab inside the dialog
    c.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const f = [...m.box.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
    });
    modals.push(m);
    const first = c.querySelector('[autofocus]') || c.querySelector('.mod-cta, .mod-warning');
    if (first) setTimeout(() => first.focus(), 30);
    return m;
  }
  function confirmModal(title, html, label, run, danger) {
    modal({ title, html, buttons: [{ label: 'Cancel' }, { label, cls: danger ? 'mod-warning' : 'mod-cta', action: () => { run(); } }] });
  }
  function textPrompt(o) {
    const m = modal({
      title: o.title,
      html: (o.desc ? '<p>' + o.desc + '</p>' : '') + '<input class="text-input" id="tpInput" spellcheck="false" autofocus value="' + esc(o.value || '') + '" placeholder="' + esc(o.placeholder || '') + '"><div class="field-error" id="tpErr"></div>',
      buttons: [{ label: 'Cancel' }, { label: o.ok || 'Save', cls: 'mod-cta', action: () => submit() }],
    });
    const input = m.box.querySelector('#tpInput');
    setTimeout(() => { input.focus(); input.select(); }, 40);
    function submit() {
      const err = o.validate ? o.validate(input.value) : '';
      if (err) { m.box.querySelector('#tpErr').textContent = err; input.focus(); return false; }
      o.run(input.value); return true;
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { if (submit()) m.close(); e.preventDefault(); } });
  }

  // ======================================================================= tree rendering
  function buildTree(entries, dirs) {
    const root = { name: '', path: '', folders: new Map(), files: [], data: {} };
    const ensure = p => {
      if (!p) return root;
      let node = root, acc = '';
      for (const seg of p.split('/')) {
        acc = acc ? acc + '/' + seg : seg;
        const k = seg.toLowerCase();
        if (!node.folders.has(k)) node.folders.set(k, { name: seg, path: acc, folders: new Map(), files: [], data: {} });
        node = node.folders.get(k);
      }
      return node;
    };
    for (const d of dirs || []) Object.assign(ensure(d.path).data, d.data || {});
    for (const e of entries) ensure(dirname(e.path)).files.push(e);
    const count = n => { let c = n.files.length; for (const f of n.folders.values()) c += count(f); n.count = c; return c; };
    count(root);
    return root;
  }
  function fileComparator() {
    const s = UI().explorer.sort;
    if (s === 'modified') return (a, b) => (b.mtime || 0) - (a.mtime || 0) || collator.compare(a.name, b.name);
    if (s === 'size') return (a, b) => (b.size || 0) - (a.size || 0) || collator.compare(a.name, b.name);
    if (s === 'type') return (a, b) => collator.compare(E.splitExt(a.name).ext, E.splitExt(b.name).ext) || collator.compare(a.name, b.name);
    return (a, b) => collator.compare(a.name, b.name);
  }
  function treeHTML(node, cfg) {
    const ex = UI().explorer;
    const folders = [...node.folders.values()].sort((a, b) => collator.compare(a.name, b.name)).filter(f => !(cfg.hideFolder && cfg.hideFolder(f)));
    const files = node.files.slice().sort(fileComparator());
    const folderHTML = f => {
      const open = cfg.isOpen(f);
      return '<div class="tree-item' + (open ? '' : ' is-collapsed') + '">' +
        '<div class="tree-item-self mod-folder ' + (cfg.folderClass ? cfg.folderClass(f) : '') + '" tabindex="-1" role="treeitem" aria-expanded="' + open + '" data-kind="folder" data-tree="' + cfg.id + '" data-path="' + esc(f.path) + '">' +
        '<div class="collapse-icon">' + icon('chevron-down') + '</div>' +
        '<div class="tree-item-inner">' + esc(f.name) + '</div>' +
        '<div class="tree-item-flair">' + (cfg.folderFlair ? cfg.folderFlair(f) : '') + '</div></div>' +
        '<div class="tree-item-children" role="group">' + (open ? treeHTML(f, cfg) : '') + '</div></div>';
    };
    const fileHTML = e => {
      const { base, ext } = splitName(e.name);
      const t = cfg.fileTip ? cfg.fileTip(e) : '';
      return '<div class="tree-item"><div class="tree-item-self mod-file ' + (cfg.fileClass ? cfg.fileClass(e) : '') + '" tabindex="-1" role="treeitem" data-kind="file" data-tree="' + cfg.id +
        '" data-path="' + esc(e.path) + '" data-source="' + esc(e.source) + '"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' +
        '<div class="tree-item-inner">' + esc(base) + '</div>' +
        '<div class="tree-item-flair">' + (cfg.fileFlair ? cfg.fileFlair(e) : '') + (ext ? '<span class="nav-file-tag">' + esc(ext) + '</span>' : '') + '</div></div></div>';
    };
    if (ex.foldersFirst || UI().explorer.sort !== 'name') return folders.map(folderHTML).join('') + files.map(fileHTML).join('');
    const mixed = folders.map(f => ({ n: f.name, h: () => folderHTML(f) })).concat(files.map(e => ({ n: e.name, h: () => fileHTML(e) })));
    return mixed.sort((a, b) => collator.compare(a.n, b.n)).map(x => x.h()).join('');
  }

  // ----------------------------------------------------------------- explorer (left)
  function renderExplorer() {
    const el = $('#explorer');
    $('#vaultSwitcher .name').textContent = S.vault ? S.vault.vaultName : 'No vault open';
    if (!S.vault) { el.innerHTML = '<div class="nav-empty">No folder open.<br><a class="mod-link" data-action="open-folder">Open a folder</a><br><a class="mod-link" data-action="places">Browse This PC</a></div>'; return; }
    const f = S.explorerFilter.trim().toLowerCase();
    const plan = planBySource();
    const ex = UI().explorer;
    let files = S.vault.files;
    if (f) files = files.filter(x => x.path.toLowerCase().includes(f));
    const entries = files.map(x => ({ path: x.path, name: x.name, source: x.path, size: x.size, mtime: x.lastModified, item: plan.get(x.path) }));
    const dirs = f ? [] : S.vault.dirs.map(d => ({ path: d.path, data: { opaque: d.opaque } }));
    const kinds = kindsMap();
    const treeTags = UI().library.treeTags !== false;
    const html = treeHTML(buildTree(entries, dirs), {
      id: 'explorer',
      isOpen: n => !!f || S.explorerOpen.has(n.path),
      folderFlair: n => n.data.opaque ? '<span class="pill muted">not scanned</span>' : bundlePill(n.path, kinds),
      folderClass: n => n.data.opaque ? 'mod-faint' : '',
      fileClass: e => (S.selected === e.source ? 'is-active' : '') + (e.item && e.item.skip ? ' mod-skipped' : ''),
      fileFlair: e => (treeTags ? tagDots(e.source) : '') + (ex.sizes ? '<span>' + fmt(e.size) + '</span>' : '') + (ex.moveDots && e.item && isMoving(e.item) ? '<span class="move-dot"></span>' : ''),
      fileTip: e => {
        const t = treeTags ? LIB.tagsOf(e.source) : [];
        return [e.item && isMoving(e.item) ? 'Moves to ' + (dirname(e.item.target) || 'top level') + '/' : '', t.length ? t.map(x => '#' + x).join('  ') : ''].filter(Boolean).join('\n');
      },
    });
    el.innerHTML = html || '<div class="nav-empty">' + (f ? 'No files match “' + esc(S.explorerFilter) + '”.' : 'This folder is empty.') + '</div>';
  }

  function tagDots(p) {
    const t = LIB.tagsOf(p);
    if (!t.length) return '';
    return '<span class="tree-tags">' + t.slice(0, 3).map(x => '<span style="background:' + LIB.tagColor(x) + '"></span>').join('') + '</span>';
  }

  // ======================================================================= main views
  function viewMeta(v) {
    if (v === 'structure') return { title: S.plan ? 'Proposed structure' : 'Overview' };
    if (v === 'changes') return { count: S.plan ? S.plan.items.filter(isMoving).length : null };
    return {};
  }
  function btnIcon(action, ic, tipText) { return '<button class="clickable-icon" data-action="' + action + '" data-tip="' + esc(tipText) + '" aria-label="' + esc(tipText) + '">' + icon(ic) + '</button>'; }
  function viewHeader(v) {
    const root = document.querySelector('.view-root[data-view="' + v + '"]');
    if (!root) return;
    const name = v === 'structure' ? (S.plan ? 'Proposed structure' : 'Overview') : WS.VIEWS[v].name;
    if (!root.querySelector('[data-title]')) return;
    root.querySelector('[data-title]').innerHTML = S.vault ? '<span class="crumb">' + esc(S.vault.vaultName) + '</span><span class="sep">/</span>' + esc(name) : esc(name);
    let actions = '';
    if (v === 'structure' && S.plan) actions = btnIcon('expand-proposed', 'chevrons-up-down', 'Expand all') + btnIcon('collapse-proposed', 'chevrons-down-up', 'Collapse all');
    if (v === 'graph' && S.vault) actions = btnIcon('graph-fit', 'crosshair', 'Fit to view');
    if (v === 'library' && S.vault) actions = btnIcon('lib-autotag', 'sparkles', 'Tag automatically') + btnIcon('quick-find', 'search', 'Quick find');
    root.querySelector('[data-actions]').innerHTML = actions;
  }
  function renderTabs() {
    // remember scroll positions: moving views between docks would otherwise reset them
    const pos = [...document.querySelectorAll('.view-root .view-content, .view-root .nav-files, .view-root .side-content')].map(el => [el, el.scrollTop]);
    WS.render();
    for (const [el, y] of pos) el.scrollTop = y;
  }
  function renderView() {
    for (const v of MAIN_VIEWS) {
      if (!WS.isVisible(v)) { if (v === 'graph' && S.graphInst) { S.graphInst.destroy(); S.graphInst = null; } continue; }
      renderOne(v);
    }
  }
  function renderOne(v) {
    viewHeader(v);
    const el = $('#vs-' + v);
    if (v === 'library') { LIB.renderLibrary(el); return; }
    if (v === 'tags') { LIB.renderTagsPanel(el); return; }
    el.classList.toggle('busy', S.busy);
    if (v === 'structure' && S.vault && S.vault.browse) { el.innerHTML = browseOverviewHTML(); return; }
    if (v === 'structure') { const y = el.scrollTop; el.innerHTML = S.vault ? structureHTML() : emptyStateHTML(); el.scrollTop = y; return; }
    if (S.vault && S.vault.browse && (v === 'graph' || v === 'changes')) {
      if (v === 'graph' && S.graphInst) { S.graphInst.destroy(); S.graphInst = null; }
      el.innerHTML = '<div class="empty-state"><div class="empty-inner">' + icon('shield-check') + '<div class="sub">' + (v === 'graph' ? 'The graph maps a folder Onyx has fully read. Open a folder (not a whole drive) to see it.' : 'Nothing to change here: this location is browse-only.') + '</div><button class="btn" data-action="view-library">' + icon('library') + 'Browse in the Library</button></div></div>';
      return;
    }
    if (!S.vault) {
      if (v === 'graph' && S.graphInst) { S.graphInst.destroy(); S.graphInst = null; }
      el.innerHTML = '<div class="empty-state"><div class="empty-inner"><img class="logo small" src="icon.png" alt=""><div class="sub">' + (v === 'graph' ? 'The graph shows your folder as a map once a folder is open.' : 'Every move Onyx proposes will be listed here.') + '</div><button class="btn mod-cta" data-action="open-folder">' + icon('folder-open') + 'Open folder</button></div></div>';
      return;
    }
    if (v === 'changes') {
      const y = el.scrollTop;
      el.innerHTML = changesHTML(); el.scrollTop = y;
      const inp = $('#changesFilter');
      if (inp) inp.addEventListener('input', () => { S.changesFilter = inp.value; const p = inp.selectionStart; renderOne('changes'); const n = $('#changesFilter'); n.focus(); n.setSelectionRange(p, p); });
      return;
    }
    if (v === 'graph') renderGraph(el);
  }
  function updateCounts() {
    const n = S.plan ? S.plan.items.filter(isMoving).length : null;
    document.querySelectorAll('.tab[data-view="changes"] .count').forEach(c => { c.textContent = n == null ? '' : n; });
  }

  function emptyStateHTML() {
    const recent = (S.settings && S.settings.ui && S.settings.ui.recent) || [];
    const k = id => { const l = hotkeyLabel(effectiveHotkey(id)); return l ? '<span class="hint">' + esc(l) + '</span>' : ''; };
    return '<div class="empty-state"><div class="empty-inner"><img class="logo" src="icon.png" alt="">' +
      '<h1>Onyx</h1><div class="sub">Open a messy folder. Onyx proposes a clean structure, you review it, and nothing moves until you say so.</div>' +
      '<div class="empty-actions">' +
      '<button class="empty-action" data-action="open-folder">' + icon('folder-open') + 'Open folder as vault' + k('open-folder') + '</button>' +
      '<button class="empty-action" data-action="places">' + icon('monitor') + 'Browse This PC<span class="hint">Explore whole drives, browse-only</span></button>' +
      '<button class="empty-action" data-action="demo">' + icon('flask-conical') + 'Try the demo vault<span class="hint">Nothing on disk is touched</span></button>' +
      '<button class="empty-action" data-action="palette">' + icon('terminal-square') + 'Open command palette' + k('palette') + '</button>' +
      '<button class="empty-action" data-action="settings-appearance">' + icon('palette') + 'Make it yours: themes, fonts, layout' + k('settings') + '</button>' +
      '</div>' +
      (recent.length ? '<div class="recent-title">Recent</div>' + recent.map(p => '<button class="recent-item" data-action="open-recent" data-path="' + esc(p) + '"><span class="r-name">' +
        esc(p.split(/[\\/]/).filter(Boolean).pop() || p) + '</span><span class="r-path">' + esc(p) + '</span></button>').join('') : '') +
      '<div class="drop-hint">Tip: drop a folder anywhere on this window to open it.</div>' +
      '</div></div>';
  }

  function browseOverviewHTML() {
    const V = S.vault;
    return '<div class="markdown-reading-view"><div class="inline-title">' + esc(V.vaultName) + '</div>' +
      '<div class="metadata"><div class="metadata-title">' + icon('info', 'xs') + 'Properties</div>' +
      prop('hard-drive', 'location', '<span class="muted">' + esc(V.rootPath) + '</span>') +
      prop('shield-check', 'mode', '<span class="tag grey">browse only</span>') + '</div>' +
      callout('tip', 'shield-check', 'Explore, search and tag, safely', '<p>' + esc(V.rootPath) + ' is a drive or system folder. Onyx lets you browse it like File Explorer, search it, preview and open files, and tag them, but it will never move anything here.</p>' +
        '<p style="margin-top:10px">To tidy a folder inside it, right-click the folder in the Library and choose <b>Organize this folder</b>.</p>' +
        '<p style="margin-top:12px"><button class="btn mod-cta" data-action="view-library">' + icon('library') + 'Browse in the Library</button> <button class="btn" data-action="places">' + icon('monitor') + 'This PC</button></p>') + '</div>';
  }
  function prop(ic, key, val) { return '<div class="metadata-property"><div class="metadata-key">' + icon(ic) + esc(key) + '</div><div class="metadata-value">' + val + '</div></div>'; }
  function callout(kind, ic, title, body) { return '<div class="callout ' + kind + '"><div class="callout-title">' + icon(ic) + esc(title) + '</div><div class="callout-content">' + body + '</div></div>'; }

  function structureHTML() {
    const V = S.vault, P = S.plan;
    let h = '<div class="markdown-reading-view">';
    const st = orgSettings();
    const kinds = kindsMap();
    const looseMovable = V.files.filter(f => !E.untouchableReason(f) && !E.nestedKeepReason(f, kinds, st));
    const nestedMovable = looseMovable.filter(f => f.path.includes('/')).length;
    const bundles = [...kinds.values()].filter(k => k.kind === 'bundle' && k.root === k.path);
    const depthLabel = { smart: 'loose files and general folders', all: 'everything except bundles', top: 'only loose files' }[st.depth] || 'loose files and general folders';
    const markers = E.buildContext(V.files, V.dirs).rootMarkers;
    const org = S.settings.organize || {};
    const ruleCount = (org.rules || []).filter(r => r.enabled !== false && r.folder).length;
    if (!P) {
      const total = V.files.reduce((a, f) => a + f.size, 0);
      h += '<div class="inline-title">' + esc(V.vaultName) + '</div>';
      h += '<div class="metadata"><div class="metadata-title">' + icon('info', 'xs') + 'Properties</div>' +
        prop('folder', 'location', V.demo ? '<span class="tag grey">demo, in memory</span>' : '<span class="muted">' + esc(V.rootPath) + '</span>') +
        prop('files', 'files', '<span>' + V.files.length + '</span><span class="muted">' + fmt(total) + '</span>') +
        prop('folder-open', 'folders', String(V.dirs.length)) +
        prop('file', 'Onyx can sort', '<span class="tag">' + looseMovable.length + '</span>' + (nestedMovable ? '<span class="muted">' + nestedMovable + ' inside folders</span>' : '')) +
        prop('folder-input', 'sorting', '<span>' + esc(depthLabel) + '</span> <a class="mod-link" data-action="settings-organizing">Change</a>') +
        (bundles.length ? prop('package', 'kept together', bundles.slice(0, 4).map(b => '<span class="tag grey" data-tip="' + esc(b.why) + '">' + esc(basename(b.path)) + '</span>').join('') + (bundles.length > 4 ? '<span class="muted">+' + (bundles.length - 4) + ' more</span>' : '')) : '') +
        prop('list-checks', 'your rules', ruleCount ? '<span>' + plural(ruleCount, 'rule') + '</span> <a class="mod-link" data-action="settings-rules">Edit</a>' : '<a class="mod-link" data-action="settings-rules">Add a rule</a>') + '</div>';
      if (markers.length) h += callout('warning', 'alert-triangle', 'This looks like a project folder', '<p>Found ' + markers.map(m => '<code>' + esc(m) + '</code>').join(' ') + ' at the top level. Moving files here could break the project. Consider organizing a different folder.</p>');
      if (looseMovable.length) {
        const what = st.depth === 'top' ? 'sitting loose at the top of this folder. Anything already inside a folder stays exactly where it is'
          : st.depth === 'all' ? 'here, including ones inside your folders. Only bundles (projects, apps, 3D assets with textures) stay together'
          : 'sitting loose or in general folders like Documents or New folder. Bundles (projects, apps, 3D assets) and your own named folders stay as they are';
        h += callout('tip', 'sparkles', 'Ready to organize', '<p>Onyx will sort the <b>' + plural(looseMovable.length, 'file') + '</b> ' + what + '. You review every move before it happens.</p>' +
          '<p style="margin-top:12px"><button class="btn mod-cta" data-action="organize">' + icon(stratById(S.strategy).icon) + 'Organize · ' + esc(stratById(S.strategy).name) + '</button></p>');
        h += '<h2>Files to sort <span class="muted" style="font-weight:400;font-size:.8em">' + looseMovable.length + '</span></h2><div class="tree" tabindex="0" role="tree" aria-label="Files to sort">' +
          treeHTML(buildTree(looseMovable.slice(0, 400).map(f => ({ path: f.path, name: f.name, source: f.path, size: f.size, mtime: f.lastModified })), []), {
            id: 'loose', isOpen: () => true, fileClass: e => S.selected === e.source ? 'is-active' : '',
            fileFlair: e => '<span>' + fmt(e.size) + '</span>',
          }) + '</div>';
      } else {
        h += callout('success', 'check-circle', 'Nothing to sort', '<p>Every file is already in a bundle or one of your own folders. ' + (st.depth !== 'all' ? 'Switch sorting to <a class="mod-link" data-action="settings-organizing">everything except bundles</a> to re-sort inside your folders too, or use <b>Flatten</b> to start over.' : 'Use <b>Flatten</b> to start over from a flat folder.') + '</p>');
      }
      return h + '</div>';
    }

    const moving = P.items.filter(isMoving);
    const existing = existingDirSet();
    const newFolders = new Set();
    for (const it of moving) { let d = dirname(it.target); while (d) { if (!existing.has(d.toLowerCase())) newFolders.add(d.toLowerCase()); d = dirname(d); } }
    const intoExisting = moving.filter(i => existing.has(dirname(i.target).toLowerCase())).length;
    const byYou = moving.filter(i => i.by === 'you' || i.by === 'rule').length;
    const strat = stratById(P.strategy);
    const engine = P.strategy === 'smart' ? (P.ai.used ? '<span class="tag">' + icon('sparkles', 'xs') + esc(P.ai.model || 'AI') + '</span><span class="muted">' + esc(P.ai.providerLabel) + '</span>' : '<span class="tag grey">offline rules (fallback)</span>')
      : P.strategy === 'rules' ? '<span class="tag grey">offline rules</span>' : '<span class="tag grey">' + esc(strat.name.toLowerCase()) + '</span>';
    h += '<div class="inline-title">Proposed structure</div>';
    h += '<div class="metadata"><div class="metadata-title">' + icon('info', 'xs') + 'Properties</div>' +
      prop(strat.icon, 'strategy', '<span class="tag">' + esc(strat.name) + '</span>') +
      prop('cpu', 'engine', engine) +
      prop('folder-input', 'moving', '<span>' + plural(moving.length, 'file') + '</span>' + (intoExisting ? '<span class="muted">· ' + intoExisting + ' into folders you already have</span>' : '')) +
      prop('folder-plus', 'new folders', String(newFolders.size)) +
      (byYou ? prop('list-checks', 'your choices', plural(byYou, 'file') + ' placed by your rules or edits') : '') +
      prop('pin', 'untouched', plural(P.items.length - moving.length, 'file')) + '</div>';
    if (P.demo) h += callout('', 'flask-conical', 'Demo vault', '<p>These files only exist in memory, so <b>Apply</b> is turned off. Open a real folder to move files.</p>');
    if (P.strategy === 'smart' && P.ai.error) h += callout('warning', 'alert-triangle', 'AI unavailable, used offline rules', '<p>' + esc(P.ai.error) + '</p><p class="muted">The offline rules still group series, keywords and types. <a class="mod-link" data-action="settings-ai">Choose another AI provider</a> for better results.</p>');
    if (P.ai && P.ai.used && P.ai.summary) h += callout('example', 'sparkles', 'Why this structure', '<p>' + esc(P.ai.summary) + '</p>');
    if (P.rootMarkers && P.rootMarkers.length) h += callout('warning', 'alert-triangle', 'This looks like a project folder', '<p>Found ' + P.rootMarkers.map(m => '<code>' + esc(m) + '</code>').join(' ') + '. Double-check before applying.</p>');
    if (P.strategy === 'flatten' && moving.length) h += callout('warning', 'alert-triangle', 'Flatten removes your folder structure', '<p>Files inside project folders are left alone, but every other subfolder gets emptied. You can undo it afterwards.</p>');
    if (!moving.length) h += callout('success', 'check-circle', 'Already tidy', '<p>Nothing needs to move with this strategy.</p>');
    h += '<h2>Structure</h2><p class="muted" style="font-size:.86em;margin-top:-4px">Right-click a file or folder to move it somewhere else, rename a new folder, or keep files in place.</p><div class="tree" id="proposedTree" tabindex="0" role="tree" aria-label="Proposed structure">' + proposedTreeHTML() + '</div>';
    return h + '</div>';
  }

  function proposedTreeHTML() {
    const P = S.plan;
    const existing = existingDirSet();
    const entries = P.items.map(it => ({ path: effTarget(it), name: basename(effTarget(it)), source: it.source, size: it.size, item: it }));
    const dirs = S.vault.dirs.map(d => ({ path: d.path, data: { existing: true, opaque: d.opaque } }));
    const tree = buildTree(entries, dirs);
    const incoming = new Map();
    for (const it of P.items) if (isMoving(it)) { let d = dirname(it.target); while (d) { const k = d.toLowerCase(); incoming.set(k, (incoming.get(k) || 0) + 1); d = dirname(d); } }
    return treeHTML(tree, {
      id: 'proposed',
      isOpen: n => S.proposedOpen.has(n.path),
      folderClass: n => (!incoming.has(n.path.toLowerCase()) && existing.has(n.path.toLowerCase()) ? 'mod-faint' : ''),
      folderFlair: n => {
        const k = n.path.toLowerCase();
        const inc = incoming.get(k) || 0;
        if (!existing.has(k)) return '<span>' + n.count + '</span><span class="pill new">new</span>';
        if (inc) return '<span>' + n.count + '</span><span class="pill in">+' + inc + '</span>';
        return n.data.opaque ? '<span class="pill muted">not scanned</span>' : '<span>' + n.count + '</span>' + bundlePill(n.path, kindsMap());
      },
      fileClass: e => (isMoving(e.item) ? 'mod-incoming' : 'mod-faint') + (e.item.skip ? ' mod-skipped' : '') + (S.selected === e.source ? ' is-active' : ''),
      fileFlair: e => {
        if (e.item.skip) return '<span class="pill muted">kept</span>';
        if (e.item.by === 'you') return '<span class="pill you">you</span>';
        if (e.item.by === 'rule') return '<span class="pill you">rule</span>';
        if (e.item.kind === 'keep' && !e.source.includes('/')) return '<span class="pill muted">stays</span>';
        return '';
      },
      fileTip: e => {
        const it = e.item;
        if (it.skip) return 'Kept in place (you excluded it)';
        if (it.kind === 'move') return it.reason + '\nFrom: ' + (dirname(it.source) || 'top level') + (basename(it.source) !== basename(it.target) ? '\nRenamed: ' + basename(it.target) : '');
        return it.reason;
      },
    });
  }

  function changesHTML() {
    const P = S.plan;
    if (!P) {
      return '<div class="empty-state"><div class="empty-inner"><h1 style="font-size:20px">No changes yet</h1><div class="sub">Run Organize to get a list of every move Onyx would make. You can untick anything, send files somewhere else, or turn a choice into a rule.</div>' +
        '<button class="btn mod-cta" data-action="organize">' + icon('sparkles') + 'Organize</button></div></div>';
    }
    const all = P.items.filter(i => i.kind === 'move');
    const q = S.changesFilter.trim().toLowerCase();
    const shown = q ? all.filter(i => (i.source + ' ' + i.target + ' ' + i.reason).toLowerCase().includes(q)) : all;
    const groups = new Map();
    for (const it of shown) { const d = dirname(it.target) || '(top level)'; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(it); }
    const existing = existingDirSet();
    const sel = all.filter(i => !i.skip).length;
    let h = '<div class="changes"><div class="changes-toolbar">' +
      '<div class="search-wrap">' + icon('search', 'xs') + '<input class="search-input" id="changesFilter" placeholder="Filter changes…" aria-label="Filter changes" spellcheck="false" value="' + esc(S.changesFilter) + '"></div>' +
      '<a class="mod-link" data-action="select-all" tabindex="0">Select all</a><a class="mod-link" data-action="select-none" tabindex="0">None</a>' +
      '<span class="summary">' + sel + ' of ' + all.length + ' moves selected</span></div>';
    if (!all.length) h += '<p class="muted" style="padding:20px 8px">Nothing to move with this strategy.</p>';
    else if (!shown.length) h += '<p class="muted" style="padding:20px 8px">No changes match “' + esc(q) + '”.</p>';
    for (const [dir, items] of [...groups.entries()].sort((a, b) => collator.compare(a[0], b[0]))) {
      const isNew = dir !== '(top level)' && !existing.has(dir.toLowerCase());
      h += '<div class="change-group"><div class="change-group-title">' + icon('folder') + '<span class="g-name" title="' + esc(dir) + '">' + esc(dir) + '</span>' + (isNew ? '<span class="pill new">new</span>' : '<span class="pill in">existing</span>') +
        '<span class="g-actions"><span>' + items.length + '</span>' + (isNew ? '<button class="clickable-icon" data-action="rename-folder" data-path="' + esc(dir) + '" data-tip="Rename this folder" aria-label="Rename folder">' + icon('pencil') + '</button>' : '') +
        '<button class="clickable-icon" data-action="move-group" data-path="' + esc(dir) + '" data-tip="Move all of these to another folder" aria-label="Move group">' + icon('folder-input') + '</button></span></div>';
      for (const it of items.sort((a, b) => collator.compare(a.name, b.name))) {
        h += '<div class="change-row' + (it.skip ? ' is-skipped' : '') + (S.selected === it.source ? ' is-active' : '') + '" data-source="' + esc(it.source) + '">' +
          '<input type="checkbox" class="checkbox" aria-label="Move ' + esc(it.name) + '" data-toggle-skip="' + esc(it.source) + '"' + (it.skip ? '' : ' checked') + '>' +
          '<div class="c-name">' + icon(fileIconName(it.extension)) + '<span title="' + esc(it.source) + '">' + esc(it.source) + '</span></div>' +
          '<div class="c-arrow">' + icon('arrow-right', 'xs') + '</div>' +
          '<div class="c-reason" title="' + esc(it.reason) + '">' + esc(basename(it.target) !== it.name ? 'as ' + basename(it.target) + ' · ' : '') + esc(it.reason) + '</div>' +
          '<button class="clickable-icon c-more" data-action="row-menu" data-source="' + esc(it.source) + '" aria-label="More actions for ' + esc(it.name) + '">' + icon('more-horizontal') + '</button></div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  // ----------------------------------------------------------------- graph
  function graphColors() {
    const c = T.colors() || {};
    const dark = c.mode !== 'light';
    const accent = T.hexToRgb(c.accent || '#d7dae2').join(',');
    return {
      link: dark ? 'rgba(200,206,220,.13)' : 'rgba(40,44,60,.16)', dim: dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)',
      lit: 'rgba(' + accent + ',.9)', focus: c.accent || '#ffffff', text: c.text || '#e6e6ea', muted: c.muted || '#9a9ba4',
      font: getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif',
    };
  }
  function graphData() {
    const V = S.vault, G = UI().graph;
    const mode = S.plan ? S.graphMode : 'current';
    const entries = mode === 'proposed'
      ? S.plan.items.map(it => ({ path: effTarget(it), source: it.source, moving: isMoving(it), ext: it.extension }))
      : V.files.map(f => ({ path: f.path, source: f.path, moving: false, ext: f.extension }));
    const dirSet = new Set();
    for (const d of V.dirs) dirSet.add(d.path);
    for (const e of entries) { let d = dirname(e.path); while (d) { dirSet.add(d); d = dirname(d); } }
    const existing = existingDirSet();
    let showFiles = G.files;
    if (showFiles && entries.length + dirSet.size > 1800) showFiles = false;
    const palette = (T.colors() || {}).groupColors || ['#888'];
    const unchangedCol = (T.colors() || {}).mode === 'light' ? '#a8a9b2' : '#62636c';
    let groups;
    if (G.colorBy === 'type') groups = [...new Set(entries.map(e => E.typeFolder(e.ext || '').split('/')[0]))].sort(collator.compare);
    else groups = [...new Set([...dirSet].map(d => d.split('/')[0]))].sort(collator.compare);
    const colorOfGroup = g => { const i = groups.indexOf(g); return i < 0 ? unchangedCol : palette[i % palette.length]; };
    const folderColor = p => G.colorBy === 'type' ? ((T.colors() || {}).muted || '#999') : colorOfGroup(p.split('/')[0]);
    const fileColor = e => G.colorBy === 'type' ? colorOfGroup(E.typeFolder(e.ext || '').split('/')[0]) : (dirname(e.path) ? colorOfGroup(e.path.split('/')[0]) : unchangedCol);
    const count = new Map();
    for (const e of entries) { let d = dirname(e.path); while (d) { count.set(d, (count.get(d) || 0) + 1); d = dirname(d); } }
    const nodes = [{ id: 'root', label: V.vaultName, kind: 'root', color: (T.colors() || {}).accent || '#d7dae2', r: 9 }];
    const links = [];
    const seen = new Set();
    for (const d of [...dirSet].sort()) {
      const k = d.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
      const c = count.get(d) || 0;
      nodes.push({ id: 'd:' + k, label: basename(d), kind: 'folder', path: d, color: folderColor(d), r: 4 + Math.min(7, Math.sqrt(c) * 1.2),
        ring: mode === 'proposed' && !existing.has(k) ? 'rgba(' + T.hexToRgb((T.colors() || {}).accent || '#ccc').join(',') + ',.55)' : null });
      const p = dirname(d);
      links.push({ s: p ? 'd:' + p.toLowerCase() : 'root', t: 'd:' + k, len: 60 });
    }
    if (showFiles) {
      for (const e of entries) {
        const p = dirname(e.path);
        const unchanged = mode === 'proposed' && !e.moving;
        nodes.push({ id: 'f:' + e.path.toLowerCase(), label: basename(e.path), kind: 'file', path: e.path, source: e.source, color: unchanged ? unchangedCol : fileColor(e), r: 2.8 });
        links.push({ s: p ? 'd:' + p.toLowerCase() : 'root', t: 'f:' + e.path.toLowerCase(), len: 28 });
      }
    }
    return { nodes, links, groups, colorOfGroup, mode, capped: G.files && !showFiles, unchangedCol };
  }
  function slider(action, label, value, min, max, step) {
    const pct = ((value - min) / (max - min)) * 100;
    return '<div class="gc-row col"><div class="lbl"><span>' + label + '</span><span>' + (+value).toFixed(1) + '×</span></div>' +
      '<input type="range" class="slider" data-graph-slider="' + action + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" style="--fill:' + pct + '%" aria-label="' + label + '"></div>';
  }
  function renderGraph(v) {
    const data = graphData();
    const G = UI().graph;
    if (!S.graphInst || !v.querySelector('.graph-view')) {
      if (S.graphInst) { S.graphInst.destroy(); S.graphInst = null; }
      v.innerHTML = '<div class="graph-view" id="graphView"></div>';
      S.graphInst = new OnyxGraph($('#graphView'), {
        labels: G.labels, colors: graphColors(),
        forces: { repel: G.repel, linkDistance: G.linkDistance, nodeSize: G.nodeSize, textFade: G.textFade },
        onHover: (n, e) => {
          if (!n) { hideTip(); return; }
          tip.innerHTML = esc(n.kind === 'root' ? S.vault.vaultName : n.path) + (n.kind === 'folder' ? '<span class="kbd">folder</span>' : '');
          tip.classList.add('show'); showTip(null, tip.innerHTML, e.clientX, e.clientY);
        },
        onSelect: n => { if (n.kind === 'file') select(n.source, 'graph'); },
        onOpen: n => { if (!S.vault.demo && n.kind !== 'root') api.reveal(n.kind === 'file' ? n.source : n.path); },
      });
      S.graphInst.setData(data);
    } else S.graphInst.setData(data, true);
    v.querySelectorAll('.graph-controls,.graph-legend,.graph-hint').forEach(x => x.remove());
    const gv = $('#graphView');
    const legend = data.groups.slice(0, 10).map(t => '<span class="lg"><span class="dot" style="background:' + data.colorOfGroup(t) + '"></span>' + esc(t) + '</span>').join('') +
      (data.mode === 'proposed' ? '<span class="lg"><span class="dot" style="background:' + data.unchangedCol + '"></span>unchanged</span>' : '');
    const seg = (act, cur, opts) => '<div class="segmented">' + opts.map(([v2, l]) => '<button data-action="' + act + '" data-v="' + v2 + '" class="' + (cur === v2 ? 'is-active' : '') + '">' + l + '</button>').join('') + '</div>';
    gv.insertAdjacentHTML('beforeend',
      '<div class="graph-controls' + (S.graphPanel ? '' : ' collapsed') + '">' +
      '<div class="gc-head">' + (S.graphPanel ? 'Display' : '') + '<span class="spacer"></span>' + btnIcon('graph-panel', S.graphPanel ? 'x' : 'settings-2', S.graphPanel ? 'Close' : 'Graph settings') + '</div>' +
      '<div class="gc-body">' +
      (S.plan ? '<div class="gc-row">Show' + seg('graph-mode', data.mode, [['current', 'Current'], ['proposed', 'Proposed']]) + '</div>' : '') +
      '<div class="gc-row">Color by' + seg('graph-color', G.colorBy, [['folder', 'Folder'], ['type', 'File type']]) + '</div>' +
      '<div class="gc-row">Files<button class="toggle' + (G.files ? ' is-enabled' : '') + '" role="switch" aria-checked="' + G.files + '" aria-label="Show files" data-action="graph-files"></button></div>' +
      '<div class="gc-row">Labels<button class="toggle' + (G.labels ? ' is-enabled' : '') + '" role="switch" aria-checked="' + G.labels + '" aria-label="Show labels" data-action="graph-labels"></button></div>' +
      '<div class="gc-section"><div class="gc-section-title">Forces</div>' +
      slider('nodeSize', 'Node size', G.nodeSize, 0.5, 2.5, 0.1) + slider('linkDistance', 'Link distance', G.linkDistance, 0.4, 2.5, 0.1) +
      slider('repel', 'Repel force', G.repel, 0.2, 3, 0.1) + slider('textFade', 'Text fade threshold', G.textFade, 0.3, 2.5, 0.1) + '</div>' +
      '<div class="gc-section"><div class="gc-row"><button class="btn small" data-action="graph-reheat">' + icon('refresh-cw') + 'Animate</button><button class="btn small" data-action="graph-reset">Reset</button></div></div>' +
      '</div></div>' +
      '<div class="graph-legend">' + legend + '</div>' +
      (data.capped ? '<div class="graph-hint">Too many files to draw, showing folders only</div>' : ''));
  }
  document.addEventListener('input', e => {
    const s = e.target.closest('[data-graph-slider]');
    if (!s) return;
    const key = s.dataset.graphSlider, v = +s.value;
    s.style.setProperty('--fill', ((v - +s.min) / (+s.max - +s.min)) * 100 + '%');
    s.closest('.gc-row').querySelector('.lbl span:last-child').textContent = v.toFixed(1) + '×';
    S.settings.ui.graph = Object.assign({}, UI().graph, { [key]: v });
    persist('graph', 'ui');
    if (S.graphInst) S.graphInst.setForces({ [key]: v });
  });

  // ======================================================================= right sidebar
  function renderSide() {
    const V = S.vault, P = S.plan;
    let h = '<div class="side-section"><div class="side-section-title">Strategy</div><div class="strategy-list" role="radiogroup" aria-label="Strategy"' + (V && V.browse ? ' style="display:none"' : '') + '>';
    for (const s of STRATEGIES) {
      h += '<button class="strategy' + (s.id === S.strategy ? ' is-active' : '') + '" role="radio" aria-checked="' + (s.id === S.strategy) + '" data-action="set-strategy" data-id="' + s.id + '">' + icon(s.icon) +
        '<div><div class="s-name">' + esc(s.name) + (s.badge ? '<span class="badge">' + s.badge + '</span>' : '') + '</div><div class="s-desc">' + esc(s.desc) + '</div></div></button>';
    }
    h += '</div>';
    const progress = S.progress && S.progress.of > 1 ? ' ' + S.progress.batch + '/' + S.progress.of : '';
    const ok = hotkeyLabel(effectiveHotkey('organize'));
    if (V && V.browse) h += '<div class="browse-note">' + icon('shield-check') + '<div><span class="bn-title">Browse only</span><span>' + esc(V.rootPath) + ' is a drive or system folder, so Onyx won’t reorganize it. Right-click a folder in the Library and choose <b>Organize this folder</b> to sort it.</span></div></div>';
    h += '<button class="btn mod-cta block organize-btn" data-action="organize"' + (!V || S.busy || (V && V.browse) ? ' disabled' : '') + '>' +
      (S.busy ? '<span class="spinner"></span>' + (S.strategy === 'smart' ? 'Asking AI…' + progress : 'Working…') : icon(stratById(S.strategy).icon) + (P ? 'Organize again' : 'Organize') + (ok ? '<kbd>' + esc(ok) + '</kbd>' : '')) + '</button>';
    if (!V) h += '<div class="side-note">Open a folder to get started.</div>';
    h += '</div>';

    if (P) {
      const moving = P.items.filter(isMoving).length;
      const existing = existingDirSet();
      const nf = new Set();
      for (const it of P.items) if (isMoving(it)) { let d = dirname(it.target); while (d) { if (!existing.has(d.toLowerCase())) nf.add(d.toLowerCase()); d = dirname(d); } }
      h += '<div class="side-section"><div class="side-section-title">Plan<span class="spacer"></span><a class="mod-link" data-action="view-changes" tabindex="0">Review</a></div>' +
        '<div class="stats"><div class="stat accent"><div class="v">' + moving + '</div><div class="l">moving</div></div>' +
        '<div class="stat"><div class="v">' + nf.size + '</div><div class="l">new folders</div></div>' +
        '<div class="stat"><div class="v">' + (P.items.length - moving) + '</div><div class="l">untouched</div></div></div>' +
        '<div class="btn-row"><button class="btn mod-cta" data-action="apply"' + (P.demo || !moving || S.busy ? ' disabled' : '') + '>' + icon('check') + 'Apply</button>' +
        '<button class="btn" data-action="discard">Discard</button></div>' +
        (P.demo ? '<div class="side-note">Demo vault: applying is off. Open a real folder to move files.</div>' : '<div class="side-note">Nothing is deleted or overwritten. You can undo afterwards.</div>') + '</div>';
    }

    const org = S.settings ? S.settings.organize : {};
    const rc = (org.rules || []).filter(r => r.enabled !== false && r.folder).length, nm = (org.neverMove || []).length;
    h += '<div class="side-section"><div class="side-section-title">Your rules<span class="spacer"></span><a class="mod-link" data-action="settings-rules" tabindex="0">' + (rc || nm ? 'Edit' : 'Add') + '</a></div>' +
      '<div class="rule-count">' + (rc || nm ? plural(rc, 'rule') + ' · ' + plural(nm, 'file') + ' never moved' : 'Teach Onyx where things go, like “anything with minecraft → Games/Minecraft”.') + '</div></div>';

    const ai = S.settings ? S.settings.ai : null;
    if (ai) {
      const prov = S.settings.providers[ai.provider] || {};
      const lastErr = P && P.strategy === 'smart' && P.ai.error;
      const dotCls = ai.provider === 'off' ? '' : lastErr || (S.aiTest && !S.aiTest.ok) ? 'err' : 'ok';
      const model = ai.model || prov.model || '';
      const sub = ai.provider === 'off' ? 'AI smart falls back to rules' : lastErr ? 'Last request failed' : model;
      h += '<div class="side-section"><div class="side-section-title">AI<span class="spacer"></span><a class="mod-link" data-action="settings-ai" tabindex="0">Configure</a></div>' +
        '<button class="ai-card" data-action="settings-ai"><span class="dot ' + dotCls + '"></span><div class="grow"><div class="t1">' + esc(prov.label || ai.provider) + '</div><div class="t2">' + esc(sub) + '</div></div>' + icon('chevron-right', 'xs') + '</button></div>';
    }
    if (V && !V.demo && !V.browse) {
      h += '<div class="side-section"><div class="side-section-title">History</div>' +
        '<div class="history-line">' + (V.undo ? 'Last organize moved ' + plural(V.undo.count, 'file') + ' · ' + ago(V.undo.at) : 'Onyx hasn’t changed anything in this folder yet.') + '</div>' +
        '<button class="btn block" data-action="undo"' + (V.undo && !S.busy ? '' : ' disabled') + '>' + icon('undo-2') + 'Undo last organize</button></div>';
    }
    if (V && V.skipped && V.skipped.length) {
      h += '<div class="side-section"><div class="side-section-title">Skipped while scanning · ' + V.skipped.length + '</div><div class="skipped-list">' + V.skipped.slice(0, 200).map(esc).join('<br>') + '</div></div>';
    }
    $('#side').innerHTML = h;
  }

  // ======================================================================= status bar
  function renderStatus() {
    const V = S.vault, P = S.plan;
    let h = '';
    if (S.busy) h += '<div class="status-bar-item"><span class="spinner" style="width:11px;height:11px;border-width:1.5px"></span>' + (S.strategy === 'smart' ? 'Asking AI' : 'Working') + '</div>';
    if (P) { const n = P.items.filter(isMoving).length; h += '<div class="status-bar-item clickable accent" data-action="view-changes">' + icon('arrow-left-right') + plural(n, 'change') + ' pending</div>'; }
    if (V && V.browse) h += '<div class="status-bar-item" data-tip="Browse only: Onyx won’t reorganize this location">' + icon('shield-check') + 'Browsing ' + esc(V.rootPath) + '</div>';
    else if (V) h += '<div class="status-bar-item">' + plural(V.files.length, 'file') + '</div><div class="status-bar-item">' + plural(V.dirs.length, 'folder') + '</div>';
    const r = T.resolve(S.settings ? S.settings.ui : {});
    h += '<div class="status-bar-item clickable" data-action="theme-menu" data-tip="Appearance">' + icon('palette') + esc(r.p.name) + '</div>';
    if (S.settings) {
      const p = S.settings.ai.provider;
      const col = p === 'off' ? 'var(--text-faint)' : (P && P.ai && P.ai.error && P.strategy === 'smart') ? 'var(--orange)' : 'var(--green)';
      h += '<div class="status-bar-item clickable" data-action="settings-ai" data-tip="AI provider"><span class="dot" style="background:' + col + '"></span>' + (p === 'off' ? 'AI off' : 'AI') + '</div>';
    }
    $('#statusBar').innerHTML = h;
  }

  function renderAll() { renderTabs(); renderExplorer(); renderView(); renderSide(); renderStatus(); }

  // ======================================================================= selection sync
  function select(source, from) {
    S.selected = source;
    openAncestors(S.explorerOpen, source);
    const it = planBySource().get(source);
    if (it) openAncestors(S.proposedOpen, effTarget(it));
    renderExplorer();
    for (const v of ['structure', 'changes']) if (WS.isVisible(v)) renderOne(v);
    requestAnimationFrame(() => {
      const sel = '[data-source="' + CSS.escape(source) + '"]';
      document.querySelectorAll('.view-root ' + sel).forEach(el => {
        const inExplorer = !!el.closest('#explorer');
        if ((from === 'explorer') === inExplorer && from !== 'graph') return;
        el.scrollIntoView({ block: 'nearest', behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth' }); el.classList.add('flash');
      });
    });
  }

  // ======================================================================= plan editing (review UX)
  function allPlanFolders() {
    const set = new Map();
    const add = p => { if (p) set.set(p.toLowerCase(), p); };
    for (const d of (S.vault ? S.vault.dirs : [])) if (!d.opaque) add(d.path);
    if (S.plan) for (const it of S.plan.items) if (isMoving(it)) { let d = dirname(it.target); while (d) { add(d); d = dirname(d); } }
    return [...set.values()].sort(collator.compare);
  }
  function resolveClashes() {
    const items = S.plan.items;
    const taken = new Set(items.filter(i => !isMoving(i)).map(i => i.source.toLowerCase()));
    for (const d of S.vault.dirs) taken.add(d.path.toLowerCase());
    for (const it of items) {
      if (!isMoving(it)) continue;
      let t = it.target; const dir = dirname(t); const { base, ext } = E.splitExt(basename(t)); let n = 2;
      while (taken.has(t.toLowerCase())) { t = E.joinPath(dir, base + ' (' + n + ')' + (ext ? '.' + ext : '')); n++; }
      it.target = t; taken.add(t.toLowerCase());
    }
  }
  function moveItemsTo(items, folder) {
    for (const it of items) {
      if (!folder) { if (it.kind === 'move') it.skip = true; continue; }
      it.target = E.joinPath(folder, it.name); it.kind = 'move'; it.skip = false; it.by = 'you'; it.reason = 'Moved by you';
      if (it.target.toLowerCase() === it.source.toLowerCase()) { it.kind = 'keep'; it.reason = 'Stays where it is'; }
    }
    resolveClashes();
    if (folder) openAncestors(S.proposedOpen, folder + '/x');
    renderAll();
    notice(plural(items.length, 'file') + (folder ? ' will go to <b>' + esc(folder) + '</b>' : ' kept in place'), 'success', 2600);
  }
  function folderPicker(title, items) {
    const folders = allPlanFolders();
    const m = modal({ cls: 'mod-prompt', noClose: true, html: null });
    m.box.innerHTML = '<div class="prompt-input-container"><div class="prompt-title">' + title + '</div><input class="prompt-input" placeholder="Type a folder, like Games/Minecraft" spellcheck="false" aria-label="Folder"></div><div class="prompt-results" role="listbox"></div>' +
      '<div class="prompt-instructions"><span><b>↑↓</b>to navigate</span><span><b>↵</b>to move here</span><span><b>esc</b>to cancel</span></div>';
    const input = m.box.querySelector('input'), list = m.box.querySelector('.prompt-results');
    let shown = [], sel = 0;
    function draw() {
      const q = input.value.trim();
      const clean = q ? E.sanitizeFolder(q, 6) : '';
      shown = [];
      if (clean && !folders.some(f => f.toLowerCase() === clean.toLowerCase())) shown.push({ folder: clean, html: 'Create <b>' + esc(clean) + '</b>', icon: 'folder-plus', note: 'new folder' });
      for (const f of folders) { const r = fuzzy(q, f); if (r) shown.push({ folder: f, html: r.html, score: r.score, icon: 'folder' }); }
      if (q) shown.sort((a, b) => (b.note ? 1e9 : b.score || 0) - (a.note ? 1e9 : a.score || 0));
      shown.push({ folder: '', html: 'Keep in place (don’t move)', icon: 'pin' });
      sel = Math.min(sel, shown.length - 1);
      list.innerHTML = shown.map((s, i) => '<div class="suggestion-item' + (i === sel ? ' is-selected' : '') + '" role="option" data-i="' + i + '">' + icon(s.icon) + '<span>' + s.html + '</span>' + (s.note ? '<span class="note">' + s.note + '</span>' : '') + '</div>').join('');
      const s = list.querySelector('.is-selected'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    function choose(i) { const s = shown[i]; if (!s) return; m.close(); moveItemsTo(items, s.folder); }
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = (sel + 1) % shown.length; draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = (sel - 1 + shown.length) % shown.length; draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
      else if (e.key === 'Escape') { m.close(); e.preventDefault(); e.stopPropagation(); }
    });
    list.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) choose(+it.dataset.i); });
    draw(); input.focus();
  }
  function renameFolder(path) {
    textPrompt({
      title: 'Rename folder', value: path, ok: 'Rename',
      desc: 'Every file going into <b>' + esc(path) + '</b> will go to the new name instead. Use <code>/</code> to nest it.',
      validate: v => { const c = E.sanitizeFolder(v, 6); return c ? '' : 'Enter a folder name.'; },
      run: v => {
        const to = E.sanitizeFolder(v, 6), low = path.toLowerCase();
        let n = 0;
        for (const it of S.plan.items) {
          if (it.kind !== 'move') continue;
          const tl = it.target.toLowerCase();
          if (tl.startsWith(low + '/')) { it.target = to + it.target.slice(path.length); it.by = it.by === 'rule' ? 'rule' : 'you'; if (it.by === 'you') it.reason = 'Folder renamed by you'; n++; }
        }
        resolveClashes(); openAncestors(S.proposedOpen, to + '/x'); renderAll();
        notice('Renamed to <b>' + esc(to) + '</b> (' + plural(n, 'file') + ')', 'success', 2600);
      },
    });
  }
  function toggleSkip(source, val) {
    const it = planBySource().get(source); if (!it || it.kind !== 'move') return;
    it.skip = val == null ? !it.skip : val;
    renderExplorer(); renderSide(); renderStatus(); updateCounts();
    if (WS.isVisible('changes')) renderOne('changes');
    if (WS.isVisible('structure')) { const t = $('#proposedTree'); if (t) t.innerHTML = proposedTreeHTML(); }
    if (WS.isVisible('graph')) renderOne('graph');
  }
  function ruleFromFile(source) {
    const f = S.vault.files.find(x => x.path === source); if (!f) return;
    const it = planBySource().get(source);
    const stem = E.seriesStem(f.name);
    window.OnyxSettings.ruleEditor(ctx, {
      type: f.extension && !stem ? 'ext' : 'contains',
      value: stem ? stem.label.toLowerCase().replace(/s$/, '') : (f.extension || splitName(f.name).base),
      folder: it && isMoving(it) ? dirname(it.target) : '',
    });
  }
  function fileMenuItems(src) {
    const it = planBySource().get(src);
    const items = [];
    if (it && S.plan) {
      items.push({ label: 'Move to…', icon: 'folder-input', action: () => folderPicker('Move <b>' + esc(it.name) + '</b> to…', [it]) });
      if (it.kind === 'move') items.push(it.skip ? { label: 'Include in plan', icon: 'check', action: () => toggleSkip(src, false) } : { label: 'Keep in place', icon: 'pin', action: () => toggleSkip(src, true) });
    }
    items.push({ label: 'Always put files like this in…', icon: 'list-checks', action: () => ruleFromFile(src) });
    items.push({ label: 'Never move this file', icon: 'eye-off', action: () => { const list = (S.settings.organize.neverMove || []).slice(); const n = basename(src); if (!list.includes(n)) list.push(n); setOrg('neverMove', list); if (it && it.kind === 'move') toggleSkip(src, true); notice('<b>' + esc(n) + '</b> added to your never-move list', 'success', 3000); } });
    items.push('sep');
    if (!S.vault.demo) items.push({ label: 'Show in system explorer', icon: 'external-link', action: () => api.reveal(src) });
    items.push({ label: 'Copy path', icon: 'copy', action: () => api.copyText(src) });
    return items;
  }
  function folderMenuItems(p, tree) {
    const items = [];
    const k = kindsMap().get(p.toLowerCase());
    if (k) {
      const target = k.kind === 'bundle' ? k.root : p;
      const name = basename(target);
      const org = S.settings.organize;
      const without = (list) => (list || []).filter(x => String(x).toLowerCase() !== name.toLowerCase());
      if (k.kind === 'bundle') items.push({ label: 'Let Onyx sort inside “' + name + '”', icon: 'folder-input', action: () => { setOrg('keepFolders', without(org.keepFolders)); setOrg('openFolders', without(org.openFolders).concat([name])); renderAll(); notice('Onyx may now sort files inside <b>' + esc(name) + '</b>. Run Organize again to update the plan.', 'success'); } });
      else items.push({ label: 'Keep “' + name + '” together', icon: 'package', action: () => { setOrg('openFolders', without(org.openFolders)); setOrg('keepFolders', without(org.keepFolders).concat([name])); renderAll(); notice('<b>' + esc(name) + '</b> will be kept together. Run Organize again to update the plan.', 'success'); } });
      items.push('sep');
    }
    if (tree === 'proposed' && S.plan) {
      const inside = S.plan.items.filter(i => i.kind === 'move' && i.target.toLowerCase().startsWith(p.toLowerCase() + '/'));
      const isNew = !existingDirSet().has(p.toLowerCase());
      if (isNew) items.push({ label: 'Rename folder…', icon: 'pencil', action: () => renameFolder(p) });
      if (inside.length) {
        items.push({ label: 'Move these ' + inside.length + ' files to…', icon: 'folder-input', action: () => folderPicker('Move ' + plural(inside.length, 'file') + ' from <b>' + esc(p) + '</b> to…', inside) });
        const allSkipped = inside.every(i => i.skip);
        items.push({ label: allSkipped ? 'Include these ' + inside.length + ' files' : 'Keep these ' + inside.length + ' files in place', icon: allSkipped ? 'check' : 'pin', action: () => { for (const i of inside) i.skip = !allSkipped; renderAll(); } });
      }
      if (items.length) items.push('sep');
    }
    const exists = existingDirSet().has(p.toLowerCase());
    if (!S.vault.demo && exists) items.push({ label: 'Show in system explorer', icon: 'external-link', action: () => api.reveal(p) });
    items.push({ label: 'Copy path', icon: 'copy', action: () => api.copyText(p) });
    items.push({ label: 'Collapse all', icon: 'chevrons-down-up', action: () => { (tree === 'explorer' ? S.explorerOpen : S.proposedOpen).clear(); renderAll(); } });
    return items;
  }

  // ======================================================================= vault actions
  async function loadSettings() { S.settings = await api.getSettings(); S.settings.ui = S.settings.ui || {}; }
  function setVault(v) {
    S.vault = v; S.plan = null; S.selected = null; S.explorerOpen = new Set(); S.proposedOpen = new Set();
    S.explorerFilter = ''; $('#explorerFilter').value = '';
  }
  async function afterOpen(r, quiet) {
    if (!r || r.cancelled) return;
    if (r.error) { modal({ title: 'Can’t open this folder', html: '<p>' + esc(r.error) + '</p>', buttons: [{ label: 'OK', cls: 'mod-cta' }] }); return; }
    setVault(r); await loadSettings();
    if (r.browse) {
      if (!WS.isVisible('library')) WS.activate('library', { noRender: true });
      renderAll(); LIB.ensureListed('');
      if (!quiet) notice('Browsing <b>' + esc(r.rootPath) + '</b>. Onyx won’t reorganize a whole drive or system folder, but you can rename, copy, move and delete as in File Explorer.', 'success', 6000);
      return;
    }
    renderAll();
    if (!quiet) notice('Opened <b>' + esc(r.vaultName) + '</b> · ' + plural(r.files.length, 'file') + (r.autoTagged ? ' · tagged ' + plural(r.autoTagged, 'file') + ' from their names' : ''), 'success');
  }
  function autoTagNotice(r) {
    if (!r || !r.autoTagged) return;
    setTimeout(() => notice('Tagged <b>' + plural(r.autoTagged, 'file') + '</b> from their names, like #invoice or #screenshot.', 'success', 7000,
      { label: 'Open Library', run: () => LIB.showLibrary() }), 600);
  }
  async function openFolder() { afterOpen(await api.pickFolder()); }
  async function openFolderPath(p) { const r = await api.openRecent(p); if (r && r.error) { modal({ title: 'Can’t open this folder', html: '<p>' + esc(r.error) + '</p>', buttons: [{ label: 'OK', cls: 'mod-cta' }] }); return; } afterOpen(r); }
  // This PC: drives and the usual folders
  async function openPlaces() {
    const r = await api.listPlaces();
    const gb = n => n ? (n / 1073741824 >= 100 ? Math.round(n / 1073741824) : (n / 1073741824).toFixed(1)) + ' GB' : '';
    const drive = d => {
      const used = d.total ? Math.round((1 - d.free / d.total) * 100) : 0;
      return '<button class="place drive" data-place="' + esc(d.path) + '">' + icon('hard-drive') + '<div class="pl-main"><div class="pl-name">' + esc(d.name === 'Computer' ? 'Computer' : 'Local Disk (' + d.name + ')') + '</div>' +
        (d.total ? '<div class="pl-bar"><span style="width:' + used + '%"' + (used > 90 ? ' class="full"' : '') + '></span></div><div class="pl-sub">' + gb(d.free) + ' free of ' + gb(d.total) + '</div>' : '<div class="pl-sub">Browse only</div>') + '</div></button>';
    };
    const place = p => '<button class="place" data-place="' + esc(p.path) + '">' + icon(p.name === 'Home' ? 'folder' : p.name === 'Pictures' ? 'image' : p.name === 'Music' ? 'music' : p.name === 'Videos' ? 'film' : p.name === 'Downloads' ? 'download' : 'folder') +
      '<div class="pl-main"><div class="pl-name">' + esc(p.name) + '</div><div class="pl-sub">' + (p.browseOnly ? 'Browse only' : 'Browse and organize') + '</div></div></button>';
    const m = modal({
      title: 'This PC', cls: 'mod-places',
      html: '<p class="muted" style="margin-bottom:12px">Drives and system folders open <b>browse-only</b>: explore, search and tag everything, but Onyx won’t reorganize them. Ordinary folders like Downloads can be organized.</p>' +
        '<div class="pl-title">Drives</div><div class="pl-grid">' + (r.drives || []).map(drive).join('') + '</div>' +
        '<div class="pl-title">Folders</div><div class="pl-grid">' + (r.places || []).map(place).join('') + '</div>',
    });
    m.box.addEventListener('click', e => { const b = e.target.closest('[data-place]'); if (!b) return; m.close(); openFolderPath(b.dataset.place); });
  }
  async function openRecent(p, quiet) { const r = await api.openRecent(p); if (r.error) { if (!quiet) notice(esc(r.error), 'error'); return; } afterOpen(r, quiet); }
  async function loadDemo() { const r = await api.loadDemo(); setVault(r); renderAll(); notice('Demo vault loaded. Nothing on your disk will be touched.', 'success'); }
  async function rescan() {
    if (!S.vault) return;
    if (S.vault.browse) { LIB.reload(); notice('Reloaded from disk'); return; }
    const r = await api.rescan();
    const keepSel = S.selected;
    S.vault = r; S.plan = null; S.selected = keepSel;
    renderAll(); notice('Reloaded from disk');
    autoTagNotice(r);
  }
  async function organize(strategy) {
    if (strategy) setStrategy(strategy);
    if (!S.vault) { notice('Open a folder first', 'warn'); return; }
    if (S.vault.browse) { notice('Onyx doesn’t reorganize a whole drive or system folder. In the Library, right-click a folder and choose <b>Organize this folder</b>.', 'warn', 7000); return; }
    if (S.busy) return;
    S.busy = true; S.progress = null;
    renderSide(); renderStatus(); document.querySelectorAll('.view-content').forEach(el => el.classList.add('busy'));
    let r;
    try { r = await api.organize(S.strategy); } catch (e) { r = { error: e.message }; }
    S.busy = false;
    if (r.error) { notice(esc(r.error), 'error'); renderAll(); return; }
    S.plan = r.plan;
    S.proposedOpen = new Set();
    for (const it of S.plan.items) if (isMoving(it)) openAncestors(S.proposedOpen, it.target);
    if (S.selected) { const it = planBySource().get(S.selected); if (it) openAncestors(S.proposedOpen, effTarget(it)); }
    if (S.plan.strategy === 'smart' && S.plan.ai.error) notice('AI unavailable, used offline rules instead.', 'warn', 6000);
    const after = UI().layout.afterOrganize;
    if (after && !WS.isVisible(after)) WS.activate(after, { noRender: true });
    renderAll();
  }
  function confirmApply() {
    const P = S.plan; if (!P || P.demo) return;
    const items = P.items.filter(isMoving);
    if (!items.length) { notice('Nothing selected to move', 'warn'); return; }
    if (!UI().layout.confirmApply) { doApply(); return; }
    const existing = existingDirSet();
    const nf = new Set();
    for (const it of items) { let d = dirname(it.target); while (d) { if (!existing.has(d.toLowerCase())) nf.add(d.toLowerCase()); d = dirname(d); } }
    modal({
      title: 'Apply changes?',
      html: '<p>Onyx will move <b>' + plural(items.length, 'file') + '</b>' + (nf.size ? ' into <b>' + plural(nf.size, 'new folder') + '</b>' : '') + ' inside <b>' + esc(S.vault.vaultName) + '</b>.</p>' +
        '<p style="margin-top:8px">Nothing is deleted or overwritten. If a name is taken, the file gets a “(2)” suffix. You can undo this from the sidebar.</p>',
      buttons: [{ label: 'Cancel' }, { label: 'Move ' + plural(items.length, 'file'), cls: 'mod-cta', action: () => { doApply(); } }],
    });
  }
  async function doApply() {
    S.busy = true; renderSide(); renderStatus();
    const r = await api.apply(S.plan.items);
    S.busy = false;
    if (r.error) { notice(esc(r.error), 'error'); renderAll(); return; }
    S.vault = r.vault; S.plan = null;
    renderAll();
    if (r.failed && r.failed.length) {
      modal({ title: plural(r.applied, 'file') + ' moved, ' + r.failed.length + ' failed',
        html: '<p>These files couldn’t be moved and were left where they were:</p><div class="skipped-list" style="margin:10px 0 0;max-height:240px">' + r.failed.map(f => esc(f.source) + ' — ' + esc(f.error)).join('<br>') + '</div>',
        buttons: [{ label: 'OK', cls: 'mod-cta' }] });
    } else notice('Moved ' + plural(r.applied, 'file') + '.', 'success', 8000, { label: 'Undo', run: () => confirmUndo() });
  }
  function confirmUndo() {
    if (!S.vault || !S.vault.undo || S.busy) { notice('Nothing to undo in this folder', 'warn', 2500); return; }
    confirmModal('Undo last organize?', '<p>Moves <b>' + plural(S.vault.undo.count, 'file') + '</b> back to where they were ' + ago(S.vault.undo.at) + ', and removes folders Onyx created if they’re empty.</p>', 'Undo', doUndo);
  }
  async function doUndo() {
    S.busy = true; renderSide();
    const r = await api.undo();
    S.busy = false;
    if (r.error) { notice(esc(r.error), 'error'); renderAll(); return; }
    S.vault = r.vault; S.plan = null; renderAll();
    if (r.failed && r.failed.length) notice('Restored ' + plural(r.restored, 'file') + '. ' + r.failed.length + ' couldn’t be restored.', 'warn', 7000);
    else notice('Restored ' + plural(r.restored, 'file'), 'success');
  }
  function setStrategy(id) { S.strategy = id; store.set('strategy', id); renderSide(); if (!S.plan && S.vault && WS.isVisible('structure')) renderOne('structure'); }
  function toggleSidebar(side) { WS.toggleDock(side); }
  // the Organize panel lives in a sidebar that stays hidden until you need it
  function openOrganize(toggle) {
    const k = WS.keyOf('organize');
    if (toggle && WS.isVisible('organize') && (k === 'left' || k === 'right')) { WS.toggleDock(k); return; }
    WS.activate('organize');
  }
  function layoutMenu(el) {
    const r = el.getBoundingClientRect();
    const items = [{ heading: 'Layouts' }];
    for (const [id, p] of Object.entries(WS.PRESETS)) items.push({ label: p.name, sub: p.desc, icon: 'layout-dashboard', action: () => WS.applyPreset(id) });
    items.push('sep', { heading: 'Show' });
    for (const [v, m] of Object.entries(WS.VIEWS)) items.push({ label: m.name, icon: m.icon, check: WS.isVisible(v), action: () => WS.activate(v) });
    items.push('sep', { label: 'Swap sidebars', icon: 'arrow-left-right', action: () => WS.swapSides() });
    items.push({ label: 'How to move panels', icon: 'info', action: () => notice('Drag any tab onto a sidebar, another tab bar, or the edge of a pane to split it. Right-click a tab for the same options.', '', 7000) });
    showMenu(items, r.right + 6, r.bottom, { above: true });
  }

  function vaultMenu(el) {
    const r = el.getBoundingClientRect();
    const recent = ((S.settings && S.settings.ui.recent) || []);
    const items = [];
    if (recent.length) { items.push({ heading: 'Recent' }); for (const p of recent) items.push({ label: p.split(/[\\/]/).filter(Boolean).pop() || p, sub: p, icon: 'folder', action: () => openRecent(p) }); items.push('sep'); }
    items.push({ label: 'Open folder…', icon: 'folder-open', action: openFolder });
    items.push({ label: 'Browse This PC…', icon: 'monitor', sub: 'drives', action: openPlaces });
    items.push({ label: 'Open demo vault', icon: 'flask-conical', action: loadDemo });
    if (S.vault && !S.vault.demo) items.push({ label: 'Show in system explorer', icon: 'external-link', action: () => api.reveal('') });
    showMenu(items, r.left, r.top, { above: true });
  }
  function themeMenu(el) {
    const r = el.getBoundingClientRect();
    const u = UI(), cur = T.resolve(S.settings.ui);
    const items = [{ heading: 'Mode' }];
    for (const [v, l] of [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']]) items.push({ label: l, icon: v === 'dark' ? 'moon' : v === 'light' ? 'sun' : 'monitor', check: u.appearance.mode === v, action: () => setUi('appearance', 'mode', v) });
    items.push('sep', { heading: cur.mode === 'light' ? 'Light themes' : 'Dark themes' });
    for (const [id, p] of Object.entries(T.allThemes(S.settings.ui))) if (p.mode === cur.mode) items.push({ label: p.name, sub: p.custom ? 'Your scheme' : p.desc, check: cur.presetId === id, action: () => setUi('appearance', p.mode === 'light' ? 'themeLight' : 'themeDark', id) });
    items.push({ label: 'Build a color scheme…', icon: 'wand', action: () => window.OnyxSettings.themeEditor(ctx) });
    items.push('sep', { heading: 'Density' });
    for (const d of ['compact', 'comfortable', 'spacious']) items.push({ label: d[0].toUpperCase() + d.slice(1), check: u.appearance.density === d, action: () => setUi('appearance', 'density', d) });
    items.push('sep', { label: 'All appearance settings…', icon: 'settings', action: () => openSettings('appearance') });
    showMenu(items, r.right - 260, r.top, { above: true });
  }

  // ======================================================================= commands + hotkeys
  const COMMANDS = [
    { id: 'palette', name: 'Open command palette', hk: 'Mod+P', run: () => openPalette() },
    { id: 'open-folder', name: 'Open folder as vault', hk: 'Mod+O', run: openFolder },
    { id: 'demo', name: 'Open demo vault', run: loadDemo },
    { id: 'places', name: 'Files: Browse This PC (drives)', run: () => openPlaces() },
    { id: 'organize', name: 'Organize: Run with current strategy', hk: 'Mod+Enter', run: () => organize() },
    ...STRATEGIES.map(s => ({ id: 'organize-' + s.id, name: 'Organize: ' + s.name, run: () => organize(s.id) })),
    { id: 'apply', name: 'Plan: Apply changes', hk: 'Mod+Shift+Enter', run: () => confirmApply() },
    { id: 'discard', name: 'Plan: Discard proposed changes', run: () => { S.plan = null; renderAll(); } },
    { id: 'view-structure', name: 'View: Proposed structure', hk: 'Mod+1', run: () => WS.activate('structure') },
    { id: 'view-changes', name: 'View: Changes', hk: 'Mod+2', run: () => WS.activate('changes') },
    { id: 'view-graph', name: 'View: Graph view', hk: 'Mod+G', run: () => WS.activate('graph') },
    { id: 'view-files', name: 'View: Files', hk: 'Mod+Shift+E', run: () => { WS.activate('files'); focusTree($('#explorer')); } },
    { id: 'view-organize', name: 'View: Organize panel', run: () => openOrganize() },
    { id: 'view-library', name: 'View: Library', hk: 'Mod+L', run: () => LIB.showLibrary() },
    { id: 'view-tags', name: 'View: Tags panel', run: () => WS.activate('tags') },
    { id: 'quick-find', name: 'Files: Quick find', hk: 'Mod+K', run: () => LIB.quickFind() },
    { id: 'library-search', name: 'Library: Search', hk: 'Mod+F', run: () => LIB.focusSearch() },
    { id: 'library-toggle-view', name: 'Library: Switch between list and grid', run: () => { LIB.showLibrary(); LIB.toggleView(); } },
    { id: 'save-search', name: 'Library: Save current search', run: () => { if (!LIB.query.trim()) { notice('Search for something in the Library first', 'warn', 2500); return; } LIB.saveSearch(); } },
    { id: 'tag-selected', name: 'Tags: Tag the selected files', hk: 'Mod+T', run: () => LIB.tagEditor() },
    { id: 'autotag-ai', name: 'Tags: Tag untagged files with AI', run: () => LIB.autoTag('ai', { scope: 'untagged' }) },
    { id: 'autotag-rules', name: 'Tags: Suggest tags from names (offline)', run: () => LIB.autoTag('rules', { scope: 'all' }) },
    { id: 'clear-auto', name: 'Tags: Remove all automatic tags', run: () => confirmModal('Remove automatic tags?', '<p>Removes every tag Onyx or AI added. Tags you added yourself stay.</p>', 'Remove', () => LIB.clearAuto(null), true) },
    { id: 'show-untagged', name: 'Library: Show untagged files', run: () => LIB.setQuery('is:untagged') },
    { id: 'show-duplicates', name: 'Library: Show duplicates', run: () => LIB.setQuery('is:duplicate') },
    { id: 'show-recent', name: 'Library: Show recently changed files', run: () => LIB.setQuery('modified:<7d') },
    ...Object.entries(WS.PRESETS).map(([id, p]) => ({ id: 'layout-' + id, name: 'Layout: ' + p.name + ' (' + p.desc.toLowerCase() + ')', run: () => WS.applyPreset(id) })),
    { id: 'undo', name: 'History: Undo last change', hk: 'Mod+Z', run: () => (window.OnyxOps ? window.OnyxOps.undo() : confirmUndo()) },
    { id: 'undo-organize', name: 'History: Undo last organize', run: () => confirmUndo() },
    { id: 'new-folder', name: 'Files: New folder (' + (isMac ? '⌘' : 'Ctrl+') + 'Shift+N)', run: () => { LIB.showLibrary(); window.OnyxOps.newItem('folder'); } },
    { id: 'new-text', name: 'Files: New text document', run: () => { LIB.showLibrary(); window.OnyxOps.newItem('text'); } },
    { id: 'rename-selected', name: 'Files: Rename (F2)', run: () => window.OnyxOps.startRename() },
    { id: 'delete-selected', name: 'Files: Delete to Recycle Bin (Del)', run: () => window.OnyxOps.del(false) },
    { id: 'paste', name: 'Files: Paste (' + (isMac ? '⌘' : 'Ctrl+') + 'V)', run: () => window.OnyxOps.pasteHere() },
    { id: 'properties', name: 'Files: Properties (Alt+Enter)', run: () => window.OnyxOps.properties() },
    { id: 'terminal', name: 'Files: Open in Terminal', run: () => window.OnyxOps && S.vault && api.fsTerminal(LIB.cwd).then(r => r && r.error && notice(esc(r.error), 'error')) },
    { id: 'rescan', name: 'Files: Reload folder from disk', hk: 'Mod+R', run: rescan },
    { id: 'search-files', name: 'Files: Search files', hk: 'Mod+Shift+F', run: () => { WS.activate('files'); $('#navSearch').classList.add('show'); $('#explorerFilter').focus(); } },
    { id: 'collapse-explorer', name: 'Files: Collapse all', run: () => { S.explorerOpen.clear(); renderExplorer(); } },
    { id: 'reveal-root', name: 'Files: Show vault in system explorer', run: () => { if (S.vault && !S.vault.demo) api.reveal(''); else notice('Open a real folder first', 'warn'); } },
    { id: 'toggle-left', name: 'Layout: Toggle left sidebar', hk: 'Mod+[', run: () => toggleSidebar('left') },
    { id: 'toggle-right', name: 'Layout: Toggle right sidebar', hk: 'Mod+]', run: () => toggleSidebar('right') },
    { id: 'toggle-ribbon', name: 'Layout: Toggle ribbon', run: () => setUi('layout', 'ribbon', !UI().layout.ribbon) },
    { id: 'toggle-statusbar', name: 'Layout: Toggle status bar', run: () => setUi('layout', 'statusBar', !UI().layout.statusBar) },
    { id: 'swap-sidebars', name: 'Layout: Swap sidebars', run: () => WS.swapSides() },
    { id: 'toggle-mode', name: 'Appearance: Toggle light and dark', hk: 'Mod+Shift+L', run: () => setUi('appearance', 'mode', T.resolve(S.settings.ui).mode === 'dark' ? 'light' : 'dark') },
    { id: 'next-theme', name: 'Appearance: Next theme', run: () => { const r = T.resolve(S.settings.ui); const all = T.allThemes(S.settings.ui); const ids = Object.keys(all).filter(k => all[k].mode === r.mode); setUi('appearance', r.mode === 'light' ? 'themeLight' : 'themeDark', ids[(ids.indexOf(r.presetId) + 1) % ids.length]); notice('Theme: ' + T.resolve(S.settings.ui).p.name, '', 1500); } },
    ...Object.entries(T.PRESETS).map(([id, p]) => ({ id: 'theme-' + id, name: 'Appearance: Use ' + p.name + ' theme', run: () => { setUi('appearance', p.mode === 'light' ? 'themeLight' : 'themeDark', id); setUi('appearance', 'mode', p.mode); } })),
    ...['compact', 'comfortable', 'spacious'].map(d => ({ id: 'density-' + d, name: 'Appearance: ' + d[0].toUpperCase() + d.slice(1) + ' density', run: () => setUi('appearance', 'density', d) })),
    { id: 'zoom-in', name: 'Appearance: Zoom in', hk: 'Mod+=', run: () => setUi('appearance', 'zoom', Math.min(160, UI().appearance.zoom + 10)) },
    { id: 'zoom-out', name: 'Appearance: Zoom out', hk: 'Mod+-', run: () => setUi('appearance', 'zoom', Math.max(70, UI().appearance.zoom - 10)) },
    { id: 'zoom-reset', name: 'Appearance: Reset zoom', hk: 'Mod+0', run: () => setUi('appearance', 'zoom', 100) },
    { id: 'settings', name: 'Settings: Open settings', hk: 'Mod+,', run: () => openSettings() },
    { id: 'settings-appearance', name: 'Settings: Appearance', run: () => openSettings('appearance') },
    { id: 'settings-rules', name: 'Settings: My rules', run: () => openSettings('rules') },
    { id: 'settings-hotkeys', name: 'Settings: Hotkeys', run: () => openSettings('hotkeys') },
    { id: 'settings-library', name: 'Settings: Library and tags', run: () => openSettings('library') },
    { id: 'add-rule', name: 'Rules: Add a rule', run: () => window.OnyxSettings.ruleEditor(ctx, {}) },
    { id: 'new-theme', name: 'Appearance: Build a color scheme', run: () => window.OnyxSettings.themeEditor(ctx) },
    { id: 'help', name: 'Help: How Onyx works', hk: 'F1', run: () => openHelp() },
  ];
  const CMD = Object.fromEntries(COMMANDS.map(c => [c.id, c]));
  function effectiveHotkey(id) {
    const o = UI().hotkeys || {};
    if (Object.prototype.hasOwnProperty.call(o, id)) return o[id] || '';
    return (CMD[id] && CMD[id].hk) || '';
  }
  function hotkeyLabel(hk) {
    if (!hk) return '';
    return hk.split('+').map(p => ({ Mod: isMac ? '⌘' : 'Ctrl', Shift: isMac ? '⇧' : 'Shift', Alt: isMac ? '⌥' : 'Alt', Enter: '↵', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space' }[p] || p)).join(isMac ? '' : '+');
  }
  function comboFromEvent(e) {
    const k = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
    const parts = [];
    if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let key = k.length === 1 ? k.toUpperCase() : k;
    if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
    if (key === '+') key = '=';
    if (key === '_') key = '-';
    if (key === '{') key = '['; if (key === '}') key = ']';
    if (key === ' ') key = 'Space';
    parts.push(key);
    return parts.join('+');
  }
  function runCommand(id) { const c = CMD[id]; if (c) c.run(); }

  document.addEventListener('keydown', e => {
    if (window.OnyxSettings && window.OnyxSettings.recording) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (menuEl) { closeMenu(); return; }
      if (modals.length) { modals[modals.length - 1].close(); return; }
    }
    const combo = comboFromEvent(e);
    if (!combo) return;
    if (typing && !combo.startsWith('Mod') && !/^F\d+$/.test(combo)) return;
    if (typing && combo === 'Mod+Z') return; // native text undo
    if (modals.length && !['palette'].includes(findCommand(combo))) return;
    const id = findCommand(combo);
    if (id) { e.preventDefault(); runCommand(id); }
  });
  function findCommand(combo) { for (const c of COMMANDS) if (effectiveHotkey(c.id) === combo) return c.id; return null; }

  // ======================================================================= keyboard navigation in trees
  function visibleRows(container) { return [...container.querySelectorAll('.tree-item-self')].filter(r => r.offsetParent !== null); }
  function focusTree(container) {
    if (!container) return;
    const rows = visibleRows(container);
    const target = container.querySelector('.tree-item-self.is-active') || rows[0];
    if (target) target.focus();
  }
  document.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('tree')) focusTree(e.target); });
  document.addEventListener('keydown', e => {
    const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tree-item-self');
    if (!row || modals.length) return;
    const container = row.closest('.tree, .nav-files');
    const rows = visibleRows(container);
    const i = rows.indexOf(row);
    const isFolder = row.dataset.kind === 'folder';
    const collapsed = isFolder && row.parentElement.classList.contains('is-collapsed');
    const refocus = path => requestAnimationFrame(() => { const el = container.querySelector('.tree-item-self[data-path="' + CSS.escape(path) + '"]'); if (el) el.focus(); });
    if (e.key === 'ArrowDown') { if (rows[i + 1]) rows[i + 1].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { if (rows[i - 1]) rows[i - 1].focus(); e.preventDefault(); }
    else if (e.key === 'Home') { rows[0] && rows[0].focus(); e.preventDefault(); }
    else if (e.key === 'End') { rows[rows.length - 1] && rows[rows.length - 1].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' && isFolder) { if (collapsed) { toggleFolder(row); refocus(row.dataset.path); } else if (rows[i + 1]) rows[i + 1].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') {
      if (isFolder && !collapsed) { toggleFolder(row); refocus(row.dataset.path); }
      else { const parent = row.closest('.tree-item-children'); const p = parent && parent.previousElementSibling; if (p) p.focus(); }
      e.preventDefault();
    } else if (e.key === 'Enter') { if (isFolder) { toggleFolder(row); refocus(row.dataset.path); } else select(row.dataset.source, row.dataset.tree === 'explorer' ? 'explorer' : 'view'); e.preventDefault(); }
    else if (e.key === ' ' && !isFolder && S.plan) { toggleSkip(row.dataset.source); refocus(row.dataset.path); e.preventDefault(); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const b = row.getBoundingClientRect();
      showMenu(isFolder ? folderMenuItems(row.dataset.path, row.dataset.tree) : fileMenuItems(row.dataset.source), b.left + 24, b.bottom, { keyboard: true });
      e.preventDefault();
    }
  });
  function toggleFolder(row) {
    const set = row.dataset.tree === 'explorer' ? S.explorerOpen : S.proposedOpen;
    const p = row.dataset.path;
    if (set.has(p)) set.delete(p); else { set.add(p); if (S.vault && S.vault.browse && !LIB.isListed(p)) LIB.ensureListed(p); }
    if (row.dataset.tree === 'explorer') renderExplorer(); else { const t = $('#proposedTree'); if (t) t.innerHTML = proposedTreeHTML(); }
  }

  // ======================================================================= click / context handling
  const ACTIONS = {
    'toggle-organize': () => openOrganize(true), 'open-folder': openFolder, 'demo': loadDemo, 'places': () => openPlaces(), 'organize': () => organize(), 'apply': confirmApply, 'undo': confirmUndo, 'rescan': rescan,
    'discard': () => { S.plan = null; renderAll(); },
    'settings': () => openSettings(), 'settings-ai': () => openSettings('ai'), 'settings-organizing': () => openSettings('organizing'), 'settings-appearance': () => openSettings('appearance'), 'settings-rules': () => openSettings('rules'),
    'palette': () => openPalette(), 'help': () => openHelp(),
    'toggle-left': () => toggleSidebar('left'), 'toggle-right': () => toggleSidebar('right'),
    'activate-view': (el) => WS.activate(el.dataset.view),
    'close-view': (el) => WS.closeView(el.dataset.view),
    'collapse-dock': (el) => WS.toggleDock(el.dataset.region),
    'layout-menu': (el) => layoutMenu(el),
    'toggle-search': () => { if (!WS.isVisible('files')) WS.activate('files'); const s = $('#navSearch'); s.classList.toggle('show'); if (s.classList.contains('show')) $('#explorerFilter').focus(); else { S.explorerFilter = ''; $('#explorerFilter').value = ''; renderExplorer(); } },
    'collapse-explorer': () => { S.explorerOpen.clear(); renderExplorer(); },
    'reveal-root': () => runCommand('reveal-root'),
    'vault-menu': (el) => vaultMenu(el), 'theme-menu': (el) => themeMenu(el),
    'view-structure': () => WS.activate('structure'), 'view-changes': () => WS.activate('changes'), 'view-graph': () => WS.activate('graph'),
    'view-library': () => LIB.showLibrary(), 'quick-find': () => LIB.quickFind(), 'lib-autotag': (el) => LIB.autoTagMenu(el),
    'lib-ai-untagged': () => LIB.autoTag('ai', { scope: 'untagged' }),
    'lib-clear-auto': () => runCommand('clear-auto'),
    'set-strategy': (el) => setStrategy(el.dataset.id),
    'open-recent': (el) => openRecent(el.dataset.path),
    'expand-proposed': () => { if (!S.plan) return; for (const it of S.plan.items) openAncestors(S.proposedOpen, effTarget(it)); renderOne('structure'); },
    'collapse-proposed': () => { S.proposedOpen.clear(); renderOne('structure'); },
    'select-all': () => { for (const it of S.plan.items) it.skip = false; renderAll(); },
    'select-none': () => { for (const it of S.plan.items) if (it.kind === 'move') it.skip = true; renderAll(); },
    'row-menu': (el) => { const b = el.getBoundingClientRect(); showMenu(fileMenuItems(el.dataset.source), b.right - 210, b.bottom + 4); },
    'rename-folder': (el) => renameFolder(el.dataset.path),
    'move-group': (el) => { const items = S.plan.items.filter(i => i.kind === 'move' && (dirname(i.target) || '(top level)') === el.dataset.path); folderPicker('Move ' + plural(items.length, 'file') + ' from <b>' + esc(el.dataset.path) + '</b> to…', items); },
    'graph-fit': () => S.graphInst && S.graphInst.fit(),
    'graph-panel': () => { S.graphPanel = !S.graphPanel; renderOne('graph'); },
    'graph-mode': (el) => { S.graphMode = el.dataset.v; if (S.graphInst) { S.graphInst.destroy(); S.graphInst = null; } renderOne('graph'); },
    'graph-color': (el) => setUi('graph', 'colorBy', el.dataset.v),
    'graph-files': () => setUi('graph', 'files', !UI().graph.files),
    'graph-labels': () => setUi('graph', 'labels', !UI().graph.labels),
    'graph-reheat': () => S.graphInst && S.graphInst.reheat(1),
    'graph-reset': () => { setUi('graph', null, Object.assign({}, T.UI_DEFAULTS.graph, { files: UI().graph.files, labels: UI().graph.labels, colorBy: UI().graph.colorBy })); if (S.graphInst) { S.graphInst.destroy(); S.graphInst = null; } renderOne('graph'); },
  };
  function run(name, el) { const fn = ACTIONS[name]; if (fn) fn(el); }

  document.addEventListener('click', e => {
    if (e.target.closest('.modal-container') && !e.target.closest('[data-action]')) return;
    const cb = e.target.closest('[data-toggle-skip]');
    if (cb) { toggleSkip(cb.dataset.toggleSkip, !cb.checked); return; }
    const a = e.target.closest('[data-action]');
    if (a && !a.disabled) { e.preventDefault(); run(a.dataset.action, a); return; }
    const row = e.target.closest('.tree-item-self');
    if (row) {
      // like Explorer's navigation pane: the tree drives the Library when it's open
      const drive = row.dataset.tree === 'explorer' && WS.isVisible('library');
      if (row.dataset.kind === 'folder') { toggleFolder(row); if (drive) LIB.go(row.dataset.path); }
      else { select(row.dataset.source, row.dataset.tree === 'explorer' ? 'explorer' : 'view'); if (drive) LIB.revealFile(row.dataset.source); }
      return;
    }
    const cr = e.target.closest('.change-row');
    if (cr) select(cr.dataset.source, 'view');
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement && document.activeElement.matches('.tab, a.mod-link[data-action]')) { e.preventDefault(); document.activeElement.click(); }
  });
  document.addEventListener('dblclick', e => {
    const row = e.target.closest('.tree-item-self[data-kind="file"]');
    if (row && S.vault && !S.vault.demo && row.dataset.tree === 'explorer') api.reveal(row.dataset.source);
  });
  document.addEventListener('contextmenu', e => {
    const row = e.target.closest('.tree-item-self, .change-row');
    if (!row || !S.vault) return;
    e.preventDefault();
    const isFile = row.classList.contains('change-row') || row.dataset.kind === 'file';
    showMenu(isFile ? fileMenuItems(row.dataset.source) : folderMenuItems(row.dataset.path, row.dataset.tree), e.clientX, e.clientY);
  });
  $('#explorerFilter').addEventListener('input', e => { S.explorerFilter = e.target.value; renderExplorer(); });
  $('#explorerFilter').addEventListener('keydown', e => { if (e.key === 'Escape') { S.explorerFilter = ''; e.target.value = ''; $('#navSearch').classList.remove('show'); renderExplorer(); e.stopPropagation(); } if (e.key === 'ArrowDown') { focusTree($('#explorer')); e.preventDefault(); } });

  // ======================================================================= drag a folder onto the window
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e) || (window.OnyxOps && window.OnyxOps.dragging)) return; dragDepth++; $('#dropOverlay').classList.add('show'); e.preventDefault(); });
  window.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').classList.remove('show'); });
  window.addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.remove('show');
    if (window.OnyxOps && window.OnyxOps.dragging) return;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const p = api.pathForFile(f);
    if (!p) { notice('Couldn’t read that item.', 'error'); return; }
    const r = await api.openPath(p);
    if (r && r.error) { notice(esc(r.error), 'warn'); return; }
    afterOpen(r);
  });

  // ======================================================================= settings, help, palette
  const ctx = {
    get S() { return S; }, api, E, T, UI, setUi, setOrg, modal, notice, esc, icon, confirmModal, renderAll, applyTheme, loadSettings,
    COMMANDS, effectiveHotkey, hotkeyLabel, comboFromEvent, fuzzy, WS, showMenu, textPrompt,
  };
  function openSettings(tab) { window.OnyxSettings.open(ctx, tab); }
  LIB.init({
    get S() { return S; }, api, E, T, WS, UI, setUi, modal, notice, esc, icon, confirmModal, textPrompt, showMenu, fuzzy, collator, fmt, isMac,
    emptyState: () => emptyStateHTML(),
    openPlaces: () => openPlaces(), openFolderPath: (p) => openFolderPath(p),
    renderExplorer: () => renderExplorer(), renderAll: () => renderAll(), select: (p, from) => select(p, from), openSettings: (t) => openSettings(t),
    organizeUndo: () => confirmUndo(), openOrganize: () => openOrganize(), rescan: () => rescan(),
  });
  function openHelp() {
    const k = id => '<kbd>' + esc(hotkeyLabel(effectiveHotkey(id)) || '—') + '</kbd>';
    modal({
      title: 'How Onyx works',
      html: '<p><b>1. Open a folder.</b> Downloads and Desktop are the usual suspects. You can also drop a folder onto the window.</p>' +
        '<p style="margin-top:8px"><b>2. Organize.</b> Onyx looks at the loose files at the top level and proposes folders. <b>AI smart</b> asks a language model using only file names; <b>Smart rules</b> works offline. Your own rules always win.</p>' +
        '<p style="margin-top:8px"><b>3. Review.</b> Hover a file to see why it’s going there. Right-click to move it elsewhere, rename a new folder, keep it in place, or turn it into a rule.</p>' +
        '<p style="margin-top:8px"><b>4. Apply.</b> Files move, nothing is overwritten, and <b>Undo</b> puts everything back.</p>' +
        '<p style="margin-top:8px"><b>Every day: the Library.</b> Search every file, filter by <code>#tag</code>, type, size or date, and tag files by hand or with AI. ' + k('quick-find') + ' finds any file in a second; select files and press <kbd>#</kbd> to tag them.</p>' +
        '<p style="margin-top:14px" class="muted">Command palette ' + k('palette') + ' · Settings ' + k('settings') + ' · Light/dark ' + k('toggle-mode') + '</p>',
      buttons: [{ label: 'Open settings', action: () => { setTimeout(() => openSettings(), 0); } }, { label: 'Got it', cls: 'mod-cta' }],
    });
  }
  function fuzzy(q, s) {
    if (!q) return { score: 0, html: esc(s) };
    const ql = q.toLowerCase(), sl = s.toLowerCase();
    const idx = sl.indexOf(ql);
    if (idx >= 0) return { score: 100 - idx, html: esc(s.slice(0, idx)) + '<mark>' + esc(s.slice(idx, idx + q.length)) + '</mark>' + esc(s.slice(idx + q.length)) };
    let qi = 0, html = '', score = 0, last = -2;
    for (let i = 0; i < s.length; i++) {
      if (qi < ql.length && sl[i] === ql[qi]) { html += '<mark>' + esc(s[i]) + '</mark>'; score += i === last + 1 ? 3 : 1; last = i; qi++; }
      else html += esc(s[i]);
    }
    return qi === ql.length ? { score, html } : null;
  }
  const recentCmds = store.get('recentCommands', []);
  function openPalette() {
    if (modals.some(m => m.box.classList.contains('mod-prompt'))) return;
    const m = modal({ cls: 'mod-prompt', noClose: true, html: null });
    m.box.innerHTML = '<div class="prompt-input-container"><input class="prompt-input" placeholder="Select a command…" aria-label="Command" spellcheck="false"></div><div class="prompt-results" role="listbox"></div>' +
      '<div class="prompt-instructions"><span><b>↑↓</b>to navigate</span><span><b>↵</b>to use</span><span><b>esc</b>to dismiss</span></div>';
    const input = m.box.querySelector('input'), list = m.box.querySelector('.prompt-results');
    let shown = [], sel = 0;
    function draw() {
      const q = input.value.trim();
      shown = COMMANDS.filter(c => c.id !== 'palette').map(c => { const f = fuzzy(q, c.name); return f ? Object.assign({}, c, f) : null; }).filter(Boolean);
      if (q) shown.sort((a, b) => b.score - a.score);
      else shown.sort((a, b) => { const ra = recentCmds.indexOf(a.id), rb = recentCmds.indexOf(b.id); return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb); });
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((c, i) => {
        const ci = c.html.indexOf(': ');
        const label = ci > 0 && c.name.includes(': ') ? '<span class="prefix">' + c.html.slice(0, ci + 2) + '</span>' + c.html.slice(ci + 2) : c.html;
        const hk = hotkeyLabel(effectiveHotkey(c.id));
        return '<div class="suggestion-item' + (i === sel ? ' is-selected' : '') + '" role="option" data-i="' + i + '"><span>' + label + '</span>' +
          (!q && recentCmds.includes(c.id) ? '<span class="note">recently used</span>' : '') + (hk ? '<span class="hk"><kbd>' + esc(hk) + '</kbd></span>' : '') + '</div>';
      }).join('') : '<div class="prompt-empty">No commands found.</div>';
      const s = list.querySelector('.is-selected'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    function choose(i) {
      const c = shown[i]; if (!c) return; m.close();
      const k = recentCmds.indexOf(c.id); if (k >= 0) recentCmds.splice(k, 1); recentCmds.unshift(c.id); recentCmds.length = Math.min(recentCmds.length, 6); store.set('recentCommands', recentCmds);
      setTimeout(() => c.run(), 0);
    }
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, shown.length); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = (sel - 1 + shown.length) % Math.max(1, shown.length); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
      else if (e.key === 'Escape') { m.close(); e.preventDefault(); e.stopPropagation(); }
    });
    list.addEventListener('mousemove', e => { const it = e.target.closest('[data-i]'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; list.querySelectorAll('.suggestion-item').forEach((x, i) => x.classList.toggle('is-selected', i === sel)); } });
    list.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) choose(+it.dataset.i); });
    draw(); input.focus();
  }

  // ======================================================================= sidebar resizing
  document.querySelectorAll('.resize-handle').forEach(h => {
    h.addEventListener('mousedown', e => {
      e.preventDefault();
      const side = h.dataset.side;
      const startX = e.clientX;
      const start = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--' + side + '-w'), 10);
      const grows = side === 'left' ? 1 : -1;
      h.classList.add('dragging'); document.body.style.cursor = 'col-resize';
      const mm = ev => {
        const w = Math.max(200, Math.min(560, start + (ev.clientX - startX) * grows));
        document.documentElement.style.setProperty('--' + side + '-w', w + 'px');
      };
      const mu = () => {
        window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu);
        h.classList.remove('dragging'); document.body.style.cursor = '';
        store.set(side + 'W', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--' + side + '-w'), 10));
      };
      window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    });
  });

  // ======================================================================= boot
  api.onProgress(p => { S.progress = p; renderSide(); });
  (async function boot() {
    for (const side of ['left', 'right']) {
      const w = store.get(side + 'W', null); if (w) document.documentElement.style.setProperty('--' + side + '-w', w + 'px');
    }
    hydrate(document);
    await loadSettings();
    WS.init({
      icon, esc, notice, showMenu, viewMeta,
      renderAll: () => renderAll(),
      saveWorkspace: (w) => { S.settings.ui.workspace = w; persist('workspace', 'ui'); },
    }, UI().workspace);
    if (!store.get('layoutV3', false)) { store.set('layoutV3', true); WS.declutter(); }
    applyTheme();
    renderAll();
    const recent = S.settings.ui.recent || [];
    if (UI().layout.reopenLast && recent[0]) openRecent(recent[0], true);
    if (!store.get('seenLibrary', false)) {
      store.set('seenLibrary', true);
      setTimeout(() => notice('<b>New: Library and tags.</b> Search everything, tag files, and find them again with ' + esc(hotkeyLabel(effectiveHotkey('quick-find'))) + '.', '', 9000, { label: 'Open Library', run: () => LIB.showLibrary() }), 1200);
    }
  })();
})();
