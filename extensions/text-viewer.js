/* Built-in extension: Text Viewer. Reads text, notes, logs, CSV and code files inside Onyx (the first 1 MB). */
(function () {
  'use strict';
  const TXT = /^(txt|text|md|markdown|log|csv|tsv|json|jsonc|xml|yml|yaml|toml|ini|cfg|conf|env|properties|js|mjs|cjs|ts|tsx|jsx|css|scss|less|html?|vue|svelte|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|bat|cmd|ps1|psm1|sql|lua|r|swift|dart|gitignore|gitattributes|editorconfig|srt|vtt|nfo|reg|tex)$/;
  Onyx.registerExtension({
    id: 'text-viewer',
    name: 'Text Viewer',
    version: '1.0.0',
    author: 'Onyx',
    icon: 'file-text',
    description: 'Read text, notes, logs, CSV and code files inside Onyx, with line numbers.',
    viewers: [{
      id: 'text', label: 'Text and code', priority: 0,
      match: f => TXT.test(f.extension || '') || (!f.extension && f.size < 512 * 1024),
      render(el, api) {
        el.innerHTML = '<div class="tv-loading"><span class="spinner"></span></div>';
        api.text().then(r => {
          if (!api.isCurrent()) return;
          if (!r || r.error) { api.noPreview(r && r.error ? r.error : 'Couldn’t read it.'); return; }
          if (r.binary) { api.noPreview('This isn’t a text file, so there’s nothing readable to show.'); return; }
          const lines = r.text.split(/\r?\n/);
          api.setInfo(lines.length.toLocaleString() + ' lines');
          el.innerHTML = '<div class="tv-wrap" tabindex="0"><pre class="tv-text"><code>' + lines.map((l, i) => '<span class="ln">' + (i + 1) + '</span>' + api.esc(l)).join('\n') + '</code></pre>' +
            (r.truncated ? '<div class="tv-more">Showing the first 1 MB of ' + api.esc(api.fmt(r.size)) + '. Open it to see the rest.</div>' : '') + '</div>';
        });
        return {
          onKey(e) {
            // ↑ ↓ scroll the text instead of changing file
            const w = el.querySelector('.tv-wrap'); if (!w) return false;
            if (e.key === 'ArrowDown') { w.scrollTop += 40; return true; }
            if (e.key === 'ArrowUp') { w.scrollTop -= 40; return true; }
            return false;
          },
        };
      },
    }],
  });
})();
