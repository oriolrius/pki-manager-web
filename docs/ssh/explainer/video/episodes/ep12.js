// Episode 12 — Designing your principal catalog (series 2, principals in depth).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, arrow, heading, caption, mark, ease, prog, clamp, lerp, textW } = A;

  // ---------- shared helpers ----------
  const TAGS = {
    user: { fill: C.orange, stroke: C.orangeInk, text: C.white },
    grey: { fill: C.mist, stroke: C.slate, text: C.slate },
    green: { fill: C.green, stroke: '#0A7C58', text: C.white },
    soft: { fill: C.orangeSoft, stroke: C.orange, text: C.orangeInk },
  };
  const tagW = (label, size) => textW(label, size, true) + size * 1.9;
  /** Principal tag: pill with a hole, label in mono. Centre-anchored. */
  function tag(cx, cy, label, { kind = 'user', size = 30 } = {}) {
    const k = TAGS[kind];
    const w = tagW(label, size), h = size * 1.7, x = cx - w / 2, y = cy - h / 2;
    return rect(x, y, w, h, { fill: k.fill, stroke: k.stroke, sw: 2.5, r: h / 2 }) +
      `<circle cx="${x + h * 0.5}" cy="${cy}" r="${size * 0.17}" fill="${C.white}" stroke="${k.stroke}" stroke-width="1.5"/>` +
      text(x + h * 0.85 + (w - h * 0.85 - size * 0.4) / 2, cy + 1, label, { size, mono: true, fill: k.text, anchor: 'middle', weight: 700 });
  }
  /** Tag whose left edge is at x. */
  const tagL = (x, cy, label, o = {}) => tag(x + tagW(label, o.size ?? 30) / 2, cy, label, o);
  /** Next-episode pill sized to its label (A.nextCard has a fixed 400 px width and clips long labels). */
  function nextPill(label, at) {
    const str = `Next: ${label}  →`;
    const w = Math.min(760, textW(str, 26) * 1.1 + 60);
    return show(rect(1820 - w, 900, w, 70, { fill: C.navy, stroke: C.navy, sw: 0, r: 35 }) + text(1820 - w / 2, 936, str, { size: 26, anchor: 'middle', fill: C.white, weight: 700 }), { at, from: 'right', dist: 30 });
  }
  /** Compact certificate: header + one principal tag row. */
  function miniCert(x, y, w, h, name, principals) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.orange, sw: 3, r: 14 });
    o += `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v${36 - 14} h${-w} z" fill="${C.orange}"/>`;
    o += text(x + 22, y + 19, name, { size: 24, weight: 700, fill: C.white });
    o += text(x + 22, y + 82, 'Principals', { size: 24, fill: C.slate, weight: 500 });
    let tx = x + w - 20;
    [...principals].reverse().forEach((p) => {
      const tw = tagW(p, 26);
      o += tag(tx - tw / 2, y + 82, p, { kind: 'soft', size: 26 });
      tx -= tw + 10;
    });
    return o;
  }

  const ROLES = ['developers', 'sysadmins', 'security'];
  const CUSTS = ['client-acme', 'client-globex', 'client-initech'];

  EPISODES['12'] = {
    scenes: {
      // ---------------------------------------------------------------- 12.1
      '12.1': ({ s, e }) => {
        let o = heading('Few and durable');
        // left: bad catalog (40 per-person-per-server tags)
        const people = ['ana', 'pau', 'eva', 'jan'];
        const targets = ['acme-web', 'acme-db', 'globex-web', 'dev-01', 'dev-03', 'ci', 'vault', 'logs', 'db-int', 'backup'];
        const names = [];
        targets.forEach((t) => people.forEach((p) => names.push(`${p}-${t}`)));
        const lx = 110, ly = 290, lw = 860, lh = 590;
        const fade = 1 - 0.7 * ease(prog(s(2) + 0.3, 0.9));
        let L = rect(lx, ly, lw, lh, { fill: C.white, stroke: C.red, sw: 3, r: 18 });
        L += text(lx + 30, ly + 36, '40 principals', { size: 34, weight: 700, fill: '#8E1B1B' });
        L += text(lx + lw - 30, ly + 36, 'one per person, per server', { size: 26, fill: C.slate, anchor: 'end' });
        names.forEach((n, i) => {
          const col = i % 4, row = Math.floor(i / 4);
          const cx = lx + 20 + col * 208 + tagW(n, 22) / 2;
          const cy = ly + 100 + row * 47;
          L += show(tag(cx, cy, n, { kind: 'grey', size: 22 }), { at: s(0) + 0.3 + i * 0.03, d: 0.3, from: 'none' });
        });
        o += show(`<g opacity="${fade.toFixed(3)}">${L}</g>`, { at: s(0), from: 'left', dist: 40 });
        o += show(mark(lx + lw / 2, ly + lh / 2, '✕', { r: 90, color: C.red }), { at: s(2) + 0.5, from: 'pop', cx: lx + lw / 2, cy: ly + lh / 2 });
        // right: good catalog (7 tags)
        const rx = 1050, ry = 290, rw = 770, rh = 400;
        let R = rect(rx, ry, rw, rh, { fill: C.white, stroke: C.green, sw: 3, r: 18 });
        R += text(rx + 30, ry + 36, '7 principals', { size: 34, weight: 700, fill: '#075C41' });
        R += text(rx + rw - 30, ry + 36, 'few, durable', { size: 26, fill: C.slate, anchor: 'end' });
        const good = [...ROLES, ...CUSTS, 'break-glass'];
        const cols = [[...ROLES, 'break-glass'], CUSTS];
        cols.forEach((c, ci) => c.forEach((n, ri) => {
          R += show(tagL(rx + 40 + ci * 360, ry + 110 + ri * 72, n, { kind: 'user', size: 28 }), { at: s(0) + 1.8 + (ci * 4 + ri) * 0.15, d: 0.4, from: 'pop', cx: rx + 150 + ci * 360, cy: ry + 110 + ri * 72 });
        }));
        void good;
        o += show(R, { at: s(0) + 1.5, from: 'right', dist: 40 });
        // item 1: roles and customers change rarely
        o += show(chip(rx + 40, ry + rh + 50, 'roles + customers: they change rarely', { kind: 'good', size: 26 }), { at: s(1), from: 'up', dist: 14 });
        // item 2: fine slicing in the mapping
        o += show(card({ x: rx, y: 770, w: rw, h: 130, kind: 'file', title: 'Fine slicing per server: in the mapping', body: ['acme-web  ·  deploy ← client-acme'], size: 28, bodySize: 26, mono: false }), { at: s(2), from: 'up', dist: 20 });
        return o;
      },

      // ---------------------------------------------------------------- 12.2
      '12.2': ({ s }) => {
        let o = heading('Three families');
        const cw = 540, cy0 = 290, ch = 380, xs = [110, 690, 1270];
        const FAM = [
          { t: 'Roles', sub: 'what you do', items: ROLES, at: s(1), stroke: C.navy },
          { t: 'Customers', sub: 'whose servers', items: CUSTS, at: s(2), stroke: C.navy },
          { t: 'Special', sub: 'emergencies', items: ['break-glass'], at: s(3), stroke: C.amber },
        ];
        FAM.forEach((f, i) => {
          const x = xs[i];
          let g = rect(x, cy0, cw, ch, { fill: C.white, stroke: f.stroke, sw: 3, r: 18 });
          g += `<path d="M${x} ${cy0 + 18} a18 18 0 0 1 18 -18 h${cw - 36} a18 18 0 0 1 18 18 v${64 - 18} h${-cw} z" fill="${f.stroke}"/>`;
          g += text(x + 28, cy0 + 33, f.t, { size: 36, weight: 700, fill: C.white });
          g += text(x + cw - 28, cy0 + 33, f.sub, { size: 26, fill: '#D8DAF0', anchor: 'end' });
          f.items.forEach((n, k) => { g += show(tagL(x + 40, cy0 + 130 + k * 82, n, { kind: 'user', size: 30 }), { at: f.at + 0.4 + k * 0.35, d: 0.45, from: 'up', dist: 20 }); });
          o += show(g, { at: i === 0 ? s(0) : f.at - 0.2, from: 'up', dist: 30 });
        });
        // item 0: all three headers visible early
        o += show(chip(960, 850, 'a prefix in the name keeps the families apart', { kind: 'plain', size: 28, anchor: 'middle' }), { at: s(4), from: 'up', dist: 16 });
        // item 4: prefix chips
        if (A.now() >= s(4)) {
          o += show(chip(xs[1] + cw / 2, 725, 'prefix  client-', { kind: 'user', size: 28, anchor: 'middle', mono: true }), { at: s(4) + 0.5, from: 'up', dist: 12 });
        }
        return o;
      },

      // ---------------------------------------------------------------- 12.3
      '12.3': ({ s, e }) => {
        let o = heading('Role and customer together');
        const fx = 110, fy = 320, fw = 640;
        const fileA = code({ x: fx, y: fy, w: fw, size: 32, title: '/etc/ssh/auth_principals/deploy', lines: ['developers', 'client-acme'], hl: [{ line: 0, at: s(0) + 1.0, color: C.green, opacity: 0.25 }, { line: 1, at: s(0) + 1.0, color: C.green, opacity: 0.25 }] });
        const fileB = code({ x: fx, y: fy, w: fw, size: 32, title: '/etc/ssh/auth_principals/deploy', lines: [{ text: 'acme-deployer', color: C.navy }], hl: [{ line: 0, at: s(2) + 0.6, color: C.green, opacity: 0.25 }] });
        o += show(fileA.svg, { at: 0.2, from: 'left', out: s(2) - 0.1, outD: 0.3 });
        o += show(fileB.svg, { at: s(2), from: 'left', dist: 30 });
        const cx0 = 1090, cw = 730, chh = 130;
        // Ana's certificate: only client-acme
        o += show(miniCert(cx0, 290, cw, chh, "Ana's certificate", ['client-acme']), { at: s(0) + 0.4, from: 'right', dist: 60 });
        const ay = 290 + chh / 2;
        // phase 1: one match opens
        o += show(arrow({ x1: cx0 - 10, y1: ay, x2: fx + fw + 16, y2: fy + 100, at: s(0) + 1.6, d: 0.7, color: C.green, width: 5 }) +
          mark(960, (ay + fy + 100) / 2, '✓', { r: 30, color: C.green }), { at: s(0) + 1.6, out: s(2) - 0.1, from: 'none', outD: 0.3 });
        o += show(chip(fx + fw / 2, fy + 250, 'one match: Ana enters', { kind: 'good', size: 28, anchor: 'middle' }), { at: s(0) + 2.4, out: s(2) - 0.1, from: 'up', dist: 12, outD: 0.3 });
        // item 1: cannot be split
        o += show(card({ x: fx, y: 610, w: 1710, h: 130, kind: 'warn', title: 'A file cannot say "developers AND client-acme"', body: ['one principal cannot be split in two'], size: 32, bodySize: 28 }), { at: s(1), from: 'up', dist: 20 });
        // phase 2: only acme-deployer opens
        const t2 = s(2) + 0.7;
        o += show(arrow({ x1: cx0 - 10, y1: ay, x2: fx + fw + 16, y2: fy + 60, at: t2, d: 0.6, color: C.red, width: 5, dashed: true }) +
          mark(960, (ay + fy + 60) / 2 + 10, '✕', { r: 30, color: C.red }), { at: t2, from: 'none' });
        o += show(miniCert(cx0, 460, cw, chh, 'Certificate for the deployers', ['acme-deployer']), { at: s(2) + 1.4, from: 'right', dist: 60 });
        const by = 460 + chh / 2;
        o += show(arrow({ x1: cx0 - 10, y1: by, x2: fx + fw + 16, y2: fy + 100, at: s(2) + 2.2, d: 0.7, color: C.green, width: 5 }) +
          mark(960, (by + fy + 100) / 2 - 12, '✓', { r: 30, color: C.green }), { at: s(2) + 2.2, from: 'none' });
        o += show(chip(960, 925, 'give it only to the people who need both', { kind: 'user', size: 28, anchor: 'middle' }), { at: s(2) + 3.0, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 12.4
      '12.4': ({ s }) => {
        let o = heading('Naming rules');
        // rule card
        const rule = '^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$';
        o += show(rect(110, 280, 1700, 110, { fill: C.mist, stroke: C.slate, sw: 3, r: 16 }) +
          text(140, 335, 'Rule', { size: 28, fill: C.slate, weight: 700 }) +
          text(960, 337, rule, { size: 44, mono: true, weight: 700, anchor: 'middle', fill: C.navy }), { at: s(1) - 0.2, from: 'up', dist: 20 });
        // examples
        const ROWS = [
          { n: 'client-acme', ok: 'ok', note: 'short, lower case, readable', at: s(0) + 0.2 },
          { n: 'break-glass', ok: 'ok', note: 'dashes are fine', at: s(0) + 1.2 },
          { n: 'team.payments', ok: 'ok', note: 'dots are fine', at: s(0) + 2.2 },
          { n: 'u:ana', ok: 'bad', note: 'colon not allowed', at: s(2) },
          { n: 'developers@acme-web', ok: 'warn', note: 'reserved form', at: s(3) },
        ];
        ROWS.forEach((r, i) => {
          const y = 480 + i * 92;
          const col = r.ok === 'ok' ? C.green : r.ok === 'bad' ? C.red : C.amber;
          const sym = r.ok === 'ok' ? '✓' : r.ok === 'bad' ? '✕' : '⚠';
          const sv = tagL(130, y, r.n, { kind: r.ok === 'ok' ? 'user' : 'grey', size: 30 }) +
            mark(790, y, sym, { r: 30, color: col }) +
            text(850, y, r.note, { size: 30, weight: 500, fill: col === C.amber ? '#6B4000' : col });
          o += show(sv, { at: r.at, from: 'left', dist: 40 });
        });
        o += show(text(1180, 810, 'PKI Manager uses @ for the per-host form', { size: 26, fill: C.slate, weight: 500 }), { at: s(3) + 0.8 });
        o += show(text(1180, 850, 'of a principal: developers@acme-web', { size: 26, fill: C.slate, weight: 500, mono: false }), { at: s(3) + 0.8 });
        return o;
      },

      // ---------------------------------------------------------------- 12.5
      '12.5': ({ s, e }) => {
        let o = heading('No principals for people');
        // bad mapping: grows long
        const names = ['ana', 'pau', 'marta', 'eva', 'jan', 'lia', 'sol', 'noa'];
        const t0 = s(0) + 0.8, per = Math.max(0.35, (e(2) - 1.5 - t0) / names.length * 0.55);
        const n = A.now() < t0 ? 0 : Math.min(names.length, 1 + Math.floor((A.now() - t0) / per));
        const head = 'deploy ← ';
        let str = head + names.slice(0, n).join(', ') + (n >= names.length ? ', …' : '');
        const bad = A.now() >= s(2) + 0.8;
        const fade = bad ? 1 - 0.65 * ease(prog(s(2) + 0.8, 0.8)) : 1;
        let B = rect(110, 290, 1700, 130, { fill: C.white, stroke: C.red, sw: 3, r: 16 });
        B += text(140, 330, 'acme-web  ·  one principal per person', { size: 26, fill: C.slate, weight: 500 });
        B += text(140, 378, str, { size: 36, mono: true, weight: 700, fill: C.navy });
        o += show(`<g opacity="${fade.toFixed(3)}">${B}</g>`, { at: s(0), from: 'up', dist: 24 });
        o += show(mark(1730, 355, '✕', { r: 38, color: C.red }), { at: s(2) + 0.8, from: 'pop', cx: 1730, cy: 355, d: 0.35 });
        // item 1: the certificate already identifies the person
        const kx = 110, ky = 500, kw = 700;
        let K = rect(kx, ky, kw, 290, { fill: C.white, stroke: C.orange, sw: 3, r: 16 });
        K += `<path d="M${kx} ${ky + 16} a16 16 0 0 1 16 -16 h${kw - 32} a16 16 0 0 1 16 16 v${38} h${-kw} z" fill="${C.orange}"/>`;
        K += text(kx + 26, ky + 27, 'User certificate', { size: 28, weight: 700, fill: C.white });
        K += text(kx + 26, ky + 100, 'Key ID', { size: 28, fill: C.slate, weight: 500 }) + text(kx + kw - 26, ky + 100, 'ana@ops.example', { size: 30, mono: true, weight: 700, anchor: 'end', fill: C.orangeInk });
        K += text(kx + 26, ky + 170, 'Principals', { size: 28, fill: C.slate, weight: 500 }) + tagL(kx + 26, ky + 225, 'client-acme', { kind: 'soft', size: 28 });
        o += show(K, { at: s(1), from: 'left', dist: 40 });
        o += show(chip(kx + kw / 2, 840, 'the certificate already identifies the person', { kind: 'user', size: 26, anchor: 'middle' }), { at: s(1) + 0.6, from: 'up', dist: 12 });
        // replacement mapping
        const gx = 960, gw = 850;
        const gat = s(2) + Math.max(2.0, (e(2) - s(2)) * 0.55);
        let G = rect(gx, ky, gw, 290, { fill: C.white, stroke: C.green, sw: 3, r: 16 });
        G += text(gx + 30, ky + 40, 'acme-web  ·  one principal per customer', { size: 26, fill: C.slate, weight: 500 });
        G += text(gx + 30, ky + 125, 'deploy ← client-acme', { size: 40, mono: true, weight: 700, fill: '#075C41' });
        G += text(gx + 30, ky + 215, 'one name, for everyone who works on Acme', { size: 28, fill: C.slate });
        o += show(G + mark(gx + gw - 60, ky + 60, '✓', { r: 38, color: C.green }), { at: gat, from: 'right', dist: 50 });
        return o;
      },

      // ---------------------------------------------------------------- 12.6
      '12.6': ({ s }) => {
        let o = heading('In PKI Manager');
        const wx = 110, wy = 250, ww = 1100, wh = 735;
        let w = rect(wx, wy, ww, wh, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
        w += `<path d="M${wx} ${wy + 16} a16 16 0 0 1 16 -16 h${ww - 32} a16 16 0 0 1 16 16 v${38} h${-ww} z" fill="${C.navy}"/>`;
        w += text(wx + 28, wy + 27, 'PKI Manager  ›  SSH  ›  Principals', { size: 26, weight: 700, fill: C.white });
        w += chip(wx + ww - 24 - (textW('Zone: prod ▾', 24) + 24 * 1.2), wy + 27, 'Zone: prod ▾', { kind: 'good', size: 24 });
        o += show(w, { at: 0.2, from: 'up', dist: 24 });
        // card heading + form
        let f = text(wx + 34, wy + 100, 'Principal catalog', { size: 32, weight: 700 });
        f += text(wx + 34, wy + 140, 'Principals (roles) are matched against AuthorizedPrincipalsFile on each host.', { size: 22, fill: C.muted });
        const fy = wy + 190;
        const field = (x, w2, label, val, ph) => text(x, fy, label, { size: 22, weight: 500, fill: C.slate }) +
          rect(x, fy + 14, w2, 50, { fill: C.white, stroke: C.line, sw: 2, r: 8 }) + text(x + 14, fy + 40, val || ph, { size: 24, fill: val ? C.navy : C.muted, mono: true });
        f += field(wx + 34, 250, 'Name *', '', 'admins');
        f += field(wx + 304, 400, 'Description (optional)', '', 'Production administrators');
        f += field(wx + 724, 150, 'Zone *', 'prod', '');
        f += rect(wx + 900, fy + 14, 90, 50, { fill: C.navy, stroke: C.navy, sw: 0, r: 8 }) + text(wx + 945, fy + 40, 'Add', { size: 26, fill: C.white, anchor: 'middle', weight: 700 });
        o += show(f, { at: s(0) - 0.2, from: 'up', dist: 20 });
        // table
        const ty = wy + 285, rowH = 52, tx = wx + 30, tw = ww - 60;
        const ROWS = [
          ['developers', 'Developers: deploy and internal tools'],
          ['sysadmins', 'Administrators: root everywhere'],
          ['security', 'Security: read-only audit'],
          ['client-acme', 'Customer Acme'],
          ['client-globex', 'Customer Globex'],
          ['client-initech', 'Customer Initech'],
          ['break-glass', 'Emergency access only'],
        ];
        let tb = rect(tx, ty, tw, rowH * (ROWS.length + 1), { fill: C.white, stroke: C.line, sw: 2, r: 10 });
        tb += `<path d="M${tx} ${ty + 10} a10 10 0 0 1 10 -10 h${tw - 20} a10 10 0 0 1 10 10 v${rowH - 10} h${-tw} z" fill="${C.mist}"/>`;
        tb += text(tx + 18, ty + rowH / 2, 'Name', { size: 24, weight: 700 }) + text(tx + 340, ty + rowH / 2, 'Description', { size: 24, weight: 700 });
        o += show(tb, { at: s(0), from: 'up', dist: 20 });
        ROWS.forEach(([n, d], i) => {
          const y = ty + rowH * (i + 1) + rowH / 2;
          const r = `<line x1="${tx}" y1="${y - rowH / 2}" x2="${tx + tw}" y2="${y - rowH / 2}" stroke="${C.line}" stroke-width="1.5"/>` +
            text(tx + 18, y, n, { size: 26, mono: true, weight: 700, fill: C.orangeInk }) + text(tx + 340, y, d, { size: 24, fill: C.body });
          o += show(r, { at: s(0) + 0.6 + i * 0.5, from: 'right', dist: 40, d: 0.4 });
        });
        // item 1: same name, two zones
        const rx = 1260, rw = 560;
        o += show(text(rx + rw / 2, 300, 'Same name, two zones', { size: 32, weight: 700, anchor: 'middle' }), { at: s(1) });
        const zc = (y, zone, col, label) => rect(rx, y, rw, 150, { fill: C.white, stroke: col, sw: 3, r: 16 }) +
          text(rx + 26, y + 38, `Zone: ${zone}`, { size: 28, weight: 700, fill: col === C.green ? '#075C41' : C.slate }) +
          tagL(rx + 26, y + 100, 'client-acme', { kind: 'user', size: 30 }) +
          text(rx + rw - 26, y + 100, label, { size: 26, fill: C.slate, anchor: 'end' });
        o += show(zc(340, 'prod', C.green, 'principal 1'), { at: s(1) + 0.4, from: 'right', dist: 40 });
        o += show(mark(rx + rw / 2, 535, '≠', { r: 34, color: C.amber }), { at: s(1) + 1.4, from: 'pop', cx: rx + rw / 2, cy: 535, d: 0.35 });
        o += show(zc(580, 'staging', C.slate, 'principal 2'), { at: s(1) + 1.0, from: 'right', dist: 40 });
        o += nextPill('13 Mapping a real fleet', s(1));
        return o;
      },
    },
  };
})();
