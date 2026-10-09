const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const E = require('./engine');

let mainWindow;
let scan = { root: '', files: [], dirs: [], skipped: [], demo: false };

// ============================================================================
// Settings (stored in the user's app-data folder; API key encrypted when possible)
// ============================================================================
// The stone icon lives under a name no earlier build used, so Windows can't show a stale cached icon for it
const ICON_FILE = path.join(__dirname, 'onyx-stone.ico');
const APP_ID = 'com.onyx.organizer';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const HISTORY_FILE = () => path.join(app.getPath('userData'), 'history.json');

const DEFAULT_SETTINGS = {
  ai: { provider: 'pollinations', baseUrl: 'https://api.openai.com/v1', model: '', key: '' },
  organize: { seriesMin: 2, maxDepth: 3, useExisting: true, collapseSingles: true, rules: [], neverMove: [], categoryNames: {}, aiInstructions: '', depth: 'smart', keepFolders: [], openFolders: [] },
  ui: { recent: [] },
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function loadSettings() {
  const s = readJson(SETTINGS_FILE(), {});
  return {
    ai: Object.assign({}, DEFAULT_SETTINGS.ai, s.ai || {}),
    organize: Object.assign({}, DEFAULT_SETTINGS.organize, s.organize || {}),
    ui: Object.assign({}, DEFAULT_SETTINGS.ui, s.ui || {}),
  };
}
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}
function getKey(s) {
  if (!s.ai.key) return '';
  if (s.ai.keyEnc) {
    try { return safeStorage.decryptString(Buffer.from(s.ai.key, 'base64')); } catch { return ''; }
  }
  return s.ai.key;
}
function publicSettings(s) {
  const out = JSON.parse(JSON.stringify(s));
  out.ai.hasKey = !!s.ai.key;
  delete out.ai.key; delete out.ai.keyEnc;
  return out;
}

// ============================================================================
// Scanning
// ============================================================================
const SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', 'ehthumbs.db', 'ehthumbs_vista.db', 'pagefile.sys', 'hiberfil.sys',
  'swapfile.sys', 'ntuser.ini', 'ntuser.dat', 'iconcache.db', '.ds_store', '.localized', '.directory']);
const SYSTEM_DIRS = new Set(['$recycle.bin', 'system volume information', 'config.msi', '$winrepackage', '.spotlight-v100',
  '.fseventsd', '.documentrevisions-v100', '.temporaryitems', '.trash', '.trashes']);
// Big folders we list but never walk into
const OPAQUE_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', '.idea', '.vs', '.gradle', '.next']);

function scanDirectory(rootPath) {
  const files = [], dirs = [], skipped = [];
  const maxFiles = 20000;
  function walk(dir, rel, depth) {
    if (files.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { skipped.push((rel || path.basename(dir)) + ': ' + e.code); return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) { skipped.push('Stopped after ' + maxFiles + ' files'); break; }
      const full = path.join(dir, entry.name);
      const r = rel ? rel + '/' + entry.name : entry.name;
      const lower = entry.name.toLowerCase();
      if (entry.isSymbolicLink()) { skipped.push(r + ': shortcut/link'); continue; }
      if (entry.isDirectory()) {
        if (SYSTEM_DIRS.has(lower)) { skipped.push(r + ': system folder'); continue; }
        // opaque dirs below the root are treated as part of a project
        const opaque = OPAQUE_DIRS.has(lower);
        dirs.push({ path: r, opaque });
        if (!opaque) walk(full, r, depth + 1);
      } else if (entry.isFile()) {
        if (SYSTEM_FILES.has(lower)) { skipped.push(r + ': system file'); continue; }
        try {
          const st = fs.statSync(full);
          files.push({ name: entry.name, path: r, extension: path.extname(entry.name).toLowerCase().replace(/^\./, ''), size: st.size, lastModified: st.mtimeMs });
        } catch (e) { skipped.push(r + ': ' + e.code); }
      }
    }
  }
  walk(rootPath, '', 0);
  return { files, dirs, skipped };
}

