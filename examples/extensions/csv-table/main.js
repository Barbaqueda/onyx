// A small community extension: shows .csv files as a table in Onyx's viewer.
// Install: copy this folder into Onyx's extensions folder (Settings → Extensions → Open folder),
// turn on "Allow community extensions", then turn on "CSV Table".
Onyx.registerExtension({
  id: 'hello-csv',
  name: 'CSV Table',
  version: '0.1.0',
  author: 'Example',
  icon: 'list',
  description: 'Shows CSV files as a table.',
  viewers: [{
    id: 'csv',
    label: 'CSV tables',
    priority: 20,                                   // higher than the built-in Text Viewer, so it wins for .csv
    match: file => file.extension === 'csv',
    render(el, api) {
      el.innerHTML = '<div style="margin:auto;color:var(--text-muted)">Loading…</div>';
      api.text().then(r => {
        if (!api.isCurrent()) return;               // you already moved on to another file
        if (r.error || r.binary) { api.noPreview('Couldn’t read this CSV.'); return; }
        const rows = r.text.trim().split(/\r?\n/).map(line => line.split(','));
        api.setInfo(rows.length + ' rows');
        el.innerHTML = '<div style="overflow:auto;flex:1;padding:24px"><table style="border-collapse:collapse;color:var(--text);font-size:13px">' +
          rows.map((cells, i) => '<tr>' + cells.map(c => '<' + (i ? 'td' : 'th') + ' style="padding:5px 12px;border:1px solid var(--border);text-align:left">' + api.esc(c) + '</' + (i ? 'td' : 'th') + '>').join('') + '</tr>').join('') +
          '</table></div>';
      });
      return { destroy() {} };
    },
  }],
});
