/* Onyx extensions: the registry every extension (built-in or community) registers with.
   An extension can add viewers: something that shows a kind of file inside Onyx.

     Onyx.registerExtension({
       id: 'my-viewer', name: 'My viewer', version: '1.0.0', author: 'You', icon: 'file',
       description: 'What it does, in one line.',
       viewers: [{
         id: 'thing', label: 'Thing files', priority: 0,
         match: file => file.extension === 'thing',        // file: { name, path, extension, size, lastModified }
         render(el, api) { el.textContent = 'Hello ' + api.file.name; return { destroy() {} }; },
         details(api) { return '<div>small preview for the details pane</div>'; },   // optional
       }],
     });

   See EXTENSIONS.md for the whole API. */
(function () {
  'use strict';
  const registry = new Map();
  const listeners = new Set();
  let C = null;
  const ID = /^[a-z0-9][a-z0-9-]{1,48}$/;

  function registerExtension(def) {
    if (!def || typeof def !== 'object' || !ID.test(def.id || '') || !def.name) {
      console.warn('[Onyx] An extension needs an id (lowercase letters, numbers and dashes) and a name.', def);
      return false;
    }
    const src = (document.currentScript && document.currentScript.src) || '';
    const community = /^onyx-ext:/i.test(src);
    if (registry.has(def.id) && registry.get(def.id).builtin && community) {
      console.warn('[Onyx] A community extension can’t replace the built-in “' + def.id + '”.');
      return false;
    }
    const viewers = (Array.isArray(def.viewers) ? def.viewers : []).filter(v => v && typeof v.match === 'function' && typeof v.render === 'function')
      .map(v => Object.assign({ priority: 0 }, v, { ext: def.id }));
    registry.set(def.id, Object.assign({}, def, { builtin: !community, viewers, version: String(def.version || '1.0.0') }));
    for (const fn of listeners) { try { fn(def.id); } catch { /* listener failed */ } }
    return true;
  }
  const settings = () => (C && C.UI && C.UI().extensions) || {};
  // built-in extensions are on unless you turn them off; community ones are off until you turn them on
  function isEnabled(id) {
    const e = registry.get(id); if (!e) return false;
    const v = settings()[id];
    if (!e.builtin && !settings().community) return false;
    return v === undefined ? e.builtin : !!v;
  }
  function viewersFor(file, all) {
    const out = [];
    for (const e of registry.values()) {
      if (!all && !isEnabled(e.id)) continue;
      for (const v of e.viewers) { let ok = false; try { ok = !!v.match(file); } catch { ok = false; } if (ok) out.push(v); }
    }
    return out.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  const viewerFor = file => viewersFor(file)[0] || null;
  // a turned-off extension that could show this file (to suggest turning it on)
  function offViewerFor(file) { const on = viewerFor(file); if (on) return null; const v = viewersFor(file, true)[0]; return v ? registry.get(v.ext) : null; }

  // community extensions: folders inside Onyx's extensions folder, each with a manifest.json and a script
  let community = [];
  const loaded = new Set();
  async function loadCommunity() {
    if (!C || !C.api.extList) return [];
    let r; try { r = await C.api.extList(); } catch { r = null; }
    community = (r && Array.isArray(r.extensions)) ? r.extensions : [];
    if (!settings().community) return community;
    for (const m of community) if (settings()[m.id] && !loaded.has(m.id)) inject(m);
    return community;
  }
  function inject(m) {
    loaded.add(m.id);
    const s = document.createElement('script');
    s.src = 'onyx-ext://ext/' + encodeURIComponent(m.folder) + '/' + m.main.split('/').map(encodeURIComponent).join('/');
    s.onerror = () => { if (C) C.notice('Couldn’t load the extension <b>' + C.esc(m.name) + '</b>.', 'error', 5000); };
    document.head.appendChild(s);
  }
  function changed(key) {
    if (key === 'community' || (settings().community && community.some(m => m.id === key) && settings()[key])) loadCommunity();
    for (const fn of listeners) { try { fn(key); } catch { /* listener failed */ } }
  }

  window.Onyx = window.Onyx || {};
  window.Onyx.registerExtension = registerExtension;
  window.OnyxExtensions = {
    init(ctx) { C = ctx; },
    list: () => [...registry.values()],
    get: id => registry.get(id) || null,
    community: () => community.slice(),
    isLoaded: id => registry.has(id),
    isEnabled, viewersFor, viewerFor, offViewerFor, changed, loadCommunity,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
