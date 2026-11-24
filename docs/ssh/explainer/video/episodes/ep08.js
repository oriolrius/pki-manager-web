// Episode 08 — Zones: separate trust domains.
(function () {
  const { C, KIND, show, text, rect, card, chip, arrow, server, person, ca, mark, nextCard, heading, ease, prog, lerp } = A;

  /** Zone frame with header. */
  function zoneBox(x, y, w, h, name, { stroke = C.navy, fill = C.white } = {}) {
    return rect(x, y, w, h, { fill, stroke, sw: 4, r: 22 }) +
      rect(x + 24, y - 24, 60 + name.length * 15, 48, { fill: stroke, stroke: 'none', sw: 0, r: 24 }) +
      text(x + 24 + (60 + name.length * 15) / 2, y + 1, name, { size: 28, weight: 700, fill: C.white, anchor: 'middle' });
  }
  /** Small certificate card with a zone tag. */
  function certCard(cx, cy, zone, kind = 'user') {
    const w = 220, h = 88, k = KIND[kind];
    return rect(cx - w / 2, cy - h / 2, w, h, { fill: k.fill, stroke: k.stroke, sw: 3, r: 14 }) +
      text(cx, cy - 16, 'user certificate', { size: 24, weight: 700, fill: k.text, anchor: 'middle' }) +
      rect(cx - 72, cy + 6, 144, 36, { fill: C.white, stroke: 'none', sw: 0, r: 18 }) +
      text(cx, cy + 25, zone, { size: 24, weight: 700, fill: C.orangeInk, anchor: 'middle' });
  }

  EPISODES['08'] = {
    scenes: {
      // ---------------------------------------------------------------
      '08.1': ({ s }) => {
        let o = heading('One CA pair = one trust domain');
        const bx = 150, by = 285, bw = 1620, bh = 480;
        o += show(rect(bx, by, bw, bh, { fill: C.white, stroke: C.navy, sw: 4, r: 24 }) +
          text(bx + 40, by + 44, 'One trust domain', { size: 30, weight: 700, fill: C.navy }), { at: s(0) - 0.3, from: 'none' });
        o += show(ca(760, by + 200, { r: 82, kind: 'user', label: 'User CA', labelSize: 28 }) + ca(980, by + 200, { r: 82, kind: 'host', label: 'Host CA', labelSize: 28 }), { at: s(0) + 0.5, from: 'pop', cx: 870, cy: by + 200 });
        [0, 1, 2].forEach((i) => {
          o += show(person(290 + i * 150, by + 330, { s: 0.68, label: ['Alice', 'Bob', 'Carol'][i], labelSize: 24 }), { at: s(0) + 1.2 + i * 0.25 });
        });
        [0, 1, 2, 3].forEach((i) => {
          o += show(server(1170 + i * 160, by + 310, { s: 0.52, label: `srv${i + 1}`, labelSize: 24 }), { at: s(0) + 1.8 + i * 0.25 });
        });
        o += show(chip(1290, by + 44, 'one User CA + one Host CA, everything inside', { kind: 'file', size: 26, anchor: 'middle' }), { at: s(1) });
        // the question
        o += show(chip(480, 860, 'production', { kind: 'machine', size: 28, anchor: 'middle' }) + chip(1440, 860, 'staging', { kind: 'machine', size: 28, anchor: 'middle' }) +
          mark(960, 860, '?', { r: 36, color: C.amber }) + text(960, 925, 'must never trust each other', { size: 26, anchor: 'middle', fill: C.amber, weight: 700 }), { at: s(2) + 0.2 });
        o += show(chip(480, 935, 'customer A', { kind: 'host', size: 26, anchor: 'middle' }) + chip(1440, 935, 'customer B', { kind: 'host', size: 26, anchor: 'middle' }), { at: s(3) + 0.2 });
        return o;
      },

      // ---------------------------------------------------------------
      '08.2': ({ s }) => {
        let o = heading('Zones');
        const p = ease(prog(s(0) + 0.5, 1.0));
        const y = 300, h = 560;
        const lx1 = 130, lx2 = lerp(1790, 930, p);
        const rx1 = lerp(130, 990, p), rx2 = 1790;
        o += zoneBox(lx1, y, lx2 - lx1, h, 'zone: prod', { stroke: C.navy });
        o += zoneBox(rx1, y, rx2 - rx1, h, 'zone: staging', { stroke: C.slate });
        o += show(chip(960, 940, 'a real trust boundary, not a label', { kind: 'warn', size: 26, anchor: 'middle' }), { at: s(0) + 2.4 });
        const zone = (x0, tag, srvs, users, princ) => {
          let g = '';
          g += show(ca(x0 + 150, y + 160, { r: 70, kind: 'user', label: 'User CA', labelSize: 24 }) + ca(x0 + 330, y + 160, { r: 70, kind: 'host', label: 'Host CA', labelSize: 24 }), { at: s(1) + 0.1, from: 'pop', cx: x0 + 240, cy: y + 160 });
          srvs.forEach((n, i) => { g += show(server(x0 + 540 + i * 140, y + 150, { s: 0.52, label: n, labelSize: 24 }), { at: s(1) + 1.8 + i * 0.3 }); });
          users.forEach((n, i) => { g += show(person(x0 + 110 + i * 150, y + 380, { s: 0.62, label: n, labelSize: 24 }), { at: s(1) + 3.4 + i * 0.3 }); });
          princ.forEach((n, i) => { g += show(chip(x0 + 400, y + 345 + i * 66, `principal: ${n}`, { kind: 'file', size: 24 }), { at: s(1) + 5 + i * 0.3 }); });
          void tag;
          return g;
        };
        o += zone(150, 'prod', ['web1', 'db1'], ['Alice', 'Bob'], ['developers', 'dbadmin']);
        o += zone(1010, 'staging', ['web1', 'qa1'], ['Alice', 'Dave'], ['developers', 'testers']);
        return o;
      },

      // ---------------------------------------------------------------
      '08.3': ({ s }) => {
        let o = heading('The one rule');
        const y = 285, h = 650;
        o += zoneBox(110, y, 700, h, 'zone: prod', { stroke: C.navy });
        o += zoneBox(1110, y, 700, h, 'zone: staging', { stroke: C.slate });
        // prod: User CA -> server, user
        o += ca(215, y + 150, { r: 62, kind: 'user', label: 'User CA', labelSize: 22 });
        o += person(190, y + 330, { s: 0.7, label: 'Alice', labelSize: 24 });
        o += server(690, y + 330, { s: 0.85, label: 'web1', labelSize: 24 });
        o += show(arrow({ x1: 280, y1: y + 175, x2: 630, y2: y + 250, color: C.orange, width: 4, at: s(0) + 0.6, d: 0.9 }), { at: s(0) + 0.6, from: 'none' });
        o += show(chip(520, y + 150, 'trusts only prod User CA', { kind: 'user', size: 22, anchor: 'middle' }), { at: s(0) + 1.6, from: 'none' });
        // staging: User CA, user, server
        o += ca(1320, y + 150, { r: 62, kind: 'user', label: 'User CA', labelSize: 22 });
        o += server(1420, y + 330, { s: 0.85, label: 'web1', labelSize: 24 });
        o += show(arrow({ x1: 1385, y1: y + 175, x2: 1400, y2: y + 255, color: C.orange, width: 4, at: s(0) + 1.2, d: 0.6 }), { at: s(0) + 1.2, from: 'none' });
        o += person(1700, y + 330, { s: 0.7, label: 'Dave', labelSize: 24 });
        // staging certificate flies to the prod server and bounces
        const px = 800, ps = 1575, py = y + 330;
        const tIn = s(1) + 0.2, tOut = tIn + 1.3;
        const a = ease(prog(tIn, 1.3)), b = ease(prog(tOut, 0.7));
        let cx = lerp(ps, px, a);
        cx = lerp(cx, 985, b);
        const sx = cx + (b > 0 && b < 1 ? 0 : 0);
        if (A.now() >= tIn) o += show(certCard(sx, py + 40, 'staging'), { at: tIn, d: 0.3, from: 'none' });
        if (A.now() >= tOut + 0.2) o += show(mark(px - 10, py - 70, '✕', { r: 34, color: C.red }) + text(960, py + 140, 'refused', { size: 28, weight: 700, fill: C.red, anchor: 'middle' }), { at: tOut + 0.2, from: 'pop', cx: px - 10, cy: py - 70 });
        // prod certificate enters
        const t3 = s(1) + 2.1;
        if (A.now() >= t3) {
          const pe = ease(prog(t3, 0.9));
          o += show(certCard(lerp(330, 520, pe), py + 40, 'prod'), { at: t3, d: 0.3, from: 'none' });
        }
        o += show(mark(520, py - 48, '✓', { r: 30, color: C.green }), { at: t3 + 0.9, from: 'pop', cx: 520, cy: py - 48 });
        // revocations & blocks stay in their zone
        o += show(card({ x: 1160, y: y + 480, w: 600, h: 110, kind: 'danger', title: 'staging: revocations + blocks', body: ['stay inside staging'], size: 26 }), { at: s(2) });
        o += show(card({ x: 160, y: y + 480, w: 600, h: 110, kind: 'file', title: 'prod: revocations + blocks', body: ['not affected'], size: 26 }), { at: s(2) + 0.3 });
        o += arrow({ x1: 1150, y1: y + 535, x2: 830, y2: y + 535, at: s(2) + 0.7, d: 0.6, color: C.red, width: 4, dashed: true, head: false });
        o += show(mark(970, y + 535, '✕', { r: 30, color: C.red }), { at: s(2) + 1.2, from: 'pop', cx: 970, cy: y + 535 });
        return o;
      },

      // ---------------------------------------------------------------
      '08.4': ({ s }) => {
        let o = heading('Practical rules');
        const W = 800, H = 310, X1 = 110, X2 = 1010, Y1 = 285, Y2 = 625;
        const frame = (x, y, kind, title) => {
          const k = KIND[kind];
          return rect(x, y, W, H, { fill: k.soft, stroke: k.stroke, sw: 3, r: 18 }) + text(x + 30, y + 48, title, { size: 30, weight: 700, fill: k.text === C.white ? C.navy : k.text });
        };
        // 1 same FQDN
        let c1 = frame(X1, Y1, 'good', 'same FQDN in two zones ✓');
        c1 += chip(X1 + 40, Y1 + 130, 'zone: prod', { kind: 'machine', size: 24 }) + text(X1 + 300, Y1 + 130, 'web1.acme.example', { size: 28, mono: true });
        c1 += chip(X1 + 40, Y1 + 215, 'zone: staging', { kind: 'file', size: 24 }) + text(X1 + 300, Y1 + 215, 'web1.acme.example', { size: 28, mono: true });
        o += show(c1, { at: s(0) + 0.2, from: 'up' });
        // 2 identities
        let c2 = frame(X2, Y1, 'user', 'one person = one identity per zone');
        c2 += person(X2 + 110, Y1 + 195, { s: 0.55, color: C.navy });
        c2 += arrow({ x1: X2 + 190, y1: Y1 + 170, x2: X2 + 330, y2: Y1 + 135, color: C.orange, width: 3, head: true });
        c2 += arrow({ x1: X2 + 190, y1: Y1 + 205, x2: X2 + 330, y2: Y1 + 240, color: C.orange, width: 3, head: true });
        c2 += chip(X2 + 350, Y1 + 135, 'Alice · prod', { kind: 'user', size: 26 }) + chip(X2 + 350, Y1 + 240, 'Alice · staging', { kind: 'user', size: 26 });
        o += show(c2, { at: s(1) + 0.2, from: 'up' });
        // 3 host cannot move
        let c3 = frame(X1, Y2, 'warn', 'zone is fixed → offboard + re-enrol');
        c3 += chip(X1 + 120, Y2 + 105, 'zone: prod', { kind: 'machine', size: 24, anchor: 'middle' });
        c3 += server(X1 + 120, Y2 + 185, { s: 0.5, label: 'web1', labelSize: 24 });
        c3 += arrow({ x1: X1 + 200, y1: Y2 + 170, x2: X1 + 480, y2: Y2 + 170, color: C.red, width: 4, dashed: true, head: false });
        c3 += mark(X1 + 340, Y2 + 170, '✕', { r: 26, color: C.red });
        c3 += chip(X1 + 520, Y2 + 170, 'zone: staging', { kind: 'file', size: 24 });
        c3 += text(X1 + 400, Y2 + 265, 'offboard, then enrol again', { size: 28, weight: 700, fill: C.amber, anchor: 'middle' });
        o += show(c3, { at: s(2) + 0.2, from: 'up' });
        // 4 archive
        let c4 = frame(X2, Y2, 'file', "archive, don't delete");
        c4 += rect(X2 + 60, Y2 + 120, 260, 150, { fill: C.white, stroke: C.slate, sw: 3, r: 12 });
        c4 += rect(X2 + 45, Y2 + 100, 290, 42, { fill: C.mist, stroke: C.slate, sw: 3, r: 10 });
        c4 += text(X2 + 190, Y2 + 205, 'zone: old', { size: 28, weight: 700, anchor: 'middle' });
        c4 += chip(X2 + 520, Y2 + 150, 'archived ✓', { kind: 'good', size: 26, anchor: 'middle' });
        c4 += chip(X2 + 520, Y2 + 235, 'delete ✕', { kind: 'danger', size: 26, anchor: 'middle' });
        o += show(c4, { at: s(3) + 0.2, from: 'up' });
        return o;
      },

      // ---------------------------------------------------------------
      '08.5': ({ s }) => {
        let o = heading('No guessing');
        o += show(card({ x: 110, y: 270, w: 800, h: 90, kind: 'good', title: '1 zone: nothing changes', size: 30 }), { at: s(0) + 0.2 });
        o += show(card({ x: 1010, y: 270, w: 800, h: 90, kind: 'plain', title: '2 zones: every request names its zone', size: 28 }), { at: s(1) + 0.2 });
        // request without zone -> refused
        o += show(card({ x: 110, y: 410, w: 420, h: 150, kind: 'file', title: 'request', body: ['no zone given'], size: 30 }), { at: s(2) });
        o += arrow({ x1: 530, y1: 485, x2: 640, y2: 485, at: s(2) + 0.4, d: 0.5, color: C.slate, width: 4 });
        o += show(card({ x: 650, y: 410, w: 300, h: 150, kind: 'plain', title: 'PKI Manager', size: 30 }), { at: s(2) + 0.6 });
        o += arrow({ x1: 950, y1: 485, x2: 1050, y2: 485, at: s(2) + 1.0, d: 0.5, color: C.red, width: 4 });
        o += show(card({ x: 1060, y: 395, w: 750, h: 180, kind: 'danger', title: 'refused', body: ['zone is ambiguous — 2 zones exist', '(prod, staging); specify one explicitly'], size: 28, bodySize: 26, mono: true }), { at: s(2) + 1.3, from: 'pop', cx: 1435, cy: 485 });
        // fleet token carries its zone
        o += show(card({ x: 110, y: 640, w: 620, h: 150, kind: 'host', title: 'Fleet token', body: ['already carries its zone'], size: 30 }) +
          chip(420, 820, 'zone: prod', { kind: 'machine', size: 24, anchor: 'middle' }), { at: s(3) + 0.2 });
        // zone switcher (UI redraw)
        const ux = 800, uy = 620;
        let ui = rect(ux, uy, 570, 330, { fill: C.white, stroke: C.line, sw: 3, r: 14 });
        ui += `<path d="M${ux} ${uy + 14} a14 14 0 0 1 14 -14 h${570 - 28} a14 14 0 0 1 14 14 v${54 - 14} h${-570} z" fill="${C.navy}"/>`;
        ui += text(ux + 24, uy + 28, 'SSH', { size: 26, weight: 700, fill: C.white });
        ui += rect(ux + 330, uy + 9, 216, 38, { fill: '#2A2C74', stroke: C.white, sw: 1.5, r: 8 }) + text(ux + 346, uy + 29, 'Zone: prod  ▾', { size: 24, fill: C.white, weight: 500 });
        ui += rect(ux + 330, uy + 60, 216, 118, { fill: C.white, stroke: C.navy, sw: 2, r: 8 });
        ui += rect(ux + 338, uy + 68, 200, 48, { fill: C.orangeSoft, stroke: 'none', sw: 0, r: 6 }) + text(ux + 354, uy + 92, 'prod  ✓', { size: 26, weight: 700 }) + text(ux + 354, uy + 148, 'staging', { size: 26 });
        ui += text(ux + 28, uy + 120, 'Hosts · Identities ·', { size: 24, fill: C.muted }) + text(ux + 28, uy + 156, 'Principals · Fleet tokens', { size: 24, fill: C.muted });
        ui += text(ux + 28, uy + 285, 'Use the zone switcher', { size: 28, weight: 700, fill: C.navy });
        o += show(ui, { at: s(4) + 0.2, from: 'up' });
        o += nextCard('09 Automation', s(4) + 1.5);
        return o;
      },
    },
  };
})();