// Folders we refuse to reorganize
function dangerousRoot(p) {
  const resolved = path.resolve(p);
  const lower = resolved.toLowerCase().replace(/[\\/]+$/, '');
  if (path.parse(resolved).root.toLowerCase().replace(/[\\/]+$/, '') === lower) return 'This is the root of a drive.';
  const env = process.env;
  const bad = [env.WINDIR || env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData, env.APPDATA, env.LOCALAPPDATA, '/usr', '/etc', '/bin', '/System', '/Applications', '/Library']
    .filter(Boolean).map(x => path.resolve(x).toLowerCase());
  for (const b of bad) if (lower === b || lower.startsWith(b + path.sep)) return 'This is a system or program folder.';
  if (lower === path.resolve(os.homedir()).toLowerCase()) return 'This is your whole user folder. Pick a folder inside it, like Downloads or Desktop.';
  return null;
}

function loadFolder(folder) {
  const danger = dangerousRoot(folder);
  if (danger) return { error: danger + ' Onyx won\'t reorganize it, to keep your system safe.' };
  const r = scanDirectory(folder);
  scan = { root: folder, files: r.files, dirs: r.dirs, skipped: r.skipped, demo: false };
  const s = loadSettings();
  s.ui.recent = [folder].concat((s.ui.recent || []).filter(x => x !== folder)).slice(0, 6);
  writeJson(SETTINGS_FILE(), s);
  return vaultPayload();
}

function vaultPayload() {
  return {
    vaultName: scan.demo ? 'Demo vault' : path.basename(scan.root) || scan.root,
    rootPath: scan.root, demo: scan.demo,
    files: scan.files, dirs: scan.dirs, skipped: scan.skipped,
    undo: (() => { const h = scan.demo ? null : lastHistory(scan.root); return h ? { at: h.at, count: h.moves.length } : null; })(),
  };
}

// ============================================================================
// AI providers
// ============================================================================
const PROVIDERS = {
  freeai: { label: 'free.ai', model: 'qwen3-8b', baseUrl: 'https://api.free.ai/v1' },
  pollinations: { label: 'Pollinations (free, no key)', model: 'openai' },
  openai: { label: 'OpenAI-compatible', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', model: 'claude-haiku-5-5' },
  off: { label: 'Off (offline rules only)' },
};

async function fetchJson(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 90000);
  try {
    const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
    const text = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.replace(/\s+/g, ' ').slice(0, 180));
    try { return JSON.parse(text); } catch { throw new Error('Unexpected reply from AI service'); }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI request timed out');
    throw e;
  } finally { clearTimeout(t); }
}

let freeaiPath = null;

function friendlyError(provider, e) {
  const msg = String(e && e.message || e);
  const name = (PROVIDERS[provider] || {}).label || 'The AI service';
  if (/^HTTP 401|^HTTP 403/.test(msg)) return new Error(name + ' rejected the API key. Check it in Settings → AI provider.');
  if (/^HTTP 402/.test(msg)) return new Error(name + ' says your account is out of credits.');
  if (/^HTTP 429/.test(msg)) return new Error(name + ' is rate-limiting requests. Try again in a minute.');
  if (/^HTTP 5\d\d/.test(msg)) return new Error(name + ' had a server error (' + msg.slice(5, 8) + '). Try again shortly.');
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg)) return new Error('Couldn’t reach ' + name + '. Check your internet connection.');
  return e instanceof Error ? e : new Error(msg);
}

async function chat(settings, system, user) {
  try { return await chatRaw(settings, system, user); }
  catch (e) { throw friendlyError(settings.ai.provider, e); }
}

