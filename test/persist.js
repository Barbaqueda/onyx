const Module = require('module'); const fs = require('fs'); const path = require('path'); const os = require('os');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-')); const handlers = {};
const stub = { app: { getPath: () => ud, whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '2.1.0' }, ipcMain: { handle: (n, f) => handlers[n] = f },
  dialog: {}, shell: {}, clipboard: {}, Menu: {}, BrowserWindow: function () {}, safeStorage: { isEncryptionAvailable: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? stub : orig.call(this, r, ...a); };
require(require('path').join(__dirname, '..', 'main.js'));
(async () => {
  await handlers['replace-settings'](null, { section: 'ui', key: 'appearance', value: { mode: 'light', themeLight: 'quartz', density: 'compact' } });
  await handlers['replace-settings'](null, { section: 'ui', key: 'hotkeys', value: { 'organize': 'Mod+K' } });
  await handlers['replace-settings'](null, { section: 'organize', key: 'rules', value: [{ type: 'ext', value: 'blend', folder: '3D/Blender' }] });
  await handlers['save-settings'](null, { ai: { provider: 'openai', model: 'gpt-x' } });
  const s = await handlers['get-settings']();
  console.log(JSON.stringify({ ui: s.ui, rules: s.organize.rules, ai: s.ai.provider + '/' + s.ai.model, seriesMin: s.organize.seriesMin }));
  await handlers['reset-settings'](null, 'ui');
  console.log('after ui reset', JSON.stringify((await handlers['get-settings']()).ui), 'rules kept:', (await handlers['get-settings']()).organize.rules.length);
})();
