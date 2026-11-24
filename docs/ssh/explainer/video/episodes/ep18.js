// Episode 18 — Changing access, and proving who did what (series 2, scenes 18.1–18.5).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, arrow, server, person, lock, heading, nextCard, mark, ease, prog, clamp, lerp, textW } = A;

  // ---------- shared helpers ----------
  const TAGS = {
    user: { fill: C.orange, stroke: C.orangeInk, text: C.white },
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
  /** Certificate card (coloured header). Returns { svg, h }. */
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
  /** Compact certificate: header + principals row. Returns svg. */
  function miniCert(x, y, w, h, name, principals) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.orange, sw: 3, r: 14 });
    o += `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v${36 - 14} h${-w} z" fill="${C.orange}"/>`;
    o += text(x + 22, y + 19, name, { size: 24, weight: 700, fill: C.white });
    o += text(x + 22, y + 82, 'Principals', { size: 24, fill: C.slate, weight: 500 });
    let tx = x + 190;
    principals.forEach((p) => {
      const tw = tagW(p, 26);
      o += tag(tx + tw / 2, y + 82, p, { kind: 'soft', size: 26 });
      tx += tw + 10;
    });
    return o;
  }
  /** Server panel: navy title band + white body. */
  function serverPanel(x, y, w, h, label, { stroke = C.navy } = {}) {
    let o = rect(x, y, w, h, { fill: C.white, stroke, sw: 3, r: 16 });
    o += `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${44} h${-w} z" fill="${C.navy}"/>`;
    o += text(x + 46, y + 30, label, { size: 28, weight: 700, fill: C.white, mono: true });
    return o;
  }
  function win(x, y, w, h, title) {
    return rect(x, y, w, h, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) +
      `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${42} h${-w} z" fill="${C.navy}"/>` +
      text(x + 30, y + 29, title, { size: 26, weight: 700, fill: C.white });
  }
  function button(x, y, w, h, label, { pressed = false, primary = false, size = 26 } = {}) {
    const dark = primary || pressed;
    return rect(x, y, w, h, { fill: dark ? C.navy : C.white, stroke: C.navy, sw: 2.5, r: 10 }) +
      text(x + w / 2, y + h / 2 + 1, label, { size, weight: 700, anchor: 'middle', fill: dark ? C.white : C.navy });
  }
  /** Circular "renew" arrow, centre-anchored. */
  function renewIcon(cx, cy, r = 30, color = C.navy) {
    const a0 = (-60 * Math.PI) / 180, a1 = (210 * Math.PI) / 180;
    const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const ang = a1 + Math.PI / 2;
    const hx = x1 + 12 * Math.cos(ang), hy = y1 + 12 * Math.sin(ang);
    const q1 = [x1 + 14 * Math.cos(ang + 2.6), y1 + 14 * Math.sin(ang + 2.6)], q2 = [x1 + 14 * Math.cos(ang - 2.6), y1 + 14 * Math.sin(ang - 2.6)];
    void hx; void hy;
    return `<path d="M${x0} ${y0} A${r} ${r} 0 1 1 ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M${x1 + 16 * Math.cos(ang)} ${y1 + 16 * Math.sin(ang)} L${q1[0]} ${q1[1]} L${q2[0]} ${q2[1]} Z" fill="${color}"/>`;
  }
  const FILE = '/etc/ssh/auth_principals/deploy';

  EPISODES['18'] = {
    scenes: {
      // ---------------------------------------------------------------- 18.1
      '18.1': ({ s }) => {
        let o = heading('Certificates do not follow your directory');
        // directory card
        const tMove = s(0) + 2.2;
        const moved = A.now() >= tMove;
        let d = rect(110, 290, 700, 300, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
        d += `<path d="M110 306 a16 16 0 0 1 16 -16 h668 a16 16 0 0 1 16 16 v${42} h-700 z" fill="${C.slate}"/>`;
        d += text(140, 319, 'Company directory', { size: 26, weight: 700, fill: C.white });
        d += person(220, 470, { s: 1.0, label: 'Ana', labelSize: 28 });
        d += text(350, 410, 'group', { size: 24, fill: C.slate });
        const acmeW = textW('acme', 28, true) + 34;
        d += rect(350, 430, acmeW, 52, { fill: moved ? C.mist : C.white, stroke: moved ? C.line : C.navy, sw: 2.5, r: 26 }) + text(350 + acmeW / 2, 457, 'acme', { size: 28, mono: true, weight: 700, anchor: 'middle', fill: moved ? C.muted : C.navy });
        if (moved) d += `<line x1="362" y1="457" x2="${350 + acmeW - 12}" y2="457" stroke="${C.muted}" stroke-width="3"/>`;
        d += show(arrow({ x1: 350 + acmeW + 8, y1: 457, x2: 350 + acmeW + 88, y2: 457, at: tMove, d: 0.4, color: C.navy, width: 4 }) +
          rect(350 + acmeW + 100, 430, textW('globex', 28, true) + 34, 52, { fill: C.navy, stroke: C.navyDeep, sw: 2, r: 26 }) +
          text(350 + acmeW + 100 + (textW('globex', 28, true) + 34) / 2, 457, 'globex', { size: 28, mono: true, weight: 700, anchor: 'middle', fill: C.white }), { at: tMove, from: 'none', d: 0.3 });
        o += show(d, { at: s(0) + 0.1, from: 'left', dist: 50 });
        // Ana's certificate: unchanged
        const c1 = cert(900, 290, 920, { principals: ['developers', 'client-acme'] });
        o += show(c1.svg, { at: s(0) + 0.6, from: 'right', dist: 50 });
        o += show(chip(900, 592, 'unchanged: still client-acme', { kind: 'warn', size: 26 }), { at: tMove + 1.0, from: 'up', dist: 14 });

        // s(1): the issuing process requests the new principals
        const dOut = s(2) - 0.1;
        let pr = card({ x: 110, y: 710, w: 700, h: 130, kind: 'plain', title: 'your issuing process', body: ['requests the new principals'], size: 32, bodySize: 26 });
        o += show(pr, { at: s(1) + 0.2, from: 'left', dist: 40, out: dOut });
        o += show(arrow({ x1: 460, y1: 596, x2: 460, y2: 702, at: s(1) + 0.1, d: 0.5, color: C.navy, width: 5 }), { at: s(1) + 0.1, from: 'none', d: 0.01, out: dOut });
        o += show(arrow({ x1: 820, y1: 775, x2: 890, y2: 775, at: s(1) + 1.2, d: 0.4, color: C.orangeInk, width: 5 }), { at: s(1) + 1.2, from: 'none', d: 0.01, out: dOut });
        const c2 = cert(900, 650, 920, { rows: [['Key ID', 'ana@ops.example'], ['Serial', '43']], principals: ['developers', 'client-globex'] });
        o += show(c2.svg, { at: s(1) + 1.5, from: 'right', dist: 50, out: dOut });

        // s(2): bulk renew copies the old principals
        let br = rect(110, 710, 700, 130, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
        br += renewIcon(190, 775, 30) + text(250, 775, 'Bulk renew', { size: 36, weight: 700 });
        o += show(br, { at: s(2) + 0.2, from: 'left', dist: 40 });
        o += arrow({ x1: 820, y1: 775, x2: 890, y2: 775, at: s(2) + 1.0, d: 0.4, color: C.amber, width: 5 });
        const c3 = cert(900, 650, 920, { rows: [['Key ID', 'ana@ops.example'], ['Serial', '44']], principals: ['developers', 'client-acme'], hdr: C.amber, stroke: C.amber });
        o += show(c3.svg, { at: s(2) + 1.3, from: 'right', dist: 50 });
        o += show(chip(110, 890, '⚠ copies the old principals', { kind: 'warn', size: 30 }), { at: s(2) + 2.2, from: 'up', dist: 14 });
        o += show(text(110, 950, 'never renew a certificate whose principals are wrong', { size: 28, weight: 500, fill: C.slate }), { at: s(2) + 3.4, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 18.2
      '18.2': ({ s }) => {
        let o = heading('Four levers');
        o += show(text(620, 296, 'scope', { size: 24, weight: 700, fill: C.slate }) + text(1080, 296, 'when it takes effect', { size: 24, weight: 700, fill: C.slate }), { at: s(0) + 0.3, from: 'none' });
        const rows = [
          { name: 'new certificate', scope: 'one person', when: 'after the old one expires or is revoked', col: C.orange, at: s(1) + 0.1 },
          { name: 'mapping change', scope: 'one server', when: 'next login after the files are deployed', col: C.slate, at: s(2) + 0.1 },
          { name: 'revoke', scope: 'one certificate, everywhere', when: 'next KRL pull', col: C.red, at: s(3) + 0.1 },
          { name: 'block', scope: 'one person, one host', when: 'next KRL pull', col: C.red, at: s(4) + 0.1 },
        ];
        const icon = (i, cx, cy, col) => {
          if (i === 0) return mark(cx, cy, '+', { r: 30, color: col });
          if (i === 1) return mark(cx, cy, '±', { r: 30, color: col });
          if (i === 2) return mark(cx, cy, '✕', { r: 30, color: col });
          return `<circle cx="${cx}" cy="${cy}" r="30" fill="${col}"/><rect x="${cx - 16}" y="${cy - 5}" width="32" height="10" rx="3" fill="${C.white}"/>`;
        };
        rows.forEach((r, i) => {
          const y = 320 + i * 138, cy = y + 59;
          // name part appears with s(0)
          const nameAt = s(0) + 0.5 + i * 0.35;
          let g = rect(110, y, 1710, 118, { fill: C.white, stroke: r.col, sw: 3, r: 16 }) + `<rect x="110" y="${y}" width="14" height="118" rx="6" fill="${r.col}"/>`;
          g += icon(i, 190, cy, r.col);
          g += text(250, cy, r.name, { size: 32, weight: 700 });
          o += show(g, { at: nameAt, from: 'left', dist: 40 });
          let detail = text(620, cy, r.scope, { size: 28, weight: 500 }) + text(1080, cy, r.when, { size: 28, fill: C.slate });
          o += show(detail, { at: r.at + 0.2, from: 'right', dist: 30 });
          // highlight the row being spoken
          const end = (i < 3 ? s(i + 2) : s(5)) - 0.15;
          if (A.now() >= r.at && A.now() < end) o += rect(104, y - 6, 1722, 130, { fill: 'none', stroke: r.col, sw: 4, r: 20, opacity: 0.55 });
        });
        o += show(card({ x: 110, y: 880, w: 1710, h: 80, kind: 'warn', title: 'open sessions: close them yourself', size: 32 }), { at: s(5) + 0.2, from: 'up', dist: 20 });
        return o;
      },

      // ---------------------------------------------------------------- 18.3
      '18.3': ({ s }) => {
        let o = heading('Adding a server');
        // Acme production group
        let g = rect(110, 290, 900, 340, { fill: C.white, stroke: C.line, sw: 3, r: 18 });
        g += text(140, 335, 'Acme production', { size: 34, weight: 700 });
        [['acme-web', 230], ['acme-db', 430], ['acme-app', 630]].forEach(([n, cx]) => { g += server(cx, 460, { s: 0.55, label: n, labelSize: 26 }); });
        o += show(g, { at: 0.2, from: 'left', dist: 40 });
        o += show(server(830, 460, { s: 0.55, label: 'acme-api', labelSize: 26, color: C.navy }) + chip(830, 568, 'new', { kind: 'good', size: 24, anchor: 'middle' }), { at: s(0) + 0.2, from: 'down', dist: 160, d: 0.9 });
        // mapping copied from the class and deployed
        const tDep = s(0) + 4.2;
        const cb = code({
          x: 1120, y: 368, w: 670, size: 28, title: FILE, kind: 'file', lines: ['client-acme', 'sysadmins'],
          lineAt: [s(0) + 2.2, s(0) + 2.7],
          hl: [{ line: 0, at: tDep + 0.6, color: C.green, opacity: 0.25 }, { line: 1, at: tDep + 0.6, color: C.green, opacity: 0.25 }],
        });
        o += show(serverPanel(1090, 290, 730, 340, 'acme-api') + cb.svg, { at: s(0) + 1.2, from: 'right', dist: 50 });
        o += show(chip(1455, 580, 'mapping copied from the Acme class', { kind: 'plain', size: 24, anchor: 'middle' }), { at: s(0) + 2.0, from: 'up', dist: 10, out: tDep });
        o += show(chip(1455, 580, 'files deployed', { kind: 'good', size: 26, anchor: 'middle' }), { at: tDep, from: 'up', dist: 10 });
        // Ana's existing certificate enters
        const tc = s(1) + 0.2;
        o += show(miniCert(110, 700, 700, 130, "Ana's certificate (serial 42)", ['developers', 'client-acme']), { at: tc, from: 'left', dist: 50 });
        o += arrow({ x1: 820, y1: 765, x2: 1080, y2: 735, at: s(1) + 1.2, d: 0.6, color: C.green, width: 6 });
        o += show(card({ x: 1090, y: 680, w: 730, h: 90, kind: 'good', title: '✓  ana@ops.example logs in as deploy', size: 28 }), { at: s(1) + 1.9, from: 'up', dist: 14 });
        o += show(chip(460, 890, 'the certificate is not touched', { kind: 'plain', size: 28, anchor: 'middle' }), { at: s(2) + 0.1, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 18.4
      '18.4': ({ s }) => {
        let o = heading('Limit who may hold a principal');
        // identity card
        let w = win(110, 280, 860, 430, 'Identity · ana@ops.example');
        w += text(140, 376, 'Allowed principals', { size: 30, weight: 700 });
        w += text(140, 416, 'Principals this identity may receive in its certificates.', { size: 24, fill: C.slate });
        ['developers', 'client-acme'].forEach((n, i) => {
          const y = 448 + i * 70;
          w += rect(140, y, 800, 58, { fill: C.mist, stroke: C.line, sw: 2, r: 10 });
          w += tag(160 + tagW(n, 28) / 2, y + 29, n, { kind: 'soft', size: 28 });
          w += button(790, y + 8, 134, 42, 'Remove', { size: 24 });
        });
        w += rect(140, 610, 560, 56, { fill: C.white, stroke: C.slate, sw: 2, r: 10 }) + text(162, 639, 'Add principal…', { size: 28, fill: C.muted }) + text(670, 639, '▾', { size: 26, anchor: 'middle', fill: C.slate });
        w += button(720, 610, 200, 56, 'Grant', { primary: true });
        o += show(w, { at: s(0) + 0.2, from: 'left', dist: 40 });

        // API request refused
        const t1 = s(1) + 0.3, tErr = s(1) + 2.8;
        const req = code({ x: 1020, y: 280, w: 800, size: 28, title: 'issue request', kind: 'file', lines: ['principals: ["sysadmins"]', { text: 'enforceEntitlement: true', color: C.orangeInk }], lineAt: [t1, t1 + 0.6] });
        o += show(req.svg, { at: t1, from: 'right', dist: 40 });
        o += show(card({ x: 1020, y: 280 + req.h + 20, w: 800, h: 76, kind: 'danger', title: 'identity not entitled to principals: sysadmins', size: 26 }), { at: tErr, from: 'up', dist: 14 });

        // host Access card
        const ay = 618;
        let ac = rect(1020, ay, 800, 230, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
        ac += `<path d="M1020 ${ay + 16} a16 16 0 0 1 16 -16 h768 a16 16 0 0 1 16 16 v${42} h-800 z" fill="${C.navy}"/>`;
        ac += text(1050, ay + 29, 'acme-web · Access', { size: 26, weight: 700, fill: C.white, mono: true });
        ac += text(1050, ay + 100, 'ana@ops.example · certificate + grant', { size: 28, mono: true, weight: 700 });
        ac += text(1050, ay + 160, 'pau@ops.example · certificate', { size: 28, mono: true });
        o += show(ac, { at: s(2) + 0.2, from: 'right', dist: 40 });
        o += show(chip(1700, ay + 100, 'grant', { kind: 'good', size: 24, anchor: 'middle' }), { at: s(2) + 1.8, from: 'pop', cx: 1700, cy: ay + 100 });
        o += show(chip(1700, ay + 160, 'live cert', { kind: 'plain', size: 24, anchor: 'middle' }), { at: s(2) + 3.0, from: 'pop', cx: 1700, cy: ay + 160 });

        // where the check applies
        const sc = [
          ['API: optional check', 'good', 110, s(3) + 0.3], ['Ansible module: optional check', 'good', 620, s(3) + 1.6], ['Web form: no check', 'warn', 1260, s(3) + 3.2],
        ];
        sc.forEach(([l, k, x, at]) => {
          const ww = k === 'warn' ? 560 : (x === 110 ? 480 : 620);
          o += show(card({ x, y: 886, w: ww, h: 70, kind: k, title: l, size: 28 }), { at, from: 'up', dist: 16 });
        });
        return o;
      },

      // ---------------------------------------------------------------- 18.5
      '18.5': ({ s }) => {
        let o = heading('Who did what');
        const tJoin = s(3) + 0.2;
        // PKI Manager record
        const rec = code({
          x: 110, y: 290, w: 800, size: 28, title: 'PKI Manager · certificate record', kind: 'user',
          lines: ['keyId  ana@ops.example', 'principals  developers client-acme', 'serial  42', 'CA  User CA prod'],
          lineAt: [s(1) + 0.2, s(1) + 1.2, s(1) + 2.2, s(1) + 3.2],
          hl: [{ line: 2, at: tJoin, color: C.orange, opacity: 0.25 }, { line: 3, at: tJoin, color: C.orange, opacity: 0.25 }],
        });
        o += show(rec.svg, { at: s(0) + 0.3, from: 'left', dist: 50 });
        // central log
        const log = code({
          x: 1020, y: 290, w: 800, size: 28, title: 'central log · acme-web', kind: 'file',
          lines: ['acme-web sshd', 'Accepted publickey for deploy', 'ID ana@ops.example (serial 42)', 'CA ECDSA SHA256:…'],
          lineAt: [s(2) + 0.2, s(2) + 1.0, s(2) + 1.8, s(2) + 2.6],
          hl: [{ line: 2, at: tJoin, color: C.orange, opacity: 0.25 }, { line: 3, at: tJoin, color: C.orange, opacity: 0.25 }],
        });
        o += show(log.svg, { at: s(0) + 0.8, from: 'right', dist: 50 });
        // join
        o += arrow({ x1: 510, y1: 300 + rec.h + 4, x2: 740, y2: 640, at: tJoin, d: 0.6, color: C.orangeInk, width: 5 });
        o += arrow({ x1: 1420, y1: 300 + log.h + 4, x2: 1180, y2: 640, at: tJoin, d: 0.6, color: C.orangeInk, width: 5 });
        o += show(card({ x: 700, y: 650, w: 520, h: 90, kind: 'pki', title: 'serial 42 + CA fingerprint', size: 32 }), { at: tJoin + 0.5, from: 'up', dist: 20 });
        // result
        let px = 110;
        [['who', 'ana@ops.example'], ['role', 'developers client-acme'], ['where', 'acme-web, as deploy']].forEach(([k, v], i) => {
          const pw = 28 + textW(k, 24) + 18 + textW(v, 26, true) + 28;
          o += show(rect(px, 790, pw, 76, { fill: C.white, stroke: C.navy, sw: 2.5, r: 38 }) + text(px + 28, 828, k, { size: 24, weight: 700, fill: C.slate }) + text(px + 28 + textW(k, 24) + 18, 829, v, { size: 26, mono: true, weight: 700 }), { at: tJoin + 1.8 + i * 0.9, from: 'up', dist: 14 });
          px += pw + 24;
        });
        o += nextCard('19 Test your design', s(3));
        return o;
      },
    },
  };
})();
