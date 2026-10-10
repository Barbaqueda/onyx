// File operations through the app's main process: new, rename, paste, delete to the (fake) Recycle Bin, undo, tags, refusals
const assert = require('assert');
const Module = require('module'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP = fs.existsSync(path.join(__dirname, '..', 'app')) ? path.join(__dirname, '..', 'app') : path.join(__dirname, '..');
const FO = require(path.join(APP, 'fileops.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-fom-'));
const home = path.join(tmp, 'home'), ud = path.join(tmp, 'ud'), bin = path.join(tmp, '$Recycle.Bin'), sid = path.join(bin, 'S-1-5-test');
process.env.HOME = home; process.env.USERPROFILE = home; process.env.ONYX_TEST_BIN = bin;
fs.mkdirSync(sid, { recursive: true });
const H = (...a) => path.join(home, ...a);
const W = (p, c) => { fs.mkdirSync(path.dirname(H(p)), { recursive: true }); fs.writeFileSync(H(p), c || p); };
W('Downloads/invoice_2024_03.pdf'); W('Downloads/notes.txt'); W('Downloads/Trip/a.jpg'); W('Downloads/Trip/b.jpg'); W('Other/elsewhere.txt'); W('Documents/essay.docx');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
let binN = 0;
const handlers = {};
const stub = {
  app: { getPath: k => k === 'userData' ? ud : k === 'home' ? home : path.join(home, k[0].toUpperCase() + k.slice(1)), whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '2.6.0', isPackaged: false },
  ipcMain: { on() {}, handle: (n, f) => handlers[n] = f, on: (n, f) => handlers[n] = f }, dialog: {}, clipboard: { writeText() {} }, Menu: {}, BrowserWindow: function () {}, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  shell: {
    openPath: async () => '',
    // what Windows does: move it into the Recycle Bin with a $I file saying where it came from
    trashItem: async p => { const id = 'T' + (++binN) + path.extname(p); fs.renameSync(p, path.join(sid, '$R' + id)); fs.writeFileSync(path.join(sid, '$I' + id), FO.makeRecycleInfo(p, 1, Date.now())); },
    writeShortcutLink: () => false,
  },
  safeStorage: { isEncryptionAvailable: () => false },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? stub : orig.call(this, r, ...a); };
require(path.join(APP, 'main.js'));
const sent = [];
const ev = { sender: { send: (n, p) => sent.push([n, p]) } };
const has = (v, p) => v.files.some(f => f.path === p);
const hasDir = (v, p) => v.dirs.some(d => d.path === p);

(async () => {
  let v = await handlers['open-recent'](null, H('Downloads'));
  ok(!v.browse && v.files.length === 4, 'Downloads opens normally');

  // new folder → New folder, New folder (2)
  let r = await handlers['fs-new'](null, { dir: '', kind: 'folder' });
  ok(!r.error && r.select[0] === 'New folder' && hasDir(r.vault, 'New folder') && fs.existsSync(H('Downloads', 'New folder')), 'new folder');
  r = await handlers['fs-new'](null, { dir: 'Trip', kind: 'text' });
  ok(r.select[0] === 'Trip/New Text Document.txt' && has(r.vault, 'Trip/New Text Document.txt'), 'new text document in a subfolder');

  // rename (and tags follow)
  await handlers['tags-edit'](null, { paths: ['notes.txt', 'Trip/a.jpg'], add: ['keep'], remove: [] });
  r = await handlers['fs-rename'](null, { rel: 'notes.txt', name: 'Meeting notes.txt' });
  ok(!r.error && has(r.vault, 'Meeting notes.txt') && !has(r.vault, 'notes.txt'), 'rename');
  ok(r.vault.tags.files['Meeting notes.txt'] && r.vault.tags.files['Meeting notes.txt'].t.includes('keep'), 'tags follow a rename');
  r = await handlers['fs-rename'](null, { rel: 'Meeting notes.txt', name: 'bad:name' });
  ok(r.error && /characters/.test(r.error), 'bad name refused: ' + r.error);
  r = await handlers['fs-rename'](null, { rel: 'New folder', name: 'Projects' });
  ok(hasDir(r.vault, 'Projects'), 'rename a folder');
  r = await handlers['fs-rename'](null, { rel: 'Trip', name: 'Iceland' });
  ok(has(r.vault, 'Iceland/a.jpg') && !has(r.vault, 'Trip/a.jpg') && r.vault.tags.files['Iceland/a.jpg'], 'folder rename carries its files and tags');

  // undo the folder rename
  ok(/rename/i.test(await handlers['fs-undo-label']()), 'undo label');
  r = await handlers['fs-undo']();
  ok(!r.error && has(r.vault, 'Trip/a.jpg') && fs.existsSync(H('Downloads', 'Trip', 'a.jpg')), 'undo rename');

  // rename several: Photo (1).jpg, Photo (2).jpg
  r = await handlers['fs-rename-many'](null, { rels: ['Trip/a.jpg', 'Trip/b.jpg'], name: 'Photo' });
  ok(has(r.vault, 'Trip/Photo (1).jpg') && has(r.vault, 'Trip/Photo (2).jpg'), 'rename several like Explorer');

  // copy from outside into the folder (what pasting from Explorer does), with a conflict
  W('Other/invoice_2024_03.pdf', 'other');
  const plan = await handlers['fs-plan-paste'](null, { sources: [H('Other', 'elsewhere.txt'), H('Other', 'invoice_2024_03.pdf')], dest: '', mode: 'copy' });
  ok(plan.items.length === 2 && plan.items[1].conflict && !plan.items[0].conflict, 'plan finds the conflict');
  r = await handlers['fs-paste'](ev, { sources: [H('Other', 'elsewhere.txt'), H('Other', 'invoice_2024_03.pdf')], dest: '', mode: 'copy', resolution: 'both' });
  ok(!r.error && r.count === 2 && has(r.vault, 'elsewhere.txt') && has(r.vault, 'invoice_2024_03 (2).pdf'), 'paste copies, keeps both');
  ok(r.select.includes('elsewhere.txt'), 'pasted items are selected');
  ok(fs.existsSync(H('Other', 'elsewhere.txt')), 'copy leaves the original');
  r = await handlers['fs-undo']();
  ok(!has(r.vault, 'elsewhere.txt') && !fs.existsSync(H('Downloads', 'elsewhere.txt')), 'undo copy sends the copies to the Recycle Bin');

  // copy inside the folder keeps your tags
  r = await handlers['fs-paste'](ev, { sources: [H('Downloads', 'Meeting notes.txt')], dest: '', mode: 'copy' });
  ok(has(r.vault, 'Meeting notes - Copy.txt') && r.vault.tags.files['Meeting notes - Copy.txt'] && r.vault.tags.files['Meeting notes - Copy.txt'].t.includes('keep'), 'copy keeps your tags');

  // move into a subfolder (drag onto a folder)
  r = await handlers['fs-paste'](ev, { sources: [H('Downloads', 'Meeting notes.txt')], dest: 'Projects', mode: 'move' });
  ok(has(r.vault, 'Projects/Meeting notes.txt') && !has(r.vault, 'Meeting notes.txt') && r.vault.tags.files['Projects/Meeting notes.txt'], 'move, tags follow');
  r = await handlers['fs-undo']();
  ok(has(r.vault, 'Meeting notes.txt') && !has(r.vault, 'Projects/Meeting notes.txt'), 'undo move');
  // folder into itself
  r = await handlers['fs-paste'](ev, { sources: [H('Downloads', 'Trip')], dest: 'Trip', mode: 'move' });
  ok(r.failed.length === 1 && fs.existsSync(H('Downloads', 'Trip')), 'folder into itself refused');

  // delete to the Recycle Bin, then undo (restores from the bin)
  r = await handlers['fs-trash'](null, ['invoice_2024_03.pdf', 'Trip']);
  ok(r.done === 2 && !has(r.vault, 'invoice_2024_03.pdf') && !hasDir(r.vault, 'Trip') && !has(r.vault, 'Trip/Photo (1).jpg'), 'delete to Recycle Bin');
  ok(fs.readdirSync(sid).length >= 4, 'it’s in the bin');
  r = await handlers['fs-undo']();
  ok(!r.error && !r.failed.length && has(r.vault, 'invoice_2024_03.pdf') && has(r.vault, 'Trip/Photo (2).jpg'), 'undo delete restores from the Recycle Bin: ' + JSON.stringify(r.failed));

  // permanent delete
  r = await handlers['fs-delete'](null, ['Meeting notes - Copy.txt']);
  ok(r.done === 1 && !fs.existsSync(H('Downloads', 'Meeting notes - Copy.txt')), 'permanent delete');

  // refusals
  r = await handlers['fs-rename'](null, { rel: '', name: 'x' });
  ok(r.error, 'can’t rename the open folder itself');
  r = await handlers['fs-trash'](null, ['../Other/elsewhere.txt']);
  ok(r.error && fs.existsSync(H('Other', 'elsewhere.txt')), 'can’t delete outside the folder');
  r = await handlers['fs-paste'](ev, { sources: [H('Downloads', 'Meeting notes.txt')], dest: '../Other', mode: 'move' });
  ok(r.error, 'can’t paste outside the folder');

  // ZIP and back
  r = await handlers['fs-compress'](null, ['Trip']);
  ok(!r.error && has(r.vault, 'Trip.zip'), 'compress to ZIP: ' + (r.error || ''));
  r = await handlers['fs-extract'](null, 'Trip.zip');
  ok(!r.error && hasDir(r.vault, 'Trip (2)') && (has(r.vault, 'Trip (2)/Trip/Photo (1).jpg') || has(r.vault, 'Trip (2)/Photo (1).jpg')), 'extract all: ' + (r.error || JSON.stringify(r.vault.files.map(f => f.path))));

  // clipboard falls back to Onyx's own off Windows
  r = await handlers['fs-clip-set'](null, { rels: ['Meeting notes.txt'], effect: 'move' });
  ok(r.ok, 'cut');
  const clip = await handlers['fs-clip-get']();
  ok(clip.files.length === 1 && clip.effect === 'move' && clip.files[0] === H('Downloads', 'Meeting notes.txt'), 'clipboard holds the cut file');

  // browse-only locations allow your own file operations, but not inside Windows' folders
  v = await handlers['open-recent'](null, home);
  ok(v.browse, 'home is browse-only');
  r = await handlers['fs-rename'](null, { rel: 'Downloads', name: 'Stuff' });
  ok(r.error && /Windows/.test(r.error) && fs.existsSync(H('Downloads')), 'Downloads itself can’t be renamed: ' + r.error);
  r = await handlers['fs-new'](null, { dir: 'Documents', kind: 'folder' });
  ok(!r.error && r.listings && r.listings.some(l => l.path === 'Documents' && l.dirs.some(d => d.path === 'Documents/New folder')), 'new folder in browse mode returns the new listing');
  r = await handlers['fs-rename'](null, { rel: 'Documents/essay.docx', name: 'Essay final.docx' });
  ok(!r.error && r.listings.some(l => l.files.some(f => f.path === 'Documents/Essay final.docx')), 'rename in browse mode');
  r = await handlers['fs-undo']();
  ok(!r.error && fs.existsSync(H('Documents', 'essay.docx')), 'undo works there too');
  // undo from another folder is refused
  await handlers['fs-new'](null, { dir: 'Documents', kind: 'folder' });
  await handlers['open-recent'](null, H('Downloads'));
  r = await handlers['fs-undo']();
  ok(r.error && /another folder/.test(r.error), 'undo of a change made in another folder is refused');

  // demo
  await handlers['load-demo']();
  r = await handlers['fs-new'](null, { dir: '', kind: 'folder' });
  ok(r.error && /demo/i.test(r.error), 'demo refuses');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('file operation tests passed:', pass);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
