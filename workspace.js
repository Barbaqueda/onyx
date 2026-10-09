/* Onyx workspace: dockable views. Every view can live in the left or right sidebar or in one of two main panes. */
(function () {
  'use strict';

  const VIEWS = {
    files: { icon: 'files', name: 'Files', home: 'left' },
    organize: { icon: 'sparkles', name: 'Organize', home: 'right' },
    structure: { icon: 'list-tree', name: 'Structure', home: 'main' },
    changes: { icon: 'arrow-left-right', name: 'Changes', home: 'main' },
    graph: { icon: 'git-fork', name: 'Graph view', home: 'main' },
  };
  const ALL = Object.keys(VIEWS);
  const R = (tabs, active) => ({ tabs, active: active || tabs[0] || null, collapsed: false });
  const PRESETS = {
    classic: { name: 'Classic', desc: 'Files left, Organize right, views in the middle', ws: () => ({ left: R(['files']), right: R(['organize']), main: [R(['structure', 'changes', 'graph'])], split: 'row', ratio: 0.5, hidden: [] }) },
    swapped: { name: 'Swapped', desc: 'Organize on the left, files on the right', ws: () => ({ left: R(['organize']), right: R(['files']), main: [R(['structure', 'changes', 'graph'])], split: 'row', ratio: 0.5, hidden: [] }) },
    review: { name: 'Review', desc: 'Structure and graph side by side', ws: () => ({ left: R(['files', 'organize'], 'organize'), right: R([]), main: [R(['structure', 'changes']), R(['graph'])], split: 'row', ratio: 0.55, hidden: [] }) },
    stacked: { name: 'Stacked', desc: 'Changes above, graph below', ws: () => ({ left: R(['files']), right: R(['organize']), main: [R(['changes', 'structure']), R(['graph'])], split: 'column', ratio: 0.6, hidden: [] }) },
    focus: { name: 'Focus', desc: 'One area with tabs, no sidebars', ws: () => ({ left: R([]), right: R([]), main: [R(['structure', 'changes', 'graph', 'organize', 'files'])], split: 'row', ratio: 0.5, hidden: [] }) },
  };

  let C = null;           // renderer context
  let ws = null;
  let dragView = null, dropTarget = null;
  const $ = s => document.querySelector(s);
  const viewEl = v => document.querySelector('.view-root[data-view="' + v + '"]');

  // ------------------------------------------------------------------ model
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function normalize(w) {
    w = w && typeof w === 'object' ? clone(w) : PRESETS.classic.ws();
    for (const k of ['left', 'right']) w[k] = Object.assign(R([]), w[k] || {});
    w.main = Array.isArray(w.main) && w.main.length ? w.main.slice(0, 2).map(p => Object.assign(R([]), p)) : [R([])];
    w.hidden = Array.isArray(w.hidden) ? w.hidden : [];
    w.split = w.split === 'column' ? 'column' : 'row';
    w.ratio = Math.min(0.85, Math.max(0.15, +w.ratio || 0.5));
    const seen = new Set();
    const clean = list => list.filter(v => VIEWS[v] && !seen.has(v) && seen.add(v));
    for (const r of regions(w)) { r.tabs = clean(r.tabs || []); if (!r.tabs.includes(r.active)) r.active = r.tabs[0] || null; }
    w.hidden = clean(w.hidden);
    for (const v of ALL) if (!seen.has(v)) { const home = homeRegion(w, v); home.tabs.push(v); if (!home.active) home.active = v; }
    return w;
  }
  function regions(w) { return [w.left, w.right].concat(w.main); }
  function region(key, w) { w = w || ws; if (key === 'left' || key === 'right') return w[key]; const i = +key.split(':')[1]; return w.main[i]; }
  function keyOf(v, w) {
    w = w || ws;
    if (w.left.tabs.includes(v)) return 'left';
    if (w.right.tabs.includes(v)) return 'right';
    for (let i = 0; i < w.main.length; i++) if (w.main[i].tabs.includes(v)) return 'main:' + i;
    return null;
  }
  function homeRegion(w, v) { const h = VIEWS[v].home; return h === 'main' ? w.main[0] : w[h]; }
  function isVisible(v) {
    const k = keyOf(v); if (!k) return false;
    const r = region(k);
    return r.active === v && !(k === 'left' || k === 'right' ? r.collapsed : false);
  }
  function save() { C.saveWorkspace(clone(ws)); }

  function removeFrom(v) {
    const k = keyOf(v); if (!k) { ws.hidden = ws.hidden.filter(x => x !== v); return; }
    const r = region(k);
    const i = r.tabs.indexOf(v);
    r.tabs.splice(i, 1);
    if (r.active === v) r.active = r.tabs[Math.min(i, r.tabs.length - 1)] || null;
  }
  function tidyPanes() {
    if (ws.main.length > 1) ws.main = ws.main.filter(p => p.tabs.length);
    if (!ws.main.length) ws.main = [R([])];
  }
  // target: { region: 'left'|'right'|'main:N', index } or { split: 'left'|'right'|'up'|'down' }
  function moveView(v, target) {
    const fromKey = keyOf(v);
    if (target.split) {
      if (ws.main.length >= 2) { target = { region: target.split === 'right' || target.split === 'down' ? 'main:1' : 'main:0' }; }
      else {
        removeFrom(v);
        const pane = R([v]);
        ws.split = target.split === 'left' || target.split === 'right' ? 'row' : 'column';
        if (target.split === 'left' || target.split === 'up') ws.main.unshift(pane); else ws.main.push(pane);
        ws.ratio = 0.5;
        tidyPanes(); save(); C.renderAll(); return;
      }
    }
    const before = target.region;
    const toBefore = region(before);
    let idx = target.index == null ? toBefore.tabs.length : target.index;
    if (fromKey === before) { const cur = toBefore.tabs.indexOf(v); if (cur < idx) idx--; }
    removeFrom(v);
    // the target pane may have been removed by tidyPanes if it was the source and now empty — handle keys after removal
    const to = region(before) || ws.main[0];
    to.tabs.splice(Math.max(0, Math.min(idx, to.tabs.length)), 0, v);
    to.active = v; to.collapsed = false;
    tidyPanes(); save(); C.renderAll();
  }
  function closeView(v) {
    removeFrom(v);
    if (!ws.hidden.includes(v)) ws.hidden.push(v);
    tidyPanes(); save(); C.renderAll();
  }
  function activate(v, opts) {
    let k = keyOf(v);
    if (!k) { ws.hidden = ws.hidden.filter(x => x !== v); const h = homeRegion(ws, v); h.tabs.push(v); k = keyOf(v); }
    const r = region(k);
    r.active = v; r.collapsed = false;
    save();
    if (!opts || !opts.noRender) C.renderAll();
  }
  function toggleDock(side) {
    const r = ws[side];
    if (!r.tabs.length) { C.notice('That sidebar is empty. Drag a tab onto the edge of the window to put something there.', '', 4000); return; }
    r.collapsed = !r.collapsed; save(); C.renderAll();
  }
  function applyPreset(id) { ws = normalize(PRESETS[id].ws()); save(); C.renderAll(); C.notice('Layout: ' + PRESETS[id].name, '', 1600); }
  function swapSides() { const l = ws.left; ws.left = ws.right; ws.right = l; save(); C.renderAll(); }

  // ------------------------------------------------------------------ render
  function tabMeta(v) { const m = Object.assign({}, VIEWS[v]); const extra = C.viewMeta ? C.viewMeta(v) : {}; return Object.assign(m, extra); }
  function render() {
    const store = $('#viewStore');
    const icon = C.icon, esc = C.esc;
    // park every view, then place the active ones
    for (const v of ALL) { const el = viewEl(v); if (el && el.parentElement !== store) store.appendChild(el); }

    for (const side of ['left', 'right']) {
      const r = ws[side];
      const dock = $('#dock-' + side);
      const visible = r.tabs.length && !r.collapsed;
      dock.hidden = !visible;
      document.querySelector('.resize-handle.' + side).hidden = !visible;
      if (!visible) { dock.innerHTML = ''; continue; }
      dock.innerHTML = '<div class="dock-tabs drag" data-strip="' + side + '" role="tablist" aria-label="' + side + ' sidebar">' +
        r.tabs.map(v => { const m = tabMeta(v); return '<button class="dock-tab' + (v === r.active ? ' is-active' : '') + '" draggable="true" role="tab" aria-selected="' + (v === r.active) + '" data-view="' + v + '" data-action="activate-view" data-tip="' + esc(m.name) + '" aria-label="' + esc(m.name) + '">' + icon(m.icon) + '</button>'; }).join('') +
        '<span class="spacer"></span>' +
        (r.active ? '<span class="dock-title">' + esc(tabMeta(r.active).title || tabMeta(r.active).name) + '</span>' : '') +
        '<button class="clickable-icon" data-action="collapse-dock" data-region="' + side + '" data-tip="Hide sidebar" aria-label="Hide ' + side + ' sidebar">' + icon(side === 'left' ? 'panel-left' : 'panel-right') + '</button></div>' +
        '<div class="dock-body" data-body="' + side + '"></div>';
      if (r.active) dock.querySelector('.dock-body').appendChild(viewEl(r.active));
    }

    const panes = $('#mainPanes');
    panes.style.flexDirection = ws.split;
    panes.classList.toggle('split-column', ws.split === 'column');
    panes.innerHTML = ws.main.map((p, i) => (i ? '<div class="pane-split" data-split role="separator" aria-orientation="' + (ws.split === 'row' ? 'vertical' : 'horizontal') + '"></div>' : '') +
      '<div class="pane" data-pane="' + i + '" style="flex:' + (ws.main.length > 1 ? (i ? 1 - ws.ratio : ws.ratio) : 1) + ' 1 0">' +
      '<div class="tab-header drag" data-strip="main:' + i + '"><div class="tabs" role="tablist">' +
      p.tabs.map(v => { const m = tabMeta(v); return '<div class="tab' + (v === p.active ? ' is-active' : '') + '" draggable="true" role="tab" tabindex="0" aria-selected="' + (v === p.active) + '" data-view="' + v + '" data-action="activate-view">' +
        icon(m.icon) + '<span>' + esc(m.title || m.name) + '</span>' + (m.count != null ? '<span class="count">' + m.count + '</span>' : '') +
        '<button class="tab-close" data-action="close-view" data-view="' + v + '" aria-label="Close ' + esc(m.name) + '" data-tip="Close">' + icon('x') + '</button></div>'; }).join('') +
      '</div><div class="spacer"></div>' +
      (i === ws.main.length - 1 ? '<button class="clickable-icon pane-btn" data-action="toggle-right" data-tip="Toggle right sidebar" data-cmd="toggle-right" aria-label="Toggle right sidebar">' + icon('panel-right') + '</button>' : '') +
      '</div><div class="pane-body" data-body="main:' + i + '">' + (p.active ? '' : emptyPane()) + '</div></div>').join('');
    ws.main.forEach((p, i) => { if (p.active) panes.querySelector('[data-body="main:' + i + '"]').appendChild(viewEl(p.active)); });

    // keep the top-right header clear of Windows' minimize/maximize/close buttons
    requestAnimationFrame(markTopRight);
  }
  function emptyPane() {
    const hidden = ALL.filter(v => !isVisible(v));
    return '<div class="pane-empty"><img src="icon.png" alt=""><div class="pe-title">Empty pane</div><div class="pe-sub">Drag a tab here, or open a view:</div><div class="pe-actions">' +
      hidden.map(v => '<button class="btn small" data-action="activate-view" data-view="' + v + '" data-into="main">' + C.icon(VIEWS[v].icon) + C.esc(VIEWS[v].name) + '</button>').join('') + '</div></div>';
  }
  function markTopRight() {
    document.querySelectorAll('.tr-pad').forEach(el => el.classList.remove('tr-pad'));
    if (document.body.classList.contains('mac')) return;
    const cands = [...document.querySelectorAll('.dock-tabs, .tab-header')].filter(el => el.offsetParent !== null);
    let best = null, bestRight = -1;
    for (const el of cands) { const r = el.getBoundingClientRect(); if (r.top <= 1 && r.right > bestRight) { best = el; bestRight = r.right; } }
    if (best) best.classList.add('tr-pad');
  }
  window.addEventListener('resize', () => requestAnimationFrame(markTopRight));

  // ------------------------------------------------------------------ drag and drop
  const ind = () => $('#dropIndicator');
  function showInd(rect, kind) {
    const el = ind();
    el.className = 'drop-indicator show ' + (kind || '');
    el.style.left = rect.left + 'px'; el.style.top = rect.top + 'px'; el.style.width = rect.width + 'px'; el.style.height = rect.height + 'px';
  }
  function hideInd() { ind().className = 'drop-indicator'; dropTarget = null; }
  function computeTarget(e) {
    const edge = e.target.closest && e.target.closest('[data-edge]');
    if (edge) { const side = edge.dataset.edge; return { t: { region: side, index: ws[side].tabs.length }, rect: edge.getBoundingClientRect(), kind: 'zone' }; }
    const strip = e.target.closest && e.target.closest('[data-strip]');
    if (strip) {
      const key = strip.dataset.strip;
      const tabs = [...strip.querySelectorAll('[data-view][draggable]')];
      let index = tabs.length, x = null;
      for (let i = 0; i < tabs.length; i++) { const r = tabs[i].getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) { index = i; x = r.left; break; } }
      const sr = strip.getBoundingClientRect();
      if (x == null) x = tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : sr.left + 8;
      return { t: { region: key, index }, rect: { left: x - 1, top: sr.top + 6, width: 3, height: sr.height - 12 }, kind: 'line' };
    }
    const body = e.target.closest && e.target.closest('[data-body]');
    if (body) {
      const key = body.dataset.body;
      const r = body.getBoundingClientRect();
      if (key.startsWith('main:') && ws.main.length < 2) {
        const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        const m = Math.min(fx, 1 - fx, fy, 1 - fy);
        if (m < 0.22) {
          if (m === 1 - fx) return { t: { split: 'right' }, rect: { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height }, kind: 'zone' };
          if (m === fx) return { t: { split: 'left' }, rect: { left: r.left, top: r.top, width: r.width / 2, height: r.height }, kind: 'zone' };
          if (m === 1 - fy) return { t: { split: 'down' }, rect: { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 }, kind: 'zone' };
          return { t: { split: 'up' }, rect: { left: r.left, top: r.top, width: r.width, height: r.height / 2 }, kind: 'zone' };
        }
      }
      return { t: { region: key }, rect: r, kind: 'zone' };
    }
    return null;
  }
  document.addEventListener('dragstart', e => {
    const t = e.target.closest && e.target.closest('[draggable][data-view]');
    if (!t) return;
    dragView = t.dataset.view;
    e.dataTransfer.setData('text/onyx-view', dragView);
    e.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('view-dragging');
    document.body.classList.toggle('left-free', !ws.left.tabs.length || ws.left.collapsed);
    document.body.classList.toggle('right-free', !ws.right.tabs.length || ws.right.collapsed);
  });
  document.addEventListener('dragover', e => {
    if (!dragView) return;
    const tg = computeTarget(e);
    if (!tg) { hideInd(); return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    dropTarget = tg.t; showInd(tg.rect, tg.kind);
  });
  document.addEventListener('drop', e => {
    if (!dragView) return;
    e.preventDefault();
    const v = dragView, t = dropTarget;
    endDrag();
    if (t) moveView(v, t);
  });
  document.addEventListener('dragend', endDrag);
  function endDrag() { dragView = null; hideInd(); document.body.classList.remove('view-dragging', 'left-free', 'right-free'); }

  // split ratio
  document.addEventListener('mousedown', e => {
    const h = e.target.closest && e.target.closest('[data-split]');
    if (!h) return;
    e.preventDefault();
    const box = $('#mainPanes').getBoundingClientRect();
    const row = ws.split === 'row';
    h.classList.add('dragging'); document.body.style.cursor = row ? 'col-resize' : 'row-resize';
    const panes = document.querySelectorAll('#mainPanes > .pane');
    const mm = ev => {
      ws.ratio = Math.min(0.85, Math.max(0.15, row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height));
      panes[0].style.flex = ws.ratio + ' 1 0'; panes[1].style.flex = (1 - ws.ratio) + ' 1 0';
    };
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); h.classList.remove('dragging'); document.body.style.cursor = ''; save(); markTopRight(); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  });

  // keyboard / menu alternative to dragging
  function tabMenuItems(v) {
    const k = keyOf(v);
    const items = [{ heading: VIEWS[v].name }];
    if (k !== 'left') items.push({ label: 'Move to left sidebar', icon: 'panel-left', action: () => moveView(v, { region: 'left' }) });
    if (k !== 'right') items.push({ label: 'Move to right sidebar', icon: 'panel-right', action: () => moveView(v, { region: 'right' }) });
    if (!k || !k.startsWith('main')) items.push({ label: 'Move to main area', icon: 'layout-dashboard', action: () => moveView(v, { region: 'main:0' }) });
    if (ws.main.length < 2) { items.push({ label: 'Split right', icon: 'columns', action: () => moveView(v, { split: 'right' }) }); items.push({ label: 'Split down', icon: 'rows', action: () => moveView(v, { split: 'down' }) }); }
    else if (k && k.startsWith('main')) items.push({ label: 'Move to other pane', icon: 'columns', action: () => moveView(v, { region: k === 'main:0' ? 'main:1' : 'main:0' }) });
    items.push('sep', { label: 'Close', icon: 'x', action: () => closeView(v) });
    return items;
  }
  document.addEventListener('contextmenu', e => {
    const t = e.target.closest && e.target.closest('[draggable][data-view]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    C.showMenu(tabMenuItems(t.dataset.view), e.clientX, e.clientY);
  }, true);
  document.addEventListener('keydown', e => {
    const t = document.activeElement && document.activeElement.closest && document.activeElement.closest('[draggable][data-view]');
    if (!t) return;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { const r = t.getBoundingClientRect(); C.showMenu(tabMenuItems(t.dataset.view), r.left, r.bottom + 4, { keyboard: true }); e.preventDefault(); }
  });

  window.OnyxWorkspace = {
    VIEWS, PRESETS,
    init(ctx, saved) { C = ctx; ws = normalize(saved); },
    get: () => ws,
    render, isVisible, activate, moveView, closeView, toggleDock, applyPreset, swapSides, keyOf, tabMenuItems,
    isHidden: v => ws.hidden.includes(v),
  };
})();
