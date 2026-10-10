/*
 * Onyx organizing engine.
 * Pure functions only (no fs / electron) so it can be unit-tested in Node and
 * reused in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OnyxEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Basic helpers
  // ---------------------------------------------------------------------------
  function splitExt(name) {
    const i = name.lastIndexOf('.');
    if (i <= 0) return { base: name, ext: '' };
    return { base: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() };
  }
  function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function basename(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
  function joinPath(a, b) { return a ? (b ? a + '/' + b : a) : b; }
  function normKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  // "Invoices" == "invoice" == "INVOICE"
  function cmpKey(s) {
    let k = normKey(s);
    if (k.length > 4 && k.endsWith('ies')) k = k.slice(0, -3) + 'y';
    else if (k.length > 4 && /(ches|shes|xes|sses)$/.test(k)) k = k.slice(0, -2);
    else if (k.length > 3 && k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1);
    return k;
  }
  function titleCase(s) {
    return s.split(' ').map(w => {
      if (!w) return w;
      if (/^[A-Z0-9]+$/.test(w) && w.length <= 4) return w;       // acronyms: Q4, PDF
      if (/[a-z][A-Z]/.test(w)) return w;                          // camelCase: iPhone
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  // ---------------------------------------------------------------------------
  // File-type taxonomy (nested, so we never dump everything in one bucket)
  // ---------------------------------------------------------------------------
  const TYPE_FOLDERS = [
    ['Documents', 'pdf doc docx odt rtf pages wpd xps'],
    ['Documents/Notes', 'txt md markdown org'],
    ['Documents/Spreadsheets', 'xls xlsx xlsm csv tsv ods numbers'],
    ['Documents/Presentations', 'ppt pptx key odp'],
    ['eBooks', 'epub mobi azw azw3 djvu fb2 cbz cbr'],
    ['Images', 'jpg jpeg png gif webp bmp tif tiff heic heif avif ico jfif'],
    ['Images/RAW', 'raw cr2 cr3 nef arw dng orf rw2'],
    ['Images/Vector', 'svg eps'],
    ['Design', 'psd ai xd fig sketch indd afdesign afphoto kra xcf clip procreate'],
    ['Videos', 'mp4 mov avi mkv webm wmv flv m4v mpg mpeg 3gp mts'],
    ['Audio', 'mp3 wav flac aac ogg m4a wma opus aiff aif mid midi'],
    ['3D Models', 'obj fbx stl blend gltf glb dae 3ds max ma mb c4d usd usdz usda ply 3mf mtl'],
    ['Code', 'js mjs cjs ts tsx jsx py java go rs cpp cc c h hpp cs rb php swift kt lua sh bat cmd ps1 r scala dart sql ipynb gd'],
    ['Code/Web', 'html htm css scss sass less vue svelte'],
    ['Code/Config', 'json xml yaml yml toml ini cfg conf env plist'],
    ['Archives', 'zip rar 7z tar gz tgz bz2 xz'],
    ['Disk Images', 'iso img dmg vhd vhdx'],
    ['Installers', 'exe msi msix appx appxbundle apk deb rpm pkg'],
    ['Fonts', 'ttf otf woff woff2 fon'],
    ['Shortcuts', 'lnk url webloc'],
    ['Torrents', 'torrent'],
    ['Subtitles', 'srt vtt ass ssa sub'],
    ['Calendar & Contacts', 'ics vcf'],
    ['Email', 'eml msg mbox'],
  ];
  const EXT_TO_FOLDER = {};
  for (const [folder, exts] of TYPE_FOLDERS) for (const e of exts.split(' ')) EXT_TO_FOLDER[e] = folder;

  function typeFolder(ext) { return Object.prototype.hasOwnProperty.call(EXT_TO_FOLDER, ext) ? EXT_TO_FOLDER[ext] : 'Other'; }
  function typeGroup(ext) { return typeFolder(ext).split('/')[0]; }

  // Keyword rules only apply to "content" files. A file called
  // invoice_generator.py is code, not an invoice.
  const CONTENT_GROUPS = new Set(['Documents', 'eBooks', 'Other']);
  const MEDIA_GROUPS = new Set(['Images', 'Videos']);

  const KEYWORD_RULES = [
    ['Finance/Invoices', 'invoice invoices inv factura rechnung facture'],
    ['Finance/Receipts', 'receipt receipts order confirmation'],
    ['Finance/Taxes', 'tax taxes w2 w-2 1099 1040 irs hmrc vat tax return'],
    ['Finance/Bank Statements', 'bank statement statements'],
    ['Finance/Payslips', 'payslip payslips paystub pay stub salary payroll'],
    ['Finance/Budgets', 'budget budgets expenses expense spending'],
    ['Finance/Insurance', 'insurance'],
    ['Work/Contracts', 'contract contracts agreement nda sow'],
    ['Work/Proposals', 'proposal proposals pitch quotation'],
    ['Work/Reports', 'report reports quarterly q1 q2 q3 q4 okr okrs kpi'],
    ['Work/Meetings', 'meeting meetings agenda minutes kickoff standup retro'],
    ['Work/Presentations', 'presentation deck slides'],
    ['Personal/Identity', 'passport license licence id card visa birth certificate ssn'],
    ['Personal/Career', 'resume cv cover letter portfolio'],
    ['Personal/Certificates', 'certificate diploma transcript'],
    ['Personal/Journal', 'diary journal'],
    ['School/Lectures', 'lecture lectures syllabus course'],
    ['School/Assignments', 'homework assignment essay exam quiz midterm worksheet'],
    ['School/Research', 'thesis dissertation research'],
    ['Travel', 'boarding ticket tickets hotel itinerary flight booking reservation trip vacation airbnb'],
    ['Health/Medical', 'medical prescription doctor lab results vaccine vaccination dental hospital'],
    ['Health/Fitness', 'workout fitness diet meal plan training plan'],
    ['Manuals', 'manual manuals user guide instructions handbook datasheet'],
    ['Recipes', 'recipe recipes'],
    ['Documents/Scans', 'scan scanned scans'],
  ].map(([folder, kw]) => ({ folder, kw: splitKeywords(kw) }));

  function splitKeywords(s) {
    // allow multi-word phrases in the list by joining known pairs
    const phrases = ['order confirmation', 'tax return', 'pay stub', 'id card', 'birth certificate', 'cover letter',
      'lab results', 'meal plan', 'training plan', 'user guide', 'screen shot', 'screen recording'];
    let rest = ' ' + s + ' ';
    const out = [];
    for (const p of phrases) if (rest.includes(' ' + p + ' ')) { out.push(p); rest = rest.replace(' ' + p + ' ', ' '); }
    return out.concat(rest.trim().split(/\s+/).filter(Boolean));
  }

  const MEDIA_RULES = [
    { folder: 'Images/Screenshots', exts: 'Images', kw: ['screenshot', 'screenshots', 'screen shot', 'snip', 'capture', 'scr'] },
    { folder: 'Images/WhatsApp', exts: 'Images', kw: ['whatsapp'], re: /^img-\d{8}-wa\d+/i },
    { folder: 'Images/Wallpapers', exts: 'Images', kw: ['wallpaper', 'wallpapers'] },
    { folder: 'Images/Camera', exts: 'Images', kw: ['img', 'dsc', 'dscn', 'dcim', 'pxl', 'mvimg', 'photo', 'gopr', 'dji'], re: /^\d{8}[_-]\d{6}/ },
    { folder: 'Videos/Screen Recordings', exts: 'Videos', kw: ['screen recording', 'recording', 'obs'] },
    { folder: 'Videos/WhatsApp', exts: 'Videos', kw: ['whatsapp'], re: /^vid-\d{8}-wa\d+/i },
    { folder: 'Videos/Camera', exts: 'Videos', kw: ['vid', 'mvi', 'mov', 'gopr', 'dji', 'pxl'], re: /^\d{8}[_-]\d{6}/ },
  ];

  // Two normalised spellings: "TaxReturn2023" -> "tax return2023" and "tax return 2023"
  function nameTexts(name) {
    const { base } = splitExt(name);
    const camel = base.replace(/([a-z])([A-Z])/g, '$1 $2');
    const t1 = ' ' + camel.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' ';
    const t2 = ' ' + camel.replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
      .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' ';
    return [t1, t2];
  }
  function hasKeyword(texts, kw) { return texts.some(t => t.includes(' ' + kw + ' ')); }

  function keywordFolder(file) {
    const group = typeGroup(file.extension);
    const texts = nameTexts(file.name);
    if (MEDIA_GROUPS.has(group)) {
      for (const r of MEDIA_RULES) {
        if (r.exts !== group) continue;
        if ((r.re && r.re.test(file.name)) || r.kw.some(k => hasKeyword(texts, k))) return r.folder;
      }
    }
    // Spreadsheets/presentations are content too
    if (CONTENT_GROUPS.has(group) || group === 'Images' && /scan/.test(texts[1])) {
      for (const r of KEYWORD_RULES) if (r.kw.some(k => hasKeyword(texts, k))) return r.folder;
    }
    return null;
  }

  function ruleFolder(file) {
    const kw = keywordFolder(file);
    if (kw) return { folder: kw, reason: 'Name suggests ' + kw.split('/').pop().toLowerCase() };
    const t = typeFolder(file.extension);
    return { folder: t, reason: file.extension ? '.' + file.extension + ' file' : 'No extension' };
  }

  // ---------------------------------------------------------------------------
  // Files we should never move
  // ---------------------------------------------------------------------------
  function untouchableReason(file) {
    const n = file.name;
    const lower = n.toLowerCase();
    if (n.startsWith('.')) return 'Hidden file';
    if (n.startsWith('~$') || lower.startsWith('.~lock')) return 'Office lock file';
    if (/\.(crdownload|part|partial|download|opdownload|tmp)$/.test(lower)) return 'Download still in progress';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Series detection: excavatorio1.obj, excavatorio2.obj -> "Excavatorio"
  // ---------------------------------------------------------------------------
  const GENERIC_STEMS = new Set(('img image images photo photos pic picture pictures dsc dscn dcim pxl mvimg vid video videos mov mvi ' +
    'screenshot screenshots screen shot capture scan scans scanned file files document documents doc untitled new copy download downloads ' +
    'export output temp test unnamed whatsapp image whatsapp video wa gopr dji recording clip snip page').split(' ').concat(
    ['screen shot', 'whatsapp image', 'whatsapp video', 'screen recording']));
  const MARKERS = new Set(['copy', 'final', 'draft', 'edit', 'edited', 'new', 'old', 'backup', 'bak', 'rev', 'revised', 'updated', 'v']);
  const PLURALIZABLE = new Set(('invoice receipt statement scan render sketch drawing recording chapter lesson lecture episode ' +
    'track level map model texture frame shot clip song note report letter budget payslip ticket asset sprite icon ' +
    'mockup wireframe concept design poster flyer logo banner sample loop beat stem mix take part section unit week ' +
    'module exercise worksheet slide figure plot chart table scene character prop').split(' '));
  function pluralize(w) {
    if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
    if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
    return w + 's';
  }
  function isNumericish(t) { return /^\d+$/.test(t) || /^v\d+$/i.test(t) || /^\d+(st|nd|rd|th)$/i.test(t) || /^#\d+$/.test(t); }

  function seriesStem(name) {
    const { base } = splitExt(name);
    let tokens = base.split(/[\s_\-.()\[\]]+/).filter(Boolean);
    if (!tokens.length) return null;
    let changed = false;
    while (tokens.length > 1 && isNumericish(tokens[0])) { tokens.shift(); changed = true; }
    for (let guard = 0; guard < 6; guard++) {
      const last = tokens[tokens.length - 1];
      if (tokens.length > 1 && (isNumericish(last) || MARKERS.has(last.toLowerCase()))) { tokens.pop(); changed = true; continue; }
      const m = last.match(/^(.*?[a-z])(\d+)$/i);
      if (m && m[1].length >= 2) { tokens[tokens.length - 1] = m[1]; changed = true; continue; }
      break;
    }
    if (!changed) return null;
    const stem = tokens.join(' ');
    if (stem.replace(/[^a-z]/gi, '').length < 3) return null;
    const key = stem.toLowerCase();
    if (GENERIC_STEMS.has(key) || GENERIC_STEMS.has(tokens[0].toLowerCase()) && tokens.length === 1) return null;
    let label = titleCase(stem);
    const words = label.split(' ');
    const lastWord = words[words.length - 1];
    if (PLURALIZABLE.has(lastWord.toLowerCase())) { words[words.length - 1] = pluralize(lastWord); label = words.join(' '); }
    return { key: normKey(stem), label };
  }

  function detectSeries(files, minSize) {
    const groups = new Map();
    for (const f of files) {
      const s = seriesStem(f.name);
      if (!s) continue;
      if (!groups.has(s.key)) groups.set(s.key, { key: s.key, label: s.label, files: [] });
      groups.get(s.key).files.push(f);
    }
    for (const [k, g] of groups) if (g.files.length < (minSize || 2)) groups.delete(k);
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Existing structure awareness
  // ---------------------------------------------------------------------------
  const PROJECT_MARKERS = new Set(['.git', '.svn', '.hg', 'package.json', 'cargo.toml', 'pyproject.toml', 'setup.py', 'go.mod',
    'pom.xml', 'build.gradle', 'cmakelists.txt', 'makefile', 'project.godot', '.obsidian', '.vscode', '.idea', 'node_modules',
    'requirements.txt', 'composer.json', 'gemfile', 'assets.meta', 'projectsettings']);
  const PROJECT_EXT_MARKERS = new Set(['sln', 'csproj', 'uproject', 'xcodeproj', 'blend1']);

  const CATEGORY_SYNONYMS = {
    images: ['photos', 'pictures', 'pics', 'images', 'photography', 'imgs'],
    videos: ['videos', 'movies', 'clips', 'video', 'films'],
    audio: ['audio', 'music', 'sounds', 'sound', 'songs'],
    documents: ['documents', 'docs', 'document', 'paperwork'],
    code: ['code', 'scripts', 'dev', 'programming', 'source'],
    archives: ['archives', 'zips', 'compressed', 'zip files'],
    installers: ['installers', 'setup', 'setups', 'programs', 'software', 'apps'],
    finance: ['finance', 'finances', 'money', 'bills', 'financial'],
    work: ['work', 'job', 'office', 'business'],
    school: ['school', 'university', 'uni', 'college', 'study', 'studies', 'education', 'class', 'classes'],
    '3dmodels': ['3d models', '3d', 'models', 'meshes', '3d assets'],
    design: ['design', 'designs', 'graphics', 'artwork', 'art'],
    ebooks: ['ebooks', 'books', 'e-books', 'reading'],
    personal: ['personal', 'private', 'me'],
    health: ['health', 'medical'],
    travel: ['travel', 'trips', 'travelling', 'traveling'],
    fonts: ['fonts', 'typefaces'],
  };
  const KNOWN_CATEGORY_KEYS = new Set();
  for (const [k, list] of Object.entries(CATEGORY_SYNONYMS)) { KNOWN_CATEGORY_KEYS.add(cmpKey(k)); for (const s of list) KNOWN_CATEGORY_KEYS.add(cmpKey(s)); }
  for (const [f] of TYPE_FOLDERS) KNOWN_CATEGORY_KEYS.add(cmpKey(f.split('/')[0]));

  const NO_LEAF_MATCH = new Set(['other', 'misc', 'newfolder', 'temp', 'tmp', 'old', 'backup', 'archive', 'stuff', 'file', 'new', 'sorted', 'unsorted']);

  function buildContext(files, dirs) {
    const dirSet = new Map(); // lower path -> canonical path
    const addDir = d => { if (d && !dirSet.has(d.toLowerCase())) dirSet.set(d.toLowerCase(), d); };
    for (const d of dirs || []) { let p = d.path; while (p) { addDir(p); p = dirname(p); } }
    for (const f of files) { let p = dirname(f.path); while (p) { addDir(p); p = dirname(p); } }

    // project-like dirs (contain markers)
    const projectDirs = new Set();
    for (const f of files) {
      const d = dirname(f.path);
      if (!d) continue;
      const n = f.name.toLowerCase();
      if (PROJECT_MARKERS.has(n) || PROJECT_EXT_MARKERS.has(splitExt(n).ext)) projectDirs.add(d.toLowerCase());
    }
    for (const d of dirs || []) {
      const n = basename(d.path).toLowerCase();
      if (PROJECT_MARKERS.has(n) && dirname(d.path)) projectDirs.add(dirname(d.path).toLowerCase());
      if (d.opaque && dirname(d.path)) projectDirs.add(dirname(d.path).toLowerCase());
    }
    // A folder with an .exe and .dll files is an installed app / game
    const exeDirs = new Set(), dllDirs = new Set();
    for (const f of files) {
      const d = dirname(f.path).toLowerCase(); if (!d) continue;
      if (f.extension === 'exe') exeDirs.add(d);
      if (f.extension === 'dll' || f.extension === 'pak') dllDirs.add(d);
    }
    for (const d of exeDirs) if (dllDirs.has(d)) projectDirs.add(d);

    const fileCount = new Map();
    for (const f of files) { let p = dirname(f.path); while (p) { const k = p.toLowerCase(); fileCount.set(k, (fileCount.get(k) || 0) + 1); p = dirname(p); } }

    const rootFiles = new Set(files.filter(f => !f.path.includes('/')).map(f => f.path.toLowerCase()));
    const rootMarkers = files.filter(f => !f.path.includes('/') && (PROJECT_MARKERS.has(f.name.toLowerCase()) || PROJECT_EXT_MARKERS.has(f.extension)))
      .map(f => f.name).concat((dirs || []).filter(d => !d.path.includes('/') && PROJECT_MARKERS.has(d.path.toLowerCase())).map(d => d.path));

    return { dirSet, projectDirs, fileCount, rootFiles, rootMarkers };
  }

  function insideProject(ctx, folder) {
    let p = folder.toLowerCase();
    while (p) { if (ctx.projectDirs.has(p)) return true; p = dirname(p); }
    return false;
  }

  // Map a proposed folder onto what's already on disk.
  function resolveExisting(folder, ctx, opts) {
    if (!folder) return folder;
    const lower = folder.toLowerCase();
    // 1. exact
    if (ctx.dirSet.has(lower)) return ctx.dirSet.get(lower);
    const segs = folder.split('/');
    if (opts.loose) {
      // 2. leaf matches a root-level folder (e.g. "Finance/Taxes" -> existing "Taxes")
      const leafKey = cmpKey(segs[segs.length - 1]);
      if (!NO_LEAF_MATCH.has(leafKey)) {
        for (const [k, canon] of ctx.dirSet) {
          if (k.includes('/')) continue;
          if (cmpKey(canon) === leafKey && !insideProject(ctx, canon)) return canon;
        }
      }
      // 3. top-level synonym (rule says "Images", user already has "Photos")
      const topKey = cmpKey(segs[0]);
      let family = null;
      for (const [k, list] of Object.entries(CATEGORY_SYNONYMS)) {
        if (cmpKey(k) === topKey || list.some(s => cmpKey(s) === topKey)) { family = list.concat([k]); break; }
      }
      if (family) {
        for (const [k, canon] of ctx.dirSet) {
          if (k.includes('/')) continue;
          if (family.some(s => cmpKey(s) === cmpKey(canon)) && !insideProject(ctx, canon)) { segs[0] = canon; break; }
        }
      }
    }
    // 4. reuse casing of any existing prefix
    let acc = '';
    for (let i = 0; i < segs.length; i++) {
      const next = joinPath(acc, segs[i]);
      const hit = ctx.dirSet.get(next.toLowerCase());
      if (hit) { segs[i] = basename(hit); acc = hit; } else acc = next;
    }
    return segs.join('/');
  }

  // Find an existing folder that a series belongs in ("excavatorio" -> "Excavatorio/" or "3D Models/Excavatorio/")
  function existingSeriesFolder(series, ctx) {
    let best = null;
    for (const [k, canon] of ctx.dirSet) {
      const depth = k.split('/').length;
      if (depth > 2) continue;
      if (cmpKey(basename(canon)) !== cmpKey(series.label) && normKey(basename(canon)) !== series.key) continue;
      if (depth === 2 && !KNOWN_CATEGORY_KEYS.has(cmpKey(canon.split('/')[0]))) continue;
      if (insideProject(ctx, canon)) continue;
      if (!best || depth < best.depth) best = { path: canon, depth };
    }
    return best ? best.path : null;
  }

  // ---------------------------------------------------------------------------
  // Path sanitising (AI output is never trusted)
  // ---------------------------------------------------------------------------
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const VAGUE = new Set(['root', 'vault', 'files', 'stuff', 'folder', 'newfolder', 'misc', 'miscellaneous', 'unsorted', 'uncategorized', 'loose']);
  function sanitizeFolder(p, maxDepth, fileName) {
    if (p == null) return null;
    let s = String(p).trim().replace(/\\/g, '/');
    if (/^[a-z]:/i.test(s) || s.startsWith('//')) return null;      // absolute paths
    let segs = s.split('/').map(x => x.trim());
    if (segs.some(x => x === '..')) return null;                     // path traversal: don't trust any of it
    // AI sometimes returns the full target incl. a filename
    if (segs.length) {
      const last = segs[segs.length - 1];
      const m = last.match(/\.([a-z0-9]{1,5})$/i);
      if ((fileName && last.toLowerCase() === fileName.toLowerCase()) || (m && EXT_TO_FOLDER[m[1].toLowerCase()])) segs.pop();
    }
    segs = segs.map(seg => seg.replace(/[<>:"|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim())
      .filter(seg => seg && seg !== '.' && !VAGUE.has(normKey(seg)));
    segs = segs.map(seg => (RESERVED.test(seg) ? seg + '_' : seg).slice(0, 64));
    // drop consecutive duplicate segments: "Documents/Documents"
    segs = segs.filter((seg, i) => i === 0 || cmpKey(seg) !== cmpKey(segs[i - 1]));
    if (maxDepth) segs = segs.slice(0, maxDepth);
    return segs.join('/');
  }

  // ---------------------------------------------------------------------------
  // Plan builder
  // ---------------------------------------------------------------------------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DEFAULTS = { seriesMin: 2, maxDepth: 3, useExisting: true, collapseSingles: true, rules: [], neverMove: [], categoryNames: {}, aiInstructions: '',
    depth: 'smart', keepFolders: [], openFolders: [] };

  // ---------------------------------------------------------------------------
  // Folders inside the vault: which ones are "bundles" (component pieces that must
  // stay together), which are generic buckets Onyx may re-sort, and which are the
  // user's own named groups.
  // ---------------------------------------------------------------------------
  const extSet = s => new Set(s.split(' '));
  const CODE_EXTS = extSet('js mjs cjs ts tsx jsx py pyw java go rs cpp cc c h hpp cs rb php swift kt lua sh bat cmd ps1 r scala dart sql gd gdshader wasm vue svelte');
  const WEB_EXTS = extSet('js mjs ts css scss sass less wasm');
  const CONFIG_EXTS = extSet('json xml yaml yml toml ini cfg conf env lock map plist');
  const MODEL_EXTS = extSet('obj fbx stl blend gltf glb dae 3ds max ma mb c4d usd usdz usda ply 3mf');
  const TEXTURE_EXTS = extSet('mtl png jpg jpeg tga dds exr hdr tif tiff bmp ktx bin');
  const APP_EXTS = extSet('dll pak dat asar so dylib jar node');
  const MUSIC_PROJECT_EXTS = extSet('als flp logicx ptx aup3 rpp cpr band song sesx');
  const GENERIC_DIR_KEYS = new Set(('documents document docs doc images image pictures picture pics pic photos photo videos video movies movie clips ' +
    'music audio sounds sound songs downloads download files file misc miscellaneous other others stuff random new newfolder untitled untitledfolder folder ' +
    'desktop archives archive compressed zips spreadsheets presentations pdfs pdf scans screenshots installers setups setup programs software ' +
    'fonts ebooks books 3dmodels models design graphics wallpapers temp tmp unsorted uncategorized sort tosort inbox dump junk loosefiles').split(' ').map(cmpKey));
  const DUMP_KEYS = new Set(['downloads', 'download', 'desktop', 'documents', 'document', 'mydocuments', 'newfolder', 'untitledfolder', 'misc', 'miscellaneous', 'stuff', 'temp', 'tmp', 'unsorted', 'other', 'others', 'random', 'files', 'inbox']);
  function dirKey(name) { return cmpKey(String(name).replace(/\s*\(\d+\)$/, '').replace(/[\s_-]+\d+$/, '')); }

  function classifyDirs(files, dirs, st, ctx) {
    st = Object.assign({}, DEFAULTS, st || {});
    ctx = ctx || buildContext(files, dirs);
    // type buckets (Images, Documents, Installers…) are generic; purpose folders (School, Work, Finance…) are the user's groupings
    const genericKeys = new Set(GENERIC_DIR_KEYS);
    for (const [f] of TYPE_FOLDERS) for (const s of f.split('/')) genericKeys.add(cmpKey(s));
    const info = new Map();
    for (const [k, canon] of ctx.dirSet) info.set(k, { path: canon, files: [] });
    for (const f of files) { const d = dirname(f.path).toLowerCase(); if (d && info.has(d)) info.get(d).files.push(f); }
    const named = (pats, name) => (pats || []).some(p => { p = String(p || '').trim(); return p && (/[*?]/.test(p) ? globToRegex(p).test(name) : p.toLowerCase() === name.toLowerCase()); });
    const out = new Map();
    for (const [k, inf] of info) {
      const name = basename(inf.path);
      const F = inf.files;
      const exts = new Set(F.map(f => f.extension));
      const n = set => F.filter(f => set.has(f.extension)).length;
      const any = set => [...exts].some(x => set.has(x));
      const codeKinds = new Set(F.filter(f => CODE_EXTS.has(f.extension) || WEB_EXTS.has(f.extension)).map(f => f.extension)).size;
      // stems that appear with several different extensions (model.obj + model.mtl, beat.flp + beat.wav)
      const stems = new Map();
      for (const f of F) { const b = splitExt(f.name).base.toLowerCase(); if (!stems.has(b)) stems.set(b, new Set()); stems.get(b).add(f.extension); }
      const sharedStems = [...stems.values()].filter(s => s.size >= 2).length;
      let kind = 'named', why = 'Your own folder';
      if (named(st.keepFolders, name)) { kind = 'bundle'; why = 'you marked it to keep together'; }
      else if (named(st.openFolders, name)) { kind = 'generic'; why = 'you allowed reorganizing inside it'; }
      else if (ctx.projectDirs.has(k)) { kind = 'bundle'; why = 'project folder'; }
      // Downloads, Desktop, Documents, New folder…: dumping grounds, never a bundle just because a model sits next to a picture
      else if (DUMP_KEYS.has(dirKey(name)) || VAGUE.has(normKey(name))) { kind = 'generic'; why = 'general-purpose folder'; }
      else if ((exts.has('html') || exts.has('htm')) && any(WEB_EXTS)) { kind = 'bundle'; why = 'web project: HTML with its scripts'; }
      else if (n(CODE_EXTS) >= 2 && (codeKinds >= 2 || any(CONFIG_EXTS))) { kind = 'bundle'; why = 'code project: scripts that work together'; }
      else if (n(CODE_EXTS) >= 3) { kind = 'bundle'; why = 'code project: scripts that work together'; }
      else if (exts.has('exe') && any(APP_EXTS)) { kind = 'bundle'; why = 'app or game files'; }
      else if (any(MODEL_EXTS) && (exts.has('mtl') || n(TEXTURE_EXTS) >= 1)) { kind = 'bundle'; why = '3D model with its textures'; }
      else if (any(MUSIC_PROJECT_EXTS)) { kind = 'bundle'; why = 'music project'; }
      else if (sharedStems >= 2) { kind = 'bundle'; why = 'files that belong together'; }
      else if (genericKeys.has(dirKey(name)) || VAGUE.has(normKey(name))) { kind = 'generic'; why = 'general-purpose folder'; }
      out.set(k, { path: inf.path, kind, why, root: inf.path });
    }
    // a bundle includes everything below it
    const keys = [...out.keys()].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const k of keys) {
      const parent = dirname(k);
      const pk = parent && out.get(parent);
      if (pk && pk.kind === 'bundle') { const me = out.get(k); me.kind = 'bundle'; me.why = pk.why; me.root = pk.root; }
    }
    return out;
  }

  // null = Onyx may move this file; otherwise the reason it stays
  function nestedKeepReason(f, kinds, st) {
    if (isLoose(f)) return null;
    const chain = [];
    let p = dirname(f.path);
    while (p) { chain.unshift(p); p = dirname(p); }
    for (const d of chain) {
      const k = kinds.get(d.toLowerCase());
      if (k && k.kind === 'bundle') return 'Kept together in “' + basename(k.root) + '” (' + k.why + ')';
    }
    if (st.depth === 'top') return 'Already in ' + chain[0] + '/';
    if (st.depth !== 'all') {
      for (const d of chain) {
        const k = kinds.get(d.toLowerCase());
        if (!k || k.kind === 'named') return 'Inside your folder “' + basename(d) + '”';
      }
    }
    return null;
  }
  function sameFamily(a, b) {
    const ka = cmpKey(a), kb = cmpKey(b);
    if (ka === kb) return true;
    for (const [k, list] of Object.entries(CATEGORY_SYNONYMS)) {
      const fam = list.concat([k]).map(cmpKey);
      if (fam.includes(ka) && fam.includes(kb)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // User customization: rules, never-move list, category names
  // ---------------------------------------------------------------------------
  const RULE_TYPES = {
    contains: 'Name contains', starts: 'Name starts with', ends: 'Name ends with', pattern: 'Name matches pattern',
    ext: 'Extension is', larger: 'Larger than (MB)', older: 'Older than (days)',
  };
  function globToRegex(p) {
    return new RegExp('^' + String(p).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  }
  function listOf(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
  function ruleMatches(rule, f, now) {
    if (!rule || rule.enabled === false || !rule.folder) return false;
    const name = f.name.toLowerCase(), base = splitExt(f.name).base.toLowerCase();
    const vals = listOf(rule.value).map(s => s.toLowerCase());
    switch (rule.type) {
      case 'contains': return vals.some(v => name.includes(v));
      case 'starts': return vals.some(v => base.startsWith(v) || name.startsWith(v));
      case 'ends': return vals.some(v => base.endsWith(v) || name.endsWith(v));
      case 'pattern': return vals.some(v => globToRegex(v).test(f.name));
      case 'ext': return vals.map(v => v.replace(/^\./, '')).includes(f.extension);
      case 'larger': { const mb = parseFloat(rule.value); return !isNaN(mb) && f.size > mb * 1048576; }
      case 'older': { const d = parseFloat(rule.value); return !isNaN(d) && f.lastModified < (now || Date.now()) - d * 86400000; }
    }
    return false;
  }
  function describeRule(rule) {
    const t = RULE_TYPES[rule.type] || rule.type;
    return 'Your rule: ' + t.charAt(0).toLowerCase() + t.slice(1) + ' “' + rule.value + '”';
  }
  function userRuleFor(f, st) {
    for (const r of st.rules || []) if (ruleMatches(r, f)) return r;
    return null;
  }
  function neverMoveMatch(f, st) {
    for (const p of st.neverMove || []) {
      const s = String(p || '').trim(); if (!s) continue;
      if (/[*?]/.test(s) ? globToRegex(s).test(f.name) : s.toLowerCase() === f.name.toLowerCase()) return s;
    }
    return null;
  }
  function renameCategory(folder, st) {
    const map = st.categoryNames || {};
    if (!folder) return folder;
    const segs = folder.split('/');
    const full = map[folder];
    if (full && String(full).trim()) return sanitizeFolder(full, 4) || folder;
    const top = map[segs[0]];
    if (top && String(top).trim()) segs[0] = sanitizeFolder(top, 1) || segs[0];
    return segs.join('/');
  }
  // every built-in folder name a user might want to rename
  const CATEGORY_LIST = (() => {
    const s = new Set();
    for (const [f] of TYPE_FOLDERS) s.add(f.split('/')[0]);
    for (const r of KEYWORD_RULES) s.add(r.folder.split('/')[0]);
    s.add('Other');
    return [...s].sort((a, b) => a.localeCompare(b));
  })();

  function isLoose(f) { return !f.path.includes('/'); }

  /**
   * opts: { files, dirs, strategy, settings, aiFolders: {path: folder} }
   */
  function buildPlan(opts) {
    const files = opts.files || [];
    const strategy = opts.strategy || 'rules';
    const st = Object.assign({}, DEFAULTS, opts.settings || {});
    const ai = opts.aiFolders || null;
    const ctx = buildContext(files, opts.dirs);
    const kinds = classifyDirs(files, opts.dirs, st, ctx);
    ctx.kinds = kinds;
    const items = [];
    const assign = new Map(); // path -> {folder, reason, source}

    // --- flatten is its own thing (bundles stay intact)
    if (strategy === 'flatten') {
      for (const f of files) {
        const keep = untouchableReason(f);
        const bundle = !isLoose(f) && nestedKeepReason(f, kinds, Object.assign({}, st, { depth: 'all' }));
        if (isLoose(f) || keep) items.push(item(f, f.path, keep || 'Already at top level', 'keep'));
        else if (bundle) items.push(item(f, f.path, bundle, 'keep'));
        else items.push(item(f, f.name, 'Pulled up from ' + dirname(f.path), 'move'));
      }
      return finish(items, ctx, strategy);
    }

    const loose = [];   // every file Onyx may place: top-level files plus files in generic folders
    for (const f of files) {
      const keep = untouchableReason(f);
      const nested = nestedKeepReason(f, kinds, st);
      const never = nested ? null : neverMoveMatch(f, st);
      if (nested) items.push(item(f, f.path, nested, 'keep'));
      else if (keep) items.push(item(f, f.path, keep, 'keep'));
      else if (never) items.push(item(f, f.path, 'On your never-move list (' + never + ')', 'keep'));
      else loose.push(f);
    }

    // --- per-file folder
    for (const f of loose) {
      let a;
      if (strategy === 'type') a = { folder: typeFolder(f.extension), reason: f.extension ? '.' + f.extension + ' file' : 'No extension', src: 'type' };
      else if (strategy === 'date') {
        const d = new Date(f.lastModified);
        const m = d.getMonth();
        a = { folder: d.getFullYear() + '/' + String(m + 1).padStart(2, '0') + ' ' + MONTHS[m], reason: 'Modified ' + d.toISOString().slice(0, 10), src: 'date' };
      } else if (strategy === 'size') {
        const s = f.size;
        const folder = s < 1048576 ? 'Small (under 1 MB)' : s < 10485760 ? 'Medium (1–10 MB)' : s < 1073741824 ? 'Large (10 MB–1 GB)' : 'Huge (over 1 GB)';
        a = { folder, reason: 'Size', src: 'size' };
      } else if (strategy === 'tags') {
        const t = f.tagPrimary;
        a = t ? { folder: sanitizeFolder(t.split('/').map(seg => titleCase(seg.replace(/-/g, ' '))).join('/'), 3) || '', reason: 'Tagged #' + t, src: 'tag' }
          : { folder: '', reason: 'No tags yet', src: 'tag' };
      } else {
        const r = ruleFolder(f);
        a = { folder: r.folder, reason: r.reason, src: 'rules' };
        if (strategy === 'smart' && ai && ai[f.path] != null) {
          const clean = sanitizeFolder(ai[f.path], st.maxDepth, f.name);
          // ignore AI answers that would drop files into a project/app folder
          const resolved = clean && (ctx.dirSet.get(clean.toLowerCase()) || clean);
          if (clean && !insideProject(ctx, resolved)) a = { folder: clean, reason: 'Placed by AI', src: 'ai' };
        }
      }
      if (a.src === 'rules' || a.src === 'type') a.folder = renameCategory(a.folder, st);
      // the user's own rules always win
      const ur = userRuleFor(f, st);
      if (ur) {
        const folder = sanitizeFolder(ur.folder, 4);
        if (folder) a = { folder, reason: describeRule(ur), src: 'rule', user: true };
      }
      assign.set(f.path, a);
    }

    // --- keep series together, in their own subfolder
    if (strategy === 'smart' || strategy === 'rules' || strategy === 'type') {
      const series = detectSeries(loose.filter(f => !assign.get(f.path).user), st.seriesMin);
      for (const g of series.values()) {
        let target = st.useExisting ? existingSeriesFolder(g, ctx) : null;
        if (!target) {
          const counts = new Map();
          for (const f of g.files) { const k = assign.get(f.path).folder; counts.set(k, (counts.get(k) || 0) + 1); }
          const parent = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
          const leaf = basename(parent);
          target = cmpKey(leaf) === cmpKey(g.label) || normKey(leaf) === g.key ? parent : joinPath(parent, g.label);
          target = sanitizeFolder(target, st.maxDepth + 1);
        }
        for (const f of g.files) {
          const a = assign.get(f.path);
          assign.set(f.path, { folder: target, reason: 'Series of ' + g.files.length + ' “' + g.label + '” files', src: a.src, series: true });
        }
      }
    }

    // --- map onto existing folders, keep out of projects
    for (const f of loose) {
      const a = assign.get(f.path);
      if (st.useExisting && strategy !== 'date' && strategy !== 'size') {
        a.folder = resolveExisting(a.folder, ctx, { loose: a.src !== 'ai' && !a.series && !a.user });
      }
      if (a.folder && insideProject(ctx, a.folder)) {
        a.folder = joinPath('Loose Files', a.folder);
        a.reason += ' (kept out of a project folder)';
      }
    }

    // --- avoid single-file subfolders we invent
    if (st.collapseSingles && strategy !== 'date' && strategy !== 'size' && strategy !== 'tags') {
      for (let pass = 0; pass < 2; pass++) {
        const counts = new Map();
        for (const a of assign.values()) { let p = a.folder; while (p) { counts.set(p.toLowerCase(), (counts.get(p.toLowerCase()) || 0) + 1); p = dirname(p); } }
        for (const a of assign.values()) {
          if (a.series || a.user) continue;
          const k = a.folder.toLowerCase();
          if (!k.includes('/')) continue;
          if (ctx.dirSet.has(k)) continue;
          if (counts.get(k) === 1) a.folder = dirname(a.folder);
        }
      }
    }

    for (const f of loose) {
      const a = assign.get(f.path);
      const parent = dirname(f.path);
      if (parent && a.folder && !a.user && (a.folder.toLowerCase() === parent.toLowerCase() || a.folder.split('/').some(s => sameFamily(s, basename(parent))))) {
        items.push(item(f, f.path, 'Already in a fitting folder', 'keep')); continue;
      }
      if (!a.folder) items.push(item(f, f.path, strategy === 'tags' ? 'No tags yet, so it stays put' : isLoose(f) ? 'Stays at top level' : 'Stays where it is', 'keep'));
      else items.push(Object.assign(item(f, a.folder + '/' + f.name, a.reason, 'move'), { by: a.src }));
    }
    return finish(items, ctx, strategy);
  }

  function item(f, target, reason, kind) {
    return { source: f.path, name: f.name, size: f.size, extension: f.extension, target, reason, kind, skip: false };
  }

  function finish(items, ctx, strategy) {
    // 1. Consistent casing of folder names inside the plan
    const canon = new Map();
    for (const [k, v] of ctx.dirSet) canon.set(k, v);
    for (const it of items) {
      if (it.kind !== 'move') continue;
      const segs = dirname(it.target).split('/').filter(Boolean);
      let acc = '';
      for (let i = 0; i < segs.length; i++) {
        const next = joinPath(acc, segs[i]);
        const hit = canon.get(next.toLowerCase());
        if (hit) { segs[i] = basename(hit); acc = hit; } else { canon.set(next.toLowerCase(), next); acc = next; }
      }
      it.target = joinPath(segs.join('/'), basename(it.target));
    }
    // 2. A folder can't share a name with a file that is staying put
    const stayingFiles = new Set(items.filter(i => i.kind !== 'move').map(i => i.source.toLowerCase()));
    for (const it of items) {
      if (it.kind !== 'move') continue;
      const segs = dirname(it.target).split('/');
      let acc = '';
      for (let i = 0; i < segs.length; i++) {
        acc = joinPath(acc, segs[i]);
        if (stayingFiles.has(acc.toLowerCase())) { segs[i] = segs[i] + ' Folder'; acc = joinPath(dirname(acc), segs[i]); }
      }
      it.target = joinPath(segs.join('/'), basename(it.target));
    }
    // 3. Never collide with anything: staying files, dirs, or each other
    const taken = new Set(stayingFiles);
    for (const k of ctx.dirSet.keys()) taken.add(k);
    for (const it of items) {
      if (it.kind !== 'move') continue;
      if (it.target.toLowerCase() === it.source.toLowerCase()) { it.kind = 'keep'; taken.add(it.target.toLowerCase()); continue; }
      let t = it.target;
      const dir = dirname(t);
      const { base, ext } = splitExt(basename(t));
      let n = 2;
      while (taken.has(t.toLowerCase())) { t = joinPath(dir, base + ' (' + n + ')' + (ext ? '.' + ext : '')); n++; }
      if (t !== it.target) it.reason += ' · renamed to avoid a clash';
      it.target = t;
      taken.add(t.toLowerCase());
    }
    // stats
    const moving = items.filter(i => i.kind === 'move');
    const newFolders = new Set();
    for (const it of moving) { let p = dirname(it.target); while (p) { if (!ctx.dirSet.has(p.toLowerCase())) newFolders.add(p); p = dirname(p); } }
    const intoExisting = moving.filter(i => ctx.dirSet.has(dirname(i.target).toLowerCase())).length;
    return {
      strategy, items,
      newFolders: [...newFolders].sort(),
      stats: { moving: moving.length, kept: items.length - moving.length, newFolders: newFolders.size, intoExisting },
      rootMarkers: ctx.rootMarkers,
      folderKinds: ctx.kinds ? Object.fromEntries([...ctx.kinds.values()].map(v => [v.path, { kind: v.kind, why: v.why, root: v.root }])) : {},
    };
  }

  // ---------------------------------------------------------------------------
  // AI prompt + response handling
  // ---------------------------------------------------------------------------
  const AI_SYSTEM = [
    'You organise a messy folder on someone\'s computer. You get the files that need a home (id, current path, size,',
    'last-modified date): some are loose at the top level, some sit in general-purpose folders like "Documents" or "New folder".',
    'You also get the folders that already exist. Choose a destination folder (relative to the top level) for each file.',
    '',
    'Rules:',
    '1. Answer with a folder path only, never the file name. Use "/" between levels, at most 3 levels deep. Never rename files.',
    '2. Reuse an existing folder (exact spelling) when a file clearly belongs in it. Never put files inside a folder marked [keep together]:',
    '   those are self-contained projects, apps, games or assets. A file can stay where it is: answer its current folder.',
    '3. Group by what the file is for (a project, a subject, finances, work, school, travel...) when the name gives a clue.',
    '   Use type folders (Images, Videos, Audio, Documents, 3D Models, Installers, Archives, Code) only when it does not.',
    '4. Files given as a SERIES belong together: send every file of a series to the same folder, named after the series',
    '   and nested in a sensible parent, e.g. "3D Models/Excavatorio".',
    '5. Clear Title Case names, plural for collections (Invoices, Screenshots). No vague names like Files, Stuff, Misc, Other, New Folder.',
    '6. Keep it tidy: aim for 4-10 top-level folders; avoid a subfolder that would hold just one file.',
    '7. Reply with strict JSON only, no prose and no code fences:',
    '   {"folders": {"<id>": "<folder path>", ...}, "summary": "<one or two plain sentences about the structure you chose>"}',
    '   Include every id.',
  ].join('\n');

  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  function aiBatches(files, dirs, settings, batchSize) {
    const st = Object.assign({}, DEFAULTS, settings || {});
    const ctx = buildContext(files, dirs);
    const kinds = classifyDirs(files, dirs, st, ctx);
    const loose = files.filter(f => !nestedKeepReason(f, kinds, st) && !untouchableReason(f) && !neverMoveMatch(f, st) && !userRuleFor(f, st));
    const series = detectSeries(loose, st.seriesMin);
    const extra = String(st.aiInstructions || '').trim().slice(0, 2000);
    const system = extra ? AI_SYSTEM + '\n\nThe user\'s own preferences (follow them whenever they apply; they override rules 3, 5 and 6):\n' + extra : AI_SYSTEM;
    const seriesOf = new Map();
    for (const g of series.values()) for (const f of g.files) seriesOf.set(f.path, g);

    const dirLines = [];
    const sortedDirs = [...ctx.dirSet.values()].sort((a, b) => a.localeCompare(b));
    for (const d of sortedDirs) {
      const depth = d.split('/').length;
      if (depth > 3) continue;
      const kd = kinds.get(d.toLowerCase());
      if (kd && kd.kind === 'bundle' && kd.root.toLowerCase() !== d.toLowerCase()) continue;   // inside a bundle
      const tag = kd && kd.kind === 'bundle' ? ' [keep together]' : '';
      dirLines.push('- ' + d + '/  (' + (ctx.fileCount.get(d.toLowerCase()) || 0) + ' files)' + tag);
      if (dirLines.length >= 150) { dirLines.push('- ...'); break; }
    }

    // keep series members in the same batch
    const ordered = [];
    const seen = new Set();
    for (const f of loose) {
      if (seen.has(f.path)) continue;
      const g = seriesOf.get(f.path);
      if (g) for (const m of g.files) { ordered.push(m); seen.add(m.path); }
      else { ordered.push(f); seen.add(f.path); }
    }
    const size = batchSize || 120;
    const batches = [];
    for (let i = 0; i < ordered.length; i += size) batches.push(ordered.slice(i, i + size));

    return batches.map(batch => {
      const ids = batch.map(f => f.path);
      const lines = batch.map((f, i) => (i + 1) + '. ' + f.path + '  (' + fmtSize(f.size) + ', ' + new Date(f.lastModified).toISOString().slice(0, 10) + ')');
      const sLines = [];
      for (const g of series.values()) {
        const memberIds = g.files.map(f => ids.indexOf(f.path) + 1).filter(n => n > 0);
        if (memberIds.length) sLines.push('- "' + g.label + '": ids ' + memberIds.join(', '));
      }
      return {
        ids,
        system,
        user: (u) => [
          'EXISTING FOLDERS:', dirLines.length ? dirLines.join('\n') : '(none)',
          u && u.length ? '\nFOLDERS YOU ALREADY USED FOR OTHER FILES (reuse where they fit):\n' + u.map(x => '- ' + x).join('\n') : '',
          sLines.length ? '\nSERIES:\n' + sLines.join('\n') : '',
          '\nFILES TO PLACE (' + batch.length + '):', lines.join('\n'),
        ].filter(Boolean).join('\n'),
      };
    });
  }

  function parseAiResponse(text, ids) {
    // reasoning models (Qwen3, DeepSeek R1…) may prepend <think>…</think>
    let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    let obj = null;
    try { obj = JSON.parse(s); } catch (e) {
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a >= 0 && b > a) { try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e2) { obj = null; } }
    }
    if (!obj || typeof obj !== 'object') throw new Error('AI reply was not valid JSON');
    const map = obj.folders || obj.suggestions || {};
    const out = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== 'string') continue;
      const n = parseInt(k, 10);
      if (n >= 1 && n <= ids.length) out[ids[n - 1]] = v;
      else if (ids.includes(k)) out[k] = v;   // model echoed the name instead of the id
    }
    return { folders: out, summary: typeof obj.summary === 'string' ? obj.summary : (obj.reasoning || '') };
  }

  return {
    buildPlan, aiBatches, parseAiResponse, sanitizeFolder, seriesStem, detectSeries, ruleFolder,
    RULE_TYPES, CATEGORY_LIST, ruleMatches, globToRegex, joinPath, classifyDirs, nestedKeepReason,
    typeFolder, untouchableReason, buildContext, splitExt, dirname, basename, fmtSize, DEFAULTS,
    typeGroup, titleCase, nameTexts, hasKeyword, keywordFolder, KEYWORD_RULES, MEDIA_RULES, CONTENT_GROUPS, MEDIA_GROUPS, TYPE_FOLDERS,
  };
});
