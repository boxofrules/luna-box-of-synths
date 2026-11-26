// Box Of Synths' other controls, as the plug-in draws them (MOSS theme): the selector dial with a
// mark per choice round it (a wave glyph, or a short word), the popup menu its long lists use,
// and the envelope drawn as a graph with handles. Painting only; main.js binds them to LUNA.

(() => {
  const D = globalThis.SynthsDial;
  const M = D.MOSS;

  function fitCanvas(canvas) {
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  // ---------------------------------------------------------------- wave glyphs

  /** The glyph for a wave name, or undefined (then the mark is a short word). */
  const GLYPHS = {
    SAW: (p) => p([[0, 1], [1, 0], [1, 1]]),
    SQUARE: (p) => p([[0, 1], [0, 0], [0.5, 0], [0.5, 1], [1, 1], [1, 0]]),
    PULSE: (p) => p([[0, 1], [0, 0], [0.25, 0], [0.25, 1], [1, 1], [1, 0]]),
    TRI: (p) => p([[0, 1], [0.5, 0], [1, 1]]),
    SINE: (p) => p(Array.from({ length: 17 }, (_, i) => [i / 16, 0.5 - 0.5 * Math.sin((i / 16) * Math.PI * 2)])),
    HARMONIC: (p) => p(Array.from({ length: 25 }, (_, i) => { const t = i / 24; return [t, 0.5 - 0.32 * Math.sin(t * Math.PI * 2) - 0.18 * Math.sin(t * Math.PI * 6)]; })),
    'S&H': (p) => p([[0, 0.7], [0.25, 0.7], [0.25, 0.2], [0.5, 0.2], [0.5, 0.9], [0.75, 0.9], [0.75, 0.4], [1, 0.4]]),
    MORE: (p, g, x, y, s) => {
      // an arrow: the rest of the bank is in the menu
      p([[0.05, 0.5], [0.95, 0.5]]);
      p([[0.6, 0.15], [0.95, 0.5], [0.6, 0.85]]);
    },
  };
  function drawGlyph(g, name, cx, cy, size, colour) {
    const fn = GLYPHS[name];
    if (!fn) return false;
    const x0 = cx - size / 2, y0 = cy - size / 2;
    g.strokeStyle = colour;
    g.lineWidth = 1.4;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const poly = (pts) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x0 + x * size, y0 + y * size * 0.8 + size * 0.1) : g.moveTo(x0 + x * size, y0 + y * size * 0.8 + size * 0.1)));
      g.stroke();
    };
    fn(poly, g, x0, y0, size);
    return true;
  }

  /** A short word for a choice with no glyph: "OSC 2" -> "2", "PARALLEL" -> "PAR". */
  function shortWord(name) {
    const n = String(name).toUpperCase();
    if (n === 'NONE') return 'OFF';
    const osc = /^OSC (\d)$/.exec(n);
    if (osc) return osc[1];
    const known = { PARALLEL: 'PAR', SERIAL: 'SER', TRIANGLE: 'TRI', PRESENT: 'PRES', QUIET: 'QUIET', FORMANT: 'FORM', CUTOFF: 'CUT', DECAY: 'DEC' };
    if (known[n]) return known[n];
    return n.length <= 5 ? n : n.slice(0, 4);
  }

  // ---------------------------------------------------------------- the selector dial

  const A0 = Math.PI * 1.2, A1 = Math.PI * 2.8;

  /**
   * Where each mark sits round a selector dial of `n` positions (plus a "more" mark when the list
   * is longer than its marks), in the canvas's own pixels. Two marks sit under the dial, either
   * side, as the plug-in's SUB WAVE does; more spread over its travel.
   */
  function markLayout(w, h, n, more) {
    const cx = w / 2, cy = h * 0.47, rad = Math.min(w, h) * 0.22, ring = rad + Math.min(w, h) * 0.25;
    const total = n + (more ? 1 : 0);
    const marks = [];
    for (let i = 0; i < total; i++) {
      const a = total === 1 ? (A0 + A1) / 2 : A0 + (i / (total - 1)) * (A1 - A0);
      marks.push({ x: cx + Math.sin(a) * ring, y: cy - Math.cos(a) * ring, angle: a });
    }
    return { cx, cy, rad, marks };
  }

  /**
   * Paint a selector dial: the dial pointing at choice `index` of `names` (the first `marks` of
   * them carry marks; the rest are reached through the menu), the marks round it, the chosen one
   * lit in `colour`. A choice past the marks leaves the pointer straight down and lights the
   * "more" mark, as the plug-in does for a bank wave.
   */
  function paintSelector(canvas, { names, index, marks, colour, hover }) {
    const { g, w, h } = fitCanvas(canvas);
    const n = Math.min(marks, names.length);
    const more = names.length > n;
    const L = markLayout(w, h, n, more);
    const onMark = index < n ? index : more ? n : -1;
    // the dial itself, drawn by the dial painter on a square in the middle
    const size = L.rad * 2 + Math.min(12, L.rad * 0.6);
    const norm = onMark < 0 ? 0.5 : (n + (more ? 1 : 0)) > 1 ? onMark / (n + (more ? 1 : 0) - 1) : 0.5;
    paintInto(g, L.cx, L.cy, size, { norm, colour, hover });
    L.marks.forEach((m, i) => {
      const lit = i === onMark;
      const c = lit ? colour : M.mute;
      const name = i < n ? String(names[i]).toUpperCase() : 'MORE';
      if (!drawGlyph(g, name, m.x, m.y, 11, c)) {
        g.fillStyle = c;
        g.font = `${lit ? 600 : 400} 8.5px "Plex Mono", ui-monospace, monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(shortWord(names[i]), m.x, m.y);
      }
    });
    return L;
  }

  /** The dial painter, onto a region of a bigger canvas. */
  function paintInto(g, cx, cy, size, opts) {
    const off = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    off.style.width = `${size}px`;
    off.width = Math.round(size * dpr);
    off.height = Math.round(size * dpr);
    Object.defineProperty(off, 'clientWidth', { value: size });
    D.paint(off, opts);
    g.drawImage(off, cx - size / 2, cy - size / 2, size, size);
  }

  /** Which mark, if any, a point in the canvas's own pixels is on. */
  function markAt(canvas, names, marks, x, y) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const n = Math.min(marks, names.length);
    const L = markLayout(w, h, n, names.length > n);
    let best = -1, bestD = 11;
    L.marks.forEach((m, i) => {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) { best = i; bestD = d; }
    });
    return best; // n = the "more" mark
  }

  // ---------------------------------------------------------------- the popup menu

  let openMenu;
  /**
   * The plug-in's popup list, not the system's: dark card, hairline, the chosen item ticked in the
   * section's colour; long lists in columns. Resolves to the picked index, or undefined.
   */
  function menu(anchor, names, current, colour) {
    closeMenu();
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'bos-menu';
      box.style.setProperty('--c', colour);
      box.setAttribute('role', 'listbox');
      const cols = names.length > 24 ? 3 : names.length > 10 ? 2 : 1;
      box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      names.forEach((name, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'bos-item' + (i === current ? ' on' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === current));
        item.textContent = name;
        item.onclick = () => {
          closeMenu();
          resolve(i);
        };
        box.append(item);
      });
      document.body.append(box);
      const r = anchor.getBoundingClientRect();
      const width = Math.min(document.documentElement.clientWidth - 16, Math.max(r.width, cols * 104));
      box.style.width = `${width}px`;
      const left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - width - 8));
      box.style.left = `${left + window.scrollX}px`;
      const below = r.bottom + 4, room = window.innerHeight - below;
      box.style.top = `${(room > 180 ? below : Math.max(8, r.top - Math.min(260, box.offsetHeight) - 4)) + window.scrollY}px`;
      box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
      const away = (e) => {
        if (!box.contains(e.target)) {
          closeMenu();
          resolve(undefined);
        }
      };
      const key = (e) => {
        if (e.key === 'Escape') {
          closeMenu();
          resolve(undefined);
        }
      };
      setTimeout(() => {
        document.addEventListener('pointerdown', away, true);
        document.addEventListener('keydown', key, true);
      });
      openMenu = { box, away, key, resolve };
    });
  }
  function closeMenu() {
    if (!openMenu) return;
    const { box, away, key } = openMenu;
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', key, true);
    box.remove();
    openMenu = undefined;
  }

  // ---------------------------------------------------------------- the envelope graph

  /** "150 ms" / "1.2 s" -> milliseconds; "0.70" -> 0.70. */
  function readNumber(text) {
    const m = /(-?\d+(\.\d+)?)\s*(ms|s)?/i.exec(String(text ?? ''));
    if (!m) return 0;
    const v = Number(m[1]);
    return m[3]?.toLowerCase() === 's' ? v * 1000 : v;
  }

  /**
   * The plug-in's envelope (studio::EnvelopeView): attack up, decay down to the sustain level,
   * held, released, on a square-root time scale, filled faintly and stroked in the section's
   * colour, with a handle on each corner you can drag. Returns the handles' positions.
   */
  function paintEnvelope(canvas, { a, d, s, r, colour, hot = -1 }) {
    const { g, w, h } = fitCanvas(canvas);
    const pad = 8, top = 8, bottom = h - 8;
    const hold = Math.max(40, (a + d + r) * 0.25);
    const total = Math.sqrt(a) + Math.sqrt(d) + Math.sqrt(hold) + Math.sqrt(r) || 1;
    const X = (sq) => pad + (sq / total) * (w - pad * 2);
    const lvl = (v) => bottom - Math.max(0, Math.min(1, v)) * (bottom - top);
    const xA = X(Math.sqrt(a)), xD = X(Math.sqrt(a) + Math.sqrt(d)), xH = X(Math.sqrt(a) + Math.sqrt(d) + Math.sqrt(hold)), xR = X(total);
    const pts = [[pad, bottom], [xA, top], [xD, lvl(s)], [xH, lvl(s)], [xR, bottom]];
    // a faint grid, as the plug-in's well has
    g.strokeStyle = M.rule;
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = top + ((bottom - top) * i) / 4;
      g.beginPath();
      g.moveTo(pad, y);
      g.lineTo(w - pad, y);
      g.stroke();
    }
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.lineTo(pad, bottom);
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
    g.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.14)`;
    g.fill();
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = colour;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.stroke();
    const handles = [
      { x: xA, y: top },        // attack peak
      { x: xD, y: lvl(s) },     // decay corner: decay and sustain
      { x: xR, y: bottom },     // release end
    ];
    handles.forEach((p, i) => {
      g.beginPath();
      g.arc(p.x, p.y, i === hot ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = colour;
      g.fill();
    });
    return handles;
  }

  globalThis.SynthsWidgets = { paintSelector, markAt, menu, closeMenu, paintEnvelope, readNumber, shortWord, GLYPHS };
})();