async function chatRaw(settings, system, user) {
  const ai = settings.ai;
  const provider = PROVIDERS[ai.provider] ? ai.provider : 'pollinations';
  if (provider === 'off') throw new Error('AI is turned off');
  const model = ai.model || PROVIDERS[provider].model;
  if (provider === 'freeai') {
    const key = getKey(settings);
    if (!key) throw new Error('Add your free.ai API key in Settings → AI provider');
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + key };
    // Qwen3 models think out loud unless asked not to; Onyx only needs the JSON
    const u = /qwen3/i.test(model) ? user + '\n\n/no_think' : user;
    const body = JSON.stringify({ model, temperature: 0.2, max_tokens: 4096, messages: [{ role: 'system', content: system }, { role: 'user', content: u }] });
    const base = PROVIDERS.freeai.baseUrl;
    const paths = freeaiPath ? [freeaiPath] : ['/chat/completions', '/chat/'];   // '/chat/' is the path in free.ai's docs
    let r, lastErr;
    for (const p of paths) {
      try { r = await fetchJson(base + p, { method: 'POST', headers, body }); freeaiPath = p; break; }
      catch (e) { lastErr = e; if (!/^HTTP (404|405)/.test(e.message)) throw e; if (freeaiPath) { freeaiPath = null; } }
    }
    if (!r) throw lastErr;
    return { text: r.choices?.[0]?.message?.content || '', model };
  }
  if (provider === 'anthropic') {
    const key = getKey(settings);
    if (!key) throw new Error('Add your Anthropic API key in Settings');
    const r = await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4096, temperature: 0.2, system, messages: [{ role: 'user', content: user }] }),
    });
    return { text: (r.content || []).map(c => c.text || '').join(''), model };
  }
  let url, headers = { 'content-type': 'application/json' };
  if (provider === 'pollinations') url = 'https://text.pollinations.ai/openai';
  else {
    url = (ai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
    const key = getKey(settings);
    if (key) headers.authorization = 'Bearer ' + key;
  }
  const r = await fetchJson(url, {
    method: 'POST', headers,
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 4096, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  return { text: r.choices?.[0]?.message?.content || '', model };
}

async function aiFolders(files, dirs, settings, onProgress) {
  const batches = E.aiBatches(files, dirs, settings.organize, 120);
  const folders = {}, summaries = [];
  const used = new Set();
  let model = '';
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    onProgress && onProgress({ batch: i + 1, of: batches.length });
    let parsed = null, lastErr = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const r = await chat(settings, b.system, b.user([...used].slice(0, 80)));
        model = r.model;
        parsed = E.parseAiResponse(r.text, b.ids);
      } catch (e) { lastErr = e; }
    }
    if (!parsed) {
      if (i === 0) throw lastErr;             // nothing worked: caller falls back to rules
      continue;                                // later batch failed: those files use rules
    }
    Object.assign(folders, parsed.folders);
    for (const f of Object.values(parsed.folders)) { const c = E.sanitizeFolder(f, 3); if (c) used.add(c); }
    if (parsed.summary) summaries.push(parsed.summary);
  }
  return { folders, summary: summaries.join(' '), model, batches: batches.length };
}

// ============================================================================
// Applying plans, with an undo journal
// ============================================================================
function lastHistory(root) {
  if (!root) return null;
  const h = readJson(HISTORY_FILE(), []);
  for (let i = h.length - 1; i >= 0; i--) if (h[i].root === root && !h[i].undone) return h[i];
  return null;
}

