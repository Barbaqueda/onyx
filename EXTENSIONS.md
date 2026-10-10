# Making an Onyx extension

Extensions add things Onyx can do. Today an extension can add **viewers**: something that shows a kind of file inside Onyx when you press <kbd>Space</kbd>, double-click, or select it (the details pane).

Onyx's own viewers are extensions too, and they're good examples to copy:

| Extension | File | Shows |
| --- | --- | --- |
| Image Viewer | [`extensions/image-viewer.js`](extensions/image-viewer.js) | JPG, PNG, GIF, WebP, SVG… plus HEIC, TIFF, PSD and RAW through Windows' previews |
| PDF Viewer | [`extensions/pdf-viewer.js`](extensions/pdf-viewer.js) | PDFs, with Chromium's viewer |
| Media Player | [`extensions/media-player.js`](extensions/media-player.js) | video and sound |
| Text Viewer | [`extensions/text-viewer.js`](extensions/text-viewer.js) | text, notes, logs and code |

You can turn each of them on and off in **Settings → Extensions**.

## Installing a community extension

1. **Settings → Extensions → Open folder.** That's `%APPDATA%\Onyx\extensions`.
2. Put the extension there in its own folder (for example `extensions\csv-table\`).
3. Turn on **Allow community extensions**, click **Reload**, then turn the extension on.

> Community extensions run inside Onyx with the same access Onyx has, so they could read or change your files. Only install ones you trust.

## The files

```
csv-table/
├── manifest.json
└── main.js
```

**manifest.json**

```json
{
  "id": "hello-csv",
  "name": "CSV Table",
  "version": "0.1.0",
  "author": "You",
  "description": "Shows CSV files as a table.",
  "main": "main.js"
}
```

`id` uses lowercase letters, numbers and dashes, and must match the id your script registers. A community extension can't take over a built-in id.

**main.js** calls `Onyx.registerExtension`. The complete example is in [`examples/extensions/csv-table`](examples/extensions/csv-table/main.js):

```js
Onyx.registerExtension({
  id: 'hello-csv', name: 'CSV Table', version: '0.1.0', author: 'You', icon: 'list',
  description: 'Shows CSV files as a table.',
  viewers: [{
    id: 'csv', label: 'CSV tables', priority: 20,
    match: file => file.extension === 'csv',
    render(el, api) {
      api.text().then(r => { if (api.isCurrent()) el.textContent = r.text; });
      return { destroy() {} };
    },
  }],
});
```

## Viewers

| Field | |
| --- | --- |
| `id`, `label` | `label` is shown in Settings ("Shows: CSV tables"). |
| `match(file)` | Return `true` for files this viewer can show. `file` is `{ name, path, extension, size, lastModified }`; `extension` is lowercase without the dot. |
| `priority` | When several enabled viewers match, the highest wins. Built-ins use 0 (text) and 10 (everything else). |
| `render(el, api)` | Draw the file into `el` (a flex container filling the viewer). Return a controller (below) or nothing. |
| `details(api)` | Optional. HTML for a small preview in the details pane. |
| `detailsReplacePreview` | Optional. `true` puts your details preview in place of the thumbnail instead of under it. |
| `afterDetails(el, api)` | Optional. Called once your details HTML is on screen; return a function to clean up. |
| `prefetch(api)` | Optional. Called for the next file in the folder, so you can start loading it. |

**The controller** `render` returns can have:

- `destroy()`: called when the viewer closes or moves to another file. Stop playback, timers and listeners here.
- `onKey(event)`: return `true` if you handled the key. You see keys before Onyx does (Onyx uses Esc, Space, ← → Home End and Enter).
- `resize()`: the window changed size.

## The `api` object

| | |
| --- | --- |
| `api.file` | The file (read-only). |
| `api.url` | A URL for the file's contents, usable in `<img>`, `<video>`, `<audio>`, `<iframe>` and `fetch()`. It only works for files inside the folder that's open. |
| `api.text()` | Promise of `{ text, truncated, size }` (the first 1 MB), or `{ binary: true }`, or `{ error }`. |
| `api.thumb(size)` | Promise of the picture Windows makes of the file: `{ url, kind }` (`kind` is `'icon'` when it's just the file-type icon). |
| `api.setToolbar(items)` | Buttons in the viewer's bar: `{ icon, tip, label, text, active, disabled, run }`, or `'sep'`. Call it again to update them. |
| `api.setInfo(text)` | Extra text next to the file name, like `"1920 × 1080"`. |
| `api.noPreview(message)` | Give up and show Onyx's "no preview" screen with your message. |
| `api.isCurrent()` | `false` once the person has moved to another file. Check it after anything asynchronous. |
| `api.open()`, `api.reveal()` | Open in the file's own app; show it in File Explorer. |
| `api.icon(name)`, `api.esc(text)`, `api.fmt(bytes)`, `api.notice(html, type)` | Onyx's icons (Lucide names), HTML escaping, "2.3 MB" formatting, and a notice. |

Style with Onyx's CSS variables (`var(--text)`, `var(--text-muted)`, `var(--border)`, `var(--bg-primary)`, `var(--accent)`…) so your extension follows the theme, light or dark.
