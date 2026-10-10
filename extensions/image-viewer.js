/* Built-in extension: Image Viewer. Zoom (wheel, + −, 1 for actual size, 0 to fit), drag to pan, rotate (R),
   double-click to switch between fit and 100%. Formats Chromium can't draw (HEIC, TIFF, PSD, camera RAW) use the
   picture Windows makes of them. */
(function () {
  'use strict';
  const WEB = /^(jpe?g|jfif|pjpeg|png|apng|gif|webp|bmp|svg|ico|avif)$/;
  const SHELL = /^(heic|heif|tiff?|psd|cr2|cr3|nef|arw|dng|orf|rw2|raf|jxr|wdp)$/;

  function render(el, api) {
    let z = null, img = null, gone = false;
    el.innerHTML = '<div class="iv-stage"><img class="iv-img" alt="" draggable="false"></div><div class="iv-loading"><span class="spinner"></span></div>';
    const stage = el.querySelector('.iv-stage');
    img = el.querySelector('.iv-img');
    const box = () => stage.getBoundingClientRect();
    const fitScale = () => {
      if (!z) return 1;
      const b = box(), side = z.r % 180 !== 0;
      const w = side ? z.nh : z.nw, h = side ? z.nw : z.nh;
      return Math.max(0.01, Math.min(1, (b.width - 40) / w, (b.height - 40) / h));
    };
    const tools = () => z ? [
      { icon: 'minus', tip: 'Zoom out (−)', run: () => zoomTo(z.s / 1.25) },
      { text: Math.round(z.s * 100) + '%', tip: 'Actual size (1)', run: () => zoomTo(1) },
      { icon: 'plus', tip: 'Zoom in (+)', run: () => zoomTo(z.s * 1.25) },
      { icon: 'maximize', tip: 'Fit to window (0)', run: fit, active: z.fit },
      { icon: 'rotate-cw', tip: 'Rotate (R)', run: rotate },
    ] : [];
    function apply() {
      if (!z || gone) return;
      img.style.width = z.nw + 'px'; img.style.height = z.nh + 'px';
      img.style.transform = 'translate(-50%, -50%) translate(' + z.x + 'px, ' + z.y + 'px) rotate(' + z.r + 'deg) scale(' + z.s + ')';
      img.classList.toggle('is-pannable', z.s > fitScale() + 0.001);
      api.setToolbar(tools());
    }
    function fit() { if (!z) return; z.s = fitScale(); z.x = 0; z.y = 0; z.fit = true; apply(); }
    function zoomTo(s, px, py) {
      if (!z) return;
      s = Math.max(0.02, Math.min(32, s)); px = px || 0; py = py || 0;
      z.x = px - (px - z.x) * (s / z.s); z.y = py - (py - z.y) * (s / z.s);
      z.s = s; z.fit = false;
      if (s <= fitScale() + 0.001) { z.x = 0; z.y = 0; }
      apply();
    }
    function rotate() { if (!z) return; z.r = (z.r + 90) % 360; fit(); }
    function ready() {
      if (gone || !api.isCurrent()) return;
      const l = el.querySelector('.iv-loading'); if (l) l.remove();
      z = { s: 1, x: 0, y: 0, r: 0, nw: img.naturalWidth || 800, nh: img.naturalHeight || 600, fit: true };
      api.setInfo(z.nw + ' × ' + z.nh);
      fit();
    }
    async function useWindowsPicture(afterError) {
      let t = null;
      try { t = await api.thumb(1600); } catch { t = null; }
      if (gone || !api.isCurrent()) return;
      if (t && t.url && t.kind !== 'icon') { img.onerror = null; img.onload = ready; img.src = t.url; return; }
      api.noPreview(afterError ? 'Onyx couldn’t read this image. Its own app may still open it.' : 'Windows doesn’t have a preview for this image. Its own app can open it.');
    }
    img.onload = ready;
    if (SHELL.test(api.file.extension)) useWindowsPicture(false);
    else { img.onerror = () => useWindowsPicture(true); img.src = api.url; }

    const onWheel = e => {
      if (!z) return;
      e.preventDefault();
      const b = box();
      zoomTo(z.s * Math.pow(1.0015, -e.deltaY), e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2);
    };
    const onDown = e => {
      if (e.button !== 0 || !z || z.s <= fitScale() + 0.001) return;
      e.preventDefault();
      const sx = e.clientX - z.x, sy = e.clientY - z.y;
      img.classList.add('is-panning');
      const mm = ev => { z.x = ev.clientX - sx; z.y = ev.clientY - sy; apply(); };
      const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); img.classList.remove('is-panning'); };
      window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    };
    const onDbl = e => {
      if (!z) return;
      const b = box();
      if (!z.fit) fit(); else zoomTo(1, e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('mousedown', onDown);
    stage.addEventListener('dblclick', onDbl);
    return {
      onKey(e) {
        if (!z || e.ctrlKey || e.metaKey || e.altKey) return false;
        const k = e.key;
        if (k === '+' || k === '=') { zoomTo(z.s * 1.25); return true; }
        if (k === '-' || k === '_') { zoomTo(z.s / 1.25); return true; }
        if (k === '0') { fit(); return true; }
        if (k === '1') { zoomTo(1); return true; }
        if (k === 'r' || k === 'R') { rotate(); return true; }
        return false;
      },
      resize() { if (z && z.fit) fit(); },
      destroy() { gone = true; img.removeAttribute('src'); },
    };
  }

  Onyx.registerExtension({
    id: 'image-viewer',
    name: 'Image Viewer',
    version: '1.0.0',
    author: 'Onyx',
    icon: 'image',
    description: 'Look at photos and pictures inside Onyx: zoom, pan, rotate and flip through a folder. Also shows HEIC, TIFF, PSD and camera RAW files using the preview Windows makes of them.',
    viewers: [{
      id: 'image', label: 'Images', priority: 10,
      match: f => WEB.test(f.extension || '') || SHELL.test(f.extension || ''),
      render,
      prefetch: api => { if (WEB.test(api.file.extension)) { const i = new Image(); i.src = api.url; } },
    }],
  });
})();
