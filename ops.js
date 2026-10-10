/* Onyx file operations in the Library, like File Explorer: new folder, rename in place (F2), cut / copy / paste
   (shared with Explorer's clipboard), delete to the Recycle Bin, undo, drag and drop in and out, Properties,
   Open with, Open in Terminal, ZIP files and Windows' own right-click menu. */
(function () {
  'use strict';
  const E = window.OnyxEngine;
  const $ = s => document.querySelector(s);
  let C = null, LI = null;
  const O = { cut: new Set(), undoLabel: '', op: null, dragging: null, rn: null };
  const ARCHIVE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i;
  const EXEC = /\.(exe|msi|bat|cmd|com|ps1|vbs|scr|msix|appx)$/i;
  const esc = s => C.esc(s);
  const plural = (n, w, p) => n + ' ' + (n === 1 ? w : (p || w + 's'));
  const V = () => C.S.vault;
  const isWin = () => C.api.platform === 'win32';
  const mod = () => (C.isMac ? '⌘' : 'Ctrl+');

  // ------------------------------------------------------------------ helpers
  function demoBlock() {
    if (!V()) { C.notice('Open a folder first', 'warn'); return true; }
    if (V().demo) { C.notice('The demo vault only exists in memory, so there are no real files to change. Open a real folder to try this.', 'warn', 4500); return true; }
    return false;
  }
  const sel = () => LI.selection();                 // selected paths (files and folders), in view order
  const isDirPath = p => !!LI.dirBy(p) && !LI.fileBy(p);
  const nameOf = p => E.basename(p);
  const itemsLabel = paths => paths.length === 1 ? '“' + esc(nameOf(paths[0])) + '”' : plural(paths.length, 'item');
  function failText(list) {
    if (!list || !list.length) return '';
    return '<br><span class="muted">' + list.slice(0, 3).map(f => esc(f.name || nameOf(f.path || '')) + ': ' + esc(f.error)).join('<br>') + (list.length > 3 ? '<br>and ' + (list.length - 3) + ' more' : '') + '</span>';
  }
  // what the main process sent back: the folder's new contents and what to select
  function apply(r, opts) {
    opts = opts || {};
    const v = V(); if (!v || !r) return;
    if (r.vault) {
      v.files = r.vault.files; v.dirs = r.vault.dirs; v.tags = r.vault.tags; v.undo = r.vault.undo;
      if (C.S.plan) { C.S.plan = null; C.renderAll(); }
    } else {
      if (r.goneDirs && r.goneDirs.length) LI.dropDirs(r.goneDirs);
      for (const l of r.listings || []) LI.mergeListing(l);
      if (r.tags) v.tags = r.tags;
    }
    LI.changed();
    if (r.select && r.select.length && !opts.noSelect) LI.selectPaths(r.select);
    refreshUndo();
  }
  async function refreshUndo() { try { O.undoLabel = (await C.api.fsUndoLabel()) || ''; } catch { O.undoLabel = ''; } LI.renderCmd(); }

  // ------------------------------------------------------------------ new
  async function newItem(kind) {
    if (demoBlock()) return;
    if (LI.query()) { C.notice('Clear the search first: new items go into the folder you’re in.', 'warn', 3000); return; }
    const r = await C.api.fsNew(LI.cwd(), kind);
    if (r.error) { C.notice(esc(r.error), 'error'); return; }
    apply(r);
    if (r.select && r.select[0]) startRename(r.select[0], { fresh: true });
  }

  // ------------------------------------------------------------------ rename in place (F2)
  const BAD = /[<>:"/\\|?*\u0000-\u001f]/;
  function nameProblem(n) {
    if (!n) return '';
    if (BAD.test(n)) return 'A name can’t contain any of these characters: \\ / : * ? " < > |';
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.[^.]*)?$/i.test(n)) return '“' + n + '” is a name Windows keeps for itself.';
    if (n.length > 255) return 'That name is too long.';
    return '';
  }
  function startRename(path, opts) {
    opts = opts || {};
    if (demoBlock()) return;
    if (!path) { const s = sel(); if (!s.length) { C.notice('Select something to rename', 'warn', 2000); return; } path = LI.focus() && s.includes(LI.focus()) ? LI.focus() : s[0]; }
    cancelRename();
    const many = !opts.fresh && sel().length > 1 && sel().includes(path) ? sel().slice() : null;
    if (!many) LI.selectPaths([path]);
    LI.reveal(path);
    const dir = isDirPath(path);
    const name = nameOf(path);
    const input = document.createElement('input');
    input.className = 'lib-rename';
    input.value = name;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'New name');
    const tip = document.createElement('div');
    tip.className = 'lib-rename-tip';
    O.rn = { path, input, tip, dir, name, many, done: false, repaint: false, sel: null };
    const keep = e => e.stopPropagation();
    ['mousedown', 'click', 'dblclick', 'contextmenu', 'dragstart'].forEach(t => input.addEventListener(t, keep));
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(true); }
      else if (e.key === 'Tab') { e.preventDefault(); commitRename(); }
    });
    input.addEventListener('input', () => { const p = nameProblem(input.value); tip.textContent = p; tip.classList.toggle('show', !!p); });
    input.addEventListener('blur', () => { if (O.rn && O.rn.input === input && !O.rn.repaint && !O.rn.done) commitRename(); });
    attachRename(true);
  }
  function attachRename(first) {
    const rn = O.rn; if (!rn) return;
    const row = LI.rowEl(rn.path);
    if (!row) return;
    row.classList.add('is-renaming');
    const slot = row.querySelector('.lr-name, .lt-name');
    const host = row.classList.contains('lib-tile') ? row : slot;
    if (rn.input.parentElement !== host) { host.appendChild(rn.input); host.appendChild(rn.tip); }
    rn.input.focus({ preventScroll: true });
    if (first) {
      const ext = rn.dir ? '' : (E.splitExt(rn.name).ext || '');
      const end = ext && rn.name.length > ext.length + 1 ? rn.name.length - ext.length - 1 : rn.name.length;
      rn.input.setSelectionRange(0, end);
    } else if (rn.sel) rn.input.setSelectionRange(rn.sel[0], rn.sel[1]);
  }
  // the list repaints as you scroll: keep the box (and what you typed) across repaints
  function beforePaint() { const rn = O.rn; if (rn && rn.input.isConnected) { rn.repaint = true; rn.sel = [rn.input.selectionStart, rn.input.selectionEnd]; rn.hadFocus = document.activeElement === rn.input; } }
  function afterPaint() {
    const rn = O.rn;
    if (rn) { if (LI.rowEl(rn.path)) attachRename(false); rn.repaint = false; }
    if (O.cut.size) document.querySelectorAll('#libCanvas [data-path]').forEach(el => el.classList.toggle('is-cut', O.cut.has(el.dataset.path)));
  }
  function cancelRename(refocus) {
    const rn = O.rn; if (!rn) return;
    rn.done = true; O.rn = null;
    rn.input.remove(); rn.tip.remove();
    document.querySelectorAll('.is-renaming').forEach(el => el.classList.remove('is-renaming'));
    if (refocus) LI.focusList();
  }
  async function commitRename() {
    const rn = O.rn; if (!rn || rn.done) return;
    const raw = rn.input.value;
    const name = raw.replace(/^\s+/, '').replace(/[\s.]+$/, '');
    if (!name || name === rn.name) { cancelRename(true); return; }
    const p = nameProblem(name);
    if (p) { rn.tip.textContent = p; rn.tip.classList.add('show'); rn.input.focus(); return; }
    rn.done = true;
    const run = async () => {
      cancelRename(false);
      const r = rn.many ? await C.api.fsRenameMany(rn.many, name) : await C.api.fsRename(rn.path, name);
      if (r.error) { C.notice(esc(r.error), 'error', 5000); LI.focusList(); return; }
      apply(r);
      LI.focusList();
    };
    // like Explorer: changing a file's extension can make it unusable
    const oldExt = rn.dir ? '' : (E.splitExt(rn.name).ext || '').toLowerCase();
    const newExt = rn.dir ? '' : (E.splitExt(name).ext || '').toLowerCase();
    if (!rn.many && !rn.dir && oldExt !== newExt && (oldExt || newExt)) {
      rn.repaint = true;
      C.confirmModal('Change the file extension?', '<p>If you change a file name extension, the file might stop opening in the right program.</p><p class="muted">' + esc(rn.name) + ' → ' + esc(name) + '</p>', 'Change it', run);
      // if the dialog is dismissed, put the edit box back
      const watch = setInterval(() => { if (!document.querySelector('.modal-container')) { clearInterval(watch); if (O.rn === rn) cancelRename(true); } }, 200);
      return;
    }
    run();
  }

  // ------------------------------------------------------------------ clipboard (shared with Explorer)
  async function toClipboard(effect) {
    if (demoBlock()) return;
    const s = sel();
    if (!s.length) { C.notice('Select files or folders first', 'warn', 2000); return; }
    const r = await C.api.fsClipSet(s, effect);
    if (r.error) { C.notice(esc(r.error), 'error'); return; }
    O.cut = new Set(effect === 'move' ? s : []);
    afterPaint();
    if (effect !== 'move') document.querySelectorAll('#libCanvas .is-cut').forEach(el => el.classList.remove('is-cut'));
    C.notice((effect === 'move' ? 'Cut ' : 'Copied ') + itemsLabel(s) + (r.shared ? '. Paste in Onyx or in File Explorer.' : '.'), '', 2200);
    LI.renderCmd();
  }
  async function pasteHere(destRel) {
    if (demoBlock()) return;
    const dest = destRel == null ? LI.cwd() : destRel;
    const clip = await C.api.fsClipGet();
    if (!clip || !clip.files || !clip.files.length) { C.notice('Nothing to paste. Copy or cut files first, here or in File Explorer.', '', 3000); return; }
    const r = await transfer(clip.files, dest, clip.effect === 'move' ? 'move' : 'copy', { fromClipboard: true });
    if (r && clip.effect === 'move') { O.cut.clear(); afterPaint(); }
  }
  /**
   * Copy or move absolute paths into a folder of the open location. Asks what to do about names that already
   * exist (like Explorer's "Replace or Skip Files"), shows progress, and offers Undo.
   */
  async function transfer(sources, destRel, mode, opts) {
    opts = opts || {};
    const plan = await C.api.fsPlanPaste(sources, destRel, mode);
    if (plan.error) { C.notice(esc(plan.error), 'error'); return null; }
    const items = plan.items || [];
    if (items.length && items.every(i => i.noop)) return null;          // dropped where it already is
    const clashes = items.filter(i => i.conflict);
    let resolution = 'both';
    if (clashes.length) {
      resolution = await askConflicts(clashes, items.length, destRel, mode);
      if (!resolution) return null;
    }
    const r = await C.api.fsPaste({ sources, dest: destRel, mode, resolution, fromClipboard: !!opts.fromClipboard });
    O.op = null; LI.renderProgress();
    if (r.error) { C.notice(esc(r.error), 'error', 6000); return null; }
    apply(r);
    const where = destRel ? E.basename(destRel) : V().vaultName;
    const did = mode === 'move' ? 'Moved' : 'Copied';
    if (r.count) C.notice(did + ' ' + plural(r.count, 'item') + ' to <b>' + esc(where) + '</b>' + (r.replaced ? ' (' + r.replaced + ' replaced, the old ones are in the Recycle Bin)' : '') + (r.skipped ? ' · skipped ' + r.skipped : '') + (r.cancelled ? ' · stopped early' : '') + failText(r.failed),
      r.failed && r.failed.length ? 'warn' : 'success', 6000, { label: 'Undo', run: undo });
    else if (r.failed && r.failed.length) C.notice('Couldn’t ' + (mode === 'move' ? 'move' : 'copy') + ' that' + failText(r.failed), 'error', 7000);
    return r;
  }
  function askConflicts(clashes, total, destRel, mode) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const where = destRel ? E.basename(destRel) : V().vaultName;
      const list = clashes.slice(0, 5).map(c => '<li>' + C.icon(c.dir ? 'folder' : 'file') + esc(c.name) + '</li>').join('') + (clashes.length > 5 ? '<li class="muted">and ' + (clashes.length - 5) + ' more</li>' : '');
      C.modal({
        title: 'Replace or skip ' + (clashes.length === 1 ? 'this item' : 'these items') + '?',
        cls: 'mod-conflict',
        html: '<p><b>' + esc(where) + '</b> already has ' + (clashes.length === 1 ? 'something' : plural(clashes.length, 'item')) + ' with the same name' + (total > clashes.length ? '. ' + plural(total - clashes.length, 'other item') + ' will ' + (mode === 'move' ? 'move' : 'copy') + ' normally' : '') + '.</p><ul class="conflict-list">' + list + '</ul>' +
          '<div class="conflict-choices">' +
          '<button class="conflict-choice" data-res="replace">' + C.icon('refresh-cw') + '<span><b>Replace</b><small>The old ' + (clashes.length === 1 ? 'one goes' : 'ones go') + ' to the Recycle Bin. Folders are merged.</small></span></button>' +
          '<button class="conflict-choice" data-res="skip">' + C.icon('skip-forward' in window.ICONS ? 'skip-forward' : 'x') + '<span><b>Skip</b><small>Leave what’s there alone.</small></span></button>' +
          '<button class="conflict-choice" data-res="both">' + C.icon('copy') + '<span><b>Keep both</b><small>The new ' + (clashes.length === 1 ? 'one gets' : 'ones get') + ' a number, like “' + esc(numbered(clashes[0].name, clashes[0].dir)) + '”.</small></span></button>' +
          '</div>',
        buttons: [{ label: 'Cancel' }],
        onClose: () => finish(null),
      });
      const box = document.querySelector('.mod-conflict');
      box.addEventListener('click', e => { const b = e.target.closest('[data-res]'); if (!b) return; finish(b.dataset.res); const c = box.closest('.modal-container'); if (c) c.querySelector('.modal-bg').dispatchEvent(new MouseEvent('mousedown')); });
      const first = box.querySelector('[data-res="both"]'); if (first) first.focus();
    });
  }
  function numbered(name, dir) { const { base, ext } = E.splitExt(name); return dir || !ext || !base ? name + ' (2)' : base + ' (2).' + ext; }

  // ------------------------------------------------------------------ delete, undo
  async function del(permanent) {
    if (demoBlock()) return;
    const s = sel();
    if (!s.length) { C.notice('Select files or folders first', 'warn', 2000); return; }
    if (permanent) {
      C.confirmModal('Permanently delete ' + (s.length === 1 ? 'this item' : 'these ' + s.length + ' items') + '?', '<p>' + itemsLabel(s) + ' will be deleted for good. It won’t go to the Recycle Bin and can’t be undone.</p>', 'Delete permanently', async () => {
        const r = await C.api.fsDelete(s);
        if (r.error) { C.notice(esc(r.error), 'error'); return; }
        apply(r, { noSelect: true });
        C.notice('Deleted ' + plural(r.done, 'item') + ' permanently' + failText(r.failed), r.failed.length ? 'warn' : 'success', 4000);
      }, true);
      return;
    }
    const next = LI.neighbourAfter(s);
    const r = await C.api.fsTrash(s);
    if (r.error) { C.notice(esc(r.error), 'error', 6000); return; }
    apply(r, { noSelect: true });
    if (next) LI.selectPaths([next]);
    if (r.done) C.notice('Moved ' + plural(r.done, 'item') + ' to the Recycle Bin' + failText(r.failed), r.failed.length ? 'warn' : 'success', 6000, { label: 'Undo', run: undo });
    else C.notice('Couldn’t delete that' + failText(r.failed), 'error', 6000);
  }
  async function undo() {
    if (!V()) return;
    if (!O.undoLabel && C.organizeUndo && V().undo) { C.organizeUndo(); return; }
    const r = await C.api.fsUndo();
    if (r.error) {
      if (/Nothing to undo/.test(r.error) && C.organizeUndo && V().undo) { C.organizeUndo(); return; }
      C.notice(esc(r.error), /Nothing/.test(r.error) ? '' : 'warn', 3500); refreshUndo(); return;
    }
    apply(r);
    C.notice('Undid ' + esc(r.undone || 'that') + failText(r.failed), r.failed && r.failed.length ? 'warn' : 'success', 3000);
  }

  // ------------------------------------------------------------------ Windows
  const one = () => { const s = sel(); return s.length === 1 ? s[0] : null; };
  async function properties(paths) {
    if (demoBlock()) return;
    paths = paths || (sel().length ? sel() : [LI.cwd()]);
    if (!isWin()) { LI.showDetails(); return; }
    const r = await C.api.fsProperties(paths);
    if (r && r.error) C.notice(esc(r.error), 'error');
  }
  async function shellMenu(paths) {
    if (demoBlock()) return;
    paths = paths || sel();
    if (!paths.length) paths = [LI.cwd()];
    const r = await C.api.fsShellMenu(paths);
    if (r && r.error) C.notice(esc(r.error), 'error', 5000);
  }
  async function simple(fn, arg, okMsg) {
    if (demoBlock()) return;
    const r = await fn(arg);
    if (r && r.error) { C.notice(esc(r.error), 'error', 6000); return; }
    if (r && (r.vault || r.listings)) { apply(r); if (okMsg) C.notice(okMsg, 'success', 4000, { label: 'Undo', run: undo }); }
  }
  function copyAsPath(paths) {
    paths = paths || (sel().length ? sel() : [LI.cwd()]);
    const text = paths.map(p => { const a = LI.absPath(p); return isWin() ? '"' + a + '"' : a; }).join('\r\n');
    C.api.copyText(text);
    C.notice('Copied ' + (paths.length === 1 ? 'the path' : plural(paths.length, 'path')), 'success', 1800);
  }

  // ------------------------------------------------------------------ menus (Explorer's order)
  const K = k => mod() + k;
  function itemMenu() {
    const s = sel();
    const p = s.length === 1 ? s[0] : null;
    const dir = p && isDirPath(p);
    const items = [];
    if (p && dir) {
      items.push({ label: 'Open', icon: 'folder-open', sub: 'Enter', action: () => LI.go(p) });
      items.push({ label: 'Open in Terminal', icon: 'terminal-square', action: () => simple(C.api.fsTerminal, p) });
      items.push({ label: 'Organize this folder…', icon: 'sparkles', action: () => LI.organizeDir(p) });
    } else if (p) {
      const VW = window.OnyxViewer;
      if (VW && VW.canPreview(LI.fileBy(p))) items.push({ label: 'Preview', icon: 'eye' in window.ICONS ? 'eye' : 'search', sub: 'Space', action: () => VW.open(p) });
      items.push({ label: 'Open', icon: 'external-link', sub: VW && VW.canPreview(LI.fileBy(p)) ? '' : 'Enter', action: () => LI.openFile(p) });
      if (isWin()) items.push({ label: 'Open with…', icon: 'app-window' in window.ICONS ? 'app-window' : 'external-link', action: () => simple(C.api.fsOpenWith, p) });
      if (isWin() && EXEC.test(p)) items.push({ label: 'Run as administrator', icon: 'shield-check', action: () => simple(C.api.fsRunAdmin, p) });
    } else items.push({ label: 'Open ' + plural(s.filter(x => !isDirPath(x)).length, 'file'), icon: 'external-link', action: () => s.filter(x => !isDirPath(x)).slice(0, 15).forEach(LI.openFile) });
    items.push('sep');
    items.push({ label: 'Cut', icon: 'scissors', sub: K('X'), action: () => toClipboard('move') });
    items.push({ label: 'Copy', icon: 'copy', sub: K('C'), action: () => toClipboard('copy') });
    if (p && dir) items.push({ label: 'Paste into folder', icon: 'clipboard-paste', action: () => pasteHere(p) });
    items.push({ label: 'Rename', icon: 'pencil', sub: 'F2', action: () => startRename() });
    items.push({ label: 'Delete', icon: 'trash', sub: 'Del', danger: true, action: () => del(false) });
    items.push('sep');
    if (p && !dir && ARCHIVE.test(p)) items.push({ label: 'Extract all', icon: 'folder-output' in window.ICONS ? 'folder-output' : 'folder-open', action: () => simple(C.api.fsExtract, p, 'Extracted <b>' + esc(nameOf(p)) + '</b>') });
    items.push({ label: 'Compress to ZIP file', icon: 'archive' in window.ICONS ? 'archive' : 'package', action: () => simple(C.api.fsCompress, s, 'Made a ZIP file') });
    items.push({ label: 'Copy as path', icon: 'link' in window.ICONS ? 'link' : 'copy', sub: K('Shift+C'), action: () => copyAsPath() });
    if (isWin()) items.push({ label: 'Create shortcut', icon: 'external-link', action: () => simple(C.api.fsShortcut, s, 'Made a shortcut') });
    items.push({ label: 'Show in File Explorer', icon: 'folder-open', action: () => LI.revealPath(p || s[0]) });
    items.push('sep');
    items.push({ label: dir ? 'Tags for files inside…' : 'Tags', icon: 'tag', sub: '›', action: ev => LI.tagMenu(p, dir) });
    items.push('sep');
    items.push({ label: 'Properties', icon: 'info' in window.ICONS ? 'info' : 'file', sub: 'Alt+Enter', action: () => properties() });
    if (isWin()) items.push({ label: 'Show more options', icon: 'more-horizontal' in window.ICONS ? 'more-horizontal' : 'list', sub: 'Windows menu', action: () => shellMenu() });
    return items;
  }
  function backgroundMenu() {
    const items = [
      { label: 'View', icon: 'layout-grid', sub: '›', action: () => LI.viewMenu() },
      { label: 'Sort by', icon: 'arrow-up-down', sub: '›', action: () => LI.sortMenu() },
      { label: 'Refresh', icon: 'refresh-cw', sub: 'F5', action: () => LI.reloadNow() },
      'sep',
      { label: 'Paste', icon: 'clipboard-paste', sub: K('V'), action: () => pasteHere() },
    ];
    if (O.undoLabel) items.push({ label: O.undoLabel, icon: 'undo-2', sub: K('Z'), action: undo });
    items.push('sep',
      { label: 'New folder', icon: 'folder-plus', sub: K('Shift+N'), action: () => newItem('folder') },
      { label: 'New text document', icon: 'file-plus' in window.ICONS ? 'file-plus' : 'file', action: () => newItem('text') },
      'sep',
      { label: 'Select all', icon: 'check', sub: K('A'), action: () => LI.selectAll() },
      { label: 'Open in Terminal', icon: 'terminal-square', action: () => simple(C.api.fsTerminal, LI.cwd()) },
      { label: 'Show in File Explorer', icon: 'folder-open', action: () => LI.revealPath(LI.cwd()) },
      'sep',
      { label: 'Properties', icon: 'info' in window.ICONS ? 'info' : 'file', sub: 'Alt+Enter', action: () => properties([LI.cwd()]) });
    return items;
  }
  function newMenu(el) {
    const b = el.getBoundingClientRect();
    C.showMenu([
      { label: 'Folder', icon: 'folder-plus', sub: K('Shift+N'), action: () => newItem('folder') },
      { label: 'Text document', icon: 'file-plus' in window.ICONS ? 'file-plus' : 'file', action: () => newItem('text') },
    ], b.left, b.bottom + 4);
  }
  function moreMenu(el) {
    const b = el.getBoundingClientRect();
    const s = sel();
    const items = [
      { label: 'Select all', icon: 'check', sub: K('A'), action: () => LI.selectAll() },
      { label: 'Select none', icon: 'x', action: () => LI.selectPaths([]) },
      { label: 'Invert selection', icon: 'arrow-left-right', action: () => LI.invertSelection() },
      'sep',
      { label: s.length ? 'Copy as path' : 'Copy folder path', icon: 'link' in window.ICONS ? 'link' : 'copy', sub: K('Shift+C'), action: () => copyAsPath() },
      { label: 'Open in Terminal', icon: 'terminal-square', action: () => simple(C.api.fsTerminal, LI.cwd()) },
      { label: 'Show in File Explorer', icon: 'folder-open', action: () => LI.revealPath(s[0] || LI.cwd()) },
      { label: 'Properties', icon: 'info' in window.ICONS ? 'info' : 'file', sub: 'Alt+Enter', action: () => properties() },
    ];
    if (O.undoLabel) items.splice(3, 0, 'sep', { label: O.undoLabel, icon: 'undo-2', sub: K('Z'), action: undo });
    if (!V().browse) items.push('sep', { label: 'Organize…', icon: 'sparkles', action: () => C.openOrganize() });
    C.showMenu(items, b.right - 250, b.bottom + 4);
  }

  // ------------------------------------------------------------------ keyboard (Explorer's shortcuts)
  function key(e) {
    if (!V()) return false;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return false;
    if (document.querySelector('.modal-container')) return false;
    const m = e.ctrlKey || e.metaKey, k = e.key;
    const lk = k.length === 1 ? k.toLowerCase() : k;
    let fn = null;
    if (k === 'F2' && !m) fn = () => startRename();
    else if (k === 'Delete') fn = () => del(e.shiftKey);
    else if (m && !e.shiftKey && lk === 'c') fn = () => toClipboard('copy');
    else if (m && e.shiftKey && lk === 'c') fn = () => copyAsPath();
    else if (m && lk === 'x') fn = () => toClipboard('move');
    else if (m && lk === 'v') fn = () => pasteHere();
    else if (m && e.shiftKey && lk === 'n') fn = () => newItem('folder');
    else if (m && !e.shiftKey && lk === 'z') fn = () => undo();
    else if (k === 'Enter' && e.altKey) fn = () => properties();
    else if (k === 'F5') fn = () => LI.reloadNow();
    if (!fn) return false;
    // copying text you've highlighted still works
    if (m && lk === 'c' && String(window.getSelection() || '').trim() && !t.closest('#libScroll')) return false;
    e.preventDefault(); e.stopPropagation();
    fn();
    return true;
  }

  // ------------------------------------------------------------------ drag and drop
  // Inside Onyx: drop on a folder to move it there (Ctrl copies, like Explorer). Out of Onyx: into Explorer,
  // the desktop or any app. Into Onyx: files dragged from Explorer land in the folder under the pointer.
  function dragStart(e, paths) {
    if (V().demo) return false;
    O.dragging = { paths, at: Date.now() };
    if (C.api.startDrag) {
      e.preventDefault();
      C.api.startDrag(paths);         // a real Windows drag: works with every app
      return true;
    }
    return false;                      // browsers (tests): HTML5 drag with Onyx's own data
  }
  let hint = null;
  function showHint(text, x, y) {
    if (!hint) { hint = document.createElement('div'); hint.className = 'drag-hint'; document.body.appendChild(hint); }
    hint.innerHTML = text; hint.style.left = (x + 16) + 'px'; hint.style.top = (y + 18) + 'px'; hint.classList.add('show');
  }
  function hideHint() { if (hint) hint.classList.remove('show'); document.querySelectorAll('.is-droptarget').forEach(x => x.classList.remove('is-droptarget')); }
  function dropTarget(e) {
    const t = e.target.closest && e.target;
    if (!t || !V() || V().demo) return null;
    const row = t.closest('#libCanvas [data-dir]');
    if (row) return { el: row, rel: row.dataset.path };
    const crumb = t.closest('#libNav [data-lib="go"]');
    if (crumb) return { el: crumb, rel: crumb.dataset.p || '' };
    const tree = t.closest('.tree-item-self[data-kind="folder"][data-tree="explorer"]');
    if (tree) return { el: tree, rel: tree.dataset.path };
    if (t.closest('#libScroll') && !LI.query()) return { el: $('#libScroll'), rel: LI.cwd(), bg: true };
    return null;
  }
  const typesOf = e => [...((e.dataTransfer && e.dataTransfer.types) || [])];
  const isOurs = e => typesOf(e).includes('application/x-onyx-files') || (O.dragging && Date.now() - O.dragging.at < 120000);
  const isFiles = e => typesOf(e).includes('Files') || typesOf(e).includes('application/x-onyx-files');
  function modeFor(e, ours) { if (e.ctrlKey) return 'copy'; if (e.shiftKey) return 'move'; return ours ? 'move' : 'auto'; }
  document.addEventListener('dragenter', e => { if (isFiles(e) && V() && dropTarget(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('dragover', e => {
    if (!isFiles(e) || !V()) return;
    if (e.target.closest && e.target.closest('.tp-tag')) { if (isOurs(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'link'; } return; }
    const tg = dropTarget(e);
    if (!tg) { hideHint(); return; }
    const ours = isOurs(e);
    // dragging onto one of the folders being dragged does nothing
    if (ours && O.dragging && O.dragging.paths.some(p => p.toLowerCase() === tg.rel.toLowerCase())) { hideHint(); return; }
    e.preventDefault(); e.stopPropagation();
    const md = modeFor(e, ours);
    e.dataTransfer.dropEffect = md === 'copy' ? 'copy' : 'move';
    document.querySelectorAll('.is-droptarget').forEach(x => x !== tg.el && x.classList.remove('is-droptarget'));
    tg.el.classList.add('is-droptarget');
    const where = tg.rel ? E.basename(tg.rel) : V().vaultName;
    showHint(C.icon(md === 'copy' ? 'copy' : 'folder-input') + (md === 'copy' ? 'Copy to ' : md === 'move' ? 'Move to ' : 'Drop into ') + '<b>' + esc(where) + '</b>', e.clientX, e.clientY);
  }, true);
  document.addEventListener('dragleave', e => { if (!e.relatedTarget || !document.documentElement.contains(e.relatedTarget)) hideHint(); }, true);
  document.addEventListener('drop', async e => {
    if (!isFiles(e) || !V()) return;
    hideHint();
    const tag = e.target.closest && e.target.closest('.tp-tag');
    const ours = isOurs(e);
    let rels = null;
    try { const raw = e.dataTransfer.getData('application/x-onyx-files'); if (raw) rels = JSON.parse(raw); } catch { rels = null; }
    if (!rels && ours && O.dragging) rels = O.dragging.paths;
    if (tag) {
      if (!rels) return;
      e.preventDefault(); e.stopPropagation();
      const files = rels.filter(p => !isDirPath(p));
      if (files.length) LI.addTags(files, [tag.dataset.tag]).then(() => C.notice('Tagged ' + plural(files.length, 'file') + ' <b>#' + esc(tag.dataset.tag) + '</b>', 'success', 2200));
      O.dragging = null;
      return;
    }
    const tg = dropTarget(e);
    if (!tg) return;
    e.preventDefault(); e.stopPropagation();
    let sources;
    if (rels) sources = rels.map(LI.absPath);
    else sources = [...(e.dataTransfer.files || [])].map(f => C.api.pathForFile(f)).filter(Boolean);
    O.dragging = null;
    if (!sources.length) return;
    let md = modeFor(e, !!rels);
    if (md === 'auto') {
      // Explorer's rule: same drive moves, another drive copies
      const drive = p => (/^[a-z]:/i.exec(p) || [''])[0].toLowerCase();
      md = drive(sources[0]) && drive(sources[0]) === drive(V().rootPath || '') ? 'move' : 'copy';
    }
    if (demoBlock()) return;
    await transfer(sources, tg.rel, md);
  }, true);
  document.addEventListener('dragend', () => { hideHint(); setTimeout(() => { O.dragging = null; }, 300); });

  // ------------------------------------------------------------------ live changes from other programs
  let changeTimer = null, pendingDirs = new Set(), lastRescan = 0;
  function onFsChanged(p) {
    const v = V(); if (!v || v.demo) return;
    for (const d of (p && p.dirs) || []) pendingDirs.add(d);
    clearTimeout(changeTimer);
    changeTimer = setTimeout(async () => {
      const v2 = V(); if (!v2 || v2 !== v) return;
      if (O.rn || C.S.busy || C.S.plan || document.querySelector('.modal-container')) { changeTimer = setTimeout(() => onFsChanged(null), 1500); return; }
      const dirs = [...pendingDirs]; pendingDirs.clear();
      if (v.browse) { LI.relist(dirs); return; }
      if (Date.now() - lastRescan < 1500) { changeTimer = setTimeout(() => onFsChanged(null), 1500); return; }
      lastRescan = Date.now();
      const r = await C.api.rescan();
      if (V() !== v || !r || r.error) return;
      apply({ vault: r }, { noSelect: true });
    }, 400);
  }

  function init(ctx, lib) {
    C = ctx; LI = lib;
    if (C.api.onFileOpProgress) C.api.onFileOpProgress(p => { O.op = p; LI.renderProgress(); });
    if (C.api.onFsChanged) C.api.onFsChanged(onFsChanged);
    if (C.api.onDragDone) C.api.onDragDone(() => setTimeout(() => { O.dragging = null; hideHint(); }, 1500));
  }
  window.OnyxOps = {
    init, key, itemMenu, backgroundMenu, newMenu, moreMenu, newItem, startRename, toClipboard, pasteHere, transfer, del, undo,
    properties, shellMenu, copyAsPath, beforePaint, afterPaint, dragStart, apply, refreshUndo,
    get undoLabel() { return O.undoLabel; }, get dragging() { return !!(O.dragging && Date.now() - O.dragging.at < 120000); }, get op() { return O.op; }, get renaming() { return !!O.rn; },
    hasCut: p => O.cut.has(p),
    cancelOp: () => C.api.fsCancel(),
  };
})();
