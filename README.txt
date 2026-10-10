Onyx 2.4 - source
=================

EASIEST: double-click "Build Onyx.bat"
  It downloads the official Electron runtime (Windows x64) from GitHub,
  checks it, adds Onyx, and creates:
    Downloads\onyx\Onyx.exe   (+ desktop and Start menu shortcuts)
  then launches it. Run it again any time to rebuild; the download is cached.

LIBRARY AND TAGS (Ctrl+L)
  A better file explorer: browse folder by folder like Windows Explorer
  (address bar, Back/Forward/Up, Alt+arrows, Backspace, double-click to
  open), or every file in one list. List or grid, thumbnails, a details
  panel, and tags.
  This PC     browse whole drives (C:\), your user folder or Program Files.
               Browse-only: search, open and tag anything, but Onyx won't
               reorganize them. Right-click a folder > Organize this folder.
  Tags         added automatically from names (offline), by AI (one click,
               names only), or by hand: select files and press #, or drag
               them onto a tag. Tags live in Onyx's app-data folder; your
               files are never changed. Tags follow files when Onyx moves them.
  Search       #invoice  -#draft  type:pdf  kind:image  size:>100mb
               modified:<7d  modified:2024  in:Documents  is:untagged
               is:duplicate  "exact words"
  Quick find   Ctrl+K from anywhere. Enter shows it, Ctrl+Enter opens it.
  Tags panel   all tags with counts, recent, untagged, duplicates, large
               files, kinds and your saved searches.
  By tag       an Organize strategy: a folder for each file's main tag.

MAKE IT YOURS (Settings: Ctrl+,  -  Command palette: Ctrl+P)
  Appearance   12 themes (8 dark, 4 light), light/dark/match Windows,
               build your own color scheme (pick 2 colors and Onyx
               generates the rest, then tweak any color; share as code),
               any accent color, interface zoom, fonts, reading size,
               density, corner roundness, reduced motion
  Layout       drag any panel tab (Graph, Structure, Changes, Files,
               Organize) into either sidebar, another tab bar, or the
               edge of a pane to split it. Right-click a tab for the same
               options. Presets: Classic, Swapped, Review, Stacked, Focus
  File explorer  sort order, folders first, type tags, sizes, guides
  Graph view   node size, link distance, repel force, labels, colors
  Organizing   Smart (default): re-sorts files inside general folders like
               "New folder" or "Documents", keeps your named folders, and
               keeps component folders together (a website with html + js,
               a code project, a game with its dlls, a model with textures).
               Also "All subfolders" and "Top level only"
  My rules     "Name contains minecraft -> Games/Minecraft", by extension,
               pattern, size or age; a never-move list; folders to
               always keep together or always sort inside; rename built-in
               folders (Images -> Pictures)
  AI           free.ai, OpenAI-compatible, Anthropic or Pollinations;
               model, key (stored encrypted), and your own instructions
  Hotkeys      change any shortcut
  Advanced     custom CSS, export/import settings, resets

REVIEWING A PLAN
  Right-click any file: Move to..., Keep in place, Always put files like
  this in..., Never move this file. Right-click a new folder to rename it.
  Drop a folder on the window to open it. Arrow keys work in the trees.

FOR DEVELOPERS (needs Node.js):
  npm install / npm start / npm run dist
