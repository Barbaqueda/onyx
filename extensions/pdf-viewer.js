/* Built-in extension: PDF Viewer. Uses the viewer built into Chromium (the same one as Chrome and Edge):
   pages, zoom, page thumbnails, search (Ctrl+F inside it), rotate, print and save. */
(function () {
  'use strict';
  Onyx.registerExtension({
    id: 'pdf-viewer',
    name: 'PDF Viewer',
    version: '1.0.0',
    author: 'Onyx',
    icon: 'file-text',
    description: 'Read PDFs inside Onyx with the viewer from Chrome and Edge: pages, zoom, search, rotate and print. Also shows the first page in the details pane.',
    viewers: [{
      id: 'pdf', label: 'PDF documents', priority: 10,
      match: f => (f.extension || '') === 'pdf',
      detailsReplacePreview: true,
      render(el, api) {
        el.innerHTML = '<iframe class="pdf-frame" title="' + api.esc(api.file.name) + '"></iframe>';
        const fr = el.querySelector('iframe');
        fr.src = api.url;
        return { destroy() { fr.src = 'about:blank'; } };
      },
      // the details pane: the first page, loaded a moment after you stop on a PDF so arrowing through a folder stays quick
      details(api) {
        return '<div class="pdf-mini"><span class="spinner"></span><button class="pdf-mini-open" data-lib="preview" aria-label="Preview" data-tip="Preview (Space)"></button></div>';
      },
      afterDetails(el, api) {
        const t = setTimeout(() => {
          const box = el.querySelector('.pdf-mini');
          if (!box || box.querySelector('iframe')) return;
          const fr = document.createElement('iframe');
          fr.tabIndex = -1; fr.title = 'First page';
          fr.src = api.url + '#toolbar=0&navpanes=0&view=FitH';
          box.insertBefore(fr, box.firstChild);
          setTimeout(() => { const sp = box.querySelector('.spinner'); if (sp) sp.remove(); }, 700);
        }, 300);
        return () => clearTimeout(t);
      },
    }],
  });
})();
