const Module = require('module'); const fs = require('fs'); const path = require('path'); const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-'));
const ud = path.join(tmp, 'userdata'), root = path.join(tmp, 'Downloads');
const handlers = {};
const stub = { app: { getPath: () => ud, whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '2.0.0' },
  ipcMain: { on() {}, handle: (n, f) => handlers[n] = f }, dialog: {}, shell: {}, clipboard: {}, Menu: {}, BrowserWindow: function () {},
  safeStorage: { isEncryptionAvailable: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? stub : orig.call(this, r, ...a); };
require(require('path').join(__dirname, '..', 'main.js'));
const W = (p, c) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), c || p); };
['excavatorio1.obj','excavatorio2.obj','excavatorio3.obj','invoice_2024_03.pdf','invoice_2024_04.pdf','tax_return_2023.pdf','bank_statement.pdf','Q4_report.docx','IMG_4521.jpg','IMG_4522.jpg','notes.txt','setup.exe','~$Q4_report.docx','big.zip.crdownload','.hidden']
  .forEach(f => W(f));
W('Taxes/tax_return_2023.pdf', 'THE OLD ONE');      // clash
W('Photos/trip/a.jpg'); W('MyGame/package.json'); W('MyGame/src/x.js'); W('MyGame/node_modules/dep/index.js');
const snapshot = () => { const out = []; (function w(d, r) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const rr = r ? r + '/' + e.name : e.name; if (e.isDirectory()) w(path.join(d, e.name), rr); else out.push(rr + '=' + fs.readFileSync(path.join(d, e.name), 'utf8')); } })(root, ''); return out.sort().join('\n'); };
const before = snapshot();
(async () => {
  console.log('danger C:\\ ->', (await handlers['open-recent'](null, path.parse(root).root)).error);
  const v = await handlers['open-recent'](null, root);
  console.log('scanned', v.files.length, 'files; opaque:', v.dirs.filter(d => d.opaque).map(d => d.path));
  stub.app.getPath = () => ud;
  const { plan } = await handlers['organize']({ sender: { send() {} } }, 'rules');
  for (const i of plan.items) console.log(i.kind === 'move' ? '→' : '·', i.source, i.kind === 'move' ? '=> ' + i.target : '', '//', i.reason);
  plan.items.find(i => i.source === 'notes.txt').skip = true;
  // malicious item: should be refused
  plan.items.push({ source: 'bank_statement.pdf', target: '../escaped.pdf', kind: 'move' });
  const r = await handlers['apply-plan'](null, plan.items);
  console.log('applied', r.applied, 'failed', JSON.stringify(r.failed));
  console.log('old tax file intact:', fs.readFileSync(path.join(root, 'Taxes/tax_return_2023.pdf'), 'utf8'));
  console.log('escaped exists:', fs.existsSync(path.join(tmp, 'escaped.pdf')), '| notes.txt still at root:', fs.existsSync(path.join(root, 'notes.txt')));
  console.log('undo info:', JSON.stringify(r.vault.undo));
  const u = await handlers['undo']();
  console.log('undo restored', u.restored, 'failed', u.failed.length);
  console.log('identical after undo:', snapshot() === before);
  if (snapshot() !== before) { console.log(snapshot()); }
  // flatten test
  const f = (await handlers['organize']({ sender: { send() {} } }, 'flatten')).plan;
  console.log('flatten moves:', f.items.filter(i => i.kind === 'move').map(i => i.source + ' => ' + i.target).join(', '));
  await handlers['apply-plan'](null, f.items);
  console.log('Photos dir removed after flatten:', !fs.existsSync(path.join(root, 'Photos')), '| MyGame intact:', fs.existsSync(path.join(root, 'MyGame/src/x.js')));
  await handlers['undo']();
  console.log('identical after flatten undo:', snapshot() === before);
})();
