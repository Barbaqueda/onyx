/* Lightweight force-directed graph, drawn on canvas (in the spirit of Obsidian's graph view) */
(function () {
  'use strict';

  class OnyxGraph {
    constructor(container, opts) {
      this.opts = Object.assign({ labels: true, onOpen: null, onSelect: null, onHover: null }, opts || {});
      this._col = Object.assign({ link: 'rgba(200,206,220,.13)', dim: 'rgba(255,255,255,.04)', lit: 'rgba(232,236,245,.85)', focus: '#ffffff', text: '#e6e6ea', muted: '#9a9ba4', font: '"Segoe UI", sans-serif' }, this.opts.colors || {});
      this.forces = Object.assign({ repel: 1, linkDistance: 1, nodeSize: 1, textFade: 1 }, this.opts.forces || {});
      this.container = container;
      this.canvas = document.createElement('canvas');
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.nodes = []; this.links = []; this.byId = new Map(); this.adj = new Map();
      this.t = { x: 0, y: 0, k: 1 };
      this.alpha = 0; this.hover = null; this.drag = null; this.pan = null;
      this.raf = 0; this.dirty = true; this.fitted = false;
      this._bind();
      this.ro = new ResizeObserver(() => this._resize());
      this.ro.observe(container);
      this._resize();
      this._loop = this._loop.bind(this);
      this.raf = requestAnimationFrame(this._loop);
    }

    setData(data, keepView) {
      const old = this.byId;
      this.nodes = data.nodes.map(n => {
        const o = old.get(n.id);
        return Object.assign({ x: o ? o.x : NaN, y: o ? o.y : NaN, vx: 0, vy: 0 }, n);
      });
      this.byId = new Map(this.nodes.map(n => [n.id, n]));
      this.links = data.links.filter(l => this.byId.has(l.s) && this.byId.has(l.t)).map(l => ({ s: this.byId.get(l.s), t: this.byId.get(l.t), base: l.len || 40, len: (l.len || 40) * this.forces.linkDistance }));
      this.adj = new Map(this.nodes.map(n => [n, new Set()]));
      for (const l of this.links) { this.adj.get(l.s).add(l.t); this.adj.get(l.t).add(l.s); }
      // seed positions: children around their parent
      const placed = new Set(this.nodes.filter(n => !isNaN(n.x)));
      const root = this.nodes.find(n => n.kind === 'root') || this.nodes[0];
      if (root && isNaN(root.x)) { root.x = 0; root.y = 0; placed.add(root); }
      const queue = root ? [root] : [];
      while (queue.length) {
        const p = queue.shift();
        const kids = [...this.adj.get(p)].filter(c => !placed.has(c));
        kids.forEach((c, i) => {
          const a = (i / Math.max(1, kids.length)) * Math.PI * 2 + Math.random() * .4;
          const d = c.kind === 'file' ? 30 : 70;
          c.x = p.x + Math.cos(a) * d; c.y = p.y + Math.sin(a) * d;
          placed.add(c); queue.push(c);
        });
      }
      for (const n of this.nodes) if (isNaN(n.x)) { n.x = (Math.random() - .5) * 200; n.y = (Math.random() - .5) * 200; }
      this.alpha = 1;
      if (!keepView) {
        for (let i = 0; i < 160; i++) this._tick();   // pre-settle so the first frame looks calm
        this.fit();
      }
      this.dirty = true;
    }

    fit() {
      if (!this.nodes.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of this.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      const w = this.w || 800, h = this.h || 600;
      const k = Math.min(2, Math.max(0.15, Math.min(w / (x1 - x0 + 160), h / (y1 - y0 + 160))));
      this.t = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
      this.dirty = true;
    }

    setForces(f) { Object.assign(this.forces, f); for (const l of this.links) l.len = l.base * this.forces.linkDistance; this.reheat(.6); this.dirty = true; }
    setColors(c) { this._col = Object.assign({}, this._col, c); this.dirty = true; }
    reheat(a) { this.alpha = Math.max(this.alpha, a || .5); }
    setLabels(on) { this.opts.labels = on; this.dirty = true; }

    destroy() {
      cancelAnimationFrame(this.raf); this.ro.disconnect();
      window.removeEventListener('mousemove', this._mm); window.removeEventListener('mouseup', this._mu);
      this.canvas.remove();
    }

    // ------------------------------------------------------------- physics
    _tick() {
      const N = this.nodes, a = this.alpha;
      const rep = 900 * a * this.forces.repel;
      for (let i = 0; i < N.length; i++) {
        const p = N[i];
        for (let j = i + 1; j < N.length; j++) {
          const q = N[j];
          let dx = p.x - q.x, dy = p.y - q.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 160000) continue;
          if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
          const w = (p.kind === 'file' ? 1 : 2.2) * (q.kind === 'file' ? 1 : 2.2);
          const f = rep * w / d2;
          const fx = dx * f / Math.sqrt(d2), fy = dy * f / Math.sqrt(d2);
          p.vx += fx; p.vy += fy; q.vx -= fx; q.vy -= fy;
        }
      }
      for (const l of this.links) {
        const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - l.len) * 0.06 * a / d;
        l.s.vx += dx * f; l.s.vy += dy * f; l.t.vx -= dx * f; l.t.vy -= dy * f;
      }
      for (const n of N) {
        n.vx -= n.x * 0.003 * a; n.vy -= n.y * 0.003 * a;
        if (n === (this.drag && this.drag.node)) { n.vx = n.vy = 0; continue; }
        n.vx *= 0.55; n.vy *= 0.55;
        const v = Math.hypot(n.vx, n.vy); if (v > 30) { n.vx *= 30 / v; n.vy *= 30 / v; }
        n.x += n.vx; n.y += n.vy;
      }
      this.alpha *= 0.985;
    }

    _loop() {
      if (this.alpha > 0.004) { this._tick(); this.dirty = true; }
      if (this.dirty) { this._draw(); this.dirty = false; }
      this.raf = requestAnimationFrame(this._loop);
    }

    // ------------------------------------------------------------- drawing
    _resize() {
      const r = this.container.getBoundingClientRect();
      this.w = r.width; this.h = r.height; this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, r.width * this.dpr); this.canvas.height = Math.max(1, r.height * this.dpr);
      this.dirty = true;
    }

    _draw() {
      const c = this.ctx, t = this.t, dpr = this.dpr;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      c.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * (this.w / 2 + t.x), dpr * (this.h / 2 + t.y));
      const focus = this.hover || (this.drag && this.drag.node);
      const near = focus ? this.adj.get(focus) : null;
      const isNear = n => !focus || n === focus || near.has(n);

      // links
      c.lineWidth = 1 / t.k;
      for (const l of this.links) {
        const lit = focus && (l.s === focus || l.t === focus);
        c.strokeStyle = lit ? this._col.lit : focus ? this._col.dim : this._col.link;
        c.beginPath(); c.moveTo(l.s.x, l.s.y); c.lineTo(l.t.x, l.t.y); c.stroke();
      }
      // nodes
      for (const n of this.nodes) {
        c.globalAlpha = isNear(n) ? 1 : 0.2;
        c.fillStyle = n === focus ? this._col.focus : n.color;
        c.beginPath(); c.arc(n.x, n.y, n.r * this.forces.nodeSize, 0, Math.PI * 2); c.fill();
        if (n.ring) { c.lineWidth = 1.5 / t.k; c.strokeStyle = n.ring; c.beginPath(); c.arc(n.x, n.y, n.r * this.forces.nodeSize + 3 / t.k + 1, 0, Math.PI * 2); c.stroke(); }
      }
      c.globalAlpha = 1;
      // labels (constant on-screen size, fade with zoom like Obsidian)
      if (this.opts.labels || focus) {
        const fs = 12 / t.k;
        c.font = '500 ' + fs + 'px ' + this._col.font;
        c.textAlign = 'center'; c.textBaseline = 'top';
        // labels never overlap: bigger and focused nodes claim their space first, the rest skip
        const avoid = this.nodes.length < 1500;
        const order = avoid ? this.nodes.slice().sort((a, b) => (b === focus) - (a === focus) || (a.kind === 'file') - (b.kind === 'file') || b.r - a.r) : this.nodes;
        const taken = [];
        const pad = 3 / t.k;
        for (const n of order) {
          let o;
          if (focus) o = isNear(n) ? 1 : 0;
          else if (!this.opts.labels) o = 0;
          else if (n.kind === 'file') o = Math.min(1, Math.max(0, (t.k - 1.3 * this.forces.textFade) / 0.5));
          else o = Math.min(1, Math.max(0, (t.k - 0.3 * this.forces.textFade) / 0.3));
          if (o <= 0.02) continue;
          const ly = n.y + n.r * this.forces.nodeSize + 4 / t.k;
          if (avoid) {
            const w = c.measureText(n.label).width / 2 + pad;
            const box = [n.x - w, ly - pad, n.x + w, ly + fs + pad];
            if (n !== focus && taken.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
            taken.push(box);
          }
          c.globalAlpha = o * (n.kind === 'file' ? .8 : 1);
          c.fillStyle = n === focus ? this._col.text : n.kind === 'file' ? this._col.muted : this._col.text;
          c.fillText(n.label, n.x, ly);
        }
        c.globalAlpha = 1;
      }
    }

    // ------------------------------------------------------------- interaction
    _world(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left - this.w / 2 - this.t.x) / this.t.k, y: (e.clientY - r.top - this.h / 2 - this.t.y) / this.t.k };
    }
    _hit(p) {
      let best = null, bd = Infinity;
      for (const n of this.nodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < n.r * this.forces.nodeSize + 4 / this.t.k && d < bd) { best = n; bd = d; }
      }
      return best;
    }
    _bind() {
      const cv = this.canvas;
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left - this.w / 2, my = e.clientY - r.top - this.h / 2;
        const k0 = this.t.k, k1 = Math.min(6, Math.max(0.08, k0 * Math.exp(-e.deltaY * 0.0015)));
        this.t.x = mx - (mx - this.t.x) * (k1 / k0); this.t.y = my - (my - this.t.y) * (k1 / k0); this.t.k = k1;
        this.dirty = true;
      }, { passive: false });
      cv.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const p = this._world(e), n = this._hit(p);
        this.moved = false;
        if (n) { this.drag = { node: n }; this.reheat(.3); }
        else this.pan = { x: e.clientX, y: e.clientY, tx: this.t.x, ty: this.t.y };
        cv.classList.add('grabbing');
      });
      this._mm = e => {
        if (this.drag) {
          const p = this._world(e); this.drag.node.x = p.x; this.drag.node.y = p.y; this.moved = true; this.reheat(.25); this.dirty = true;
        } else if (this.pan) {
          this.t.x = this.pan.tx + e.clientX - this.pan.x; this.t.y = this.pan.ty + e.clientY - this.pan.y; this.moved = true; this.dirty = true;
        } else if (e.target === cv) {
          const n = this._hit(this._world(e));
          if (n !== this.hover) { this.hover = n; this.dirty = true; cv.classList.toggle('pointer', !!n); this.opts.onHover && this.opts.onHover(n, e); }
          else if (n && this.opts.onHover) this.opts.onHover(n, e);
        }
      };
      this._mu = () => {
        if (this.drag && !this.moved && this.opts.onSelect) this.opts.onSelect(this.drag.node);
        this.drag = null; this.pan = null; cv.classList.remove('grabbing'); this.dirty = true;
      };
      window.addEventListener('mousemove', this._mm);
      window.addEventListener('mouseup', this._mu);
      cv.addEventListener('mouseleave', () => { if (this.hover) { this.hover = null; this.dirty = true; this.opts.onHover && this.opts.onHover(null); } });
      cv.addEventListener('dblclick', e => { const n = this._hit(this._world(e)); if (n && this.opts.onOpen) this.opts.onOpen(n); });
    }
  }

  window.OnyxGraph = OnyxGraph;
})();
