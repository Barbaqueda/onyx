// Unit tests for tags.js plus main-process integration (tags follow moves, undo, persistence, open-file safety)
const assert = require('assert');
const Module = require('module'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP = path.join(__dirname, '..', 'app');
const TG = require(path.join(fs.existsSync(APP) ? APP : path.join(__dirname, '..'), 'tags.js'));
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); pass++; };

// ---- naming
eq(TG.normTag('  #Tax Return '), 'tax-return');
eq(TG.normTag('School/Math 101'), 'school/math-101');
eq(TG.normTag('a/b/c/d'), 'a/b/c');
eq(TG.normTag('###'), '');
eq(TG.normTag('Ísland_ferð'), 'ísland-ferð');
eq(TG.tagFolder('school/math-101'), 'School/Math 101');

// ---- queries
const now = Date.now(), D = 86400000;
const f = (p, size, age, ext) => ({ path: p, name: p.split('/').pop(), extension: ext || (p.split('.').pop()), size, lastModified: now - age * D });
const files = [f('a/invoice_1.pdf', 2e5, 1), f('b/photo.jpg', 5e6, 40), f('big.iso', 2e9, 400, 'iso'), f('x/report (2).pdf', 9000, 3), f('report.pdf', 9000, 3)];
const tags = { 'a/invoice_1.pdf': ['finance/invoice'], 'b/photo.jpg': ['trip'] };
const run = q => files.filter(x => TG.matchFile(x, tags[x.path] || [], TG.parseQuery(q), { now, dups: TG.duplicateSet(files) })).map(x => x.path);
eq(run('#finance'), ['a/invoice_1.pdf'], 'nested tag matches parent');
eq(run('-#finance type:pdf'), ['x/report (2).pdf', 'report.pdf']);
eq(run('kind:image'), ['b/photo.jpg']);
eq(run('size:>1gb'), ['big.iso']);
eq(run('size:1mb..10mb'), ['b/photo.jpg']);
eq(run('modified:<7d'), ['a/invoice_1.pdf', 'x/report (2).pdf', 'report.pdf']);
eq(run('modified:>1y'), ['big.iso']);
eq(run('in:a'), ['a/invoice_1.pdf']);
eq(run('is:untagged type:pdf'), ['x/report (2).pdf', 'report.pdf']);
eq(run('is:duplicate'), ['x/report (2).pdf', 'report.pdf']);
eq(run('"invoice_1"'), ['a/invoice_1.pdf']);
eq(run('report -x/'), ['report.pdf']);

// ---- AI parsing
const ids = ['a.pdf', 'b.jpg', 'c.txt'];
eq(TG.parseAiTags('<think>hmm</think>```json\n{"tags":{"1":["Tax Return","pdf","2024"],"2":"Iceland Trip, landscape","4":["x"]}}\n```', ids), { 'a.pdf': ['tax-return', '2024'], 'b.jpg': ['iceland-trip', 'landscape'] });
assert.throws(() => TG.parseAiTags('sorry, no', ids)); pass++;

// ---- database
let db = TG.emptyDb();
TG.applyAuto(db, { 'a.pdf': ['invoice', 'finance'], 'b.jpg': [] }, 'rules');
ok(!db.files['b.jpg'], 'no empty entries from rules');
TG.edit(db, ['a.pdf'], ['mine'], ['finance']);
eq(db.files['a.pdf'].t, ['invoice', 'mine']);
TG.applyAuto(db, { 'a.pdf': ['invoice', 'finance'] }, 'rules');
eq(db.files['a.pdf'].t, ['invoice', 'mine'], 'removed auto tag never comes back');
TG.clearAuto(db, null);
eq(db.files['a.pdf'].t, ['mine']);
TG.applyAuto(db, { 'a.pdf': ['invoice'] }, 'rules');
eq(db.files['a.pdf'].t, ['mine'], 'cleared auto tags stay cleared');
TG.edit(db, ['a.pdf', 'c.txt'], ['school/math'], []);
TG.renameTag(db, 'school', 'uni');
eq(db.files['c.txt'].t, ['uni/math']);
TG.deleteTag(db, 'uni');
ok(!db.files['a.pdf'].t.includes('uni/math'));
// moves and reconcile
db = TG.emptyDb();
TG.edit(db, ['dl/song.wav', 'x.pdf'], ['keep'], []);
TG.applyMoves(db, [{ from: 'dl\\song.wav', to: 'Music\\song.wav' }]);
ok(db.files['Music/song.wav'], 'windows separators normalised');
db.files['x.pdf'].s = 10;
TG.reconcile(db, [{ path: 'Moved/x.pdf', name: 'x.pdf', size: 10, lastModified: 1 }, { path: 'Music/song.wav', name: 'song.wav', size: 5, lastModified: 1 }], { complete: true });
ok(db.files['Moved/x.pdf'] && !db.files['x.pdf'], 'tags follow a file moved outside Onyx');
TG.reconcile(db, [{ path: 'Music/song.wav', name: 'song.wav', size: 5, lastModified: 1 }], { complete: true, now: 1000 });
ok(db.files['Moved/x.pdf'].g === 1000, 'vanished file kept with a grace timestamp');
TG.reconcile(db, [{ path: 'Music/song.wav', name: 'song.wav', size: 5, lastModified: 1 }], { complete: true, now: 1000 + 31 * D });
ok(!db.files['Moved/x.pdf'], 'dropped after 30 days');
eq(TG.primaryTag({ t: ['2024', 'invoice', 'client-x'], a: ['2024', 'invoice'] }), 'client-x', 'your own tag first');

