// Episode 16 — Break-glass and temporary access (series 2, scenes 16.1–16.5).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, arrow, server, person, heading, caption, nextCard, mark, ease, prog, clamp, lerp, textW } = A;

  // ---------- shared helpers ----------
  /** Monospace text with coloured / bold parts: parts = [str | [str, { fill, bold }]] */
  function richMono(x, y, parts, { size = 26, fill = C.navy } = {}) {
    const spans = parts.map((p) => {
      const [str, o] = Array.isArray(p) ? p : [p, {}];
      return `<tspan font-weight="${o.bold ? 700 : 400}" fill="${o.fill ?? fill}">${A.esc(str)}</tspan>`;
    }).join('');
    return `<text x="${x}" y="${y}" font-family="${A.MONO}" font-size="${size}" fill="${fill}" dominant-baseline="middle" xml:space="preserve">${spans}</text>`;
  }
  function button(x, y, w, h, label, { pressed = false, primary = false, size = 26 } = {}) {
    let fill = C.white, stroke = C.navy, tc = C.navy;
    if (primary || pressed) { fill = C.navy; tc = C.white; }
    return rect(x, y, w, h, { fill, stroke, sw: 2.5, r: 10 }) + text(x + w / 2, y + h / 2 + 1, label, { size, weight: 700, anchor: 'middle', fill: tc });
  }
  function win(x, y, w, h, title) {
    return rect(x, y, w, h, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) +
      `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${42} h${-w} z" fill="${C.navy}"/>` +
      text(x + 30, y + 29, title, { size: 26, weight: 700, fill: C.white });
  }
  function clock(cx, cy, r, { m = 0, color = C.navy } = {}) {
    let o = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.white}" stroke="${color}" stroke-width="${r * 0.08}"/>`;
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      o += `<line x1="${cx + Math.sin(a) * r * 0.82}" y1="${cy - Math.cos(a) * r * 0.82}" x2="${cx + Math.sin(a) * r * 0.92}" y2="${cy - Math.cos(a) * r * 0.92}" stroke="${color}" stroke-width="${r * 0.04}"/>`;
    }
    const hand = (deg, len, w) => { const a = (deg * Math.PI) / 180; return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.sin(a) * r * len}" y2="${cy - Math.cos(a) * r * len}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`; };
    return o + hand(m / 12, 0.5, r * 0.07) + hand(m, 0.75, r * 0.05) + `<circle cx="${cx}" cy="${cy}" r="${r * 0.07}" fill="${color}"/>`;
  }
  function bell(cx, cy, k = 1, color = C.amber) {
    return `<g transform="translate(${cx} ${cy}) scale(${k})"><path d="M-34 26 q8 -8 8 -26 a26 26 0 0 1 52 0 q0 18 8 26 z" fill="${color}"/>` +
      `<circle cx="0" cy="33" r="9" fill="${color}"/><rect x="-4" y="-44" width="8" height="12" rx="4" fill="${color}"/>` +
      `<circle cx="30" cy="-28" r="12" fill="${C.red}"/></g>`;
  }
  function envelope(cx, cy, { w = 150, h = 100, color = C.navy } = {}) {
    const x = cx - w / 2, y = cy - h / 2;
    return rect(x, y, w, h, { fill: C.white, stroke: color, sw: 3.5, r: 10 }) +
      `<path d="M${x + 6} ${y + 8} L${cx} ${cy + 8} L${x + w - 6} ${y + 8}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round"/>` +
      A.lock(cx, cy + h * 0.2, { s: 0.9, color: C.green });
  }
  /** Chips laid out in a row from x; returns svg and end x. */
  function chipRow(x, y, labels, { kind = 'user', size = 26, gap = 14, mono = false } = {}) {
    let o = '', xx = x;
    for (const l of labels) {
      o += chip(xx, y, l, { kind, size, mono });
      xx += textW(l, size, mono) + size * 1.2 + gap;
    }
    return { svg: o, end: xx - gap };
  }

  EPISODES['16'] = {
    scenes: {
      // ---------------------------------------------------------------- 16.1
      '16.1': ({ s }) => {
        let o = heading('Why break-glass');
        // night panel
        let np = rect(110, 280, 560, 650, { fill: C.navyDeep, stroke: C.navy, sw: 3, r: 22 });
        [[170, 330], [250, 318], [330, 346], [210, 380], [470, 322]].forEach(([x, y], i) => { np += `<circle cx="${x}" cy="${y}" r="${i % 2 ? 3 : 4}" fill="#C9CAE6"/>`; });
        np += `<circle cx="590" cy="372" r="38" fill="#FFE9A8"/><circle cx="610" cy="360" r="33" fill="${C.navyDeep}"/>`;
        np += person(390, 640, { s: 1.3, color: '#C9CAE6' });
        np += text(390, 748, 'Pau', { size: 34, weight: 700, anchor: 'middle', fill: C.white });
        np += text(390, 792, 'on call this week', { size: 26, anchor: 'middle', fill: '#A9ABD0' });
        o += show(np, { at: 0.2, from: 'left', dist: 50 });
        // 03:00
        o += show(text(390, 420, '03:00', { size: 80, weight: 700, anchor: 'middle', fill: C.white, mono: true }), { at: s(1) + 0.1, from: 'down', dist: 20 });
        // Pau's certificate
        const cy = 290;
        let cert = rect(740, cy, 1080, 130, { fill: C.white, stroke: C.orange, sw: 3, r: 16 });
        cert += text(770, cy + 34, "Pau's certificate: principals", { size: 28, weight: 700, fill: C.orangeInk });
        cert += chipRow(770, cy + 88, ['developers', 'client-acme', 'client-globex'], { kind: 'user', size: 28 }).svg;
        o += show(cert, { at: s(0) + 0.2, from: 'up', dist: 24 });
        // acme-db + locked root
        o += show(server(880, 650, { s: 1.0, label: 'acme-db', labelSize: 28 }), { at: s(0) + 1.0, from: 'right', dist: 40 });
        let root = rect(990, 605, 190, 90, { fill: C.redSoft, stroke: C.red, sw: 3, r: 14 }) + A.lock(1036, 640, { s: 1.2, color: C.red }) +
          text(1130, 652, 'root', { size: 32, mono: true, weight: 700, anchor: 'middle', fill: '#8E1B1B' });
        o += show(root, { at: s(0) + 1.8, from: 'pop', cx: 1085, cy: 650 });
        o += arrow({ x1: 690, y1: 650, x2: 800, y2: 650, at: s(0) + 2.2, d: 0.5, color: C.red, width: 5, dashed: true, head: false });
        o += show(mark(745, 650, '✕', { r: 26, color: C.red }), { at: s(0) + 2.7, from: 'pop', cx: 745, cy: 650 });
        o += show(text(960, 958, 'Pau has no root on production', { size: 30, anchor: 'middle', weight: 500, fill: C.red }), { at: s(0) + 3.0, from: 'up', dist: 14, out: s(2) - 0.1 });
        // database stuck
        o += show(chip(880, 830, 'database stuck: needs root', { kind: 'warn', size: 26, anchor: 'middle' }), { at: s(1) + 0.5, from: 'up', dist: 16 });
        // auth_principals file + glass box
        const f = code({
          x: 1220, y: 470, w: 600, size: 28, title: '/etc/ssh/auth_principals/root', lines: ['root ← sysadmins break-glass'],
          hl: [{ line: 0, at: s(2) + 2.2, color: C.orange, opacity: 0.2 }],
        });
        o += show(f.svg, { at: s(2) + 0.1, from: 'right', dist: 50 });
        let glass = rect(1220, 690, 600, 220, { fill: '#EAF4FB', stroke: '#8FB8D8', sw: 5, r: 18 });
        glass += `<path d="M1250 710 L1330 700 M1660 900 L1790 740" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" opacity="0.9"/>`;
        glass += text(1520, 730, 'IN CASE OF EMERGENCY', { size: 24, weight: 700, anchor: 'middle', fill: C.red });
        glass += chip(1520, 800, 'break-glass', { kind: 'user', size: 36, anchor: 'middle' });
        glass += text(1520, 872, 'nobody carries it on a normal day', { size: 26, anchor: 'middle', fill: C.slate });
        o += show(glass, { at: s(2) + 1.0, from: 'pop', cx: 1520, cy: 800 });
        return o;
      },

      // ---------------------------------------------------------------- 16.2
      '16.2': ({ s, e }) => {
        const D0 = e(0) - s(0), D1 = e(1) - s(1);
        const tPr = s(0) + 0.4 + D0 * 0.12, tTtl = s(0) + D0 * 0.42, tIssue = s(0) + D0 * 0.68;
        let o = heading('Breaking the glass');
        // form
        let fm = win(110, 280, 880, 650, 'Issue User Certificate');
        fm += text(140, 362, 'Identity *', { size: 24, weight: 700, fill: C.slate });
        fm += rect(140, 378, 820, 56, { fill: C.mist, stroke: C.slate, sw: 2, r: 10 }) + text(162, 407, 'pau@ops.example', { size: 26, mono: true });
        fm += text(140, 470, 'Principals (roles) *', { size: 24, weight: 700, fill: C.slate });
        fm += rect(140, 486, 820, 64, { fill: C.white, stroke: C.slate, sw: 2, r: 10 });
        fm += show(chip(162, 518, 'break-glass', { kind: 'user', size: 28 }), { at: tPr, from: 'pop', cx: 220, cy: 518 });
        fm += text(140, 590, 'Validity (TTL)', { size: 24, weight: 700, fill: C.slate });
        const pr = A.now() >= tTtl;
        fm += button(140, 606, 90, 54, '+1h', { pressed: pr }) + button(244, 606, 90, 54, '+1d') + button(348, 606, 90, 54, '+1w');
        fm += rect(462, 606, 150, 54, { fill: C.white, stroke: C.slate, sw: 2, r: 10 }) + (pr ? text(487, 634, '3600', { size: 28, mono: true, weight: 700 }) : '');
        fm += text(630, 634, 'seconds', { size: 26, fill: C.slate });
        fm += button(690, 826, 270, 64, 'Issue Certificate', { primary: true, pressed: A.now() >= tIssue && A.now() < tIssue + 0.5 });
        o += show(fm, { at: 0.2, from: 'left', dist: 40 });
        // people
        o += show(person(1110, 400, { s: 0.9, label: 'Marta', labelSize: 28, sub: 'issuer' }), { at: 0.5, from: 'right', dist: 30 });
        o += show(person(1730, 400, { s: 0.9, label: 'Pau', labelSize: 28, sub: 'holder' }), { at: 0.7, from: 'left', dist: 30 });
        // certificate
        const expLen = Math.min(2.0, D1 * 0.5), tClock = s(1) + 0.3, tExp = tClock + expLen;
        const expired = A.now() >= tExp;
        const certSvg = expired
          ? rect(1290, 340, 270, 130, { fill: C.mist, stroke: C.line, sw: 3, r: 16 }) + text(1425, 392, 'break-glass', { size: 28, weight: 700, anchor: 'middle', fill: C.muted }) + text(1425, 434, 'expired', { size: 26, anchor: 'middle', fill: C.muted })
          : card({ x: 1290, y: 340, w: 270, h: 130, kind: 'user', title: 'break-glass', body: ['valid 1 hour'], size: 28, bodySize: 26 });
        o += show(certSvg, { at: tIssue + 0.4, from: 'left', dist: 60 });
        o += arrow({ x1: 1172, y1: 405, x2: 1282, y2: 405, at: tIssue + 0.1, d: 0.45, color: C.orangeInk, width: 5 });
        o += arrow({ x1: 1568, y1: 405, x2: 1668, y2: 405, at: tIssue + 1.1, d: 0.45, color: C.orangeInk, width: 5 });
        // clock
        const m = ease(prog(tClock, expLen)) * 360;
        o += show(clock(1150, 690, 65, { m, color: expired ? C.muted : C.navy }), { at: s(1), from: 'pop', cx: 1150, cy: 690 });
        o += show(text(1240, 690, 'lifetime: 1 hour', { size: 30, weight: 700, fill: expired ? C.muted : C.navy }), { at: s(1) + 0.1, from: 'right', dist: 20 });
        o += show(card({ x: 1520, y: 625, w: 300, h: 130, kind: 'danger', title: 'new login', body: ['✕ refused'], size: 30, bodySize: 28 }), { at: tExp + 0.3, from: 'up', dist: 20 });
        // close the session
        o += show(card({ x: 1040, y: 810, w: 780, h: 120, kind: 'warn', title: 'close the session when done', body: ['open sessions do not close by themselves'], size: 32, bodySize: 26 }), { at: s(2) + 0.2, from: 'up', dist: 24 });
        return o;
      },

      // ---------------------------------------------------------------- 16.3
      '16.3': ({ s, e }) => {
        const D2 = e(2) - s(2);
        let o = heading('Leave a trail');
        // audit row
        o += show(card({ x: 110, y: 290, w: 330, h: 110, kind: 'pki', title: 'PKI Manager', body: ['audit log'], size: 32, bodySize: 26 }), { at: 0.2, from: 'left' });
        let row = rect(470, 295, 1110, 100, { fill: C.white, stroke: C.slate, sw: 3, r: 14 });
        row += richMono(500, 345, [['ssh.cert.issue', { bold: true }], ' · keyId pau@ops.example · ', ['principals break-glass', { bold: true, fill: C.orangeInk }], ' · ', ['serial 77', { bold: true }]], { size: 26 });
        o += show(row, { at: s(0) + 0.3, from: 'right', dist: 50 });
        // alert bell
        o += show(bell(1700, 340, 1.2) + text(1700, 410, 'alert', { size: 26, weight: 700, anchor: 'middle', fill: C.amber }), { at: s(1) + 0.2, from: 'pop', cx: 1700, cy: 345 });
        // servers + line
        o += show(server(200, 600, { s: 0.9, label: 'acme-db', labelSize: 26 }), { at: s(2) + 0.1, from: 'left', dist: 40 });
        o += show(server(1620, 600, { s: 0.9, label: 'central log server', labelSize: 26 }), { at: s(2) + 0.5, from: 'right', dist: 40 });
        o += show(text(1620, 745, 'root on the host', { size: 24, anchor: 'middle', fill: C.slate }) + text(1620, 776, 'cannot change them', { size: 24, anchor: 'middle', fill: C.slate }), { at: s(2) + D2 * 0.6 });
        o += arrow({ x1: 290, y1: 600, x2: 1520, y2: 600, at: s(2) + 0.6, d: 1.0, color: C.slate, width: 4, dashed: true });
        o += show(text(900, 665, 'sent off the host, line by line', { size: 26, anchor: 'middle', fill: C.slate }), { at: s(2) + 1.4 });
        const tMove = s(2) + 1.0, tp = ease(prog(tMove, Math.max(1.5, D2 * 0.3)));
        const lx = lerp(250, 830, tp);
        const logSvg = rect(lx, 562, 600, 76, { fill: C.term, stroke: C.navyDeep, sw: 2, r: 12 }) +
          richMono(lx + 24, 601, [['ID ', { fill: '#B9BBD9' }], ['pau@ops.example', { fill: C.termText }], [' (', { fill: '#B9BBD9' }], ['serial 77', { fill: '#FFB27A', bold: true }], [') ', { fill: '#B9BBD9' }], ['CA …', { fill: '#FFB27A', bold: true }]], { size: 28 });
        o += show(logSvg, { at: tMove - 0.1, from: 'none' });
        // checklist
        const steps = [['1  alert', 410, s(1) + 0.6], ['2  follow serial', 960, s(2) + D2 * 0.5], ['3  review', 1510, s(3) + 0.2]];
        steps.forEach(([l, cx, at]) => {
          o += show(card({ x: cx - 220, y: 838, w: 440, h: 84, kind: 'plain', title: l, size: 30 }), { at, from: 'up', dist: 20 });
        });
        o += arrow({ x1: 640, y1: 880, x2: 735, y2: 880, at: s(2) + D2 * 0.5 + 0.3, d: 0.4, color: C.navy, width: 4 });
        o += arrow({ x1: 1190, y1: 880, x2: 1285, y2: 880, at: s(3) + 0.5, d: 0.4, color: C.navy, width: 4 });
        return o;
      },

      // ---------------------------------------------------------------- 16.4
      '16.4': ({ s, e }) => {
        let o = heading('Keep one offline way in');
        // PKI Manager, then down
        o += show(card({ x: 190, y: 400, w: 520, h: 240, kind: 'pki', title: 'PKI Manager', body: ['issues the break-glass certificate'], size: 42, bodySize: 26 }), { at: 0.2, from: 'left' });
        o += show(mark(700, 400, '✕', { r: 46, color: C.red }), { at: s(1) + 0.2, from: 'pop', cx: 700, cy: 400 });
        o += show(chip(450, 700, 'PKI Manager is down', { kind: 'danger', size: 30, anchor: 'middle' }), { at: s(1) + 0.4, from: 'up', dist: 16 });
        // safe
        let sf = rect(1020, 330, 640, 520, { fill: C.slate, stroke: C.navyDeep, sw: 4, r: 26 });
        sf += rect(1052, 362, 576, 456, { fill: C.navyDeep, stroke: 'none', sw: 0, r: 14 });
        sf += rect(1008, 380, 24, 64, { fill: '#3E4247', stroke: 'none', sw: 0, r: 6 }) + rect(1008, 740, 24, 64, { fill: '#3E4247', stroke: 'none', sw: 0, r: 6 });
        sf += `<line x1="1052" y1="800" x2="1628" y2="800" stroke="${C.slate}" stroke-width="6"/>`;
        sf += text(1340, 400, 'safe', { size: 26, anchor: 'middle', fill: '#A9ABD0', weight: 700 });
        o += show(sf, { at: s(1) + 1.2, from: 'right', dist: 50 });
        o += show(envelope(1340, 560, { w: 300, h: 190 }), { at: s(1) + 2.2, from: 'down', dist: 40 });
        o += show(rect(1145, 690, 390, 60, { fill: C.white, stroke: C.line, sw: 2, r: 10 }) + text(1340, 721, 'offline emergency access', { size: 26, weight: 700, anchor: 'middle' }), { at: s(1) + 2.6, from: 'up', dist: 14 });
        o += caption('stored like any other emergency secret', { at: s(1) + 4.2 });
        return o;
      },

      // ---------------------------------------------------------------- 16.5
      '16.5': ({ s, e }) => {
        const D3 = e(3) - s(3);
        const tOff = s(3) + D3 * 0.3, off = A.now() >= tOff + 0.4;
        let o = heading('A contractor for two days');
        // identity
        let id = rect(110, 290, 640, 120, { fill: off ? C.mist : C.white, stroke: off ? C.line : C.navy, sw: 3, r: 16 });
        id += text(140, 322, 'identity', { size: 24, fill: C.slate });
        id += text(140, 368, 'dev@vendor.example', { size: 34, mono: true, weight: 700, fill: off ? C.muted : C.navy });
        id += chip(620, 350, off ? 'disabled' : 'active', { kind: off ? 'ghost' : 'good', size: 24, anchor: 'middle' });
        o += show(id, { at: s(0) + 0.3, from: 'left', dist: 50 });
        // certificate
        let ct = rect(110, 440, 640, 230, { fill: off ? C.mist : C.white, stroke: off ? C.line : C.orange, sw: 3, r: 16 });
        ct += text(140, 476, 'User certificate', { size: 30, weight: 700, fill: off ? C.muted : C.orangeInk });
        ct += text(140, 542, 'principals', { size: 24, fill: C.slate }) + chip(300, 542, 'client-acme', { kind: off ? 'ghost' : 'user', size: 28 });
        ct += text(140, 616, 'validity', { size: 24, fill: C.slate }) + text(300, 616, '172800 seconds', { size: 30, mono: true, weight: 700, fill: off ? C.muted : C.navy }) + text(540, 616, '(2 days)', { size: 24, fill: C.slate });
        o += show(ct, { at: s(1) + 0.3, from: 'left', dist: 50 });
        // fleet map
        const lit = A.now() >= s(2) + 0.6;
        const panels = [
          { name: 'Acme', x: 840, w: 400, sv: ['web', 'db', 'app'], on: true },
          { name: 'Globex', x: 1260, w: 270, sv: ['web', 'db'] },
          { name: 'Initech', x: 1550, w: 270, sv: ['web', 'db'] },
        ];
        panels.forEach((p, pi) => {
          const hot = lit && p.on;
          let g = rect(p.x, 300, p.w, 430, { fill: hot ? C.greenSoft : C.white, stroke: hot ? C.green : C.line, sw: hot ? 4 : 3, r: 18 });
          g += text(p.x + p.w / 2, 345, p.name, { size: 34, weight: 700, anchor: 'middle', fill: hot ? '#075C41' : C.muted });
          p.sv.forEach((n, i) => {
            const cx = p.x + (p.w / p.sv.length) * (i + 0.5);
            g += server(cx, 470, { s: 0.45, label: n, labelSize: 24, color: hot ? C.navy : '#B7B9D0' });
            g += chip(cx, 590, 'deploy', { kind: hot ? 'host' : 'ghost', size: 24, anchor: 'middle' });
            g += chip(cx, 650, 'root', { kind: 'ghost', size: 24, anchor: 'middle', mono: true });
          });
          o += show(g, { at: s(1) + 0.5 + pi * 0.3, from: 'up', dist: 24 });
        });
        o += arrow({ x1: 756, y1: 555, x2: 834, y2: 555, at: s(2) + 0.1, d: 0.5, color: C.orangeInk, width: 5 });
        // offboard
        o += show(button(110, 710, 240, 64, 'Offboard', { pressed: A.now() >= tOff && A.now() < tOff + 0.5 }), { at: s(2) + 1.0, from: 'up', dist: 16 });
        o += show(chip(110, 830, 'nobody can renew it', { kind: 'warn', size: 28 }), { at: tOff + 0.6, from: 'up', dist: 14 });
        o += nextCard('17 Robots', s(3));
        return o;
      },
    },
  };
})();
