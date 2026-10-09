const Module = require('module'); const fs = require('fs'); const path = require('path'); const os = require('os');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-')); const root = path.join(ud, 'Desk'); const handlers = {};
let ready;
const stub = { app: { getPath: () => ud, whenReady: () => ({ then: f => { ready = f; } }), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '2.1.0' }, ipcMain: { handle: (n, f) => handlers[n] = f },
  dialog: {}, shell: {}, clipboard: {}, Menu: { setApplicationMenu() {} }, BrowserWindow: function () { return { setMenuBarVisibility() {}, loadFile() {}, once() {}, on() {}, webContents: { setWindowOpenHandler() {}, on() {} } }; },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('ENC:' + s), decryptString: b => b.toString().replace(/^ENC:/, '') } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? stub : orig.call(this, r, ...a); };
const calls = [];
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body); calls.push({ url, auth: init.headers.authorization, model: body.model, nothink: /\/no_think$/.test(body.messages[1].content) });
  if (url.endsWith('/chat/completions')) return { ok: false, status: 404, text: async () => 'Not found' };
  const ids = body.messages[1].content.match(/^\d+\./mg) || [];
  const content = /Reply with/.test(body.messages[1].content) ? '<think>\nok fine\n</think>\n{"ok": true}'
    : '<think>The user wants {folders}. Hmm.</think>\n{"folders": {' + ids.map(i => '"' + parseInt(i) + '": "Sorted/By AI"').join(',') + '}, "summary": "Grouped by free.ai"}';
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
};
fs.writeFileSync(require('path').join(__dirname, '..', 'ai-key.txt'), 'sk-free-TESTKEY123\n');
require(require('path').join(__dirname, '..', 'main.js'));
ready();
(async () => {
  console.log('key file deleted:', !fs.existsSync(require('path').join(__dirname, '..', 'ai-key.txt')));
  const raw = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  console.log('stored provider:', raw.ai.provider, '| encrypted:', raw.ai.keyEnc, '| plaintext in file:', JSON.stringify(raw).includes('TESTKEY'));
  const t = await handlers['test-ai']();
  console.log('test-ai:', JSON.stringify(t));
  fs.mkdirSync(root); ['a.pdf', 'b.png', 'c.zip'].forEach(f => fs.writeFileSync(path.join(root, f), f));
  await handlers['open-recent'](null, root);
  const { plan } = await handlers['organize']({ sender: { send() {} } }, 'smart');
  console.log('ai used:', plan.ai.used, plan.ai.model, '|', plan.ai.summary, '|', plan.items.map(i => i.target).join(', '));
  console.log('calls:', calls.map(c => c.url.replace('https://api.free.ai', '') + ' ' + c.model + ' auth=' + (c.auth === 'Bearer sk-free-TESTKEY123') + ' no_think=' + c.nothink).join(' | '));
  // error mapping
  global.fetch = async () => ({ ok: false, status: 402, text: async () => 'Insufficient credits' });
  console.log('402 ->', (await handlers['test-ai']()).error);
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
  console.log('401 ->', (await handlers['test-ai']()).error);
})();
