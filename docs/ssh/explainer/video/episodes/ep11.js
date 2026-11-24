// Episode 11 — Under the hood: what sshd really checks (series 2, principals in depth).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, arrow, lock, heading, caption, nextCard, mark, ease, prog, clamp, lerp, textW } = A;

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
  /** User certificate card (orange header). Returns { svg, h, tag: [{x,y}] }. */
  function cert(x, y, w, { title = 'User certificate', rows = [['Key ID', 'ana@ops.example'], ['Valid', '7 days']], principals = ['developers'], hdr = C.orange, stroke = C.orange, tagKind = 'soft' } = {}) {
    const hh = 54, rh = 50;
    const h = hh + 16 + rows.length * rh + 34 + 62;
    let o = rect(x, y, w, h, { fill: C.white, stroke, sw: 3, r: 16 });
    o += `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${hh - 16} h${-w} z" fill="${hdr}"/>`;
    o += text(x + 26, y + hh / 2 + 1, title, { size: 28, weight: 700, fill: C.white });
    rows.forEach(([k, v], i) => {
      const cy = y + hh + 16 + rh * i + rh / 2;
      o += text(x + 26, cy, k, { size: 26, fill: C.slate, weight: 500 });
      o += text(x + w - 26, cy, v, { size: 26, mono: true, anchor: 'end' });
    });
    const ly = y + hh + 16 + rows.length * rh + 17;
    o += text(x + 26, ly, 'Principals', { size: 26, fill: C.slate, weight: 500 });
    const ty = ly + 50;
    let tx = x + 26;
    const pos = [];
    principals.forEach((p) => {
      const tw = tagW(p, 26);
      o += tag(tx + tw / 2, ty, p, { kind: tagKind, size: 26 });
      pos.push({ x: tx + tw / 2, y: ty });
      tx += tw + 12;
    });
    return { svg: o, h, tag: pos };
  }
  /** Server panel: navy title band + white body. */
  function serverPanel(x, y, w, h, label, { stroke = C.navy } = {}) {
    let o = rect(x, y, w, h, { fill: C.white, stroke, sw: 3, r: 16 });
    o += `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${44} h${-w} z" fill="${C.navy}"/>`;
    o += text(x + 46, y + 30, label, { size: 28, weight: 700, fill: C.white, mono: true });
    return o;
  }
  /** Compact certificate: header + one principal tag. Returns svg. */
  function miniCert(x, y, w, h, name, principal) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.orange, sw: 3, r: 14 });
    o += `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v${36 - 14} h${-w} z" fill="${C.orange}"/>`;
    o += text(x + 22, y + 19, name, { size: 24, weight: 700, fill: C.white });
    o += text(x + 22, y + 82, 'Principals', { size: 24, fill: C.slate, weight: 500 });
    o += tag(x + w - 26 - tagW(principal, 26) / 2, y + 82, principal, { kind: 'soft', size: 26 });
    return o;
  }
  /** Next-episode pill sized to its label (A.nextCard has a fixed 400 px width and clips long labels). */
  function nextPill(label, at) {
    const str = `Next: ${label}  →`;
    const w = Math.min(760, textW(str, 26) * 1.1 + 60);
    return show(rect(1820 - w, 900, w, 70, { fill: C.navy, stroke: C.navy, sw: 0, r: 35 }) + text(1820 - w / 2, 936, str, { size: 26, anchor: 'middle', fill: C.white, weight: 700 }), { at, from: 'right', dist: 30 });
  }
  const FILE = '/etc/ssh/auth_principals/deploy';

  EPISODES['11'] = {
    scenes: {
      // ---------------------------------------------------------------- 11.1
      '11.1': ({ s }) => {
        let o = heading('Where we start');
        const cx0 = 110, cy0 = 290, cw = 640, px = 1000, pw = 820;
        const c = cert(cx0, cy0, cw, { title: 'User certificate' });
        const ch = c.h;
        o += show(c.svg, { at: s(0) + 0.2, from: 'left' });
        const cb = code({ x: px + 30, y: cy0 + 78, w: pw - 60, size: 28, title: FILE, lines: ['developers'], hl: [{ line: 0, at: s(1) + 1.9, color: C.green, opacity: 0.25 }] });
        o += show(serverPanel(px, cy0, pw, ch, 'web1.acme.example') + cb.svg, { at: s(0) + 0.5, from: 'right' });
        // the two tags slide together and lock (item 1)
        const my = cy0 + ch + 95, mx = 960;
        const t0 = s(1) + 0.5, p = ease(prog(t0, 1.1));
        if (A.now() >= t0) {
          if (p < 1) {
            const a = { x: lerp(c.tag[0].x, mx, p), y: lerp(c.tag[0].y, my, p) };
            const b = { x: lerp(px + 52 + 90, mx, p), y: lerp(cy0 + 78 + 45.6 + 22 + 14, my, p) };
            o += tag(b.x, b.y, 'developers', { kind: 'grey', size: 30 }) + tag(a.x, a.y, 'developers', { kind: 'user', size: 30 });
          } else {
            o += show(tag(mx, my, 'developers', { kind: 'green', size: 34 }) + lock(mx - 190, my + 4, { s: 1.5, color: C.green }) +
              mark(mx + 190, my, '✓', { r: 34, color: C.green }), { at: t0 + 1.1, d: 0.3, from: 'none' });
          }
        }
        // title card (item 2)
        o += show(rect(360, 800, 1200, 130, { fill: C.navy, stroke: C.navyDeep, sw: 3, r: 22 }) +
          text(960, 845, 'Series 2', { size: 32, anchor: 'middle', fill: '#FFB380', weight: 700 }) +
          text(960, 890, 'Principals in depth', { size: 48, anchor: 'middle', fill: C.white, weight: 700 }), { at: s(2), from: 'up', dist: 30 });
        return o;
      },

      // ---------------------------------------------------------------- 11.2
      '11.2': ({ s }) => {
        let o = heading('One file per local account');
        // drop-in line
        const size = 32;
        const dx = 110, dy = 285, dw = 1700;
        const blk = code({ x: dx, y: dy, w: dw, size, title: '/etc/ssh/sshd_config.d/60-ssh-ca.conf', lines: [''], kind: 'file' });
        o += show(blk.svg, { at: s(0) - 0.4, from: 'up', dist: 24 });
        const ly = dy + Math.round(size * 0.85) * 1.9 + 22 + size * 0.5;
        const lx = dx + 22;
        const head = 'AuthorizedPrincipalsFile /etc/ssh/auth_principals/';
        const hw = textW(head, size, true);
        o += show(text(lx, ly, head, { size, mono: true }), { at: s(0) - 0.2, from: 'none' });
        const vars = [{ v: '%u', at: s(0) + 0.6, out: s(1) }, { v: 'deploy', at: s(1), out: s(2) }, { v: 'root', at: s(2), out: null }];
        vars.forEach(({ v, at, out }) => {
          const vw = textW(v, size, true);
          const col = v === '%u' ? C.orange : v === 'deploy' ? C.green : C.navy;
          const pill = rect(lx + hw - 6, ly - size * 0.75, vw + 12, size * 1.5, { fill: v === '%u' ? C.orangeSoft : C.greenSoft, stroke: col, sw: 2, r: 8 }) +
            text(lx + hw, ly + 1, v, { size, mono: true, weight: 700, fill: v === '%u' ? C.orangeInk : '#075C41' });
          o += show(pill, { at, out: out ?? undefined, from: 'none', d: 0.3, outD: 0.25 });
        });
        o += show(text(lx + hw + 220, ly, '← the account in the login', { size: 26, fill: C.slate, weight: 500 }), { at: s(0) + 0.8, out: s(1), from: 'none', outD: 0.25 });
        // login chips
        const loginY = 505;
        o += show(chip(110, loginY, '$ ssh deploy@dev-01', { kind: 'plain', size: 28, mono: true }), { at: s(1), out: s(2), from: 'down', dist: 16, outD: 0.25 });
        o += show(chip(110, loginY, '$ ssh root@dev-01', { kind: 'plain', size: 28, mono: true }), { at: s(2), from: 'down', dist: 16 });
        o += show(text(560, loginY, 'reads the file with that name', { size: 28, fill: C.slate, weight: 500 }), { at: s(1) + 0.6 });
        // folder view
        const fb = code({
          x: 110, y: 590, w: 1000, size: 30, title: '/etc/ssh/auth_principals/', kind: 'file',
          lines: ['deploy   developers, sysadmins', 'root     sysadmins'],
          hl: [{ line: 0, at: s(1) + 0.4, color: C.green, opacity: 0.28 }, { line: 1, at: s(2) + 0.4, color: C.green, opacity: 0.28 }],
        });
        o += show(fb.svg, { at: s(0) + 1.2, from: 'up', dist: 24 });
        o += show(card({ x: 1230, y: 600, w: 590, h: 150, kind: 'good', title: 'Each account has', body: ['its own list of accepted principals'], size: 32, bodySize: 28 }), { at: s(3), from: 'left', dist: 30 });
        return o;
      },

      // ---------------------------------------------------------------- 11.3
      '11.3': ({ s }) => {
        let o = heading('No file, no certificate login');
        const c = cert(110, 290, 560, { title: 'User certificate', rows: [['Key ID', 'ana@ops.example']] });
        o += show(c.svg, { at: 0.2, from: 'left' });
        const px = 1050, pw = 770, py = 290, ph = 300;
        const cb = code({
          x: px + 30, y: py + 78, w: pw - 60, size: 28, title: '/etc/ssh/auth_principals/', kind: 'file',
          lines: ['deploy', 'root', { text: 'postgres  ← no file', color: C.red }], lineAt: [null, null, s(0) + 0.8],
          hl: [{ line: 2, at: s(0) + 0.8, color: C.red, opacity: 0.14 }],
        });
        o += show(serverPanel(px, py, pw, ph, 'dev-01') + cb.svg, { at: 0.3, from: 'right' });
        o += arrow({ x1: 690, y1: 440, x2: 1030, y2: 440, at: s(0) + 1.8, d: 0.8, color: C.slate, width: 5, label: 'ssh postgres@dev-01', labelSize: 24, curve: 0 });
        // refusal
        const rt = s(0) + 3.0;
        o += show(rect(px, py + ph + 24, pw, 90, { fill: C.redSoft, stroke: C.red, sw: 3, r: 14 }) +
          mark(px + 50, py + ph + 69, '✕', { r: 28, color: C.red }) +
          text(px + 100, py + ph + 69, 'no principals file: certificate refused', { size: 28, weight: 700, fill: '#8E1B1B' }), { at: rt, from: 'up', dist: 20 });
        // item 1: closed
        o += show(chip(390, py + 395, 'unmapped accounts stay closed', { kind: 'danger', size: 28, anchor: 'middle' }), { at: s(1), from: 'up', dist: 14 });
        o += show(lock(px + pw - 76, py + 228, { s: 1.1, color: C.red }), { at: s(1) + 0.3, from: 'none' });
        // item 2: side card
        o += show(card({ x: 110, y: 780, w: 1710, h: 150, kind: 'file', title: 'authorized_keys and passwords are checked separately', body: ['→ disable them'], size: 34, bodySize: 32 }), { at: s(2), from: 'up', dist: 24 });
        return o;
      },

      // ---------------------------------------------------------------- 11.4
      '11.4': ({ s }) => {
        let o = heading('One match is enough');
        const fx = 110, fy = 330, fw = 720;
        const fb = code({
          x: fx, y: fy, w: fw, size: 32, title: FILE, kind: 'file', lines: ['client-acme', 'sysadmins'],
          hl: [{ line: 0, at: s(0) + 1.0, color: C.green, opacity: 0.28 }, { line: 1, at: s(0) + 2.0, color: C.green, opacity: 0.28 }],
        });
        o += show(fb.svg, { at: 0.2, from: 'left' });
        const lineY = (i) => fy + Math.round(32 * 0.85) * 1.9 + 22 + i * 32 * 1.42 + 16;
        o += show(text(fx + fw / 2, fy + fb.h + 40, 'each name = a separate way in', { size: 28, fill: C.slate, anchor: 'middle', weight: 500 }), { at: s(0) + 1.4 });
        // certificates A, B, C
        const cxs = 1100, cw = 720, chh = 130;
        const C3 = [{ n: 'Certificate A', p: 'client-acme', ok: true, y: 290 }, { n: 'Certificate B', p: 'sysadmins', ok: true, y: 460 }, { n: 'Certificate C', p: 'developers', ok: false, y: 630 }];
        C3.forEach((q, i) => {
          const at = s(1) + 0.2 + i * 0.5;
          o += show(miniCert(cxs, q.y, cw, chh, q.n, q.p), { at, from: 'right', dist: 60 });
          const my = q.y + chh / 2;
          const tgt = i === 0 ? lineY(0) : i === 1 ? lineY(1) : fy + fb.h - 6;
          if (q.ok) {
            o += arrow({ x1: cxs - 10, y1: my, x2: fx + fw + 14, y2: tgt, at: at + 0.5, d: 0.7, color: C.green, width: 5 });
            o += show(mark(960, (my + tgt) / 2 + (i === 0 ? 0 : 0), '✓', { r: 30, color: C.green }), { at: at + 1.1, from: 'pop', cx: 960, cy: (my + tgt) / 2, d: 0.3 });
          } else {
            o += arrow({ x1: cxs - 10, y1: my, x2: fx + fw + 14, y2: tgt, at: at + 0.5, d: 0.7, color: C.red, width: 5, dashed: true });
            o += show(mark(960, (my + tgt) / 2, '✕', { r: 30, color: C.red }), { at: at + 1.1, from: 'pop', cx: 960, cy: (my + tgt) / 2, d: 0.3 });
          }
        });
        o += show(chip(960, 940, 'Two names never mean that both are required', { kind: 'warn', size: 28, anchor: 'middle' }), { at: s(2), from: 'up', dist: 14 });
        o += caption('any one match opens the account', { at: s(1) + 2.8, kind: 'good' }).replace(/y="958"/g, 'y="885"');
        return o;
      },

      // ---------------------------------------------------------------- 11.5
      '11.5': ({ s }) => {
        let o = heading('What the server logs');
        const size = 24;
        const segs = [
          { t: 'Accepted publickey for deploy from 10.0.4.17 port 51022 ssh2: ED25519-CERT SHA256:… ', k: 'plain' },
          { t: 'ID ana@ops.example', k: 'id' },
          { t: ' ', k: 'plain' },
          { t: '(serial 42) CA ECDSA SHA256:…', k: 'ca' },
        ];
        const lx = 100, lw = 1720, ly = 275, lh = 120;
        o += show(rect(lx, ly, lw, lh, { fill: C.white, stroke: C.slate, sw: 3, r: 14 }) +
          `<path d="M${lx} ${ly + 14} a14 14 0 0 1 14 -14 h${lw - 28} a14 14 0 0 1 14 14 v${36 - 14} h${-lw} z" fill="${C.slate}"/>` +
          text(lx + 20, ly + 19, '/var/log/auth.log', { size: 22, mono: true, weight: 700, fill: C.white }), { at: 0.2, from: 'up', dist: 20 });
        // typed log line
        const t0 = s(0) + 0.5;
        const total = segs.reduce((n, q) => n + q.t.length, 0);
        const shown = Math.min(total, Math.floor(Math.max(0, A.now() - t0) * 46));
        let x = lx + 18, left = shown;
        const ty = ly + 80;
        const pos = {};
        let body = '';
        segs.forEach((q) => {
          const n = Math.min(left, q.t.length);
          const full = n === q.t.length;
          pos[q.k] = { x0: x, x1: x + textW(q.t, size, true) };
          if (n > 0) {
            const hlOn = (q.k === 'id' && A.now() >= s(1)) || (q.k === 'ca' && A.now() >= t0 + total / 46 + 0.6);
            const w = textW(q.t, size, true);
            if (full && hlOn) body += rect(x - 4, ty - 20, w + 8, 40, { fill: q.k === 'id' ? C.orangeSoft : '#E8E9F3', stroke: q.k === 'id' ? C.orange : C.navy, sw: 2, r: 8 });
            body += text(x, ty, q.t.slice(0, n), { size, mono: true, fill: hlOn && full ? (q.k === 'id' ? C.orangeInk : C.navy) : C.body, weight: hlOn && full ? 700 : 400 });
          }
          left -= n; x += textW(q.t, size, true);
        });
        o += body;
        // item 0 labels under the line
        const lab = (x0, x1, label, at) => show(text((x0 + x1) / 2, ly + lh + 34, label, { size: 24, fill: C.slate, anchor: 'middle', weight: 500 }), { at, from: 'up', dist: 10 });
        const px0 = (str) => lx + 18 + textW(str, size, true);
        lab0: {
          const acct = [px0('Accepted publickey for '), px0('Accepted publickey for deploy')];
          const ser = [px0(segs[0].t + 'ID ana@ops.example '), px0(segs[0].t + 'ID ana@ops.example (serial 42)')];
          const sca = [px0(segs[0].t + 'ID ana@ops.example (serial 42) '), px0(segs[0].t + 'ID ana@ops.example (serial 42) CA ECDSA SHA256:…')];
          o += lab(acct[0], acct[1], 'account', s(0) + 3.0);
          o += lab(pos.id.x0, pos.id.x1, 'key ID', s(0) + 4.2);
          o += lab(ser[0], ser[1], 'serial', s(0) + 5.2);
          o += lab(sca[0], sca[1], 'signing CA', s(0) + 6.2);
        }
        // item 1: key ID chip
        if (A.now() >= s(1)) {
          const k = chip(1400, 520, 'key ID = a label: the identity', { kind: 'user', size: 26, anchor: 'start' });
          o += show(`<g transform="translate(${-textW('key ID = a label: the identity', 26) - 26 * 1.2} 0)">${k}</g>`, { at: s(1) + 0.3, from: 'up', dist: 14 });
        }
        // item 2: record + arrow
        const ry = 610, rh = 270, rx = 1000, rw = 820;
        const rec = rect(rx, ry, rw, rh, { fill: C.white, stroke: C.orange, sw: 3, r: 16 }) +
          `<path d="M${rx} ${ry + 16} a16 16 0 0 1 16 -16 h${rw - 32} a16 16 0 0 1 16 16 v${54 - 16} h${-rw} z" fill="${C.orange}"/>` +
          text(rx + 26, ry + 28, 'PKI Manager › Certificates', { size: 28, weight: 700, fill: C.white }) +
          text(rx + 26, ry + 100, 'Identity', { size: 28, fill: C.slate, weight: 500 }) + text(rx + rw - 26, ry + 100, 'ana@ops.example', { size: 28, mono: true, anchor: 'end', fill: C.orangeInk, weight: 700 }) +
          text(rx + 26, ry + 160, 'Serial', { size: 28, fill: C.slate, weight: 500 }) + text(rx + rw - 26, ry + 160, '42', { size: 28, mono: true, anchor: 'end', fill: C.navy, weight: 700 }) +
          text(rx + 26, ry + 220, 'Issued by', { size: 28, fill: C.slate, weight: 500 }) + text(rx + rw - 26, ry + 220, 'User CA · ECDSA', { size: 28, mono: true, anchor: 'end', fill: C.navy, weight: 700 });
        o += show(rec, { at: s(2), from: 'up', dist: 30 });
        o += arrow({ x1: 1590, y1: 458, x2: 1590, y2: ry - 8, at: s(2) + 0.8, d: 0.8, color: C.navy, width: 5, label: 'match', labelSize: 26 });
        o += show(card({ x: 100, y: 600, w: 700, h: 180, kind: 'good', title: 'To be sure who it was', body: ['match the CA and the serial'], size: 32, bodySize: 30 }), { at: s(2) + 0.2, from: 'left', dist: 30 });
        o += nextPill('12 Designing your catalog', s(2));
        return o;
      },
    },
  };
})();
