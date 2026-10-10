// Browse-only locations: listing, search, refusals (uses a fake home folder, which Onyx opens browse-only)
const assert = require('assert');
const Module = require('module'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP = fs.existsSync(path.join(__dirname, '..', 'app')) ? path.join(__dirname, '..', 'app') : path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-browse-'));
const home = path.join(tmp, 'home'), ud = path.join(tmp, 'ud');
process.env.HOME = home; process.env.USERPROFILE = home;
const W = (p, c) => { fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true }); fs.writeFileSync(path.join(home, p), c || p); };
W('Downloads/invoice_2024_03.pdf'); W('Downloads/Screenshot 2026-09-12.png'); W('Documents/essay.docx'); W('Pictures/beach.jpg'); W('Projects/app/package.json'); W('Projects/app/src/index.js');
W('$Recycle.Bin/junk.txt'); W('notes.txt');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const handlers = {}, opened = [];
const stub = { app: { getPath: k => k === 'userData' ? ud : k === 'home' ? home : path.join(home, k[0].toUpperCase() + k.slice(1)), whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '2.4.0', isPackaged: false },
  ipcMain: { handle: (n, f) => handlers[n] = f }, dialog: {}, shell: { openPath: async p => { opened.push(p); return ''; } }, clipboard: {}, Menu: {}, BrowserWindow: function () {}, nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? stub : orig.call(this, r, ...a); };
require(path.join(APP, 'main.js'));
const ev = { sender: { send() {} } };
(async () => {
  const v = await handlers['open-recent'](null, home);
  ok(v.browse === true, 'home folder opens browse-only');
  ok(v.files.length === 0, 'no full scan of a big location');
  const root = await handlers['list-dir'](null, '');
  const names = root.dirs.map(d => d.path).concat(root.files.map(f => f.path)).sort();
  ok(names.includes('Downloads') && names.includes('notes.txt'), 'lists the top level: ' + names.join(','));
  ok(!names.some(n => n.startsWith('$')), 'hides $Recycle.Bin and friends');
  const dl = await handlers['list-dir'](null, 'Downloads');
  ok(dl.files.length === 2, 'lists a subfolder');
  ok(dl.tags.files['Downloads/invoice_2024_03.pdf'] && dl.tags.files['Downloads/invoice_2024_03.pdf'].t.includes('invoice'), 'tags files from their names while browsing');
  const out = await handlers['list-dir'](null, '../../etc');
  ok(out.error, 'refuses to list outside the location');
  const s1 = await handlers['search-dir'](null, { rel: '', query: 'essay' });
  ok(s1.files.length === 1 && s1.files[0].path === 'Documents/essay.docx', 'searches every folder by name');
  const s2 = await handlers['search-dir'](null, { rel: '', query: '#invoice' });
  ok(s2.files.length === 1, 'tag search uses the tag index');
  const s3 = await handlers['search-dir'](null, { rel: 'Pictures', query: 'kind:image' });
  ok(s3.files.length === 1 && s3.files[0].path === 'Pictures/beach.jpg', 'search is scoped to the current folder');
  // refusals
  ok((await handlers['organize'](ev, 'rules')).error, 'organize refused');
  ok((await handlers['apply-plan'](null, [{ kind: 'move', source: 'notes.txt', target: 'Docs/notes.txt' }])).error, 'apply refused');
  ok(fs.existsSync(path.join(home, 'notes.txt')), 'nothing moved');
  ok((await handlers['tags-auto'](ev, { mode: 'rules', scope: 'all' })).error, 'bulk tagging a whole drive refused');
  const t = await handlers['tags-auto'](ev, { mode: 'rules', paths: ['Downloads/Screenshot 2026-09-12.png'] });
  ok(!t.error, 'tagging picked files works');
  const e1 = await handlers['tags-edit'](null, { paths: ['Documents/essay.docx'], add: ['school'], remove: [] });
  ok(e1.files['Documents/essay.docx'].t.includes('school'), 'manual tags work in browse mode');
  ok(!(await handlers['open-file'](null, 'Documents/essay.docx')).error && opened.length === 1, 'opens files');
  const places = await handlers['list-places']();
  ok(Array.isArray(places.drives) && places.places.some(p => p.name === 'Downloads' && !p.browseOnly) && places.places.some(p => p.name === 'Home' && p.browseOnly), 'places: Home is browse-only, Downloads can be organized');
  // organize a folder inside: full mode
  const sub = await handlers['open-recent'](null, path.join(home, 'Downloads'));
  ok(!sub.browse && sub.files.length === 2, 'a normal folder inside opens fully');
  ok(!(await handlers['organize'](ev, 'rules')).error, 'and can be organized');
  console.log('browse tests passed:', pass);
})().catch(e => { console.error(e); process.exit(1); });
