/* Onyx theme engine: presets, accent, fonts, density, layout preferences -> CSS variables + body classes */
(function () {
  'use strict';

  // ------------------------------------------------------------------ presets
  // Each preset: base surfaces + text + default accent. Everything else is derived.
  const PRESETS = {
    onyx:     { name: 'Onyx',     mode: 'dark',  desc: 'Black stone, periwinkle accent', bg: '#0f0f11', bg2: '#161619', alt: '#1f1f23', border: '#25252a', strong: '#34343b', text: '#e6e6ea', muted: '#a3a4ad', faint: '#6c6d77', accent: '#8f9cf9' },
    jet:      { name: 'Jet',      mode: 'dark',  desc: 'Pure black for OLED screens',  bg: '#000000', bg2: '#0a0a0b', alt: '#151517', border: '#1e1e21', strong: '#2c2c30', text: '#ededf0', muted: '#9e9ea6', faint: '#5d5d64', accent: '#ffffff' },
    graphite: { name: 'Graphite', mode: 'dark',  desc: 'Softer grey, steel accent',     bg: '#1b1c1f', bg2: '#222327', alt: '#2b2c31', border: '#323339', strong: '#42434a', text: '#e3e4e8', muted: '#a9aab2', faint: '#6c6d76', accent: '#9fb4d8' },
    lapis:    { name: 'Lapis',    mode: 'dark',  desc: 'Deep navy, sapphire accent',    bg: '#0c1016', bg2: '#111722', alt: '#19212e', border: '#202a39', strong: '#2c394d', text: '#e1e8f2', muted: '#9daabd', faint: '#5d697c', accent: '#6ea8ff' },
    jade:     { name: 'Jade',     mode: 'dark',  desc: 'Green-black, jade accent',      bg: '#0d1110', bg2: '#121816', alt: '#1a221f', border: '#212b28', strong: '#2e3a36', text: '#e2ece8', muted: '#9fb0aa', faint: '#5d6d68', accent: '#6fcf97' },
    amber:    { name: 'Amber',    mode: 'dark',  desc: 'Warm brown-black, honey accent', bg: '#12100d', bg2: '#191612', alt: '#231f19', border: '#2b2520', strong: '#3a322b', text: '#eee6dc', muted: '#b2a797', faint: '#706759', accent: '#e0a458' },
    garnet:   { name: 'Garnet',   mode: 'dark',  desc: 'Wine-black, garnet accent',     bg: '#120e0f', bg2: '#191415', alt: '#231b1d', border: '#2c2124', strong: '#3b2c30', text: '#f0e4e6', muted: '#b49ea3', faint: '#725b60', accent: '#f2737d' },
    amethyst: { name: 'Amethyst', mode: 'dark',  desc: 'Violet-black, amethyst accent', bg: '#110f15', bg2: '#17141d', alt: '#201c28', border: '#282332', strong: '#372f45', text: '#ebe6f2', muted: '#aaa1b8', faint: '#686075', accent: '#a98bf5' },
    pearl:    { name: 'Pearl',    mode: 'light', desc: 'Clean white, indigo accent', bg: '#fbfbfc', bg2: '#f2f2f5', alt: '#e8e8ed', border: '#e0e0e6', strong: '#cbcbd4', text: '#1b1b1f', muted: '#585962', faint: '#80818b', accent: '#4b57d6' },
    marble:   { name: 'Marble',   mode: 'light', desc: 'Warm white, bronze accent',     bg: '#faf8f5', bg2: '#f2eee8', alt: '#e9e3da', border: '#e2dbd0', strong: '#cfc5b6', text: '#2a2520', muted: '#685e54', faint: '#998f84', accent: '#9a6b3f' },
    quartz:   { name: 'Quartz',   mode: 'light', desc: 'Cool white, cobalt accent',     bg: '#f7f9fc', bg2: '#eef2f8', alt: '#e3e9f2', border: '#dae1eb', strong: '#c5cedc', text: '#17202c', muted: '#4f5c70', faint: '#8693a6', accent: '#2f6fe4' },
    sage:     { name: 'Sage',     mode: 'light', desc: 'Soft green-grey, forest accent', bg: '#f8faf8', bg2: '#eef2ee', alt: '#e3e9e3', border: '#dae1da', strong: '#c3cdc3', text: '#1b241d', muted: '#536056', faint: '#88958b', accent: '#2f7d4f' },
  };

  const ACCENTS = [
    ['', 'Theme default'], ['#d7dae2', 'Silver'], ['#ffffff', 'White'], ['#9fb4d8', 'Steel'], ['#6ea8ff', 'Sapphire'],
    ['#6fcf97', 'Jade'], ['#e0a458', 'Amber'], ['#f08a5d', 'Coral'], ['#f2737d', 'Garnet'], ['#e88ab8', 'Rose'], ['#a98bf5', 'Amethyst'], ['#2a2c33', 'Onyx'],
  ];

  const FONTS = {
    system: ['System default', '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'],
    inter: ['Inter', 'Inter, "Segoe UI", system-ui, sans-serif'],
    segoe: ['Segoe UI', '"Segoe UI", system-ui, sans-serif'],
    arial: ['Arial', 'Arial, Helvetica, sans-serif'],
    verdana: ['Verdana', 'Verdana, Geneva, sans-serif'],
    georgia: ['Georgia (serif)', 'Georgia, "Times New Roman", serif'],
    cascadia: ['Cascadia Code (mono)', '"Cascadia Code", "Cascadia Mono", Consolas, monospace'],
    custom: ['Custom…', null],
  };
  const MONO_FONTS = {
    default: ['Default', '"Cascadia Code", "JetBrains Mono", Consolas, "SF Mono", monospace'],
    consolas: ['Consolas', 'Consolas, monospace'],
    cascadia: ['Cascadia Code', '"Cascadia Code", "Cascadia Mono", monospace'],
    courier: ['Courier New', '"Courier New", monospace'],
  };

  const SEMANTIC = {
    dark:  { red: '#fb464c', orange: '#e9973f', yellow: '#e0de71', green: '#44cf6e', cyan: '#53dfdd', blue: '#4d9bff', purple: '#b59cf6', code: '#e6a46b' },
    light: { red: '#d92b3a', orange: '#c26a0e', yellow: '#9a8a00', green: '#0a8a3a', cyan: '#00838f', blue: '#1a66d6', purple: '#6b4fd8', code: '#a8471f' },
  };
  const GROUP_COLORS = {
    dark:  ['#86b8a0', '#d2a96c', '#8aa3c9', '#c99aa8', '#a9a3c6', '#c8bb93', '#79b4b2', '#c48770', '#a0b97f', '#b7bac4'],
    light: ['#2f8a63', '#a8711f', '#3c62a8', '#a8506a', '#6c5fae', '#8a7a3c', '#2a8582', '#a6563a', '#5d8a2e', '#6b6f7c'],
  };

  const UI_DEFAULTS = {
    appearance: {
      mode: 'dark', themeDark: 'onyx', themeLight: 'pearl', accent: '',
      zoom: 100, fontUi: 'system', fontCustom: '', fontMono: 'default', readingSize: 15,
      density: 'comfortable', radius: 6, reduceMotion: 'system', cssEnabled: true, cssSnippet: '',
    },
    layout: {
      ribbon: true, statusBar: true, mirror: false, readableWidth: 'medium', tabIcons: true,
      reopenLast: false, afterOrganize: 'structure', confirmApply: true, noticeSeconds: 5,
    },
    explorer: { tags: true, sizes: false, moveDots: true, guides: true, sort: 'name', foldersFirst: true },
    graph: { files: true, labels: true, nodeSize: 1, linkDistance: 1, repel: 1, textFade: 1, colorBy: 'folder' },
    extensions: { 'image-viewer': true, 'pdf-viewer': true, 'media-player': true, 'text-viewer': true, community: false },
    library: { browse: 'folders', view: 'list', sort: 'name', dir: 'asc', group: 'none', details: true, autoTag: 'rules', dblClick: 'preview', thumbs: true, treeTags: true, tagSort: 'count' },
    hotkeys: {},
    themes: {},          // the user's own color schemes, id -> theme
    workspace: null,     // panel layout (see renderer)
  };
  const THEME_KEYS = ['bg', 'bg2', 'alt', 'border', 'strong', 'text', 'muted', 'faint', 'accent'];

  // Build a whole palette from just a background and an accent
  function generateTheme(bg, accent, name) {
    const dark = lum(hexToRgb(bg)) < 0.3;
    const up = dark ? '#ffffff' : '#000000';
    const text = dark ? mix('#f1f2f5', accent, 0.05) : mix('#16171b', accent, 0.06);
    return {
      name: name || 'My theme', mode: dark ? 'dark' : 'light', desc: 'Your theme',
      bg, bg2: mix(bg, up, dark ? 0.035 : 0.035), alt: mix(bg, up, dark ? 0.075 : 0.075),
      border: mix(bg, up, dark ? 0.11 : 0.11), strong: mix(bg, up, dark ? 0.18 : 0.2),
      text, muted: mix(text, bg, dark ? 0.36 : 0.36), faint: mix(text, bg, dark ? 0.58 : 0.5), accent,
    };
  }
  function allThemes(ui) {
    const custom = (ui && ui.themes) || {};
    const out = Object.assign({}, PRESETS);
    for (const [id, th] of Object.entries(custom)) {
      if (!th || !th.bg) continue;
      const base = generateTheme(th.bg, th.accent || '#d7dae2', th.name);
      out[id] = Object.assign(base, th, { custom: true, mode: th.mode || base.mode });
    }
    return out;
  }

  // ------------------------------------------------------------------ color math
  function hexToRgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return [128, 128, 128];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
  function lum([r, g, b]) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(a, b) { const la = lum(hexToRgb(a)), lb = lum(hexToRgb(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  // nudge a color toward black/white until it reads on bg
  function readable(color, bg, min) {
    let c = color;
    const toward = lum(hexToRgb(bg)) < 0.3 ? '#ffffff' : '#000000';
    for (let i = 0; i < 20 && contrast(c, bg) < min; i++) c = mix(c, toward, 0.12);
    return c;
  }

  // ------------------------------------------------------------------ apply
  let systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let current = null;

  function merge(defs, val) {
    const out = {};
    for (const k of Object.keys(defs)) {
      const d = defs[k], v = val && val[k];
      out[k] = d && typeof d === 'object' && !Array.isArray(d) ? Object.assign({}, d, v || {}) : (v === undefined ? d : v);
    }
    return out;
  }

  function resolve(ui) {
    const u = merge(UI_DEFAULTS, ui);
    const a = u.appearance;
    let mode = a.mode === 'system' ? (systemDark && !systemDark.matches ? 'light' : 'dark') : a.mode;
    const presetId = mode === 'light' ? a.themeLight : a.themeDark;
    const themes = allThemes(u);
    let p = themes[presetId] || PRESETS[mode === 'light' ? 'pearl' : 'onyx'];
    mode = p.mode;
    return { u, a, mode, p, presetId };
  }

  function apply(ui, api) {
    const { u, a, mode, p } = resolve(ui);
    const root = document.documentElement.style;
    const dark = mode === 'dark';
    const accent = a.accent || p.accent;
    const accentRgb = hexToRgb(accent);
    const onAccent = contrast(accent, '#000000') >= contrast(accent, '#ffffff') ? '#0b0b0d' : '#ffffff';
    const sem = SEMANTIC[mode];
    const vars = {
      '--bg-primary': p.bg, '--bg-primary-alt': mix(p.bg, p.bg2, 0.5), '--bg-secondary': p.bg2, '--bg-secondary-alt': p.alt,
      '--border': p.border, '--border-strong': p.strong,
      '--text': p.text, '--text-muted': p.muted, '--text-faint': readable(p.faint, p.bg2, 4.5),
      '--accent': accent, '--accent-rgb': accentRgb.join(','), '--on-accent': onAccent, '--on-accent-rgb': hexToRgb(onAccent).join(','),
      '--accent-hover': mix(accent, dark ? '#ffffff' : '#000000', 0.12),
      '--text-accent': readable(accent, p.bg, 4.5),
      '--mono-rgb': dark ? '255,255,255' : '0,0,0', '--bg-rgb': hexToRgb(p.bg).join(','),
      '--hover': dark ? 'rgba(255,255,255,.055)' : 'rgba(0,0,0,.045)',
      '--hover-strong': dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)',
      '--active': 'rgba(' + accentRgb.join(',') + ',' + (dark ? .1 : .1) + ')',
      '--active-strong': 'rgba(' + accentRgb.join(',') + ',' + (dark ? .16 : .15) + ')',
      '--indent-guide': dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)',
      '--toggle-off': dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.18)',
      '--overlay': dark ? 'rgba(0,0,0,.6)' : 'rgba(20,20,28,.32)',
      '--tooltip-bg': dark ? mix(p.bg, '#000000', 0.4) : '#1d1e22', '--tooltip-text': dark ? p.text : '#f2f2f5',
      '--shadow': dark ? '0 2px 6px rgba(0,0,0,.3), 0 14px 40px rgba(0,0,0,.5)' : '0 2px 6px rgba(20,20,40,.08), 0 14px 40px rgba(20,20,40,.14)',
      '--code': sem.code,
      '--red': sem.red, '--red-rgb': hexToRgb(sem.red).join(','), '--orange': sem.orange, '--orange-rgb': hexToRgb(sem.orange).join(','),
      '--yellow': sem.yellow, '--green': sem.green, '--green-rgb': hexToRgb(sem.green).join(','), '--cyan': sem.cyan, '--cyan-rgb': hexToRgb(sem.cyan).join(','),
      '--blue': sem.blue, '--blue-rgb': hexToRgb(sem.blue).join(','), '--purple': sem.purple, '--purple-rgb': hexToRgb(sem.purple).join(','),
      '--callout-accent-rgb': hexToRgb(readable(accent, p.bg, 3)).join(','),
    };
    // fonts
    const fontStack = a.fontUi === 'custom' && a.fontCustom ? '"' + a.fontCustom.replace(/"/g, '') + '", ' + FONTS.system[1] : (FONTS[a.fontUi] || FONTS.system)[1] || FONTS.system[1];
    vars['--font'] = fontStack;
    vars['--mono'] = (MONO_FONTS[a.fontMono] || MONO_FONTS.default)[1];
    vars['--reading-size'] = (+a.readingSize || 15) + 'px';
    vars['--readable-width'] = { narrow: '640px', medium: '760px', wide: '980px', full: '100%' }[u.layout.readableWidth] || '760px';
    // shape + density
    const r = Math.max(0, Math.min(16, +a.radius));
    vars['--radius-s'] = Math.round(r * 0.66) + 'px'; vars['--radius-m'] = r + 'px'; vars['--radius-l'] = Math.round(r * 1.5) + 'px';
    const D = { compact: { row: 22, py: 2, item: 5, set: 10, pad: 9, gap: 0.82 }, comfortable: { row: 26, py: 3, item: 7, set: 14, pad: 12, gap: 1 }, spacious: { row: 32, py: 5, item: 10, set: 18, pad: 15, gap: 1.2 } }[a.density] || {};
    vars['--row-h'] = D.row + 'px'; vars['--row-py'] = D.py + 'px'; vars['--item-py'] = D.item + 'px'; vars['--setting-py'] = D.set + 'px'; vars['--pad'] = D.pad + 'px'; vars['--space'] = D.gap;
    // zoom keeps the native window-control area the right size
    const zoom = Math.max(70, Math.min(160, +a.zoom || 100)) / 100;
    vars['--controls-w'] = Math.ceil(140 / zoom) + 'px';
    vars['--header-h'] = Math.ceil(38 / zoom) + 'px';
    for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);

    const b = document.body.classList;
    b.toggle('theme-light', !dark); b.toggle('theme-dark', dark);
    const reduce = a.reduceMotion === 'on' || (a.reduceMotion === 'system' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    b.toggle('reduce-motion', reduce);
    b.toggle('hide-ribbon', !u.layout.ribbon);
    b.toggle('hide-statusbar', !u.layout.statusBar);
    b.toggle('mirrored', !!u.layout.mirror);
    b.toggle('hide-tab-icons', !u.layout.tabIcons);
    b.toggle('no-guides', !u.explorer.guides);
    b.toggle('no-tags', !u.explorer.tags);
    ['compact', 'comfortable', 'spacious'].forEach(d => b.toggle('density-' + d, a.density === d));

    // user CSS snippet
    let tag = document.getElementById('userCss');
    if (!tag) { tag = document.createElement('style'); tag.id = 'userCss'; document.head.appendChild(tag); }
    tag.textContent = a.cssEnabled ? (a.cssSnippet || '') : '';

    current = { mode, accent, preset: p, groupColors: Array.isArray(p.groups) && p.groups.length >= 4 ? p.groups : GROUP_COLORS[mode], text: p.text, muted: p.muted, faint: p.faint, bg: p.bg, border: p.border, onAccent };
    if (api) {
      api.setZoom && api.setZoom(zoom);
      api.setTitleBar && api.setTitleBar({ color: p.bg2, symbolColor: p.muted });
    }
    return current;
  }

  function onSystemChange(cb) { if (systemDark && systemDark.addEventListener) systemDark.addEventListener('change', cb); }

  window.OnyxTheme = {
    PRESETS, ACCENTS, FONTS, MONO_FONTS, UI_DEFAULTS, THEME_KEYS, GROUP_COLORS, apply, resolve, merge, onSystemChange,
    colors: () => current, contrast, hexToRgb, mix, generateTheme, allThemes, readable,
  };
})();