// ---- regressions from review
db = TG.emptyDb();
TG.applyAuto(db, { 'inv.pdf': ['finance', 'invoice'] }, 'rules');
TG.edit(db, ['inv.pdf'], [], ['finance', 'invoice']);
db.files['inv.pdf'].s = 7;
TG.reconcile(db, [{ path: 'Docs/inv.pdf', name: 'inv.pdf', size: 7, lastModified: 1 }], { complete: true });
TG.applyAuto(db, { 'Docs/inv.pdf': ['finance', 'invoice'] }, 'rules', [{ path: 'Docs/inv.pdf', name: 'inv.pdf', size: 7, lastModified: 1 }]);
eq((db.files['Docs/inv.pdf'] || { t: [] }).t, [], 'removed tags stay removed after a move outside Onyx');
const E2 = require(path.join(fs.existsSync(APP) ? APP : path.join(__dirname, '..'), 'engine.js'));
eq(E2.typeFolder('constructor'), 'Other'); eq(E2.typeFolder('__proto__'), 'Other');
ok(TG.autoTags([{ path: 'x.constructor', name: 'x.constructor', extension: 'constructor', size: 1, lastModified: 1 }, { path: 'toString', name: 'toString', extension: '', size: 1, lastModified: 1 }], []), 'odd names do not throw');
db = TG.emptyDb();
TG.edit(db, ['__proto__', 'constructor'], ['weird'], []);
const vw = TG.view(db, [{ path: '__proto__' }, { path: 'constructor' }, { path: 'toString' }]);
ok(Object.prototype.hasOwnProperty.call(vw.files, '__proto__') && vw.files['__proto__'].t[0] === 'weird', '__proto__ stays a plain key');
ok(!Object.prototype.hasOwnProperty.call(vw.files, 'toString'), 'no inherited keys');
eq(TG.parseAiTags('{"tags":[["a1"],["b1"],["c1"]]}', ['a', 'b', 'c']), { a: ['a1'], b: ['b1'], c: ['c1'] }, 'array replies map by position');
db = TG.emptyDb();
TG.applyAuto(db, { 'a.pdf': ['x1'] }, 'ai');
TG.clearAuto(db, null);
eq(TG.needsAuto(db, [{ path: 'a.pdf' }], 'ai').length, 1, 'cleared files can be AI-tagged again');
db = TG.emptyDb();
TG.applyAuto(db, { 'a.png': ['screenshot'] }, 'rules');
TG.deleteTag(db, 'screenshot');
TG.applyAuto(db, { 'b.png': ['screenshot'] }, 'rules');
ok(!db.files['b.png'], 'deleted tag not added to new files');
TG.edit(db, ['c.png'], ['screenshot'], []);
TG.applyAuto(db, { 'd.png': ['screenshot'] }, 'rules');
ok(db.files['d.png'], 'adding it by hand allows it again');
db = TG.emptyDb();
TG.edit(db, ['Docs/A.pdf', 'tmp/a.pdf'], ['k'], []);
TG.applyMoves(db, [{ from: 'tmp/a.pdf', to: 'docs/a.pdf' }]);
eq(Object.keys(db.files).filter(k => k.toLowerCase() === 'docs/a.pdf').length, 1, 'no case-duplicate entries after a move');
db = TG.emptyDb();
TG.applyAuto(db, { 'old.pdf': ['t'] }, 'ai'); db.files['old.pdf'].ai = 5;
eq(TG.aiOrder(db, [{ path: 'old.pdf' }, { path: 'new.pdf' }]).map(x => x.path), ['new.pdf', 'old.pdf'], 're-tag all goes oldest first');

// ---- main-process integration
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-tags-'));
const ud = path.join(tmp, 'ud'), root = path.join(tmp, 'Downloads');
const W = (p, c) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), c || p); };
['invoice_2024_03.pdf', 'invoice_2024_04.pdf', 'Screenshot 2026-09-12.png', 'notes.txt', 'setup.exe'].forEach(x => W(x));
const handlers = {}; const opened = [];
const stub = { app: { getPath: () => ud, whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '2.3.0', isPackaged: false },
  ipcMain: { handle: (n, fn) => handlers[n] = fn }, dialog: {}, shell: { openPath: async p => { opened.push(p); return ''; } }, clipboard: {}, Menu: {}, BrowserWindow: function () {}, nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? stub : orig.call(this, r, ...a); };
