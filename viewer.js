/* Onyx viewer host: look at a file without leaving Onyx. What it can show comes from extensions
   (Image Viewer, PDF Viewer, Media Player, Text Viewer, and any community extension you add).
   Space opens it, ← → go through the folder, Esc closes. */
(function () {
  'use strict';
  let C = null, LIB = null;
  const X = () => window.OnyxExtensions;
  const V = { el: null, path: null, list: [], ctl: null, viewer: null, token: 0, tools: [], info: '' };
  const esc = s => C.esc(s);
  const icon = (n, c) => C.icon(n, c);
  const url = f => (C.api.fileUrl ? C.api.fileUrl(f.path, Math.round(f.lastModified || 0)) : '');
  const isOpen = () => !!V.el;
  const canPreview = f => !!(f && X() && X().viewerFor(f));

  // what an extension gets to work with
  function apiFor(f, tok, el) {
    return {
      file: Object.freeze({ name: f.name, path: f.path, extension: (f.extension || '').toLowerCase(), size: f.size, lastModified: f.lastModified }),
      url: url(f),
      el,
      text: () => C.api.fileText(f.path),
      thumb: size => C.api.thumb(f.path, size || 512),
      open: () => LIB.openFile(f.path),
      reveal: () => C.api.reveal(f.path),
      isCurrent: () => tok === V.token,
      setToolbar: items => { if (tok !== V.token) return; V.tools = Array.isArray(items) ? items : []; drawBar(); },
      setInfo: text => { if (tok !== V.token) return; V.info = String(text || ''); drawBar(); },
      noPreview: why => { if (tok === V.token) noPreview(f, el, why); },
      icon, esc, fmt: n => C.fmt(n), notice: (m, t, ms) => C.notice(m, t, ms),
    };
  }

  // ------------------------------------------------------------------ open / close
  function open(path) {
    const vault = C.S.vault;
    if (!vault) return;
    if (vault.demo) { C.notice('The demo vault only exists in memory, so there’s nothing to show. Open a real folder to preview files.', 'warn', 4000); return; }
    const f = LIB.fileBy(path);
    if (!f) return;
    if (!C.WS.isVisible('library')) C.WS.activate('library');
    const host = document.querySelector('#vs-library .lib');
    if (!host) return;
    V.list = LIB.previewList().map(x => x.path);
    if (!V.list.includes(path)) V.list = [path];
    if (!V.el) {
      V.el = document.createElement('div');
      V.el.className = 'viewer';
      V.el.setAttribute('role', 'dialog');
      V.el.setAttribute('aria-label', 'Preview');
      V.el.tabIndex = -1;
      V.el.innerHTML = '<div class="vw-bar"></div><div class="vw-body"></div>';
      host.appendChild(V.el);
      V.el.addEventListener('click', onClick);
    }
    show(path);
    V.el.focus({ preventScroll: true });
  }
  function teardown() {
    if (V.ctl && typeof V.ctl.destroy === 'function') { try { V.ctl.destroy(); } catch (e) { console.warn('[Onyx] extension cleanup failed', e); } }
    V.ctl = null; V.viewer = null; V.tools = []; V.info = '';
    if (V.el) V.el.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch { /* gone */ } });
  }
  function close() {
    if (!V.el) return;
    V.token++;
    teardown();
    V.el.remove(); V.el = null; V.path = null;
    LIB.focusList();
  }
  function toggle(path) { if (isOpen() && (!path || path === V.path)) close(); else if (path) open(path); }

  // ------------------------------------------------------------------ one file
  function show(path) {
    const f = LIB.fileBy(path);
    if (!f || !V.el) return;
    teardown();
    const tok = ++V.token;
    V.path = path;
    LIB.selectPath(path);
    const old = V.el.querySelector('.vw-body');
    const body = document.createElement('div');
    old.replaceWith(body);
    const viewer = X() ? X().viewerFor(f) : null;
    body.className = 'vw-body' + (viewer ? ' vw-' + viewer.ext + ' vw-v-' + viewer.id : '');
    V.viewer = viewer;
    drawBar();
    if (!viewer) { noPreview(f, body); return; }
    try {
      V.ctl = viewer.render(body, apiFor(f, tok, body)) || null;
    } catch (e) {
      console.error('[Onyx] ' + viewer.ext + ' failed', e);
      noPreview(f, body, 'The ' + extName(viewer.ext) + ' extension couldn’t show this file.');
    }
    // the next file gets a head start, so flipping through is instant
    const i = V.list.indexOf(path), nx = V.list[i + 1] && LIB.fileBy(V.list[i + 1]);
    const nv = nx && X().viewerFor(nx);
    if (nv && typeof nv.prefetch === 'function') { try { nv.prefetch(apiFor(nx, -1, null)); } catch { /* fine */ } }
  }
  const extName = id => { const e = X() && X().get(id); return e ? e.name : id; };
  async function noPreview(f, body, why) {
    const off = X() && X().offViewerFor(f);
    body.className = 'vw-body vw-none';
    body.innerHTML = '<div class="vw-none-box"><div class="vw-none-art"><span class="ft-icon">' + icon(window.fileIconName(f.extension)) + (f.extension ? '<span class="ft-ext">' + esc(f.extension.slice(0, 5)) + '</span>' : '') + '</span></div>' +
      '<div class="vw-none-name">' + esc(f.name) + '</div><div class="vw-none-sub">' + (why ? esc(why) : off ? 'The <b>' + esc(off.name) + '</b> extension can show this, but it’s turned off.' : 'No preview for ' + esc(f.extension ? '.' + f.extension + ' files' : 'this file') + '.') + '</div>' +
      '<div class="vw-none-actions">' + (off && !why ? '<button class="btn mod-cta" data-vw="enable" data-ext="' + esc(off.id) + '">' + icon('puzzle' in window.ICONS ? 'puzzle' : 'check') + 'Turn on ' + esc(off.name) + '</button>' : '') +
      '<button class="btn' + (off && !why ? '' : ' mod-cta') + '" data-vw="open">' + icon('external-link') + 'Open in its app</button><button class="btn" data-vw="reveal">' + icon('folder-open') + 'Show in folder</button></div></div>';
    // Windows may still have a picture of it (documents, 3D models…)
    const tok = V.token;
    try {
      const t = await C.api.thumb(f.path, 512);
      if (tok === V.token && t && t.url && t.kind !== 'icon') { const art = body.querySelector('.vw-none-art'); if (art) art.innerHTML = '<img src="' + t.url + '" alt="">'; }
    } catch { /* no picture */ }
  }
  function drawBar() {
    const bar = V.el && V.el.querySelector('.vw-bar');
    const f = V.path && LIB.fileBy(V.path);
    if (!bar || !f) return;
    const i = V.list.indexOf(V.path), n = V.list.length;
    const b = (vw, ic, tip, dis) => '<button class="cmd-btn" data-vw="' + vw + '" aria-label="' + esc(tip) + '" data-tip="' + esc(tip) + '"' + (dis ? ' disabled' : '') + '>' + icon(ic) + '</button>';
    const tools = V.tools.map((t, k) => t === 'sep' || (t && t.sep) ? '<span class="cmd-sep"></span>'
      : '<button class="cmd-btn' + (t.label || t.text ? ' has-label' : '') + (t.active ? ' is-active' : '') + '" data-tool="' + k + '" aria-label="' + esc(t.tip || t.label || '') + '"' + (t.tip ? ' data-tip="' + esc(t.tip) + '"' : '') + (t.disabled ? ' disabled' : '') + '>' +
        (t.icon ? icon(t.icon) : '') + (t.label ? '<span>' + esc(t.label) + '</span>' : '') + (t.text ? '<span class="vw-tool-text">' + esc(t.text) + '</span>' : '') + '</button>').join('');
    bar.innerHTML =
      b('prev', 'arrow-left', 'Previous (←)', i <= 0) + b('next', 'arrow-right', 'Next (→)', i < 0 || i >= n - 1) +
      '<div class="vw-title"><span class="vw-name" title="' + esc(f.path) + '">' + esc(f.name) + '</span><span class="vw-count">' + [n > 1 ? (i + 1) + ' of ' + n : '', V.info, C.fmt(f.size)].filter(Boolean).map(esc).join(' · ') + '</span></div>' +
      (tools ? tools + '<span class="cmd-sep"></span>' : '') +
      '<button class="cmd-btn has-label" data-vw="open" data-tip="Open in its own app (Enter)">' + icon('external-link') + '<span>Open</span></button>' +
      b('reveal', 'folder-open', 'Show in File Explorer') +
      b('close', 'x', 'Close (Esc)');
  }

  // ------------------------------------------------------------------ commands and keys
  function step(d) { const i = V.list.indexOf(V.path) + d; if (i >= 0 && i < V.list.length) show(V.list[i]); }
  function act(a, el) {
    const f = LIB.fileBy(V.path);
    if (a === 'close') close();
    else if (a === 'prev') step(-1);
    else if (a === 'next') step(1);
    else if (a === 'open') { if (f) LIB.openFile(f.path); }
    else if (a === 'reveal') { if (f) C.api.reveal(f.path); }
    else if (a === 'enable' && el) { C.setUi('extensions', el.dataset.ext, true); }
  }
  function onClick(e) {
    const t = e.target.closest('[data-tool]');
    if (t && !t.disabled) { const item = V.tools[+t.dataset.tool]; if (item && typeof item.run === 'function') { e.preventDefault(); try { item.run(); } catch (err) { console.warn(err); } } return; }
    const b = e.target.closest('[data-vw]');
    if (b && !b.disabled) { e.preventDefault(); act(b.dataset.vw, b); }
  }
  document.addEventListener('keydown', e => {
    if (!V.el) return;
    if (document.querySelector('.modal-container, .settings-modal')) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    // the extension gets first say (zoom keys, page keys…)
    if (V.ctl && typeof V.ctl.onKey === 'function') { let used = false; try { used = !!V.ctl.onKey(e); } catch { used = false; } if (used) { e.preventDefault(); e.stopPropagation(); return; } }
    const media = t && /^(VIDEO|AUDIO)$/.test(t.tagName);
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    let a = null;
    if (k === 'Escape') a = 'close';
    else if (k === ' ' && !media) a = 'close';
    else if ((k === 'ArrowLeft' || k === 'PageUp') && !media) a = 'prev';
    else if ((k === 'ArrowRight' || k === 'PageDown') && !media) a = 'next';
    else if (k === 'Home' && !media) { e.preventDefault(); e.stopPropagation(); show(V.list[0]); return; }
    else if (k === 'End' && !media) { e.preventDefault(); e.stopPropagation(); show(V.list[V.list.length - 1]); return; }
    else if (k === 'Enter' && !mod) a = 'open';
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    act(a);
  }, true);
  window.addEventListener('resize', () => { if (V.ctl && typeof V.ctl.resize === 'function') { try { V.ctl.resize(); } catch { /* fine */ } } });

  // ------------------------------------------------------------------ the details pane
  // an extension can offer a small preview for the details pane (a PDF's first page, a play button for a sound)
  const detailCtls = [];
  function detailsPreview(f) {
    const v = f && X() && X().viewerFor(f);
    if (!v || typeof v.details !== 'function') return null;
    try { const html = v.details(apiFor(f, V.token, null)); return html ? { html, replace: !!v.detailsReplacePreview } : null; } catch { return null; }
  }
  function afterDetails(f) {
    while (detailCtls.length) { const c = detailCtls.pop(); try { c(); } catch { /* fine */ } }
    const v = f && X() && X().viewerFor(f);
    const el = document.querySelector('#libDetails .ld-ext');
    if (!v || !el || typeof v.afterDetails !== 'function') return;
    try { const stop = v.afterDetails(el, apiFor(f, V.token, el)); if (typeof stop === 'function') detailCtls.push(stop); } catch { /* fine */ }
  }

  function init(ctx, lib) {
    C = ctx; LIB = lib;
    X().onChange(() => { if (V.el && V.path) show(V.path); });
  }
  window.OnyxViewer = { init, open, close, toggle, canPreview, isOpen, detailsPreview, afterDetails, get path() { return V.path; } };
})();
