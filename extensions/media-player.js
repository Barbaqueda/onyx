/* Built-in extension: Media Player. Plays video and sound inside Onyx, and puts a play button for sounds in the
   details pane, so you can audition samples while you sort them. */
(function () {
  'use strict';
  const VID = /^(mp4|m4v|webm|mov|ogv)$/;
  const AUD = /^(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba)$/;
  Onyx.registerExtension({
    id: 'media-player',
    name: 'Media Player',
    version: '1.0.0',
    author: 'Onyx',
    icon: 'film',
    description: 'Play video (MP4, WebM, MOV) and sound (MP3, WAV, FLAC, OGG, M4A) inside Onyx. Sounds get a play button in the details pane, handy for auditioning samples.',
    viewers: [
      {
        id: 'video', label: 'Video', priority: 10,
        match: f => VID.test(f.extension || ''),
        render(el, api) {
          el.innerHTML = '<video class="mp-video" controls autoplay preload="metadata"></video>';
          const v = el.querySelector('video');
          v.onerror = () => api.noPreview('Onyx can’t play this video. It may use a format only its own app understands.');
          v.onloadedmetadata = () => { if (v.videoWidth) api.setInfo(v.videoWidth + ' × ' + v.videoHeight + ' · ' + time(v.duration)); };
          v.src = api.url;
          return { destroy() { v.pause(); v.removeAttribute('src'); v.load(); } };
        },
      },
      {
        id: 'audio', label: 'Sound', priority: 10,
        match: f => AUD.test(f.extension || ''),
        render(el, api) {
          el.innerHTML = '<div class="mp-audio"><div class="mp-art">' + api.icon('music') + '</div><div class="mp-name">' + api.esc(api.file.name) + '</div><audio controls autoplay preload="metadata"></audio></div>';
          const a = el.querySelector('audio');
          a.onerror = () => api.noPreview('Onyx can’t play this sound. It may use a format only its own app understands.');
          a.onloadedmetadata = () => { if (isFinite(a.duration)) api.setInfo(time(a.duration)); };
          a.src = api.url;
          return { destroy() { a.pause(); a.removeAttribute('src'); a.load(); } };
        },
        details(api) { return '<audio class="mp-mini" controls preload="none" src="' + api.esc(api.url) + '"></audio>'; },
        afterDetails(el) { return () => { const a = el.querySelector('audio'); if (a) a.pause(); }; },
      },
    ],
  });
  function time(s) { if (!isFinite(s)) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
})();