require(path.join(fs.existsSync(APP) ? APP : path.join(__dirname, '..'), 'main.js'));
(async () => {
  let v = await handlers['open-recent'](null, root);
  ok(v.autoTagged >= 3, 'files tagged from names on open (' + v.autoTagged + ')');
  eq(v.tags.files['invoice_2024_03.pdf'].t.includes('invoice'), true);
  ok(v.tags.files['Screenshot 2026-09-12.png'].t.includes('screenshot'));
  let view = await handlers['tags-edit'](null, { paths: ['notes.txt'], add: ['Project X'], remove: [] });
  eq(view.files['notes.txt'].t, ['project-x']);
  view = await handlers['tags-edit'](null, { paths: ['invoice_2024_03.pdf'], add: [], remove: ['finance'] });
  ok(!view.files['invoice_2024_03.pdf'].t.includes('finance'));
  // tags follow an Onyx move, and undo
  const { plan } = await handlers['organize']({ sender: { send() {} } }, 'rules');
  const r = await handlers['apply-plan'](null, plan.items);
  const moved = plan.items.find(i => i.source === 'notes.txt' && i.kind === 'move');
  ok(moved, 'notes.txt moved');
  ok(r.vault.tags.files[moved.target] && r.vault.tags.files[moved.target].t.includes('project-x'), 'tag followed the move to ' + moved.target);
  ok(!r.vault.tags.files[moved.target === 'notes.txt' ? 'x' : 'notes.txt'], 'old path gone');
  const u = await handlers['undo']();
  ok(u.vault.tags.files['notes.txt'] && u.vault.tags.files['notes.txt'].t.includes('project-x'), 'tag came back with undo');
  ok(!u.vault.tags.files['invoice_2024_03.pdf'].t.includes('finance'), 'removed auto tag still removed after rescans');
  // persisted
  const dbFile = fs.readdirSync(path.join(ud, 'tags'));
  ok(dbFile.length === 1, 'one db file in app data');
  ok(!fs.readdirSync(root).some(n => /onyx|tags/i.test(n)), 'nothing written into the user folder');
  // reopen: still there
  v = await handlers['open-recent'](null, root);
  ok(v.tags.files['notes.txt'].t.includes('project-x'), 'tags persist across opens');
  // by-tag strategy uses your own tag first
  const p2 = (await handlers['organize']({ sender: { send() {} } }, 'tags')).plan;
  eq(p2.items.find(i => i.source === 'notes.txt').target, 'Project X/notes.txt');
  // open-file safety
  eq((await handlers['open-file'](null, '../../etc/passwd')).error.includes('isn'), true);
  eq((await handlers['open-file'](null, 'setup.exe')).program, true);
  ok(opened.length === 1, 'opened through the shell');
  // saved searches + colors
  view = await handlers['tags-saved'](null, [{ name: 'Bills', query: '#invoice' }, { name: '', query: 'x' }]);
  eq(view.saved, [{ name: 'Bills', query: '#invoice' }]);
  view = await handlers['tags-color'](null, { name: 'invoice', color: '#ff0000' });
  eq(view.colors.invoice, '#ff0000');
  view = await handlers['tags-color'](null, { name: 'invoice', color: 'javascript:alert(1)' });
  ok(!view.colors.invoice, 'bad colors rejected');
  // rules auto-tagging on demand is idempotent
  const a1 = await handlers['tags-auto']({ sender: { send() {} } }, { mode: 'rules', scope: 'all' });
  eq(a1.added, 0, 'nothing new to add');
  // names with dots
  view = await handlers['tags-edit'](null, { paths: ['notes..txt'], add: ['dots'], remove: [] });
  W('notes..txt'); v = await handlers['rescan']();
  ok(v.tags.files['notes..txt'] && v.tags.files['notes..txt'].t.includes('dots'), 'names with .. can be tagged');
  // a damaged tag file is backed up, not silently overwritten
  const tf = path.join(ud, 'tags', fs.readdirSync(path.join(ud, 'tags')).find(n => n.endsWith('.json') && !n.includes('damaged')));
  fs.writeFileSync(tf, '{"v":1,"files":{"notes.t');
  await handlers['open-recent'](null, root);
  ok(fs.readdirSync(path.join(ud, 'tags')).some(n => n.includes('damaged')), 'damaged file kept as a backup');
  ok(!fs.readdirSync(path.join(ud, 'tags')).some(n => n.endsWith('.tmp')), 'no temp files left behind');
  // a symlink/junction to outside can't be opened
  try {
    const outside = path.join(tmp, 'secret.txt'); fs.writeFileSync(outside, 's');
    fs.symlinkSync(outside, path.join(root, 'link.txt'));
    eq((await handlers['open-file'](null, 'link.txt')).error ? true : false, true, 'links leading outside are refused');
  } catch (e) { if (e.code !== 'EPERM') throw e; }
  console.log('tag tests passed:', pass);
})().catch(e => { console.error(e); process.exit(1); });
