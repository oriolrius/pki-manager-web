// Vector animation kit for the SSH CA explainer.
// Every helper returns an SVG string. Rendering is a pure function of time,
// so any frame can be rendered on its own (deterministic, seekable).
/* eslint-disable no-unused-vars */
(function () {
  const C = {
    navy: '#151652', navyDeep: '#0E0F3A', orange: '#FF6600', orangeInk: '#C95000',
    orangeSoft: '#FFF4EC', green: '#0C8760', greenBright: '#3CCB98', greenSoft: '#E7F6F0',
    slate: '#54595F', body: '#575757', muted: '#7A7A7A', mist: '#F4F4F4', line: '#D5D6D7',
    white: '#FFFFFF', red: '#C62828', redSoft: '#FDECEC', amber: '#B26A00', amberSoft: '#FFF3DC',
    term: '#10112E', termText: '#E8E9F3',
  };
  const KIND = {
    user: { fill: C.orange, stroke: C.orangeInk, text: C.white, soft: C.orangeSoft },
    host: { fill: C.green, stroke: '#0A7C58', text: C.white, soft: C.greenSoft },
    machine: { fill: C.navy, stroke: C.navyDeep, text: C.white, soft: '#E8E9F3' },
    file: { fill: C.mist, stroke: C.slate, text: C.navy, soft: C.mist },
    pki: { fill: C.white, stroke: C.orange, text: C.navy, soft: C.orangeSoft },
    danger: { fill: C.redSoft, stroke: C.red, text: '#8E1B1B', soft: C.redSoft },
    plain: { fill: C.white, stroke: C.navy, text: C.navy, soft: C.mist },
    warn: { fill: C.amberSoft, stroke: C.amber, text: '#6B4000', soft: C.amberSoft },
    good: { fill: C.greenSoft, stroke: C.green, text: '#075C41', soft: C.greenSoft },
    ghost: { fill: 'none', stroke: C.line, text: C.muted, soft: C.mist },
  };
  const FONT = "Ubuntu, 'Ubuntu', sans-serif";
  const MONO = "'Ubuntu Mono', monospace";

  // ---------- time ----------
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const back = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const lerp = (a, b, p) => a + (b - a) * p;
  let NOW = 0; // scene-local time, set by the player before each scene render
  const prog = (at, d = 0.5) => (at == null ? 1 : clamp((NOW - at) / d));
  const on = (at) => at == null || NOW >= at;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Rough text width for Ubuntu (good enough for layout decisions).
  const textW = (s, size, mono) => String(s).length * size * (mono ? 0.5 : 0.53);

  // ---------- appear wrapper ----------
  /** Wrap content: fade + move in at `at`. from: up|down|left|right|pop|none. out: fade out at `out`. */
  function show(content, { at, d = 0.55, from = 'up', dist = 40, out, outD = 0.4, cx = 0, cy = 0 } = {}) {
    if (at != null && NOW < at) return '';
    const p = ease(prog(at, d));
    let op = p;
    if (out != null && NOW >= out) op *= 1 - ease(clamp((NOW - out) / outD));
    if (op <= 0.001) return '';
    let tr = '';
    const q = 1 - p;
    if (from === 'up') tr = `translate(0 ${dist * q})`;
    else if (from === 'down') tr = `translate(0 ${-dist * q})`;
    else if (from === 'left') tr = `translate(${-dist * q} 0)`;
    else if (from === 'right') tr = `translate(${dist * q} 0)`;
    else if (from === 'pop') {
      const s = lerp(0.6, 1, back(prog(at, d)));
      tr = `translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`;
    }
    return `<g opacity="${op.toFixed(3)}" transform="${tr}">${content}</g>`;
  }

  /** Move content from (dx0,dy0) to (0,0) between at and at+d. */
  function move(content, { at, d = 0.8, dx = 0, dy = 0, scale0 = 1, cx = 0, cy = 0 }) {
    const p = ease(prog(at, d));
    const x = dx * (1 - p), y = dy * (1 - p), s = lerp(scale0, 1, p);
    return `<g transform="translate(${x} ${y}) translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})">${content}</g>`;
  }

  // ---------- primitives ----------
  function text(x, y, s, { size = 30, weight = 400, fill = C.navy, anchor = 'start', mono = false, opacity = 1, italic = false } = {}) {
    return `<text xml:space="preserve" x="${x}" y="${y}" font-family="${mono ? MONO : FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}"${italic ? ' font-style="italic"' : ''} dominant-baseline="middle">${esc(s)}</text>`;
  }
  /** Multi-line text, lines centred vertically around y. */
  function lines(x, y, arr, o = {}) {
    const size = o.size ?? 30, lh = o.lh ?? size * 1.3;
    const y0 = y - ((arr.length - 1) * lh) / 2;
    return arr.map((l, i) => text(x, y0 + i * lh, l, o)).join('');
  }
  function rect(x, y, w, h, { fill = C.white, stroke = C.navy, sw = 2.5, r = 14, dash, opacity = 1 } = {}) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="${opacity}"/>`;
  }

  /** Card: coloured box with title (bold) and optional body lines. Centre-anchored text. */
  function card({ x, y, w, h, kind = 'plain', title, body = [], size = 30, bodySize, align = 'middle', r = 16, sw = 3, dash, mono = false }) {
    const k = KIND[kind];
    const bs = bodySize ?? Math.round(size * 0.78);
    const all = (title ? 1 : 0) + body.length;
    const lh = bs * 1.32;
    const tx = align === 'middle' ? x + w / 2 : x + 26;
    let out = rect(x, y, w, h, { fill: k.fill, stroke: k.stroke, sw, r, dash });
    const totalH = (title ? size * 1.25 : 0) + body.length * lh;
    let cy = y + h / 2 - totalH / 2;
    if (title) { out += text(tx, cy + size * 0.62, title, { size, weight: 700, fill: k.text, anchor: align === 'middle' ? 'middle' : 'start' }); cy += size * 1.25; }
    body.forEach((b, i) => { out += text(tx, cy + lh * 0.55 + i * lh, b, { size: bs, fill: k.text, anchor: align === 'middle' ? 'middle' : 'start', mono }); });
    void all;
    return out;
  }

  /** Pill / chip. */
  function chip(x, y, label, { kind = 'user', size = 26, anchor = 'start', mono = false } = {}) {
    const k = KIND[kind];
    const w = textW(label, size, mono) + size * 1.2, h = size * 1.55;
    const x0 = anchor === 'middle' ? x - w / 2 : x;
    return rect(x0, y - h / 2, w, h, { fill: k.fill, stroke: k.stroke, sw: 2, r: h / 2 }) +
      text(x0 + w / 2, y + 1, label, { size, fill: k.text, anchor: 'middle', weight: 500, mono });
  }

  /** Code / file block with a title bar. hl: [{line, at, color}] highlights; typed: reveal lines at lineAt[i]. */
  function code({ x, y, w, title, lines: L, size = 26, kind = 'file', hl = [], lineAt = [], pad = 22, titleSize }) {
    const lh = size * 1.42;
    const ts = titleSize ?? Math.round(size * 0.85);
    const th = title ? ts * 1.9 : 0;
    const h = th + pad * 2 + L.length * lh - (lh - size);
    const k = KIND[kind];
    let out = rect(x, y, w, h, { fill: C.white, stroke: k.stroke, sw: 2.5, r: 12 });
    if (title) {
      out += `<path d="M${x} ${y + 12} a12 12 0 0 1 12 -12 h${w - 24} a12 12 0 0 1 12 12 v${th - 12} h${-w} z" fill="${k.stroke}"/>`;
      out += text(x + 20, y + th / 2 + 1, title, { size: ts, fill: C.white, mono: true, weight: 700 });
    }
    L.forEach((l, i) => {
      const ly = y + th + pad + i * lh + size * 0.5;
      const at = lineAt[i];
      if (at != null && NOW < at) return;
      const h1 = hl.filter((q) => q.line === i && on(q.at));
      for (const q of h1) {
        const p = ease(prog(q.at, 0.35));
        out += `<rect x="${x + 8}" y="${ly - lh / 2}" width="${(w - 16) * p}" height="${lh}" rx="6" fill="${q.color ?? C.orange}" opacity="${q.opacity ?? 0.16}"/>`;
      }
      const op = at != null ? ease(prog(at, 0.3)) : 1;
      const col = typeof l === 'object' ? l.color : C.navy;
      const str = typeof l === 'object' ? l.text : l;
      out += text(x + pad, ly, str, { size, mono: true, fill: col ?? C.navy, opacity: op });
    });
    return { svg: out, h };
  }

  /** Terminal window. items: [{t:'$ cmd', at, out:false, color}] typed with a cursor. */
  function terminal({ x, y, w, items, size = 27, title = 'terminal', minLines = 0, typeSpeed = 34 }) {
    const lh = size * 1.45, th = 46;
    const n = Math.max(minLines, items.length);
    const h = th + 26 + n * lh;
    let out = rect(x, y, w, h, { fill: C.term, stroke: C.navyDeep, sw: 2, r: 14 });
    out += `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v${th - 14} h${-w} z" fill="#262859"/>`;
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => { out += `<circle cx="${x + 26 + i * 24}" cy="${y + th / 2}" r="7" fill="${c}"/>`; });
    out += text(x + w / 2, y + th / 2 + 1, title, { size: 20, fill: '#A9ABD0', anchor: 'middle', mono: true });
    let row = 0;
    let lastTyping = null;
    for (const it of items) {
      if (it.at != null && NOW < it.at) break;
      const ly = y + th + 18 + row * lh + size * 0.5;
      let s = it.t;
      if (!it.out && it.at != null) {
        const nChars = Math.floor((NOW - it.at) * typeSpeed);
        if (nChars < s.length) { s = s.slice(0, nChars); lastTyping = { x: x + 22 + textW(s, size, true), y: ly }; }
      }
      const isCmd = !it.out;
      const col = it.color ?? (isCmd ? C.termText : '#B9BBD9');
      if (isCmd && s.startsWith('$ ')) {
        out += text(x + 22, ly, '$', { size, mono: true, fill: C.greenBright, weight: 700 });
        out += text(x + 22 + textW('$ ', size, true), ly, s.slice(2), { size, mono: true, fill: col });
      } else out += text(x + 22, ly, s, { size, mono: true, fill: col, weight: it.bold ? 700 : 400 });
      row++;
    }
    if (lastTyping && Math.floor(NOW * 2.5) % 2 === 0) out += `<rect x="${lastTyping.x + 2}" y="${lastTyping.y - size * 0.55}" width="${size * 0.5}" height="${size * 1.05}" fill="${C.termText}" opacity="0.85"/>`;
    return { svg: out, h };
  }

  /** Arrow drawn progressively. curve: perpendicular offset for a quadratic bend. */
  function arrow({ x1, y1, x2, y2, at, d = 0.7, color = C.slate, width = 4, dashed = false, curve = 0, label, labelSize = 24, labelColor, head = true, opacity = 1 }) {
    if (at != null && NOW < at) return '';
    const p = ease(prog(at, d));
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const len0 = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len0, ny = (x2 - x1) / len0;
    const cx = mx + nx * curve, cy = my + ny * curve;
    // sample quadratic
    const pts = [];
    const N = 40;
    for (let i = 0; i <= N * p; i++) {
      const u = i / N;
      pts.push([(1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * cx + u * u * x2, (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * cy + u * u * y2]);
    }
    if (pts.length < 2) return '';
    const dpath = 'M' + pts.map((q) => q.map((v) => v.toFixed(1)).join(' ')).join(' L');
    let out = `<path d="${dpath}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${dashed ? ' stroke-dasharray="12 10"' : ''} opacity="${opacity}"/>`;
    if (head && p > 0.98) {
      const [ax, ay] = pts[pts.length - 1], [bx, by] = pts[pts.length - 3] ?? pts[0];
      const ang = Math.atan2(ay - by, ax - bx), s = 9 + width * 2.2;
      const p1 = [ax - s * Math.cos(ang - 0.45), ay - s * Math.sin(ang - 0.45)];
      const p2 = [ax - s * Math.cos(ang + 0.45), ay - s * Math.sin(ang + 0.45)];
      out += `<path d="M${ax} ${ay} L${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]} Z" fill="${color}" opacity="${opacity}"/>`;
    }
    if (label && p > 0.6) {
      const lw = textW(label, labelSize) + 24;
      out += `<g opacity="${ease(clamp((p - 0.6) / 0.4))}">` + rect(cx - lw / 2, cy - labelSize * 0.85, lw, labelSize * 1.7, { fill: C.white, stroke: 'none', sw: 0, r: 8 }) +
        text(cx, cy + 1, label, { size: labelSize, fill: labelColor ?? color, anchor: 'middle', weight: 500 }) + '</g>';
    }
    return out;
  }

  // ---------- icons (centre-anchored) ----------
  function server(cx, cy, { s = 1, label, color = C.navy, sub, labelSize = 26, state } = {}) {
    const w = 120 * s, h = 150 * s, x = cx - w / 2, y = cy - h / 2;
    let out = rect(x, y, w, h, { fill: color, stroke: C.navyDeep, sw: 2, r: 12 * s });
    for (let i = 0; i < 3; i++) {
      const yy = y + 22 * s + i * 40 * s;
      out += rect(x + 14 * s, yy, w - 28 * s, 26 * s, { fill: '#2A2C74', stroke: 'none', sw: 0, r: 5 * s });
      out += `<circle cx="${x + w - 30 * s}" cy="${yy + 13 * s}" r="${5 * s}" fill="${C.greenBright}"/>`;
    }
    if (state === 'bad') out += `<circle cx="${x + w}" cy="${y}" r="${20 * s}" fill="${C.red}"/>` + text(x + w, y + 1, '✕', { size: 24 * s, fill: C.white, anchor: 'middle', weight: 700 });
    if (state === 'ok') out += `<circle cx="${x + w}" cy="${y}" r="${20 * s}" fill="${C.green}"/>` + text(x + w, y + 1, '✓', { size: 24 * s, fill: C.white, anchor: 'middle', weight: 700 });
    if (label) out += text(cx, y + h + labelSize * 0.95, label, { size: labelSize, anchor: 'middle', weight: 700, fill: C.navy, mono: /\./.test(label) });
    if (sub) out += text(cx, y + h + labelSize * 2.15, sub, { size: labelSize * 0.8, anchor: 'middle', fill: C.muted });
    return out;
  }
  function laptop(cx, cy, { s = 1, label, labelSize = 26, color = C.navy } = {}) {
    const w = 170 * s, h = 110 * s, x = cx - w / 2, y = cy - h / 2 - 10 * s;
    let out = rect(x, y, w, h, { fill: color, stroke: C.navyDeep, sw: 2, r: 10 * s });
    out += rect(x + 10 * s, y + 10 * s, w - 20 * s, h - 20 * s, { fill: '#2A2C74', stroke: 'none', sw: 0, r: 4 * s });
    out += `<path d="M${x - 22 * s} ${y + h + 4 * s} h${w + 44 * s} l-12 ${18 * s} h${-(w + 20 * s)} z" fill="${C.slate}"/>`;
    if (label) out += text(cx, y + h + 22 * s + labelSize * 0.95, label, { size: labelSize, anchor: 'middle', weight: 700, fill: C.navy });
    return out;
  }
  function person(cx, cy, { s = 1, label, color = C.navy, labelSize = 26, sub } = {}) {
    let out = `<circle cx="${cx}" cy="${cy - 34 * s}" r="${26 * s}" fill="${color}"/>`;
    out += `<path d="M${cx - 48 * s} ${cy + 52 * s} q0 ${-62 * s} ${48 * s} ${-62 * s} q${48 * s} 0 ${48 * s} ${62 * s} z" fill="${color}"/>`;
    if (label) out += text(cx, cy + 52 * s + labelSize, label, { size: labelSize, anchor: 'middle', weight: 700, fill: C.navy });
    if (sub) out += text(cx, cy + 52 * s + labelSize * 2.1, sub, { size: labelSize * 0.8, anchor: 'middle', fill: C.muted });
    return out;
  }
  /** CA badge: round seal. */
  function ca(cx, cy, { r = 80, kind = 'user', label = 'User CA', sub, labelSize } = {}) {
    const k = KIND[kind];
    let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${k.fill}" stroke="${k.stroke}" stroke-width="4"/>`;
    out += `<circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="none" stroke="${C.white}" stroke-width="2.5" stroke-dasharray="6 6" opacity="0.8"/>`;
    const ls = labelSize ?? r * 0.32;
    out += text(cx, cy - (sub ? ls * 0.35 : 0), label, { size: ls, anchor: 'middle', fill: C.white, weight: 700 });
    if (sub) out += text(cx, cy + ls * 0.85, sub, { size: ls * 0.62, anchor: 'middle', fill: C.white });
    return out;
  }
  /** Key card: public key. */
  function keyCard(x, y, { w = 260, h = 90, label = 'public key', sub, kind = 'file', size = 24 } = {}) {
    const k = KIND[kind];
    let out = rect(x, y, w, h, { fill: k.fill, stroke: k.stroke, sw: 2.5, r: 12 });
    const kx = x + 40, ky = y + h / 2;
    out += `<circle cx="${kx}" cy="${ky}" r="16" fill="none" stroke="${k.text === C.white ? C.white : C.orange}" stroke-width="6"/>`;
    out += `<path d="M${kx + 16} ${ky} h34 m-12 0 v12 m-12 -12 v9" stroke="${k.text === C.white ? C.white : C.orange}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
    out += text(x + 104, ky - (sub ? size * 0.5 : 0), label, { size, fill: k.text, weight: 700 });
    if (sub) out += text(x + 104, ky + size * 0.65, sub, { size: size * 0.78, fill: k.text, mono: true });
    return out;
  }
  function lock(cx, cy, { s = 1, color = C.navy } = {}) {
    return `<path d="M${cx - 14 * s} ${cy - 4 * s} v${-12 * s} a${14 * s} ${14 * s} 0 0 1 ${28 * s} 0 v${12 * s}" fill="none" stroke="${color}" stroke-width="${5 * s}"/>` +
      rect(cx - 22 * s, cy - 6 * s, 44 * s, 34 * s, { fill: color, stroke: 'none', sw: 0, r: 6 * s });
  }
  /** Stamp: a CA seal pressed onto something at `at`. */
  function stamp(cx, cy, { at, kind = 'user', r = 46, label = 'CA' } = {}) {
    if (at != null && NOW < at) return '';
    const p = prog(at, 0.45);
    const s = lerp(2.2, 1, easeOut(p));
    const op = clamp(p * 2);
    return `<g opacity="${op}" transform="translate(${cx} ${cy}) scale(${s}) rotate(-12)">${ca(0, 0, { r, kind, label, labelSize: r * 0.42 })}</g>`;
  }
  /** Check gate: circle with ✓ / ✕ / … */
  function gate(cx, cy, { state = 'pending', r = 34, label, labelSize = 24, at } = {}) {
    const col = state === 'ok' ? C.green : state === 'bad' ? C.red : C.line;
    const sym = state === 'ok' ? '✓' : state === 'bad' ? '✕' : '';
    let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${state === 'pending' ? C.white : col}" stroke="${col}" stroke-width="4"/>`;
    if (sym) out += text(cx, cy + 2, sym, { size: r * 1.15, anchor: 'middle', fill: C.white, weight: 700 });
    if (label) out += text(cx, cy + r + labelSize * 1.05, label, { size: labelSize, anchor: 'middle', fill: C.navy, weight: 500 });
    void at;
    return out;
  }
  /** Simple table. */
  function table({ x, y, cols, rows, colW, size = 26, rowH, head = true, colors = [] }) {
    const rh = rowH ?? size * 1.9;
    const W = colW.reduce((a, b) => a + b, 0);
    let out = rect(x, y, W, rh * (rows.length + (head ? 1 : 0)), { fill: C.white, stroke: C.line, sw: 2, r: 10 });
    let yy = y;
    if (head) {
      out += `<path d="M${x} ${y + 10} a10 10 0 0 1 10 -10 h${W - 20} a10 10 0 0 1 10 10 v${rh - 10} h${-W} z" fill="${C.mist}"/>`;
      let xx = x;
      cols.forEach((c, i) => { out += text(xx + 18, yy + rh / 2, c, { size, weight: 700, fill: C.navy }); xx += colW[i]; });
      yy += rh;
    }
    rows.forEach((r, ri) => {
      let xx = x;
      out += `<line x1="${x}" y1="${yy}" x2="${x + W}" y2="${yy}" stroke="${C.line}" stroke-width="1.5"/>`;
      r.forEach((c, i) => { out += text(xx + 18, yy + rh / 2, c, { size, fill: (colors[ri] && colors[ri][i]) || C.body, weight: i === 0 ? 500 : 400 }); xx += colW[i]; });
      yy += rh;
    });
    return out;
  }
  /** Scene heading (top-left, under the header). */
  function heading(title, { sub } = {}) {
    let out = text(110, 168, title, { size: 52, weight: 700, fill: C.navy });
    out += `<rect x="110" y="200" width="${Math.min(160, textW(title, 52))}" height="6" rx="3" fill="${C.orange}"/>`;
    if (sub) out += text(110, 245, sub, { size: 28, fill: C.muted });
    return out;
  }
  /** Caption at the bottom of the content area. */
  function caption(s, { at, kind } = {}) {
    const col = kind === 'bad' ? C.red : kind === 'good' ? C.green : C.slate;
    return show(text(960, 958, s, { size: 30, anchor: 'middle', fill: col, weight: 500 }), { at, from: 'up', dist: 16 });
  }
  /** Next-episode end card strip. */
  function nextCard(label, at) {
    return show(rect(1420, 900, 400, 70, { fill: C.navy, stroke: C.navy, sw: 0, r: 35 }) + text(1620, 936, `Next: ${label}  →`, { size: 26, anchor: 'middle', fill: C.white, weight: 700 }), { at, from: 'right', dist: 30 });
  }
  /** Symbol in a circle (big ✓ / ✕ / ?). */
  function mark(cx, cy, sym, { r = 40, color = C.green } = {}) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` + text(cx, cy + 3, sym, { size: r * 1.2, anchor: 'middle', fill: C.white, weight: 700 });
  }

  window.A = {
    C, KIND, FONT, MONO, clamp, ease, easeOut, back, lerp, prog, on, esc, textW,
    setNow: (t) => { NOW = t; }, now: () => NOW,
    show, move, text, lines, rect, card, chip, code, terminal, arrow,
    server, laptop, person, ca, keyCard, lock, stamp, gate, table, heading, caption, nextCard, mark,
  };
})();