function applyPlan(root, items) {
  const moves = [], failed = [], createdDirs = [];
  const sourceDirs = new Set();
  for (const it of items) {
    if (it.kind !== 'move' || it.skip) continue;
    // Plan paths come from the renderer: re-validate they stay inside the root
    const src = path.resolve(root, it.source);
    let tgt = path.resolve(root, it.target);
    const inside = p => p.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
    if (!inside(src) || !inside(tgt)) { failed.push({ source: it.source, error: 'Path outside the folder' }); continue; }
    try {
      if (!fs.existsSync(src)) throw new Error('File no longer exists');
      // never overwrite: pick "name (2).ext" if something appeared there since the plan was made
      if (fs.existsSync(tgt)) {
        const dir = path.dirname(tgt), ext = path.extname(tgt), base = path.basename(tgt, ext);
        let n = 2;
        while (fs.existsSync(tgt)) { tgt = path.join(dir, base + ' (' + n + ')' + ext); n++; }
      }
      // remember which folders we create so undo can remove them
      let d = path.dirname(tgt);
      const toCreate = [];
      while (inside(d) && !fs.existsSync(d)) { toCreate.unshift(d); d = path.dirname(d); }
      fs.mkdirSync(path.dirname(tgt), { recursive: true });
      createdDirs.push(...toCreate);
      try { fs.renameSync(src, tgt); }
      catch (e) {
        if (e.code !== 'EXDEV') throw e;
        fs.copyFileSync(src, tgt, fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(src);
      }
      moves.push({ from: path.relative(root, src), to: path.relative(root, tgt) });
      sourceDirs.add(path.dirname(src));
    } catch (e) {
      failed.push({ source: it.source, error: e.code === 'EBUSY' || e.code === 'EPERM' ? 'File is open in another program' : e.message });
    }
  }
  // tidy up folders we emptied (only relevant for Flatten)
  const removedDirs = [];
  for (let d of [...sourceDirs].sort((a, b) => b.length - a.length)) {
    while (d.toLowerCase() !== path.resolve(root).toLowerCase() && d.toLowerCase().startsWith(path.resolve(root).toLowerCase())) {
      try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); removedDirs.push(path.relative(root, d)); } catch { break; }
      d = path.dirname(d);
    }
  }
  if (moves.length) {
    const h = readJson(HISTORY_FILE(), []);
    h.push({ root, at: Date.now(), moves, createdDirs: createdDirs.map(d => path.relative(root, d)), removedDirs });
    writeJson(HISTORY_FILE(), h.slice(-30));
  }
  return { applied: moves.length, failed };
}

function undoLast(root) {
  const h = readJson(HISTORY_FILE(), []);
  let idx = -1;
  for (let i = h.length - 1; i >= 0; i--) if (h[i].root === root && !h[i].undone) { idx = i; break; }
  if (idx < 0) return { error: 'Nothing to undo' };
  const entry = h[idx];
  let restored = 0; const failed = [];
  for (const m of [...entry.moves].reverse()) {
    const from = path.join(root, m.from), to = path.join(root, m.to);
    try {
      if (!fs.existsSync(to)) throw new Error('File was moved or deleted since');
      if (fs.existsSync(from)) throw new Error('Something else is now at the original location');
      fs.mkdirSync(path.dirname(from), { recursive: true });
      fs.renameSync(to, from);
      restored++;
    } catch (e) { failed.push({ source: m.to, error: e.message }); }
  }
  for (const d of [...(entry.createdDirs || [])].sort((a, b) => b.length - a.length)) {
    try { const full = path.join(root, d); if (!fs.readdirSync(full).length) fs.rmdirSync(full); } catch { /* not empty or gone */ }
  }
  entry.undone = true;
  writeJson(HISTORY_FILE(), h);
  return { restored, failed };
}

