# Onyx

A smart file organizer for Windows, styled after Obsidian, in onyx black and silver.

Point Onyx at a messy folder and it plans a tidy structure. You review the plan as a tree, a list of changes, or a graph, adjust anything you like, then apply. Every apply can be undone.

## Build the Windows app

1. Download this repository (Code → Download ZIP) and unzip it.
2. Double-click **Build Onyx.bat**.

The script downloads the official Electron runtime (Windows x64) from GitHub and checks it against Electron's published checksums. It then adds Onyx and stamps the stone icon onto the exe. The result:

- `Downloads\onyx\Onyx.exe`
- shortcuts on your desktop and in the Start menu

Run it again any time to rebuild. The download is cached.

## How organizing works

- **Strategies:** AI smart, Smart rules (offline), By type, By date, By size, and Flatten.
- **Respects your folders:** Onyx reuses the folders you already have and understands synonyms (Images and Photos, for example). It spots series like `excavatorio1/2/3` and keeps them together.
- **Deep organize:** files inside general-purpose folders such as "New folder", "Documents" or "Other" get sorted. Folders you named yourself are left alone, and so are component folders whose parts belong together:
  - a website (HTML plus its JS and CSS)
  - a code project
  - a program with its DLLs
  - a 3D model with its textures
  - a music project
- **Safety:**
  - Onyx never overwrites a file; on a name clash it adds " (2)".
  - It refuses system folders and drive roots.
  - Paths are sanitized against `..` escapes.
  - Every apply writes an undo journal.

## Customization

Open Settings with Ctrl+, and the command palette with Ctrl+P.

- **Appearance:**
  - 12 built-in themes, light, dark or match Windows.
  - Build your own color scheme from two colors, then tweak any color. Contrast is checked as you edit, and schemes can be shared as codes.
  - Fonts, zoom, density and corner rounding.
- **Layout:**
  - Drag any panel tab (Files, Organize, Structure, Changes, Graph) into either sidebar or another tab bar.
  - Drop a tab on the edge of a pane to split it.
  - Presets: Classic, Swapped, Review, Stacked, Focus.
- **Rules:** keyword, extension, pattern, size and age rules. Lists of files to never move and folders to keep together or always sort inside. You can rename the built-in folders.
- **AI:** free.ai, any OpenAI-compatible API, Anthropic, or Pollinations. API keys are stored encrypted with the Windows credential store.
- **Hotkeys:** every shortcut can be changed.
- **Settings files:** export and import your settings.

### Adding an API key without typing it

Put a file named `ai-key.txt` containing the key next to `Onyx.exe`, or in `resources\app`, and start Onyx. On launch it imports the key encrypted and deletes the file. Never commit that file; it is in `.gitignore`.

## Development

Needs Node.js.

```
npm install
npm start          # run with Electron
npm test           # organizer, undo, settings and AI-provider tests (no Electron needed)
npm run dist       # electron-builder, Windows x64
```

| File | What it does |
| --- | --- |
| `main.js` | Electron main process: scanning, applying, undo, AI providers, settings |
| `preload.js` | the `window.onyx` bridge |
| `engine.js` | pure organizing logic, shared by main and renderer |
| `renderer.js`, `workspace.js`, `settings.js`, `theme.js`, `graph.js`, `icons.js` | the UI |
| `build-onyx.ps1` / `Build Onyx.bat` | the no-tools Windows build |
