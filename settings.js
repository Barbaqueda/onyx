/* Onyx settings window: schema-driven, searchable, live-applied */
(function () {
  'use strict';

  const SECTIONS = [
    { id: 'general', name: 'General', icon: 'settings', desc: 'How Onyx starts and how it confirms things.' },
    { id: 'appearance', name: 'Appearance', icon: 'palette', desc: 'Themes, colors, fonts and how dense the interface feels. Changes apply instantly.' },
    { id: 'layout', name: 'Layout', icon: 'panel-left', desc: 'Which parts of the window you see and where they sit.' },
    { id: 'files', name: 'File explorer', icon: 'files', desc: 'What the file tree shows and how it’s sorted.' },
    { id: 'library', name: 'Library & tags', icon: 'tag', desc: 'Browsing, searching and tagging your files. Tags live in Onyx’s own data folder; your files are never changed.' },
    { id: 'graph', name: 'Graph view', icon: 'git-fork', desc: 'How the graph is drawn. You can also change these from the graph’s Display panel.' },
    { id: 'organizing', name: 'Organizing', icon: 'sparkles', desc: 'How Onyx groups loose files.' },
    { id: 'rules', name: 'My rules', icon: 'list-checks', desc: 'Your own rules always win over Onyx’s and the AI’s choices.' },
    { id: 'ai', name: 'AI provider', icon: 'cpu', desc: 'Used by the AI smart strategy. Only file names, sizes and dates are sent, never file contents.' },
    { id: 'hotkeys', name: 'Hotkeys', icon: 'keyboard', desc: 'Click a shortcut to change it. Press Esc to cancel, Backspace to remove.' },
    { id: 'advanced', name: 'Advanced', icon: 'code', desc: 'Custom CSS, backups of your settings, and resets.' },
    { id: 'about', name: 'About', icon: 'info', desc: '' },
  ];

  let C = null;            // renderer context
  let M = null;            // open modal
  let current = 'appearance';
  let query = '';
  const api = () => C.api;
  const esc = s => C.esc(s);

  // ------------------------------------------------------------------ value access
  function get(path) {
    const [root, a, b] = path.split('.');
    if (root === 'ui') return C.UI()[a][b];
    if (root === 'org') { const v = C.S.settings.organize[a]; return v === undefined ? C.E.DEFAULTS[a] : v; }
    if (root === 'ai') return C.S.settings.ai[a];
  }
  function def(path) {
    const [root, a, b] = path.split('.');
    if (root === 'ui') return C.T.UI_DEFAULTS[a][b];
    if (root === 'org') return C.E.DEFAULTS[a];
    if (root === 'ai') return { provider: 'pollinations', baseUrl: 'https://api.openai.com/v1', model: '' }[a];
  }
  async function set(path, v, opts) {
    const [root, a, b] = path.split('.');
    if (root === 'ui') C.setUi(a, b, v);
    else if (root === 'org') C.setOrg(a, v);
    else if (root === 'ai') { const s = await api().saveSettings({ ai: { [a]: v } }); Object.assign(C.S.settings.ai, s.ai); C.renderAll(); }
    if (!opts || !opts.quiet) redraw();
    else markChanged(path);
  }
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  // ------------------------------------------------------------------ controls
  const ctl = {
    toggle: (k) => { const v = !!get(k); return '<button class="toggle' + (v ? ' is-enabled' : '') + '" role="switch" aria-checked="' + v + '" data-t="toggle" data-k="' + k + '"></button>'; },
    seg: (k, opts) => '<div class="segmented" role="radiogroup">' + opts.map(([v, l]) => '<button role="radio" aria-checked="' + same(get(k), v) + '" data-t="seg" data-k="' + k + '" data-v=\'' + esc(JSON.stringify(v)) + '\' class="' + (same(get(k), v) ? 'is-active' : '') + '">' + l + '</button>').join('') + '</div>',
    select: (k, opts) => '<select class="dropdown" data-t="select" data-k="' + k + '">' + opts.map(([v, l]) => '<option value=\'' + esc(JSON.stringify(v)) + '\'' + (same(get(k), v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>',
    slider: (k, min, max, step, unit) => {
      const v = +get(k); const pct = ((v - min) / (max - min)) * 100;
      return '<div class="slider-wrap"><input type="range" class="slider" data-t="slider" data-k="' + k + '" data-unit="' + (unit || '') + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '" style="--fill:' + pct + '%"><span class="val">' + fmtVal(v, unit) + '</span></div>';
    },
    text: (k, ph, wide) => '<input class="text-input' + (wide ? ' wide' : '') + '" data-t="text" data-k="' + k + '" spellcheck="false" placeholder="' + esc(ph || '') + '" value="' + esc(get(k) || '') + '">',
  };
  function fmtVal(v, unit) { return unit === '%' ? v + '%' : unit === 'px' ? v + 'px' : unit === 's' ? v + 's' : unit === 'x' ? (+v).toFixed(1) + '×' : String(v); }

  // ------------------------------------------------------------------ schema
  function items() {
    const T = C.T, E = C.E;
    const presets = Object.entries(T.allThemes(C.S.settings.ui));
    const fontOpts = Object.entries(T.FONTS).map(([k, [l]]) => [k, l]);
    const monoOpts = Object.entries(T.MONO_FONTS).map(([k, [l]]) => [k, l]);
    const p = get('ai.provider');
    const L = [
      // general
      { s: 'general', k: 'ui.layout.reopenLast', name: 'Reopen last folder on startup', desc: 'Skip the start screen and open the folder you used last.', c: () => ctl.toggle('ui.layout.reopenLast') },
      { s: 'general', k: 'ui.layout.afterOrganize', name: 'After organizing, show', desc: 'Which view opens when a plan is ready.', c: () => ctl.seg('ui.layout.afterOrganize', [['structure', 'Structure'], ['changes', 'Changes'], ['graph', 'Graph']]) },
      { s: 'general', k: 'ui.layout.confirmApply', name: 'Confirm before applying', desc: 'Ask before moving files. You can always undo either way.', c: () => ctl.toggle('ui.layout.confirmApply') },
      { s: 'general', k: 'ui.layout.noticeSeconds', name: 'Notification duration', desc: 'How long messages stay in the top-right corner.', c: () => ctl.slider('ui.layout.noticeSeconds', 2, 15, 1, 's') },

      // appearance
      { s: 'appearance', g: 'Theme', k: 'ui.appearance.mode', name: 'Base color scheme', desc: 'Match system follows Windows’ light or dark setting.', kw: 'dark light mode system', c: () => ctl.seg('ui.appearance.mode', [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']]) },
      { s: 'appearance', g: 'Theme', k: 'ui.appearance.themeDark', name: 'Dark theme', desc: 'Used in dark mode.', kw: 'onyx jet graphite lapis jade amber garnet amethyst preset', stack: true, c: () => themeGrid('ui.appearance.themeDark', presets.filter(([, x]) => x.mode === 'dark')) },
      { s: 'appearance', g: 'Theme', k: 'ui.appearance.themeLight', name: 'Light theme', desc: 'Used in light mode.', kw: 'pearl marble quartz sage preset', stack: true, c: () => themeGrid('ui.appearance.themeLight', presets.filter(([, x]) => x.mode === 'light')) },
      { s: 'appearance', g: 'Theme', k: 'x.themes', name: 'Your color schemes', desc: 'Build your own from scratch, from the current theme, or from just a background and an accent color. Your schemes show up in the theme lists above, marked with a pencil.', kw: 'custom theme colors colour scheme palette editor build create', noReset: true, c: () => '<button class="btn" data-x="theme-new">' + C.icon('plus') + 'New scheme</button><button class="btn" data-x="theme-dup">' + C.icon('copy') + 'Duplicate current</button><button class="btn" data-x="theme-paste">' + C.icon('upload') + 'Paste code</button>' },
      { s: 'appearance', g: 'Theme', k: 'ui.appearance.accent', name: 'Accent color', desc: 'Buttons, highlights and focus rings. Text on buttons switches between black and white automatically so it stays readable.', kw: 'color colour highlight', c: () => accentPicker() },
      { s: 'appearance', g: 'Text', k: 'ui.appearance.zoom', name: 'Interface zoom', desc: 'Scales the whole window. Also Ctrl+= and Ctrl+-.', kw: 'scale size bigger smaller', c: () => ctl.slider('ui.appearance.zoom', 70, 160, 5, '%') },
      { s: 'appearance', g: 'Text', k: 'ui.appearance.fontUi', name: 'Interface font', desc: 'Pick Custom to use any font installed on your PC.', kw: 'typeface', c: () => ctl.select('ui.appearance.fontUi', fontOpts) },
      { s: 'appearance', g: 'Text', k: 'ui.appearance.fontCustom', name: 'Custom font name', desc: 'Exactly as Windows lists it, for example “Calibri” or “JetBrains Mono”.', hidden: () => get('ui.appearance.fontUi') !== 'custom', c: () => ctl.text('ui.appearance.fontCustom', 'Font name') },
      { s: 'appearance', g: 'Text', k: 'ui.appearance.fontMono', name: 'Monospace font', desc: 'Used for paths, code and your CSS snippet.', c: () => ctl.select('ui.appearance.fontMono', monoOpts) },
      { s: 'appearance', g: 'Text', k: 'ui.appearance.readingSize', name: 'Reading text size', desc: 'Text size in the Overview and Proposed structure pages.', c: () => ctl.slider('ui.appearance.readingSize', 12, 20, 1, 'px') },
      { s: 'appearance', g: 'Shape', k: 'ui.appearance.density', name: 'Density', desc: 'Compact fits more rows on screen; Spacious gives everything more room.', kw: 'compact comfortable spacious padding', c: () => ctl.seg('ui.appearance.density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]) },
      { s: 'appearance', g: 'Shape', k: 'ui.appearance.radius', name: 'Corner roundness', desc: 'From sharp edges to soft, rounded corners.', kw: 'radius rounded', c: () => ctl.slider('ui.appearance.radius', 0, 14, 1, 'px') },
      { s: 'appearance', g: 'Shape', k: 'ui.appearance.reduceMotion', name: 'Reduce motion', desc: 'Turns off animations. “Match system” follows Windows’ animation setting.', kw: 'animation accessibility', c: () => ctl.seg('ui.appearance.reduceMotion', [['system', 'Match system'], ['on', 'On'], ['off', 'Off']]) },

      // layout
      { s: 'layout', k: 'ui.layout.ribbon', name: 'Show ribbon', desc: 'The narrow strip of icons on the far left.', c: () => ctl.toggle('ui.layout.ribbon') },
      { s: 'layout', k: 'ui.layout.statusBar', name: 'Show status bar', desc: 'File counts, pending changes, theme and AI status in the bottom corner.', c: () => ctl.toggle('ui.layout.statusBar') },
      { s: 'layout', k: 'x.presets', name: 'Layout', desc: 'Start from a preset. You can also drag any tab to a sidebar, another tab bar, or the edge of a pane to split it. Right-click a tab for the same options.', kw: 'drag dock panel split move window graph swap mirror', stack: true, noReset: true, c: () => presetPicker() },
      { s: 'layout', k: 'x.panels', name: 'Where each panel lives', desc: '', kw: 'files organize graph changes structure sidebar hide', stack: true, noReset: true, c: () => panelPlacer() },
      { s: 'layout', k: 'ui.layout.tabIcons', name: 'Show icons in tabs', desc: '', c: () => ctl.toggle('ui.layout.tabIcons') },
      { s: 'layout', k: 'ui.layout.readableWidth', name: 'Reading width', desc: 'How wide the Overview and Proposed structure pages can get.', kw: 'line length', c: () => ctl.seg('ui.layout.readableWidth', [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide'], ['full', 'Full']]) },

      // files
      { s: 'files', k: 'ui.explorer.sort', name: 'Sort files by', desc: '', c: () => ctl.select('ui.explorer.sort', [['name', 'Name'], ['modified', 'Last modified (newest first)'], ['size', 'Size (largest first)'], ['type', 'File type']]) },
      { s: 'files', k: 'ui.explorer.foldersFirst', name: 'Folders before files', desc: 'Turn off to mix folders and files alphabetically (sorting by name only).', c: () => ctl.toggle('ui.explorer.foldersFirst') },
      { s: 'files', k: 'ui.explorer.tags', name: 'Show file type tags', desc: 'The small PDF, JPG… labels next to file names.', c: () => ctl.toggle('ui.explorer.tags') },
      { s: 'files', k: 'ui.explorer.sizes', name: 'Show file sizes', desc: '', c: () => ctl.toggle('ui.explorer.sizes') },
      { s: 'files', k: 'ui.explorer.moveDots', name: 'Mark files that will move', desc: 'A dot next to files in the current plan.', c: () => ctl.toggle('ui.explorer.moveDots') },
      { s: 'files', k: 'ui.explorer.guides', name: 'Indent guides', desc: 'Vertical lines that show nesting.', c: () => ctl.toggle('ui.explorer.guides') },

      // graph
      { s: 'library', k: 'ui.library.autoTag', name: 'Tag new files automatically', desc: 'When a folder opens, Onyx tags new files from their names: #invoice, #screenshot, #2024, a shared tag for a series. Runs offline and instantly. Tags you remove never come back.', kw: 'auto tag automatic offline rules', c: () => ctl.seg('ui.library.autoTag', [['rules', 'From names'], ['off', 'Off']]) },
      { s: 'library', k: 'x.libai', name: 'Tag with AI', desc: 'AI reads file names (never contents) and adds 1 to 4 tags about topic, project or purpose. It reuses your existing tags. Uses the provider from AI provider.', kw: 'ai tag smart', noReset: true, c: () => '<button class="btn" data-action="lib-ai-untagged">' + C.icon('sparkles') + 'Tag untagged files</button><button class="btn" data-action="lib-clear-auto">' + C.icon('rotate-ccw') + 'Remove automatic tags</button>' },
      { s: 'library', k: 'ui.library.dblClick', name: 'Double-click a file to', desc: 'Enter does the same; Shift+Enter does the other.', kw: 'open reveal double click', c: () => ctl.seg('ui.library.dblClick', [['open', 'Open it'], ['reveal', 'Show it in its folder']]) },
      { s: 'library', k: 'ui.library.thumbs', name: 'Show thumbnails', desc: 'Previews of images, videos and documents in grid view and the details panel, made by Windows.', kw: 'preview thumbnail image', c: () => ctl.toggle('ui.library.thumbs') },
      { s: 'library', k: 'ui.library.treeTags', name: 'Show tags in the file tree', desc: 'Small colored dots next to tagged files in Files.', kw: 'dots tree explorer', c: () => ctl.toggle('ui.library.treeTags') },
      { s: 'library', k: 'ui.library.details', name: 'Show the details panel', desc: 'Preview, tags and properties of the selected file, on the right of the Library.', kw: 'inspector preview panel', c: () => ctl.toggle('ui.library.details') },
      { s: 'graph', k: 'ui.graph.files', name: 'Show files', desc: 'Off shows folders only, which is clearer for big folders.', c: () => ctl.toggle('ui.graph.files') },
      { s: 'graph', k: 'ui.graph.labels', name: 'Show labels', desc: '', c: () => ctl.toggle('ui.graph.labels') },
      { s: 'graph', k: 'ui.graph.colorBy', name: 'Color nodes by', desc: '', c: () => ctl.seg('ui.graph.colorBy', [['folder', 'Top folder'], ['type', 'File type']]) },
      { s: 'graph', k: 'ui.graph.nodeSize', name: 'Node size', desc: '', c: () => ctl.slider('ui.graph.nodeSize', 0.5, 2.5, 0.1, 'x') },
      { s: 'graph', k: 'ui.graph.linkDistance', name: 'Link distance', desc: '', c: () => ctl.slider('ui.graph.linkDistance', 0.4, 2.5, 0.1, 'x') },
      { s: 'graph', k: 'ui.graph.repel', name: 'Repel force', desc: '', c: () => ctl.slider('ui.graph.repel', 0.2, 3, 0.1, 'x') },
      { s: 'graph', k: 'ui.graph.textFade', name: 'Text fade threshold', desc: 'Higher hides labels until you zoom in further.', c: () => ctl.slider('ui.graph.textFade', 0.3, 2.5, 0.1, 'x') },

      // organizing
      { s: 'organizing', k: 'org.depth', name: 'Inside folders', desc: '<b>Smart</b> re-sorts general folders like Documents or New folder and leaves your own named folders alone. <b>Everything</b> re-sorts every folder. Either way, bundles stay together: folders whose files work as one piece, like a web project (HTML with its scripts), a code project, an app or game, a 3D model with its textures, or a music project.', kw: 'nested subfolders deep bundle component', c: () => ctl.seg('org.depth', [['smart', 'Smart'], ['all', 'Everything'], ['top', 'Only loose files']]) },
      { s: 'organizing', k: 'org.seriesMin', name: 'Series folder threshold', desc: 'Files like <code>excavatorio1.obj</code>, <code>excavatorio2.obj</code> get their own folder once there are this many.', c: () => ctl.select('org.seriesMin', [2, 3, 4, 5].map(n => [n, String(n)])) },
      { s: 'organizing', k: 'org.maxDepth', name: 'Maximum folder depth', desc: 'How many levels deep new folders can go.', c: () => ctl.select('org.maxDepth', [1, 2, 3, 4].map(n => [n, String(n)])) },
      { s: 'organizing', k: 'org.useExisting', name: 'Use folders that already exist', desc: 'A loose tax return goes into your <code>Taxes</code> folder; images go to <code>Photos</code> if that’s what you call it.', c: () => ctl.toggle('org.useExisting') },
      { s: 'organizing', k: 'org.collapseSingles', name: 'Avoid single-file folders', desc: 'Don’t create a subfolder that would hold just one file.', c: () => ctl.toggle('org.collapseSingles') },
      { s: 'organizing', k: 'org.categoryNames', name: 'Folder names', desc: 'Rename Onyx’s built-in folders. Leave a field empty to keep the default. You can nest, for example <code>Media/Images</code>.', kw: 'rename category images pictures', stack: true, c: () => categoryEditor(), custom: true },

      // rules
      { s: 'rules', k: 'org.rules', name: 'Rules', desc: 'Checked top to bottom; the first match wins. Tip: right-click any file in a plan and choose <b>Always put files like this in…</b>', kw: 'custom rule contains extension pattern', stack: true, c: () => rulesEditor(), custom: true },
      { s: 'rules', k: 'org.keepFolders', name: 'Always keep these folders together', desc: 'Folder names or patterns. Onyx never splits them up, even if they don’t look like a bundle. Tip: right-click a folder in the file tree.', kw: 'bundle component project', stack: true, c: () => chipEditor('org.keepFolders', 'e.g. excavatorio-modular or *-project'), custom: true },
      { s: 'rules', k: 'org.openFolders', name: 'Always let Onyx sort inside these folders', desc: 'For folders Onyx would otherwise keep together or leave alone.', kw: 'bundle open sort inside', stack: true, c: () => chipEditor('org.openFolders', 'e.g. Downloads (2)'), custom: true },
      { s: 'rules', k: 'org.neverMove', name: 'Never move', desc: 'Exact file names, or patterns like <code>*.lnk</code> or <code>Screenshot*</code>.', kw: 'exclude ignore skip', stack: true, c: () => neverEditor(), custom: true },

      // ai
      { s: 'ai', k: 'ai.provider', name: 'Provider', desc: '', c: () => '<select class="dropdown" data-t="select" data-k="ai.provider">' + Object.entries(C.S.settings.providers).map(([k, v]) => '<option value=\'' + esc(JSON.stringify(k)) + '\'' + (k === p ? ' selected' : '') + '>' + esc(v.label) + '</option>').join('') + '</select>' },
      { s: 'ai', k: 'ai.baseUrl', name: 'API base URL', desc: 'Any OpenAI-compatible endpoint: OpenAI, OpenRouter, Groq, LM Studio (<code>http://localhost:1234/v1</code>) or Ollama (<code>http://localhost:11434/v1</code>).', hidden: () => p !== 'openai', c: () => ctl.text('ai.baseUrl', 'https://api.openai.com/v1') },
      { s: 'ai', k: 'ai.model', name: 'Model', desc: 'Leave empty for the default' + ((C.S.settings.providers[p] || {}).model ? ' (<code>' + esc(C.S.settings.providers[p].model) + '</code>)' : '') + '.' + (p === 'freeai' ? ' free.ai has hundreds of models; the model page on free.ai lists their IDs. Bigger models give better folder names but use more of your monthly calls.' : ''), hidden: () => p === 'off' || p === 'pollinations', c: () => ctl.text('ai.model', (C.S.settings.providers[p] || {}).model || '') },
      { s: 'ai', k: 'ai.key', name: 'API key', desc: C.S.settings.ai.hasKey ? 'A key is saved and encrypted on this computer. Type a new one to replace it, or clear the field to remove it.' : 'Stored encrypted on this computer and only sent to the provider you picked.', hidden: () => p !== 'openai' && p !== 'anthropic' && p !== 'freeai', c: () => '<input class="text-input" type="password" id="sKey" spellcheck="false" placeholder="' + (C.S.settings.ai.hasKey ? '•••••••• saved' : 'Paste key') + '" aria-label="API key">', noReset: true },
      { s: 'ai', k: 'ai.test', name: 'Test connection', desc: 'Sends a tiny request to check the provider answers.', c: () => '<span class="test-result" id="sTestRes"></span><button class="btn" id="sTest"' + (p === 'off' ? ' disabled' : '') + '>Test</button>', noReset: true },
      { s: 'ai', k: 'org.aiInstructions', name: 'Extra instructions for the AI', desc: 'Plain-language preferences the AI should follow, like “Keep all Minecraft files in Games/Minecraft” or “Use Spanish folder names”.', kw: 'prompt preferences', stack: true, c: () => '<textarea class="textarea prose" data-t="textarea" data-k="org.aiInstructions" placeholder="One preference per line">' + esc(get('org.aiInstructions') || '') + '</textarea>' },

      // hotkeys
      { s: 'hotkeys', k: 'ui.hotkeys', name: 'Shortcuts', desc: '', stack: true, c: () => hotkeysEditor(), custom: true, noReset: true },

      // advanced
      { s: 'advanced', k: 'ui.appearance.cssEnabled', name: 'Use custom CSS', desc: 'Apply the snippet below on top of the theme.', kw: 'style snippet', c: () => ctl.toggle('ui.appearance.cssEnabled') },
      { s: 'advanced', k: 'ui.appearance.cssSnippet', name: 'CSS snippet', desc: 'Every color is a variable you can override, for example <code>body { --accent: #ff8a00; }</code> or <code>.tree-item-self { font-size: 14px; }</code>. Changes apply as you type.', kw: 'style theme variables', stack: true, c: () => '<textarea class="textarea" data-t="textarea" data-k="ui.appearance.cssSnippet" spellcheck="false" placeholder="/* your CSS */">' + esc(get('ui.appearance.cssSnippet') || '') + '</textarea>' },
      { s: 'advanced', k: 'x.backup', name: 'Back up settings', desc: 'Export everything except your API key to a file, or load a file you exported before.', kw: 'export import json backup', c: () => '<button class="btn" data-x="export">' + C.icon('download') + 'Export…</button><button class="btn" data-x="import">' + C.icon('upload') + 'Import…</button>', noReset: true },
      { s: 'advanced', k: 'x.reset', name: 'Reset', desc: 'Put appearance, layout, hotkeys and explorer settings back to how Onyx ships. Your rules and AI settings are kept.', kw: 'defaults factory', c: () => '<button class="btn" data-x="reset-ui">Reset look and layout</button>', noReset: true },
      { s: 'advanced', k: 'x.resetOrg', name: 'Reset organizing', desc: 'Clear your rules, never-move list, folder names and organizing options.', c: () => '<button class="btn mod-warning" data-x="reset-org">Reset organizing</button>', noReset: true },

      // about
      { s: 'about', k: 'x.about', name: '', desc: '', stack: true, noReset: true, c: () => '<div class="about-logo"><img src="icon.png" alt=""><div><div class="n">Onyx</div><div class="v">Version ' + esc(C.S.settings.version || '') + '</div></div></div>' +
        '<p style="color:var(--text-muted);line-height:1.6">Onyx proposes a tidy folder structure for a messy folder and only moves files after you review the plan.</p>' +
        '<ul><li>Only loose files at the top level are moved; your folders stay put.</li><li>Every apply can be undone from the sidebar.</li><li>Your API key is encrypted with your Windows account.</li><li>Press ' + kbd('palette') + ' for every command, ' + kbd('toggle-mode') + ' to flip light and dark.</li></ul>' },
    ];
    return L;
  }
  function kbd(id) { const l = C.hotkeyLabel(C.effectiveHotkey(id)); return l ? '<kbd>' + esc(l) + '</kbd>' : ''; }

  // ------------------------------------------------------------------ custom controls
  function themeGrid(k, list) {
    const cur = get(k);
    return '<div class="theme-grid">' + list.map(([id, p]) => {
      const accent = id === cur && get('ui.appearance.accent') ? get('ui.appearance.accent') : p.accent;
      const tools = p.custom ? '<span class="tc-tools"><span data-x="theme-edit" data-id="' + id + '" data-tip="Edit" role="button" aria-label="Edit ' + esc(p.name) + '">' + C.icon('pencil') + '</span><span data-x="theme-del" data-id="' + id + '" data-tip="Delete" role="button" aria-label="Delete ' + esc(p.name) + '">' + C.icon('trash') + '</span></span>' : '';
      return '<div class="theme-card' + (id === cur ? ' is-active' : '') + '" role="button" tabindex="0" data-t="theme" data-k="' + k + '" data-v="' + id + '" aria-pressed="' + (id === cur) + '" aria-label="' + esc(p.name + ' theme') + '" style="background:' + p.bg2 + '">' +
        '<div class="tc-preview" style="background:' + p.bg + '"><div class="tc-side" style="background:' + p.bg2 + ';border-right:1px solid ' + p.border + '"></div>' +
        '<div class="tc-main"><div class="tc-line" style="width:70%;background:' + p.text + '"></div><div class="tc-line" style="width:50%;background:' + p.muted + '"></div><div class="tc-line" style="width:60%;background:' + p.faint + '"></div><div class="tc-btn" style="background:' + accent + '"></div></div></div>' +
        '<div class="tc-name" style="color:' + p.text + ';border-top:1px solid ' + p.border + '"><span>' + esc(p.name) + '</span>' + (tools || (id === cur ? C.icon('check') : '')) + '</div></div>';
    }).join('') + '<button class="theme-new" data-x="theme-new" data-mode="' + (k.endsWith('Light') ? 'light' : 'dark') + '">' + C.icon('plus') + 'Build your own</button></div>';
  }
  function accentPicker() {
    const cur = get('ui.appearance.accent') || '';
    const theme = C.T.resolve(C.S.settings.ui).p;
    const custom = cur && !C.T.ACCENTS.some(([v]) => v === cur);
    return '<div class="swatches">' + C.T.ACCENTS.map(([v, l]) => '<button class="swatch' + (v ? '' : ' default') + (v === cur ? ' is-active' : '') + '" data-t="seg" data-k="ui.appearance.accent" data-v=\'' + JSON.stringify(v) + '\' data-tip="' + esc(l) + '" aria-label="' + esc(l) + '" style="background:' + (v || theme.accent) + '"></button>').join('') +
      '<input type="color" class="color-input" data-t="color" data-k="ui.appearance.accent" value="' + (cur || theme.accent) + '" aria-label="Custom accent color" data-tip="Custom color"' + (custom ? ' style="box-shadow:0 0 0 2px var(--bg-primary),0 0 0 4px var(--text)"' : '') + '></div>';
  }
  function rulesEditor() {
    const rules = get('org.rules') || [];
    const types = Object.entries(C.E.RULE_TYPES);
    const ph = { contains: 'minecraft, mod', starts: 'IMG_', ends: '_final', pattern: 'Screenshot*.png', ext: 'blend, fbx', larger: '500', older: '365' };
    let h = '<div class="rules">';
    if (!rules.length) h += '<div class="rules-empty">No rules yet. Add one, like <b>Name contains “minecraft” → Games/Minecraft</b> or <b>Extension is “blend” → 3D/Blender</b>.</div>';
    rules.forEach((r, i) => {
      h += '<div class="rule' + (r.enabled === false ? ' is-off' : '') + '" data-rule="' + i + '">' +
        '<input type="checkbox" class="checkbox" data-r="enabled" aria-label="Rule on"' + (r.enabled === false ? '' : ' checked') + '>' +
        '<select class="dropdown" data-r="type" aria-label="When">' + types.map(([v, l]) => '<option value="' + v + '"' + (r.type === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '<input class="text-input" data-r="value" aria-label="Value" spellcheck="false" placeholder="' + esc(ph[r.type] || '') + '" value="' + esc(r.value || '') + '">' +
        '<span class="r-arrow">' + C.icon('arrow-right', 'xs') + '</span>' +
        '<input class="text-input" data-r="folder" aria-label="Folder" spellcheck="false" placeholder="Folder, e.g. Games/Minecraft" value="' + esc(r.folder || '') + '">' +
        '<button class="clickable-icon" data-r="del" aria-label="Delete rule" data-tip="Delete rule">' + C.icon('x') + '</button></div>';
    });
    return h + '</div><div style="margin-top:8px;display:flex;gap:8px"><button class="btn" data-x="add-rule">' + C.icon('plus') + 'Add rule</button>' +
      (rules.length > 1 ? '<span style="color:var(--text-faint);font-size:12px;align-self:center">Comma-separate values to match any of them.</span>' : '') + '</div>';
  }
  function neverEditor() { return chipEditor('org.neverMove', 'e.g. *.lnk or Resume.pdf'); }
  function chipEditor(key, ph) {
    const list = get(key) || [];
    const id = 'chip-' + key.replace(/\W/g, '');
    return '<div class="chips">' + (list.length ? list.map((p, i) => '<span class="chip">' + esc(p) + '<button data-x="chip-del" data-key="' + key + '" data-i="' + i + '" aria-label="Remove ' + esc(p) + '">' + C.icon('x', 'xs') + '</button></span>').join('') : '<span style="color:var(--text-faint);font-size:12.5px">Nothing yet.</span>') + '</div>' +
      '<div class="chip-add"><input class="text-input" id="' + id + '" data-chip-input="' + key + '" spellcheck="false" placeholder="' + esc(ph) + '" aria-label="Add to list"><button class="btn" data-x="chip-add" data-key="' + key + '">Add</button></div>';
  }
  function presetPicker() {
    return '<div class="theme-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">' + Object.entries(C.WS.PRESETS).map(([id, p]) =>
      '<button class="theme-new" style="border-style:solid;align-items:flex-start;justify-content:flex-start;padding:10px 12px;min-height:70px;text-align:left" data-x="layout-preset" data-id="' + id + '"><b style="color:var(--text)">' + esc(p.name) + '</b><span>' + esc(p.desc) + '</span></button>').join('') + '</div>';
  }
  function panelPlacer() {
    const where = v => { const k = C.WS.keyOf(v); return !k ? 'hidden' : k.startsWith('main') ? 'main' : k; };
    return Object.entries(C.WS.VIEWS).map(([v, m]) => '<div class="hotkey-row"><div class="hk-name" style="display:flex;align-items:center;gap:8px">' + C.icon(m.icon) + esc(m.name) + '</div>' +
      '<select class="dropdown" data-place="' + v + '" aria-label="Where ' + esc(m.name) + ' lives">' + [['left', 'Left sidebar'], ['right', 'Right sidebar'], ['main', 'Main area'], ['hidden', 'Hidden']].map(([o, l]) => '<option value="' + o + '"' + (where(v) === o ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>').join('');
  }
  function categoryEditor() {
    const map = get('org.categoryNames') || {};
    return '<div class="cat-grid">' + C.E.CATEGORY_LIST.map(c => '<label class="cat-row"><span class="lbl">' + esc(c) + '</span><input class="text-input" data-cat="' + esc(c) + '" spellcheck="false" placeholder="' + esc(c) + '" value="' + esc(map[c] || '') + '"></label>').join('') + '</div>';
  }
  let recordingId = null;
  function hotkeysEditor() {
    const hk = C.UI().hotkeys || {};
    const q = (document.getElementById('hkFilter') || {}).value || '';
    const groups = new Map();
    for (const c of C.COMMANDS) groups.set(C.effectiveHotkey(c.id), (groups.get(C.effectiveHotkey(c.id)) || []).concat(c.id));
    let h = '<div class="search-wrap" style="margin-bottom:8px">' + C.icon('search', 'xs') + '<input class="search-input" id="hkFilter" placeholder="Filter commands or keys…" aria-label="Filter hotkeys" value="' + esc(q) + '"></div>';
    for (const c of C.COMMANDS) {
      const combo = C.effectiveHotkey(c.id);
      const label = C.hotkeyLabel(combo);
      if (q && !(c.name + ' ' + label).toLowerCase().includes(q.toLowerCase())) continue;
      const changed = Object.prototype.hasOwnProperty.call(hk, c.id) && hk[c.id] !== (c.hk || '');
      const clash = combo && (groups.get(combo) || []).filter(x => x !== c.id).map(x => C.COMMANDS.find(y => y.id === x).name);
      const ci = c.name.indexOf(': ');
      const name = ci > 0 ? '<span class="prefix">' + esc(c.name.slice(0, ci + 2)) + '</span>' + esc(c.name.slice(ci + 2)) : esc(c.name);
      h += '<div class="hotkey-row' + (recordingId === c.id ? ' recording' : '') + (changed ? ' is-changed' : '') + '" data-hk="' + c.id + '">' +
        '<div class="hk-name">' + name + (clash && clash.length ? '<div class="hk-conflict">Also used by ' + esc(clash.join(', ')) + '</div>' : '') + '</div>' +
        '<div class="hk-keys">' + (recordingId === c.id ? 'Press keys…' : label ? '<kbd>' + esc(label) + '</kbd>' : '<span class="none">None</span>') + '</div>' +
        '<button class="btn small" data-x="hk-record" data-id="' + c.id + '">' + (recordingId === c.id ? 'Cancel' : 'Change') + '</button>' +
        '<button class="clickable-icon" data-x="hk-reset" data-id="' + c.id + '" aria-label="Restore default" data-tip="Restore default"' + (changed ? '' : ' style="visibility:hidden"') + '>' + C.icon('rotate-ccw') + '</button></div>';
    }
    return h;
  }

  // ------------------------------------------------------------------ render
  function isChanged(it) {
    if (it.noReset) return false;
    if (it.k === 'ui.hotkeys') return false;
    return !same(get(it.k), def(it.k)) && !(get(it.k) === '' && def(it.k) == null);
  }
  function itemHTML(it, hl) {
    if (it.hidden && it.hidden()) return '';
    const name = hl ? highlight(it.name) : it.name;
    return '<div class="setting-item' + (it.stack ? ' stack' : '') + (isChanged(it) ? ' is-changed' : '') + '" data-item="' + it.k + '">' +
      (it.name || it.desc ? '<div class="setting-item-info"><div class="setting-item-name">' + name + '</div>' + (it.desc ? '<div class="setting-item-description">' + it.desc + '</div>' : '') + '</div>' : '') +
      '<div class="setting-item-control"' + (it.stack ? ' style="display:block"' : '') + '>' + it.c() +
      (it.noReset || it.stack ? '' : '<button class="clickable-icon setting-reset" data-x="reset-item" data-k="' + it.k + '" aria-label="Restore default" data-tip="Restore default">' + C.icon('rotate-ccw') + '</button>') + '</div>' +
      (it.stack && !it.noReset ? '<div style="text-align:right"><a class="mod-link setting-reset" data-x="reset-item" data-k="' + it.k + '" tabindex="0" style="width:auto;font-size:12px">Restore default</a></div>' : '') +
      '</div>';
  }
  function highlight(s) {
    if (!query) return s;
    const i = s.toLowerCase().indexOf(query.toLowerCase());
    return i < 0 ? s : esc(s.slice(0, i)) + '<mark class="hl">' + esc(s.slice(i, i + query.length)) + '</mark>' + esc(s.slice(i + query.length));
  }
  function bodyHTML() {
    const all = items();
    if (query) {
      const q = query.toLowerCase();
      const hits = all.filter(it => it.name && (it.name + ' ' + (it.desc || '') + ' ' + (it.kw || '') + ' ' + it.s).toLowerCase().includes(q) && !(it.hidden && it.hidden()));
      if (!hits.length) return '<h3>No settings match “' + esc(query) + '”</h3><div class="settings-empty">Try another word, like “dark”, “font” or “rule”.</div>';
      let h = '<h3>' + hits.length + ' setting' + (hits.length === 1 ? '' : 's') + ' for “' + esc(query) + '”</h3>';
      for (const sec of SECTIONS) {
        const list = hits.filter(it => it.s === sec.id);
        if (list.length) h += '<h4>' + esc(sec.name) + '</h4>' + list.map(it => itemHTML(it, true)).join('');
      }
      return h;
    }
    const sec = SECTIONS.find(s => s.id === current);
    let h = '<h3>' + esc(sec.name) + '</h3>' + (sec.desc ? '<div class="section-desc">' + sec.desc + '</div>' : '');
    let lastG = null;
    for (const it of all.filter(x => x.s === current)) {
      if (it.g && it.g !== lastG) { h += '<h4>' + esc(it.g) + '</h4>'; lastG = it.g; }
      h += itemHTML(it);
    }
    return h;
  }
  function navHTML() {
    return '<div class="search-wrap">' + C.icon('search', 'xs') + '<input class="search-input" id="setSearch" placeholder="Search settings…" aria-label="Search settings" value="' + esc(query) + '"></div>' +
      '<div class="nav-title">Options</div>' +
      SECTIONS.map(s => '<button class="nav-btn' + (!query && s.id === current ? ' is-active' : '') + '" data-nav="' + s.id + '">' + C.icon(s.icon) + esc(s.name) + '</button>').join('');
  }
  function redraw() {
    if (!M) return;
    const body = M.box.querySelector('.settings-body');
    const y = body.scrollTop;
    const af = document.activeElement;
    const focusKey = af && (af.dataset.k ? '[data-k="' + af.dataset.k + '"]' + (af.dataset.v ? '[data-v=\'' + af.dataset.v + '\']' : '') : af.id ? '#' + af.id : null);
    const sel = af && af.id === 'setSearch' ? [af.selectionStart, af.selectionEnd] : null;
    M.box.querySelector('.settings-nav').innerHTML = navHTML();
    body.innerHTML = bodyHTML();
    body.scrollTop = y;
    if (focusKey) { const el = M.box.querySelector(focusKey); if (el) { el.focus(); if (sel && el.setSelectionRange) el.setSelectionRange(sel[0], sel[1]); } }
  }
  function markChanged(path) {
    const el = M && M.box.querySelector('[data-item="' + path + '"]');
    if (!el) return;
    const it = items().find(x => x.k === path);
    if (it) el.classList.toggle('is-changed', isChanged(it));
  }

  // ------------------------------------------------------------------ events
  function bind() {
    const box = M.box;
    box.addEventListener('click', async e => {
      const tool = e.target.closest('[data-x]');
      if (tool && tool.closest('[data-t="theme"]')) {
        e.stopPropagation();
        if (tool.dataset.x === 'theme-edit') { themeEditor(C, tool.dataset.id); return; }
        if (tool.dataset.x === 'theme-del') return deleteTheme(tool.dataset.id);
      }
      const nav = e.target.closest('[data-nav]');
      if (nav) { current = nav.dataset.nav; query = ''; redraw(); box.querySelector('.settings-body').scrollTop = 0; return; }
      const t = e.target.closest('[data-t]');
      if (t) {
        const k = t.dataset.k;
        if (t.dataset.t === 'toggle') return set(k, !get(k));
        if (t.dataset.t === 'seg') return set(k, JSON.parse(t.dataset.v));
        if (t.dataset.t === 'theme') { await set(k, t.dataset.v, { quiet: true }); const th = C.T.allThemes(C.S.settings.ui)[t.dataset.v]; const mode = th ? th.mode : 'dark'; if (get('ui.appearance.mode') !== 'system') C.setUi('appearance', 'mode', mode); return redraw(); }
      }
      const x = e.target.closest('[data-x]');
      if (!x) return;
      const act = x.dataset.x;
      if (act === 'reset-item') return set(x.dataset.k, JSON.parse(JSON.stringify(def(x.dataset.k) == null ? '' : def(x.dataset.k))));
      if (act === 'add-rule') { const r = (get('org.rules') || []).concat([{ type: 'contains', value: '', folder: '', enabled: true }]); await set('org.rules', r); const rows = box.querySelectorAll('.rule [data-r="value"]'); rows[rows.length - 1] && rows[rows.length - 1].focus(); return; }
      if (act === 'chip-add') return addChip(x.dataset.key);
      if (act === 'chip-del') { const l = (get(x.dataset.key) || []).slice(); l.splice(+x.dataset.i, 1); return set(x.dataset.key, l); }
      if (act === 'theme-new') return themeEditor(C, null, { mode: x.dataset.mode });
      if (act === 'theme-dup') { const r = C.T.resolve(C.S.settings.ui); return themeEditor(C, r.presetId, { duplicate: true }); }
      if (act === 'theme-paste') return pasteTheme();
      if (act === 'layout-preset') { C.WS.applyPreset(x.dataset.id); return redraw(); }
      if (act === 'hk-record') { recordingId = recordingId === x.dataset.id ? null : x.dataset.id; window.OnyxSettings.recording = !!recordingId; return redraw(); }
      if (act === 'hk-reset') { const hk = Object.assign({}, C.UI().hotkeys); delete hk[x.dataset.id]; C.setUi('hotkeys', null, hk); return redraw(); }
      if (act === 'export') { const r = await api().exportSettings(); if (r && r.ok) C.notice('Settings exported', 'success'); return; }
      if (act === 'import') {
        const r = await api().importSettings();
        if (!r || r.cancelled) return;
        if (r.error) { C.notice(esc(r.error), 'error'); return; }
        await C.loadSettings(); C.applyTheme(); C.renderAll(); redraw(); C.notice('Settings imported', 'success'); return;
      }
      if (act === 'reset-ui') return C.confirmModal('Reset look and layout?', '<p>Appearance, layout, explorer, graph and hotkey settings go back to defaults. Your rules, AI settings and recent folders are kept.</p>', 'Reset', async () => { await api().resetSettings('ui'); await C.loadSettings(); C.applyTheme(); C.renderAll(); redraw(); C.notice('Look and layout reset', 'success'); });
      if (act === 'reset-org') return C.confirmModal('Reset organizing?', '<p>This deletes your rules, never-move list and folder names, and resets organizing options.</p>', 'Reset organizing', async () => { await api().resetSettings('organize'); await C.loadSettings(); C.renderAll(); redraw(); C.notice('Organizing settings reset', 'success'); }, true);
      if (act === 'del-rule') return;
    });
    // rules editor (inputs inside .rule rows)
    box.addEventListener('click', e => {
      const del = e.target.closest('.rule [data-r="del"]');
      if (del) { const i = +del.closest('.rule').dataset.rule; const r = (get('org.rules') || []).slice(); r.splice(i, 1); set('org.rules', r); }
      const cb = e.target.closest('.rule [data-r="enabled"]');
      if (cb) { const i = +cb.closest('.rule').dataset.rule; const r = (get('org.rules') || []).map(x => Object.assign({}, x)); r[i].enabled = cb.checked; set('org.rules', r); }
    });
    box.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.place) {
        const v = t.dataset.place, to = t.value;
        if (to === 'hidden') C.WS.closeView(v); else C.WS.moveView(v, to === 'main' ? { region: 'main:0' } : { region: to });
        return redraw();
      }
      if (t.matches('.rule [data-r="type"]')) { const i = +t.closest('.rule').dataset.rule; const r = (get('org.rules') || []).map(x => Object.assign({}, x)); r[i].type = t.value; return set('org.rules', r); }
      if (t.dataset.t === 'select') return set(t.dataset.k, JSON.parse(t.value));
      if (t.dataset.t === 'text') return set(t.dataset.k, t.value.trim(), { quiet: true });
      if (t.dataset.cat != null) { const m = Object.assign({}, get('org.categoryNames') || {}); const v = t.value.trim(); if (v) m[t.dataset.cat] = v; else delete m[t.dataset.cat]; return set('org.categoryNames', m, { quiet: true }); }
      if (t.id === 'sKey') { const v = t.value.trim(); api().saveSettings({ ai: { key: v } }).then(s => { Object.assign(C.S.settings.ai, s.ai); C.notice(v ? 'API key saved' : 'API key removed', 'success'); redraw(); }); }
    });
    box.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'setSearch') { query = t.value; redraw(); return; }
      if (t.id === 'hkFilter') { const pos = t.selectionStart; redraw(); const n = box.querySelector('#hkFilter'); n.focus(); n.setSelectionRange(pos, pos); return; }
      if (t.matches('.rule [data-r="value"], .rule [data-r="folder"]')) { const i = +t.closest('.rule').dataset.rule; const r = (get('org.rules') || []).map(x => Object.assign({}, x)); r[i][t.dataset.r] = t.value; C.setOrg('rules', r); return; }
      if (t.dataset.t === 'slider') {
        const v = +t.value; const min = +t.min, max = +t.max;
        t.style.setProperty('--fill', ((v - min) / (max - min)) * 100 + '%');
        t.parentElement.querySelector('.val').textContent = fmtVal(v, t.dataset.unit);
        return set(t.dataset.k, v, { quiet: true });
      }
      if (t.dataset.t === 'color') return set(t.dataset.k, t.value, { quiet: true });
      if (t.dataset.t === 'textarea') return set(t.dataset.k, t.value, { quiet: true });
      if (t.dataset.t === 'text' && t.dataset.k === 'ui.appearance.fontCustom') return set(t.dataset.k, t.value, { quiet: true });
    });
    box.addEventListener('keydown', e => {
      if (e.target.dataset && e.target.dataset.chipInput && e.key === 'Enter') { addChip(e.target.dataset.chipInput); e.preventDefault(); }
      const card = e.target.closest && e.target.closest('.theme-card[data-t="theme"]');
      if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { card.click(); e.preventDefault(); }
      if (e.target.matches('a.mod-link') && (e.key === 'Enter' || e.key === ' ')) { e.target.click(); e.preventDefault(); }
    });
    box.addEventListener('click', async e => {
      if (e.target.closest('#sTest')) {
        const keyEl = box.querySelector('#sKey');
        if (keyEl && keyEl.value.trim()) { const s = await api().saveSettings({ ai: { key: keyEl.value.trim() } }); Object.assign(C.S.settings.ai, s.ai); }
        const res = box.querySelector('#sTestRes'); res.className = 'test-result'; res.textContent = 'Testing…';
        const r = await api().testAi(); C.S.aiTest = r;
        res.className = 'test-result ' + (r.ok ? 'ok' : 'err');
        res.textContent = r.ok ? 'Connected · ' + r.model + ' · ' + (r.ms / 1000).toFixed(1) + 's' : r.error;
        C.renderAll();
      }
    });
    // hotkey recorder: capture before the app's own shortcuts
    const rec = e => {
      if (!recordingId) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { recordingId = null; window.OnyxSettings.recording = false; redraw(); return; }
      const hk = Object.assign({}, C.UI().hotkeys);
      if (e.key === 'Backspace' || e.key === 'Delete') { hk[recordingId] = ''; }
      else { const combo = C.comboFromEvent(e); if (!combo) return; if (!/^(Mod|Alt|F\d+)/.test(combo) && !combo.includes('+')) { C.notice('Use a modifier like Ctrl or Alt, or a function key.', 'warn', 2500); return; } hk[recordingId] = combo; }
      recordingId = null; window.OnyxSettings.recording = false;
      C.setUi('hotkeys', null, hk); redraw();
    };
    window.addEventListener('keydown', rec, true);
    M.cleanup = () => window.removeEventListener('keydown', rec, true);
  }
  function addChip(key) {
    const inp = M.box.querySelector('[data-chip-input="' + key + '"]'); const v = inp && inp.value.trim(); if (!v) return;
    const l = (get(key) || []).slice(); if (!l.includes(v)) l.push(v);
    set(key, l).then(() => { const n = M.box.querySelector('[data-chip-input="' + key + '"]'); n && n.focus(); });
  }
  function deleteTheme(id) {
    const th = (C.S.settings.ui.themes || {})[id]; if (!th) return;
    C.confirmModal('Delete “' + esc(th.name) + '”?', '<p>This color scheme will be removed. If it’s in use, Onyx switches back to the default theme.</p>', 'Delete', () => {
      const themes = Object.assign({}, C.S.settings.ui.themes); delete themes[id];
      C.setUi('themes', null, themes);
      const a = C.UI().appearance;
      if (a.themeDark === id) C.setUi('appearance', 'themeDark', 'onyx');
      if (a.themeLight === id) C.setUi('appearance', 'themeLight', 'pearl');
      redraw();
    }, true);
  }
  function pasteTheme() {
    C.textPrompt({
      title: 'Paste theme code', ok: 'Add theme', placeholder: '{"name": …}', desc: 'Paste a code someone shared from Onyx’s color scheme builder.',
      validate: v => { try { const t = JSON.parse(v.trim().replace(/^onyx-theme:/, '')); return t && t.bg && t.accent ? '' : 'That code is missing colors.'; } catch { return 'That isn’t a valid theme code.'; } },
      run: v => { const t = JSON.parse(v.trim().replace(/^onyx-theme:/, '')); const id = 'my-' + Date.now().toString(36); const themes = Object.assign({}, C.S.settings.ui.themes, { [id]: cleanTheme(t) }); C.setUi('themes', null, themes); C.setUi('appearance', (t.mode === 'light' ? 'themeLight' : 'themeDark'), id); C.setUi('appearance', 'mode', t.mode === 'light' ? 'light' : 'dark'); redraw(); C.notice('Added <b>' + esc(t.name || 'theme') + '</b>', 'success'); },
    });
  }
  function cleanTheme(t) {
    const out = { name: String(t.name || 'My theme').slice(0, 40), mode: t.mode === 'light' ? 'light' : 'dark', desc: 'Your theme' };
    for (const k of C.T.THEME_KEYS) if (/^#[0-9a-f]{6}$/i.test(t[k] || '')) out[k] = t[k].toLowerCase();
    if (Array.isArray(t.groups)) out.groups = t.groups.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 10);
    return out;
  }

  // ------------------------------------------------------------------ color scheme builder
  const TE_ROWS = [
    ['bg', 'Background', 'Main reading area'], ['bg2', 'Sidebars & headers', 'Panels around the main area'], ['alt', 'Raised surfaces', 'Buttons, inputs, cards'],
    ['border', 'Borders', 'Dividers between areas'], ['strong', 'Strong borders', 'Menus, dialogs, hovered edges'],
    ['text', 'Text', 'Measured against the background'], ['muted', 'Secondary text', 'Descriptions, labels'], ['faint', 'Faint text', 'Hints; Onyx lifts it to stay readable'],
    ['accent', 'Accent', 'Buttons, highlights, focus. Button text picks black or white'],
  ];
  function themeEditor(ctx, id, opts) {
    C = ctx; opts = opts || {};
    const ui = ctx.S.settings.ui;
    const all = ctx.T.allThemes(ui);
    const custom = ui.themes || {};
    const editing = id && custom[id] && !opts.duplicate;
    const editId = editing ? id : 'my-' + Date.now().toString(36);
    const base = id && all[id] ? all[id] : opts.mode === 'light' ? all.pearl : opts.mode === 'dark' ? all.onyx : ctx.T.resolve(ui).p;
    const draft = cleanTheme(Object.assign({}, base));
    for (const k of ctx.T.THEME_KEYS) if (!draft[k]) draft[k] = base[k] || '#888888';
    if (!editing) draft.name = id && all[id] ? all[id].name + ' copy' : 'My scheme';
    const snapshot = JSON.parse(JSON.stringify({ themes: ui.themes || {}, appearance: ctx.UI().appearance }));
    let saved = false;
    const m = ctx.modal({ cls: 'mod-theme', html: '', onClose: () => { if (!saved) { ctx.S.settings.ui.themes = snapshot.themes; ctx.S.settings.ui.appearance = snapshot.appearance; ctx.applyTheme(); ctx.renderAll(); } } });
    const groups = () => draft.groups && draft.groups.length ? draft.groups : ctx.T.GROUP_COLORS[draft.mode];
    m.box.innerHTML = '<button class="clickable-icon modal-close" data-close aria-label="Close">' + ctx.icon('x') + '</button>' +
      '<div class="te"><div class="te-form"><h2>' + (editing ? 'Edit color scheme' : 'Build a color scheme') + '</h2><div class="te-sub">Every change previews live across the whole app. Cancel puts everything back.</div>' +
      '<div class="te-top"><input class="text-input" id="teName" aria-label="Scheme name" spellcheck="false" value="' + ctx.esc(draft.name) + '">' +
      '<div class="segmented" id="teMode"><button data-m="dark">Dark</button><button data-m="light">Light</button></div></div>' +
      '<div class="te-quick">' + ctx.icon('wand') + 'Quick start from two colors: background <input type="color" class="color-input" id="teQBg" value="' + draft.bg + '" aria-label="Background"> accent <input type="color" class="color-input" id="teQAcc" value="' + draft.accent + '" aria-label="Accent"><button class="btn small" id="teGen">Generate the rest</button></div>' +
      TE_ROWS.map(([k, l, d]) => '<div class="te-row" data-row="' + k + '"><div class="lbl">' + l + '<small>' + d + '</small></div><input type="color" class="color-input" data-ck="' + k + '" aria-label="' + l + '"><input class="text-input" data-hk="' + k + '" spellcheck="false" aria-label="' + l + ' hex"><span class="ratio" data-rk="' + k + '"></span></div>').join('') +
      '<div class="te-row" style="grid-template-columns:1fr"><div class="lbl">Graph colors<small>Used to color folders in the graph view</small></div><div class="te-groups" id="teGroups"></div></div>' +
      '</div><div class="te-preview"><div class="tp-label">Preview</div><div class="tp-app" id="tePrev"></div><div class="tp-label" style="margin-top:6px">Share</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" id="teCopy">' + ctx.icon('copy') + 'Copy theme code</button></div></div></div>' +
      '<div class="te-actions"><div class="left">' + (editing ? '<button class="btn mod-warning" id="teDel">Delete</button>' : '') + '</div><button class="btn" data-close>Cancel</button><button class="btn mod-cta" id="teSave">' + (editing ? 'Save changes' : 'Save scheme') + '</button></div>';
    const box = m.box;
    function ratioText(k) {
      const T2 = ctx.T;
      if (k === 'text') return T2.contrast(draft.text, draft.bg);
      if (k === 'muted') return T2.contrast(draft.muted, draft.bg2);
      if (k === 'faint') return T2.contrast(draft.faint, draft.bg2);
      if (k === 'accent') { const on = T2.contrast(draft.accent, '#000000') >= T2.contrast(draft.accent, '#ffffff') ? '#0b0b0d' : '#ffffff'; return T2.contrast(on, draft.accent); }
      return null;
    }
    function sync(fromKey) {
      box.querySelectorAll('#teMode button').forEach(b => b.classList.toggle('is-active', b.dataset.m === draft.mode));
      for (const [k] of TE_ROWS) {
        const c = box.querySelector('[data-ck="' + k + '"]'), h = box.querySelector('[data-hk="' + k + '"]');
        if (fromKey !== k + ':c') c.value = draft[k];
        if (fromKey !== k + ':h') h.value = draft[k];
        const r = ratioText(k), el = box.querySelector('[data-rk="' + k + '"]');
        if (r == null) el.textContent = '';
        else { const need = k === 'faint' ? 3 : 4.5; el.textContent = r.toFixed(1) + ':1 ' + (r >= need ? '✓' : 'low'); el.classList.toggle('low', r < need); el.title = r >= need ? 'Readable' : 'Hard to read, consider more contrast'; }
      }
      const g = groups();
      box.querySelector('#teGroups').innerHTML = g.map((c, i) => '<input type="color" class="color-input" data-gi="' + i + '" value="' + c + '" aria-label="Graph color ' + (i + 1) + '">').join('') + (draft.groups ? '<button class="btn small" id="teGReset">Default</button>' : '');
      const on = ratioText('accent') != null && ctx.T.contrast(draft.accent, '#000000') >= ctx.T.contrast(draft.accent, '#ffffff') ? '#0b0b0d' : '#ffffff';
      box.querySelector('#tePrev').style.cssText = 'border-color:' + draft.strong + ';background:' + draft.bg;
      box.querySelector('#tePrev').innerHTML = '<div class="tp-side" style="background:' + draft.bg2 + ';border-right:1px solid ' + draft.border + ';color:' + draft.muted + '">' +
        '<div class="tp-item" style="color:' + draft.text + ';background:rgba(' + ctx.T.hexToRgb(draft.accent).join(',') + ',.16)">invoices</div><div class="tp-item">photos</div><div class="tp-item">notes.txt</div><div class="tp-item" style="color:' + draft.faint + '">~lock file</div></div>' +
        '<div class="tp-main"><div class="tp-h" style="color:' + draft.text + '">Proposed structure</div><div style="color:' + draft.muted + '">26 files moving · 14 new folders</div>' +
        '<span class="tp-pill" style="background:rgba(' + ctx.T.hexToRgb(draft.accent).join(',') + ',.14);color:' + ctx.T.readable(draft.accent, draft.bg, 4.5) + '">new</span>' +
        '<div class="tp-input" style="background:' + draft.alt + ';border-color:' + draft.border + ';color:' + draft.faint + '">Filter changes…</div>' +
        '<div style="display:flex;gap:4px">' + g.slice(0, 6).map(c => '<span style="width:12px;height:12px;border-radius:50%;background:' + c + '"></span>').join('') + '</div>' +
        '<span class="tp-btn" style="background:' + draft.accent + ';color:' + on + '">Apply</span></div>';
      // live preview across the app
      ctx.S.settings.ui.themes = Object.assign({}, snapshot.themes, { [editId]: cleanTheme(draft) });
      ctx.S.settings.ui.appearance = Object.assign({}, snapshot.appearance, { mode: draft.mode, accent: '', [draft.mode === 'light' ? 'themeLight' : 'themeDark']: editId });
      ctx.applyTheme();
    }
    box.querySelector('#teName').addEventListener('input', e => { draft.name = e.target.value; });
    box.querySelector('#teMode').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; draft.mode = b.dataset.m; sync(); });
    box.querySelector('#teGen').addEventListener('click', () => {
      const g = ctx.T.generateTheme(box.querySelector('#teQBg').value, box.querySelector('#teQAcc').value, draft.name);
      Object.assign(draft, { mode: g.mode }); for (const k of ctx.T.THEME_KEYS) draft[k] = g[k]; sync();
    });
    box.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.ck) { draft[t.dataset.ck] = t.value; sync(t.dataset.ck + ':c'); }
      if (t.dataset.hk) { let v = t.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) { draft[t.dataset.hk] = v.toLowerCase(); sync(t.dataset.hk + ':h'); } }
      if (t.dataset.gi != null) { const g = groups().slice(); g[+t.dataset.gi] = t.value; draft.groups = g; sync(); }
    });
    box.addEventListener('click', e => {
      if (e.target.closest('#teGReset')) { delete draft.groups; sync(); }
      if (e.target.closest('#teCopy')) { ctx.api.copyText('onyx-theme:' + JSON.stringify(cleanTheme(draft))); ctx.notice('Theme code copied. Paste it into Settings → Appearance → Paste code.', 'success'); }
      if (e.target.closest('#teSave')) {
        saved = true;
        const themes = Object.assign({}, snapshot.themes, { [editId]: cleanTheme(Object.assign(draft, { name: draft.name.trim() || 'My scheme' })) });
        ctx.setUi('themes', null, themes);
        ctx.setUi('appearance', null, Object.assign({}, snapshot.appearance, { mode: draft.mode, accent: '', [draft.mode === 'light' ? 'themeLight' : 'themeDark']: editId }));
        m.close(); ctx.renderAll(); if (M) redraw();
        ctx.notice('Saved <b>' + ctx.esc(draft.name) + '</b>', 'success');
      }
      if (e.target.closest('#teDel')) { m.close(); deleteTheme(editId); }
    });
    sync();
    setTimeout(() => box.querySelector('#teName').select(), 40);
  }
  function addNever() {
    const inp = M.box.querySelector('#neverInput'); const v = inp && inp.value.trim(); if (!v) return;
    const l = (get('org.neverMove') || []).slice(); if (!l.includes(v)) l.push(v);
    set('org.neverMove', l).then(() => { const n = M.box.querySelector('#neverInput'); n && n.focus(); });
  }

  // ------------------------------------------------------------------ public
  function open(ctx, tab) {
    C = ctx;
    if (M) { current = tab || current; query = ''; redraw(); return; }
    current = tab || current; query = ''; recordingId = null;
    M = ctx.modal({ cls: 'mod-settings', html: '', onClose: () => { if (M && M.cleanup) M.cleanup(); M = null; recordingId = null; window.OnyxSettings.recording = false; } });
    M.box.innerHTML = '<button class="clickable-icon modal-close" data-close aria-label="Close settings">' + C.icon('x') + '</button>' +
      '<nav class="settings-nav" aria-label="Settings sections"></nav><div class="settings-body"></div>';
    bind();
    redraw();
    setTimeout(() => { const s = M && M.box.querySelector('#setSearch'); s && s.focus(); }, 40);
  }

  // quick "Always put files like this in…" editor
  function ruleEditor(ctx, pre) {
    C = ctx;
    const types = Object.entries(ctx.E.RULE_TYPES);
    const m = ctx.modal({
      title: 'New rule',
      html: '<p>Files matching this rule always go to the folder you choose, whatever the strategy.</p>' +
        '<div style="display:grid;grid-template-columns:150px 1fr;gap:8px;margin-top:12px;align-items:center">' +
        '<label for="reType">When</label><select class="dropdown" id="reType">' + types.map(([v, l]) => '<option value="' + v + '"' + ((pre.type || 'contains') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '<label for="reValue">Value</label><input class="text-input" id="reValue" style="width:100%;margin:0" spellcheck="false" value="' + ctx.esc(pre.value || '') + '">' +
        '<label for="reFolder">Put them in</label><input class="text-input" id="reFolder" style="width:100%;margin:0" spellcheck="false" placeholder="e.g. Games/Minecraft" value="' + ctx.esc(pre.folder || '') + '"></div>' +
        '<div class="field-error" id="reErr"></div>',
      buttons: [{ label: 'Cancel' }, { label: 'Add rule', cls: 'mod-cta', action: () => save() }],
    });
    const f = m.box.querySelector(pre.folder ? '#reValue' : '#reFolder'); setTimeout(() => { f.focus(); f.select && f.select(); }, 40);
    function save() {
      const r = { type: m.box.querySelector('#reType').value, value: m.box.querySelector('#reValue').value.trim(), folder: ctx.E.sanitizeFolder(m.box.querySelector('#reFolder').value, 6) || '', enabled: true };
      if (!r.value) { m.box.querySelector('#reErr').textContent = 'Enter what to match.'; return false; }
      if (!r.folder) { m.box.querySelector('#reErr').textContent = 'Enter a folder.'; return false; }
      ctx.setOrg('rules', (ctx.S.settings.organize.rules || []).concat([r]));
      ctx.notice('Rule added. Run Organize again to apply it.', 'success');
      return true;
    }
    m.box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { if (save() !== false) m.close(); e.preventDefault(); } });
  }

  window.OnyxSettings = { open, ruleEditor, themeEditor, recording: false };
})();