// ============================================================================
// Demo vault (in memory, nothing on disk is touched)
// ============================================================================
function demoVault() {
  const now = Date.now(), d = 86400000;
  const F = (p, size, age) => { const name = p.split('/').pop(); return { path: p, name, extension: path.extname(name).toLowerCase().slice(1), size, lastModified: now - d * age }; };
  return {
    files: [
      F('excavatorio1.obj', 2400000, 30), F('excavatorio2.obj', 2350000, 30), F('excavatorio3.obj', 2480000, 29),
      F('invoice_2024_03.pdf', 245000, 30), F('invoice_2024_04.pdf', 312000, 28), F('tax_return_2023.pdf', 1240000, 100),
      F('bank_statement.pdf', 458000, 90), F('budget_2024.xlsx', 87000, 60), F('Q4_report.docx', 540000, 14),
      F('project_proposal.docx', 320000, 45), F('kickoff.pptx', 2400000, 20), F('passport_scan.pdf', 890000, 200),
      F('resume_2024.pdf', 234000, 15), F('lecture_notes.md', 34000, 12), F('thesis_draft.pdf', 3400000, 5),
      F('boarding_pass.pdf', 89000, 70), F('IMG_4521.jpg', 3400000, 8), F('IMG_4522.jpg', 3100000, 8),
      F('Screenshot 2026-09-12 101530.png', 450000, 18), F('Screenshot 2026-09-13 091205.png', 380000, 17),
      F('Screenshot 2026-09-14 174411.png', 420000, 16), F('invoice_generator.py', 12000, 3), F('config.json', 2300, 6),
      F('notes.txt', 3400, 1), F('VID_20260901_120000.mp4', 48000000, 30), F('OBS_Setup_31.0.exe', 120000000, 40),
      F('photos_backup.zip', 900000000, 50), F('~$Q4_report.docx', 162, 1), F('dataset.csv.crdownload', 5000000, 0),
      F('Taxes/tax_return_2022.pdf', 1100000, 400),
      F('excavatorio-modular/index.html', 4200, 12), F('excavatorio-modular/main.js', 18000, 12), F('excavatorio-modular/physics.js', 9000, 12), F('excavatorio-modular/style.css', 2100, 12),
      F('New folder/song draft01.wav', 31000000, 60), F('New folder/song draft02.wav', 30500000, 59), F('New folder/invoice_march.pdf', 210000, 45),
      F('Documents/meeting_agenda.docx', 64000, 33), F('Documents/tax_return_2021.pdf', 980000, 700),
      F('glorp/glorp.blend', 5400000, 25), F('glorp/glorp_diffuse.png', 2100000, 25),
      F('Photos/Iceland Trip/glacier.jpg', 4100000, 300), F('Photos/Iceland Trip/aurora.jpg', 3900000, 300),
      F('Game Project/package.json', 900, 20), F('Game Project/src/main.js', 14000, 2), F('Game Project/assets/level1.png', 80000, 22),
    ],
    dirs: [{ path: 'Taxes' }, { path: 'Photos' }, { path: 'Photos/Iceland Trip' }, { path: 'Game Project' }, { path: 'Game Project/src' },
      { path: 'Game Project/assets' }, { path: 'Game Project/node_modules', opaque: true }, { path: 'excavatorio-modular' }, { path: 'New folder' }, { path: 'Documents' }, { path: 'glorp' }],
  };
}

// ============================================================================
// IPC
// ============================================================================
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Open folder as vault' });
  if (r.canceled || !r.filePaths.length) return { cancelled: true };
  return loadFolder(r.filePaths[0]);
});
ipcMain.handle('open-recent', async (e, folder) => {
  if (!fs.existsSync(folder)) return { error: 'That folder no longer exists.' };
  return loadFolder(folder);
});
ipcMain.handle('load-demo', async () => {
  const v = demoVault();
  scan = { root: '', files: v.files, dirs: v.dirs, skipped: [], demo: true };
  return vaultPayload();
});
ipcMain.handle('rescan', async () => {
  if (scan.demo || !scan.root) return vaultPayload();
  const r = scanDirectory(scan.root);
  Object.assign(scan, r);
  return vaultPayload();
});

ipcMain.handle('organize', async (event, strategy) => {
  if (!scan.files.length) return { error: 'Open a folder first' };
  const settings = loadSettings();
  const ai = { used: false, provider: settings.ai.provider, providerLabel: PROVIDERS[settings.ai.provider]?.label || '', error: '', summary: '', model: '' };
  let folders = null;
  if (strategy === 'smart') {
    if (settings.ai.provider === 'off') ai.error = 'AI is off — used offline rules';
    else {
      try {
        const r = await aiFolders(scan.files, scan.dirs, settings, p => event.sender.send('organize-progress', p));
        folders = r.folders; ai.used = true; ai.summary = r.summary; ai.model = r.model;
      } catch (e) { ai.error = e.message || String(e); }
    }
  }
  const plan = E.buildPlan({ files: scan.files, dirs: scan.dirs, strategy, settings: settings.organize, aiFolders: folders });
  plan.ai = ai;
  plan.demo = scan.demo;
  return { plan };
});

