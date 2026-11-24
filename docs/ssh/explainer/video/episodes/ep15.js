// Episode 15 — Customers: isolation, moves and exits (series 2, principals in depth).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, terminal, arrow, server, person, ca, heading, caption, mark, ease, prog, clamp, lerp, textW } = A;

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
  const tagL = (x, cy, label, o = {}) => tag(x + tagW(label, o.size ?? 30) / 2, cy, label, o);
  /** Next-episode pill sized to its label (A.nextCard has a fixed 400 px width and clips long labels). */
  function nextPill(label, at) {
    const str = `Next: ${label}  →`;
    const w = Math.min(760, textW(str, 26) * 1.1 + 60);
    return show(rect(1820 - w, 900, w, 70, { fill: C.navy, stroke: C.navy, sw: 0, r: 35 }) + text(1820 - w / 2, 936, str, { size: 26, anchor: 'middle', fill: C.white, weight: 700 }), { at, from: 'right', dist: 30 });
  }
  /** Compact certificate: header + principals row. Returns svg. */
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
  /** User certificate card (orange header). Returns { svg, h }. */
  function cert(x, y, w, { title = 'User certificate', rows = [['Key ID', 'ana@ops.example'], ['Serial', '42']], principals = ['developers'], hdr = C.orange, stroke = C.orange, tagKind = 'soft' } = {}) {
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
    let tx = x + 26;
    principals.forEach((p) => {
      const tw = tagW(p, 26);
      o += tag(tx + tw / 2, ly + 50, p, { kind: tagKind, size: 26 });
      tx += tw + 12;
    });
    return { svg: o, h };
  }
  /** Server panel: navy title band + white body. */
  function serverPanel(x, y, w, h, label) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
    o += `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${44} h${-w} z" fill="${C.navy}"/>`;
    o += text(x + 46, y + 30, label, { size: 28, weight: 700, fill: C.white, mono: true });
    return o;
  }
  const FILE = '/etc/ssh/auth_principals/deploy';

  EPISODES['15'] = {
    scenes: {
      // ---------------------------------------------------------------- 15.1
      '15.1': ({ s, e }) => {
        let o = heading('Isolation for free');
        const px = 1090, pw = 730, py = 290, ph = 540;
        // acme-web with its deploy file
        const cb = code({
          x: px + 30, y: py + 78, w: pw - 60, size: 30, title: FILE, kind: 'file', lines: ['client-acme', 'sysadmins'],
          hl: [{ line: 0, at: s(2), color: C.green, opacity: 0.25 }, { line: 1, at: s(2), color: C.green, opacity: 0.25 }],
        });
        o += show(serverPanel(px, py, pw, ph, 'acme-web') + cb.svg, { at: s(0), from: 'right', dist: 50 });
        o += show(text(px + pw / 2, py + 78 + cb.h + 34, 'no "developers" in this file', { size: 28, anchor: 'middle', fill: C.slate, weight: 500 }), { at: s(2) + 0.6 });
        // the Globex developer's certificate: flies to acme-web and bounces
        const cx0 = 110, cw = 660, chh = 130, gy = 330, ay = 600;
        const t0 = s(2) + 1.6;
        const u = A.now() - t0;
        const dxG = u < 0 ? 0 : u < 0.7 ? ease(u / 0.7) * 250 : u < 1.3 ? (1 - ease((u - 0.7) / 0.6)) * 250 : 0;
        o += show(`<g transform="translate(${dxG.toFixed(1)} 0)">${miniCert(cx0, gy, cw, chh, "Globex developer's certificate", ['developers', 'client-globex'])}</g>`, { at: s(1), from: 'left', dist: 60 });
        // Ana's certificate
        const t1 = s(3) + 0.4;
        const dxA = ease(prog(t1, 0.9)) * 250;
        o += show(`<g transform="translate(${dxA.toFixed(1)} 0)">${miniCert(cx0, ay, cw, chh, "Ana's certificate", ['developers', 'client-acme'])}</g>`, { at: s(1) + 1.2, from: 'left', dist: 60 });
        // results
        o += show(chip(cx0 + 330, gy + chh + 52, 'both carry developers', { kind: 'warn', size: 26, anchor: 'middle' }), { at: s(1) + 2.0, out: s(2) + 1.0, from: 'up', dist: 10 });
        o += show(card({ x: px + 30, y: py + 330, w: pw - 60, h: 80, kind: 'danger', title: '✕  Globex developer: no client-acme', size: 28 }), { at: t0 + 0.7, from: 'up', dist: 14 });
        o += show(card({ x: px + 30, y: py + 430, w: pw - 60, h: 80, kind: 'good', title: '✓  Ana: client-acme matches', size: 28 }), { at: t1 + 0.9, from: 'up', dist: 14 });
        o += show(mark(px - 36, gy + chh / 2, '✕', { r: 28, color: C.red }), { at: t0 + 0.7, from: 'pop', cx: px - 36, cy: gy + chh / 2, d: 0.3 });
        o += show(mark(px - 36, ay + chh / 2, '✓', { r: 28, color: C.green }), { at: t1 + 0.9, from: 'pop', cx: px - 36, cy: ay + chh / 2, d: 0.3 });
        o += show(text(cx0 + 330, ay + chh + 40, 'a valid certificate, but the wrong customer', { size: 26, anchor: 'middle', fill: C.slate, weight: 500 }), { at: s(3) + 1.6 });
        void e;
        return o;
      },

      // ---------------------------------------------------------------- 15.2
      '15.2': ({ s, e }) => {
        let o = heading('A new customer');
        o += show(chip(110, 270, 'New customer: Umbrella', { kind: 'plain', size: 30 }), { at: s(0), from: 'left', dist: 40 });
        const D = e(1) - s(1);
        const ty = 330, th = 420, tw = 520;
        const X = [110, 700, 1290];
        const T = [s(1) + 0.3, s(1) + Math.max(2.2, D * 0.33), s(1) + Math.max(4.2, D * 0.62)];
        const stepFrame = (i, title, sub) => rect(X[i], ty, tw, th, { fill: C.white, stroke: C.navy, sw: 3, r: 18 }) +
          mark(X[i] + 40, ty + 4, String(i + 1), { r: 26, color: C.navy }) +
          text(X[i] + 86, ty + 46, title, { size: 32, weight: 700 }) +
          text(X[i] + 86, ty + 86, sub, { size: 24, fill: C.slate });
        // 1: catalog
        let a = stepFrame(0, 'Principal catalog', 'create it once');
        a += text(X[0] + 30, ty + 150, 'Name *', { size: 24, weight: 500, fill: C.slate });
        a += rect(X[0] + 30, ty + 168, tw - 60, 56, { fill: C.white, stroke: C.line, sw: 2, r: 8 }) + text(X[0] + 46, ty + 197, 'client-umbrella', { size: 28, mono: true, weight: 700, fill: C.orangeInk });
        a += rect(X[0] + 30, ty + 262, 110, 56, { fill: C.navy, stroke: C.navy, sw: 0, r: 8 }) + text(X[0] + 85, ty + 291, 'Add', { size: 28, fill: C.white, anchor: 'middle', weight: 700 });
        a += tagL(X[0] + 30, ty + 366, 'client-umbrella', { kind: 'user', size: 26 });
        o += show(a, { at: T[0], from: 'up', dist: 30 });
        // 2: mapping
        let b = stepFrame(1, 'Mapping', 'on Umbrella’s servers');
        b += text(X[1] + 30, ty + 150, 'Host', { size: 24, weight: 500, fill: C.slate }) + text(X[1] + tw - 30, ty + 150, 'umbrella-web', { size: 28, mono: true, anchor: 'end', weight: 700 });
        b += text(X[1] + 30, ty + 210, 'Principal', { size: 24, weight: 500, fill: C.slate }) + text(X[1] + tw - 30, ty + 210, 'client-umbrella', { size: 28, mono: true, anchor: 'end', weight: 700, fill: C.orangeInk });
        b += text(X[1] + 30, ty + 270, 'Local account', { size: 24, weight: 500, fill: C.slate }) + text(X[1] + tw - 30, ty + 270, 'deploy', { size: 28, mono: true, anchor: 'end', weight: 700 });
        b += rect(X[1] + 30, ty + 318, tw - 60, 70, { fill: C.orangeSoft, stroke: C.orange, sw: 2, r: 10 }) + text(X[1] + tw / 2, ty + 353, 'client-umbrella → deploy', { size: 26, mono: true, anchor: 'middle', weight: 700 });
        o += show(b, { at: T[1], from: 'up', dist: 30 });
        // 3: Pau's next certificate
        let c = stepFrame(2, 'Pau’s next certificate', 'only people on the account');
        const rowTags = [[['developers', 'soft'], ['client-acme', 'soft']], [['client-globex', 'soft'], ['client-umbrella', 'user']]];
        rowTags.forEach((row, ri) => {
          let tx = X[2] + 30;
          row.forEach(([n, k]) => {
            const w2 = tagW(n, 24);
            const isNew = n === 'client-umbrella';
            const node = tag(tx + w2 / 2, ty + 170 + ri * 80, n, { kind: k, size: 24 });
            c += isNew ? show(node, { at: T[2] + 0.9, from: 'pop', cx: tx + w2 / 2, cy: ty + 170 + ri * 80, d: 0.5 }) : node;
            tx += w2 + 10;
          });
        });
        o += show(c, { at: T[2], from: 'up', dist: 30 });
        o += show(chip(X[2] + tw / 2, ty + 330, '+ client-umbrella', { kind: 'good', size: 28, anchor: 'middle', mono: true }), { at: T[2] + 1.4, from: 'up', dist: 10 });
        o += show(text(X[2] + tw / 2, ty + 380, 'Ana does not get it', { size: 24, fill: C.slate, anchor: 'middle' }), { at: T[2] + 2.0 });
        o += arrow({ x1: X[0] + tw + 6, y1: ty + th / 2, x2: X[1] - 8, y2: ty + th / 2, at: T[1] - 0.3, d: 0.5, color: C.slate, width: 5 });
        o += arrow({ x1: X[1] + tw + 6, y1: ty + th / 2, x2: X[2] - 8, y2: ty + th / 2, at: T[2] - 0.3, d: 0.5, color: C.slate, width: 5 });
        return o;
      },

      // ---------------------------------------------------------------- 15.3
      '15.3': ({ s, e }) => {
        let o = heading('Someone moves to another customer');
        const rvAt = s(2) + 0.8;
        const revoked = A.now() >= rvAt + 0.5;
        // old certificate
        const old = cert(110, 310, 640, { title: "Ana's old certificate", rows: [['Key ID', 'ana@ops.example'], ['Serial', '42']], principals: ['developers', 'client-acme'], hdr: revoked ? C.slate : C.orange, stroke: revoked ? C.slate : C.orange, tagKind: revoked ? 'grey' : 'soft' });
        let oldSvg = old.svg;
        const pressed = A.now() >= rvAt && A.now() < rvAt + 0.5;
        if (A.now() >= s(2) && !revoked) {
          oldSvg += rect(540, 316, 200, 42, { fill: pressed ? C.red : C.redSoft, stroke: C.red, sw: 2.5, r: 21 }) + text(640, 338, 'Revoke', { size: 26, weight: 700, anchor: 'middle', fill: pressed ? C.white : '#8E1B1B' });
        }
        o += show(oldSvg, { at: s(0), from: 'left', dist: 50 });
        o += show(`<g transform="translate(585 324) rotate(-9)">${rect(-120, -34, 240, 68, { fill: C.redSoft, stroke: C.red, sw: 5, r: 10 })}${text(0, 3, 'REVOKED', { size: 40, weight: 700, anchor: 'middle', fill: C.red })}</g>`, { at: rvAt + 0.5, from: 'pop', cx: 585, cy: 324 });
        o += show(chip(110, 262, 'Ana moves: Acme → Globex', { kind: 'plain', size: 24 }), { at: s(0), from: 'left', dist: 30 });
        // new certificate
        const nw = cert(110, 610, 640, { title: "Ana's new certificate", rows: [['Key ID', 'ana@ops.example'], ['Serial', '51']], principals: ['developers', 'client-globex'], hdr: C.orange, stroke: A.now() >= s(3) ? C.green : C.orange });
        o += show(nw.svg, { at: s(1), from: 'left', dist: 50 });
        o += show(mark(740, 610, '✓', { r: 30, color: C.green }), { at: s(3) + 2.8, from: 'pop', cx: 740, cy: 610, d: 0.35 });
        // KRL
        const krl = code({ x: 1000, y: 310, w: 820, size: 30, title: 'KRL: revoked keys', kind: 'file', lines: [{ text: 'serial 42   ana@ops.example', color: '#8E1B1B' }], lineAt: [rvAt + 1.3], hl: [{ line: 0, at: rvAt + 1.3, color: C.red, opacity: 0.14 }] });
        o += show(krl.svg, { at: rvAt + 0.9, from: 'right', dist: 40 });
        o += arrow({ x1: 765, y1: 390, x2: 990, y2: 390, at: rvAt + 0.6, d: 0.7, color: C.red, width: 5, curve: 0, label: 'into the KRL', labelSize: 24 });
        // servers pull
        const sy = 640;
        const accOn = A.now() >= s(3) + 1.8;
        o += show(server(1240, sy, { s: 0.8, label: 'acme-web', labelSize: 26, state: accOn ? 'bad' : undefined }) + server(1600, sy, { s: 0.8, label: 'globex-web', labelSize: 26, state: A.now() >= s(3) + 2.8 ? 'ok' : undefined }), { at: s(3) - 0.2, from: 'up', dist: 30 });
        o += arrow({ x1: 1380, y1: 315 + krl.h, x2: 1270, y2: sy - 80, at: s(3) + 0.3, d: 0.8, color: C.slate, width: 5, curve: -40, label: 'next pull', labelSize: 26 });
        o += show(chip(1240, sy + 150, 'refuses serial 42', { kind: 'danger', size: 26, anchor: 'middle' }), { at: s(3) + 1.8, from: 'up', dist: 12 });
        o += show(chip(1600, sy + 150, 'serial 51 works', { kind: 'good', size: 26, anchor: 'middle' }), { at: s(3) + 2.8, from: 'up', dist: 12 });
        void e;
        return o;
      },

      // ---------------------------------------------------------------- 15.4
      '15.4': ({ s, e }) => {
        let o = heading('A customer leaves');
        const D = e(1) - s(1);
        // servers
        o += show(server(250, 400, { s: 0.95, label: 'initech-web', labelSize: 24 }) + server(520, 400, { s: 0.95, label: 'initech-db', labelSize: 24 }), { at: s(0), from: 'left', dist: 40 });
        o += show(tagL(110, 560, 'client-initech', { kind: A.now() >= e(1) - 2.2 ? 'grey' : 'user', size: 28 }), { at: s(0) + 0.6 });
        // stop issuing: strike the tag
        const stopAt = e(1) - 2.2;
        if (A.now() >= stopAt) {
          const p = ease(prog(stopAt, 0.5));
          o += `<line x1="110" y1="560" x2="${110 + 249 * p}" y2="560" stroke="${C.red}" stroke-width="3" stroke-linecap="round"/>`;
          o += show(text(280, 620, 'stop issuing it', { size: 26, fill: '#8E1B1B', anchor: 'middle', weight: 500 }), { at: stopAt + 0.4 });
        }
        // checklist
        const cx = 780, cw = 1040, chh = 125;
        const ys = [290, 440, 590];
        const T = [s(1) + 0.4, s(1) + Math.max(2.5, D * 0.40), s(1) + Math.max(5, D * 0.70)];
        // step 3 first? No: the offboard button is shown at s(0) as the trigger, step order stays 1-2-3.
        let c1 = rect(cx, ys[0], cw, chh, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) + mark(cx + 10, ys[0] + 4, '1', { r: 26, color: C.navy }) +
          text(cx + 58, ys[0] + 38, 'On each machine, remove', { size: 30, weight: 700 }) +
          text(cx + 58, ys[0] + 84, '/etc/ssh/ssh-user-ca.pub trust  +  auth_principals/*', { size: 26, mono: true, fill: C.slate });
        o += show(c1, { at: T[0], from: 'right', dist: 50 });
        let c2 = rect(cx, ys[1], cw, chh, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) + mark(cx + 10, ys[1] + 4, '2', { r: 26, color: C.navy }) +
          text(cx + 58, ys[1] + 38, 'Test', { size: 30, weight: 700 }) +
          text(cx + 58, ys[1] + 84, 'a certificate from your fleet is now refused', { size: 28, fill: C.slate });
        o += show(c2, { at: T[1], from: 'right', dist: 50 });
        const tm = terminal({ x: 110, y: 690, w: 640, size: 24, title: 'ssh test', items: [{ t: '$ ssh deploy@initech-web', at: T[1] + 0.8 }, { t: 'Permission denied (publickey).', out: true, at: T[1] + 2.4, color: '#FFB4B4' }] });
        o += show(tm.svg, { at: T[1] + 0.6, from: 'up', dist: 16 });
        o += show(mark(cx + cw - 50, ys[1] + chh / 2, '✓', { r: 30, color: C.green }), { at: T[1] + 3.0, from: 'pop', cx: cx + cw - 50, cy: ys[1] + chh / 2, d: 0.3 });
        // step 3: offboard
        const press = A.now() >= T[2] + 1.2;
        let c3 = rect(cx, ys[2], cw, chh, { fill: C.white, stroke: press ? C.green : C.navy, sw: 3, r: 16 }) + mark(cx + 10, ys[2] + 4, '3', { r: 26, color: C.navy }) +
          text(cx + 58, ys[2] + 38, 'In PKI Manager', { size: 30, weight: 700 }) +
          rect(cx + 58, ys[2] + 62, 230, 50, { fill: press ? C.green : C.navy, stroke: press ? C.green : C.navy, sw: 0, r: 10 }) + text(cx + 173, ys[2] + 88, 'Offboard', { size: 28, weight: 700, fill: C.white, anchor: 'middle' }) +
          text(cx + 320, ys[2] + 88, 'only after steps 1 and 2', { size: 26, fill: C.slate });
        o += show(c3, { at: T[2], from: 'right', dist: 50 });
        // note from item 0/1
        o += show(card({ x: 780, y: 760, w: 1040, h: 100, kind: 'warn', title: 'Offboard does not touch the machines', size: 32 }), { at: s(1) + 0.1, from: 'up', dist: 16 });
        return o;
      },

      // ---------------------------------------------------------------- 15.5
      '15.5': ({ s }) => {
        let o = heading('Customer principals or zones?');
        // left: one CA, customer tags -> separate access
        const lx = 110, ly = 280, lw = 830, lh = 440;
        let L = rect(lx, ly, lw, lh, { fill: C.white, stroke: C.orange, sw: 3, r: 18 });
        L += text(lx + 30, ly + 42, 'One CA, customer principals', { size: 30, weight: 700 });
        L += person(lx + 120, ly + 220, { s: 0.7, label: 'anyone who issues', labelSize: 24, color: C.navy });
        L += ca(lx + 420, ly + 220, { r: 75, kind: 'user', label: 'User CA' });
        L += tagL(lx + 550, ly + 170, 'client-acme', { kind: 'user', size: 28 }) + tagL(lx + 550, ly + 270, 'client-globex', { kind: 'user', size: 28 });
        o += show(L, { at: 0.2, from: 'left', dist: 40 });
        o += arrow({ x1: lx + 190, y1: ly + 220, x2: lx + 335, y2: ly + 220, at: s(0) + 0.5, d: 0.7, color: C.orange, width: 5, label: 'issues', labelSize: 24 });
        o += arrow({ x1: lx + 498, y1: ly + 200, x2: lx + 535, y2: ly + 172, at: s(0) + 1.3, d: 0.4, color: C.orange, width: 4 });
        o += arrow({ x1: lx + 498, y1: ly + 240, x2: lx + 535, y2: ly + 268, at: s(0) + 1.5, d: 0.4, color: C.orange, width: 4 });
        o += show(chip(lx + lw / 2, ly + lh - 38, 'separate access', { kind: 'user', size: 28, anchor: 'middle' }), { at: s(0) + 2.2, from: 'up', dist: 10 });
        o += show(chip(lx, ly + lh + 50, 'fine inside one team', { kind: 'good', size: 28 }), { at: s(1), from: 'up', dist: 14 });
        // right: two zones, each its own CAs -> separate trust
        const zx = [1000, 1420], zw = 400;
        const ZN = [{ n: 'acme', t: 'client-acme' }, { n: 'globex', t: 'client-globex' }];
        ZN.forEach((z, i) => {
          let g = rect(zx[i], ly, zw, lh, { fill: C.white, stroke: C.navy, sw: 3, r: 18 });
          g += text(zx[i] + 28, ly + 42, `Zone: ${z.n}`, { size: 30, weight: 700 });
          g += ca(zx[i] + zw / 2, ly + 175, { r: 62, kind: 'user', label: 'User CA' });
          g += text(zx[i] + zw / 2, ly + 275, 'its own CAs', { size: 26, anchor: 'middle', fill: C.slate });
          o += show(g, { at: s(2) + i * 0.4, from: 'right', dist: 50 });
          o += show(card({ x: zx[i] + 30, y: ly + 310, w: zw - 60, h: 100, kind: 'user', title: 'Pau', body: ['identity + certificate'], size: 28, bodySize: 24 }), { at: s(3) + 0.5 + i * 0.5, from: 'up', dist: 16 });
        });
        o += show(chip(1000 + 410, ly + lh + 50, 'separate trust', { kind: 'good', size: 28, anchor: 'middle' }), { at: s(2) + 1.2, from: 'up', dist: 10 });
        // test card
        o += show(rect(110, 830, 1130, 110, { fill: C.mist, stroke: C.slate, sw: 3, r: 16 }) +
          text(150, 885, 'Must Acme reject Globex’s CA?', { size: 34, weight: 700 }) +
          text(1000, 885, '→ zone', { size: 38, weight: 700, fill: C.green }), { at: s(2) + 1.8, from: 'up', dist: 20 });
        o += nextPill('16 Break-glass', s(3));
        return o;
      },
    },
  };
})();
