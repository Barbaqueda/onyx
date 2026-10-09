const Module = require('module'); const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-')); const ud = path.join(tmp, 'ud'), root = path.join(tmp, 'Desk');
const handlers = {};
const stub = { app: { getPath: () => ud, whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '2' }, ipcMain: { handle: (n, f) => handlers[n] = f },
  dialog: {}, shell: {}, clipboard: {}, Menu: {}, BrowserWindow: function () {}, safeStorage: { isEncryptionAvailable: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? stub : orig.call(this, r, ...a); };
require(require('path').join(__dirname, '..', 'main.js'));
let mode = 'good', seenPrompt = '';
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b); seenPrompt = body.messages[1].content;
    if (mode === 'down') { res.writeHead(503); res.end('upstream overloaded'); return; }
    const content = mode === 'junk' ? 'Sure! Here is a plan for you.' : '```json\n' + JSON.stringify({ folders: {
      1: '../../Windows/System32', 2: 'Recipes/pasta.pdf', 3: 'Projects/Robot Arm', 4: 'Projects/Robot Arm', 5: 'MyGame/assets', 6: 'misc/stuff', 7: 'C:/Users/evil' },
      summary: 'Grouped the robot arm parts together.' }) + '\n```';
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
}).listen(0, async () => {
  const port = srv.address().port;
  for (const f of ['robot_arm_base.stl', 'robot_arm_joint.stl', 'weird.txt', 'evil.txt', 'pasta.pdf', 'thing.bin', 'sprite.png']) { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, f), f); }
  fs.mkdirSync(path.join(root, 'MyGame/assets'), { recursive: true }); fs.writeFileSync(path.join(root, 'MyGame/package.json'), '{}');
  await handlers['save-settings'](null, { ai: { provider: 'openai', baseUrl: 'http://127.0.0.1:' + port + '/v1', model: 'test', key: 'sk-test' } });
  console.log('settings file has key in plain? ', fs.readFileSync(path.join(ud, 'settings.json'), 'utf8').includes('sk-test'), '(no OS encryption in this test stub)');
  await handlers['open-recent'](null, root);
  for (mode of ['good']) {
    const { plan } = await handlers['organize']({ sender: { send() {} } }, 'smart');
    console.log('\n== server', mode, '| ai used:', plan.ai.used, '| error:', plan.ai.error || '-', '| summary:', plan.ai.summary || '-');
    for (const i of plan.items.filter(i => i.kind === 'move')) console.log('  ', i.source.padEnd(22), '=>', i.target.padEnd(42), '//', i.reason);
  }
  
  srv.close();
});