ipcMain.handle('apply-plan', async (event, items) => {
  if (scan.demo) return { error: 'This is the demo vault — nothing to move. Open a real folder to apply changes.' };
  if (!scan.root) return { error: 'No folder open' };
  const r = applyPlan(scan.root, items);
  Object.assign(scan, scanDirectory(scan.root));
  return Object.assign(r, { vault: vaultPayload() });
});

ipcMain.handle('undo', async () => {
  if (!scan.root) return { error: 'No folder open' };
  const r = undoLast(scan.root);
  Object.assign(scan, scanDirectory(scan.root));
  return Object.assign(r, { vault: vaultPayload() });
});

ipcMain.handle('get-settings', async () => Object.assign(publicSettings(loadSettings()), { providers: PROVIDERS, version: app.getVersion() }));
ipcMain.handle('save-settings', async (e, patch) => {
  const s = loadSettings();
  if (patch.ai) {
    const { key, ...rest } = patch.ai;
    Object.assign(s.ai, rest);
    if (key !== undefined) {
      if (!key) { s.ai.key = ''; s.ai.keyEnc = false; }
      else if (safeStorage.isEncryptionAvailable()) { s.ai.key = safeStorage.encryptString(key).toString('base64'); s.ai.keyEnc = true; }
      else { s.ai.key = key; s.ai.keyEnc = false; }
    }
  }
  if (patch.organize) deepMerge(s.organize, patch.organize);
  if (patch.ui) deepMerge(s.ui, patch.ui);
  writeJson(SETTINGS_FILE(), s);
  return publicSettings(s);
});
ipcMain.handle('replace-settings', async (e, { section, key, value }) => {
  const s = loadSettings();
  if (!['ui', 'organize'].includes(section)) return publicSettings(s);
  s[section][key] = value;
  writeJson(SETTINGS_FILE(), s);
  return publicSettings(s);
});
ipcMain.handle('export-settings', async () => {
  const s = publicSettings(loadSettings());
  delete s.ai.hasKey; delete s.ui.recent;
  const r = await dialog.showSaveDialog(mainWindow, { title: 'Export Onyx settings', defaultPath: 'onyx-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { cancelled: true };
  fs.writeFileSync(r.filePath, JSON.stringify({ onyxSettings: 1, ai: s.ai, organize: s.organize, ui: s.ui }, null, 2));
  return { ok: true, path: r.filePath };
});
ipcMain.handle('import-settings', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Import Onyx settings', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths.length) return { cancelled: true };
  let data;
  try { data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { error: 'That file isn\'t valid JSON.' }; }
  if (!data || data.onyxSettings !== 1) return { error: 'That file isn\'t an Onyx settings export.' };
  const s = loadSettings();
  if (isObj(data.ai)) { const { key, keyEnc, hasKey, ...rest } = data.ai; Object.assign(s.ai, rest); }
  if (isObj(data.organize)) s.organize = Object.assign({}, DEFAULT_SETTINGS.organize, data.organize);
  if (isObj(data.ui)) s.ui = Object.assign({}, data.ui, { recent: s.ui.recent || [] });
  writeJson(SETTINGS_FILE(), s);
  return { ok: true, settings: publicSettings(s) };
});
ipcMain.handle('reset-settings', async (e, which) => {
  const s = loadSettings();
  if (which === 'ui' || which === 'all') s.ui = { recent: s.ui.recent || [] };
  if (which === 'organize' || which === 'all') s.organize = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.organize));
  writeJson(SETTINGS_FILE(), s);
  return publicSettings(s);
});
ipcMain.handle('set-titlebar', async (e, { color, symbolColor }) => {
  if (!mainWindow || process.platform === 'darwin') return;
  try { mainWindow.setTitleBarOverlay({ color, symbolColor, height: 38 }); mainWindow.setBackgroundColor(color); } catch { /* older Electron */ }
  const s = loadSettings(); if (s.ui.lastBg !== color) { s.ui.lastBg = color; s.ui.lastSymbol = symbolColor; writeJson(SETTINGS_FILE(), s); }
});
ipcMain.handle('open-path', async (e, p) => {
  try { if (!p || !fs.statSync(p).isDirectory()) return { error: 'Drop a folder, not a file.' }; }
  catch { return { error: 'Couldn\'t read that folder.' }; }
  return loadFolder(p);
});
ipcMain.handle('test-ai', async () => {
  const s = loadSettings();
  const t0 = Date.now();
  try {
    const r = await chat(s, 'Reply with strict JSON only.', 'Reply with {"ok": true}');
    const text = String(r.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    if (!/ok/i.test(text)) throw new Error('Unexpected reply: ' + text.trim().slice(0, 80));
    return { ok: true, ms: Date.now() - t0, model: r.model };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('reveal', async (e, rel) => {
  if (!scan.root) return;
  const full = path.resolve(scan.root, rel || '');
  if (!full.toLowerCase().startsWith(path.resolve(scan.root).toLowerCase())) return;
  if (rel) shell.showItemInFolder(full); else shell.openPath(full);
});
ipcMain.handle('copy-text', async (e, text) => { clipboard.writeText(String(text)); });

// ============================================================================
// Window
// ============================================================================
function createWindow() {
  const ui = loadSettings().ui;
  const bg = /^#[0-9a-f]{6}$/i.test(ui.lastBg || '') ? ui.lastBg : '#161619';
  const sym = /^#[0-9a-f]{6}$/i.test(ui.lastSymbol || '') ? ui.lastSymbol : '#a3a4ad';
  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 600,
    title: 'Onyx',
    icon: fs.existsSync(ICON_FILE) ? ICON_FILE : path.join(__dirname, 'icon.ico'),
    backgroundColor: bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: bg, symbolColor: sym, height: 38 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  // what Windows uses when the taskbar button is pinned
  if (process.platform === 'win32' && fs.existsSync(ICON_FILE)) {
    try { mainWindow.setAppDetails({ appId: APP_ID, appIconPath: ICON_FILE, appIconIndex: 0, relaunchCommand: '"' + process.execPath + '"', relaunchDisplayName: 'Onyx' }); } catch {}
  }
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // keep links out of the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Point Onyx's own shortcuts (desktop, Start menu, pinned taskbar) at the stone icon and this app's ID.
// Only touches existing shortcuts named Onyx*.lnk that launch this exact Onyx.exe.
function fixShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged || !fs.existsSync(ICON_FILE)) return;
  const appData = app.getPath('appData');
  const dirs = [app.getPath('desktop'), path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')];
  const exe = path.resolve(process.execPath).toLowerCase();
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir).filter(n => /^onyx.*\.lnk$/i.test(n)); } catch { continue; }
    for (const n of names) {
      const lnk = path.join(dir, n);
      try {
        const cur = shell.readShortcutLink(lnk);
        if (!cur.target || path.resolve(cur.target).toLowerCase() !== exe) continue;
        if (cur.icon === ICON_FILE && cur.appUserModelId === APP_ID) continue;
        shell.writeShortcutLink(lnk, 'update', { icon: ICON_FILE, iconIndex: 0, appUserModelId: APP_ID });
      } catch { /* leave it alone */ }
    }
  }
}

function importKeyFile() {
  for (const dir of [__dirname, path.dirname(process.execPath)]) {
    const f = path.join(dir, 'ai-key.txt');
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    try { fs.unlinkSync(f); } catch { /* read-only location */ }
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const key = lines.find(l => /^sk-/.test(l));
    if (!key) continue;
    const s = loadSettings();
    if (/^sk-free-/.test(key)) { if (s.ai.provider !== 'freeai') s.ai.model = ''; s.ai.provider = 'freeai'; }
    if (safeStorage.isEncryptionAvailable()) { s.ai.key = safeStorage.encryptString(key).toString('base64'); s.ai.keyEnc = true; }
    else { s.ai.key = key; s.ai.keyEnc = false; }
    writeJson(SETTINGS_FILE(), s);
  }
}

app.whenReady().then(() => {
  importKeyFile();
  fixShortcuts();
  // No app menu on Windows/Linux: removes Ctrl+R reload / devtools shortcuts that would wipe the current plan
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
