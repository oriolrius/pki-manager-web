// Episode 17 — Robots and pipelines (series 2, scenes 17.1–17.5).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, arrow, lock, heading, nextCard, mark, ease, prog, clamp, lerp, textW } = A;

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
  /** Robot icon, centre-anchored (extent about -92k … +90k vertically). */
  function robot(cx, cy, k = 1, color = C.navy) {
    let o = '';
    o += `<line x1="${cx}" y1="${cy - 70 * k}" x2="${cx}" y2="${cy - 92 * k}" stroke="${color}" stroke-width="${6 * k}" stroke-linecap="round"/>`;
    o += `<circle cx="${cx}" cy="${cy - 96 * k}" r="${8 * k}" fill="${C.greenBright}"/>`;
    o += rect(cx - 50 * k, cy - 70 * k, 100 * k, 72 * k, { fill: color, stroke: C.navyDeep, sw: 2, r: 16 * k });
    o += `<circle cx="${cx - 20 * k}" cy="${cy - 38 * k}" r="${9 * k}" fill="${C.white}"/><circle cx="${cx + 20 * k}" cy="${cy - 38 * k}" r="${9 * k}" fill="${C.white}"/>`;
    o += rect(cx - 16 * k, cy - 16 * k, 32 * k, 8 * k, { fill: '#2A2C74', stroke: 'none', sw: 0, r: 4 * k });
    o += rect(cx - 58 * k, cy + 8 * k, 116 * k, 82 * k, { fill: color, stroke: C.navyDeep, sw: 2, r: 16 * k });
    o += rect(cx - 76 * k, cy + 18 * k, 16 * k, 52 * k, { fill: color, stroke: C.navyDeep, sw: 2, r: 8 * k });
    o += rect(cx + 60 * k, cy + 18 * k, 16 * k, 52 * k, { fill: color, stroke: C.navyDeep, sw: 2, r: 8 * k });
    o += rect(cx - 24 * k, cy + 30 * k, 48 * k, 38 * k, { fill: '#2A2C74', stroke: 'none', sw: 0, r: 6 * k });
    o += `<circle cx="${cx}" cy="${cy + 49 * k}" r="${7 * k}" fill="${C.greenBright}"/>`;
    return o;
  }
  /** Window with a navy title bar. */
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
  /** Labelled form field: label above, box below, optional value. y = top of the label line. */
  function field(x, y, w, label, value, { mono = true, fill = C.mist, vfill = C.navy, bold = false, vsize = 26, stroke = C.slate } = {}) {
    let o = text(x, y + 4, label, { size: 24, weight: 700, fill: C.slate });
    o += rect(x, y + 20, w, 52, { fill, stroke, sw: 2, r: 10 });
    if (value) o += text(x + 20, y + 47, value, { size: vsize, mono, weight: bold ? 700 : 400, fill: vfill });
    return o;
  }
  /** Characters of `str` typed since `at` (cps chars per second). */
  const typed = (str, at, cps = 26) => (A.now() < at ? '' : str.slice(0, Math.floor((A.now() - at) * cps)));
  /** Toggle switch, v = 1 on … 0 off. */
  function toggle(x, y, v) {
    const on = v > 0.5;
    return rect(x, y, 84, 44, { fill: on ? C.green : '#C9CBCD', stroke: on ? '#0A7C58' : C.slate, sw: 2, r: 22 }) +
      `<circle cx="${lerp(x + 22, x + 62, v)}" cy="${y + 22}" r="16" fill="${C.white}"/>`;
  }
  function checkbox(x, y, on, label, { size = 28, mono = true, boldOn = true } = {}) {
    let o = rect(x, y - 17, 34, 34, { fill: on ? C.navy : C.white, stroke: C.navy, sw: 2.5, r: 7 });
    if (on) o += text(x + 17, y + 1, '✓', { size: 26, anchor: 'middle', fill: C.white, weight: 700 });
    o += text(x + 50, y + 1, label, { size, mono, weight: on && boldOn ? 700 : 400, fill: C.navy });
    return o;
  }

  EPISODES['17'] = {
    scenes: {
      // ---------------------------------------------------------------- 17.1
      '17.1': ({ s }) => {
        let o = heading('Robots are identities too');
        const robotCard = (x, name, ident, princ, tA, tB) => {
          let g = rect(x, 290, 830, 340, { fill: C.white, stroke: C.navy, sw: 3, r: 18 });
          g += robot(x + 150, 470, 1.3);
          g += text(x + 300, 350, name, { size: 34, weight: 700 });
          return [g, text(x + 300, 412, 'identity', { size: 24, fill: C.slate }) + chip(x + 300, 456, ident, { kind: 'plain', size: 26, mono: true }),
            text(x + 300, 520, 'principal', { size: 24, fill: C.slate }) + tag(x + 300 + tagW(princ, 30) / 2, 572, princ, { kind: 'user', size: 30 })];
        };
        const [a0, a1, a2] = robotCard(110, 'acme-deploy pipeline', 'acme-deploy@ci.ops.example', 'acme-deployer');
        const [b0, b1, b2] = robotCard(990, 'backup job', 'backup@ops.example', 'backup');
        o += show(a0, { at: s(0) + 0.2, from: 'left', dist: 50 });
        o += show(b0, { at: s(0) + 1.2, from: 'right', dist: 50 });
        o += show(a1, { at: s(1) + 0.1, from: 'up', dist: 20 });
        o += show(b1, { at: s(1) + 0.5, from: 'up', dist: 20 });
        o += show(a2, { at: s(1) + 1.6, from: 'up', dist: 20 });
        o += show(b2, { at: s(1) + 2.0, from: 'up', dist: 20 });
        // never reuse a person's certificate
        let c = rect(110, 700, 640, 140, { fill: C.white, stroke: C.orange, sw: 3, r: 14 });
        c += `<path d="M110 714 a14 14 0 0 1 14 -14 h612 a14 14 0 0 1 14 14 v${36 - 14} h-640 z" fill="${C.orange}"/>`;
        c += text(132, 719, "Ana's certificate", { size: 24, weight: 700, fill: C.white });
        c += text(132, 782, 'Principals', { size: 24, fill: C.slate, weight: 500 });
        c += tag(300 + tagW('developers', 26) / 2, 782, 'developers', { kind: 'soft', size: 26 });
        c += tag(300 + tagW('developers', 26) + 12 + tagW('client-acme', 26) / 2, 782, 'client-acme', { kind: 'soft', size: 26 });
        o += show(c, { at: s(2) + 0.1, from: 'up', dist: 24 });
        o += arrow({ x1: 430, y1: 696, x2: 430, y2: 640, at: s(2) + 0.7, d: 0.5, color: C.red, width: 5, dashed: true });
        o += show(mark(430, 668, '✕', { r: 24, color: C.red }), { at: s(2) + 1.3, from: 'pop', cx: 430, cy: 668 });
        o += show(text(800, 740, "A person's certificate", { size: 34, weight: 700, fill: C.red }) + text(800, 786, 'never goes in a pipeline', { size: 34, weight: 700, fill: C.red }), { at: s(2) + 1.0, from: 'right', dist: 24 });
        return o;
      },

      // ---------------------------------------------------------------- 17.2
      '17.2': ({ s }) => {
        let o = heading('Map robots narrowly');
        o += show(robot(240, 520, 1.25) + text(240, 676, 'acme-deploy', { size: 28, weight: 700, anchor: 'middle' }) + text(240, 708, 'pipeline', { size: 28, weight: 700, anchor: 'middle' }) + tag(240, 782, 'acme-deployer', { kind: 'user', size: 28 }), { at: 0.2, from: 'left', dist: 40 });
        const rows = [
          { y: 290, server: 'acme-web', acct: 'deploy', ok: true, at: s(0) + 1.0 },
          { y: 422, server: 'acme-app', acct: 'deploy', ok: true, at: s(0) + 2.4 },
          { y: 554, server: 'globex-web', acct: 'deploy', ok: false, at: s(1) + 1.6 },
          { y: 686, server: 'acme-web', acct: 'root', ok: false, at: s(2) + 0.1 },
        ];
        rows.forEach((r) => {
          const cy = r.y + 56;
          let g = rect(520, r.y, 1300, 112, { fill: r.ok ? C.greenSoft : C.mist, stroke: r.ok ? C.green : C.line, sw: r.ok ? 4 : 3, r: 16 });
          g += text(556, cy, r.server, { size: 32, mono: true, weight: 700, fill: r.ok ? '#075C41' : C.muted });
          if (r.ok) {
            g += text(860, cy, `${r.acct} ← `, { size: 32, mono: true, weight: 700 });
            g += tag(860 + textW(`${r.acct} ← `, 32, true) + tagW('acme-deployer', 28) / 2 + 4, cy, 'acme-deployer', { kind: 'user', size: 28 });
            g += mark(1760, cy, '✓', { r: 26, color: C.green });
          } else {
            g += lock(880, cy - 6, { s: 1.2, color: C.red });
            g += text(930, cy, `${r.acct}: no acme-deployer`, { size: 32, mono: true, weight: 700, fill: C.red });
            g += mark(1760, cy, '✕', { r: 26, color: C.red });
          }
          o += show(g, { at: r.at, from: 'right', dist: 40 });
          o += arrow({ x1: 380, y1: 560, x2: 510, y2: cy, at: r.at + 0.2, d: 0.5, color: r.ok ? C.green : C.red, width: 4, dashed: !r.ok });
        });
        o += show(text(960, 900, 'one principal · one account · only the servers where the robot works', { size: 30, anchor: 'middle', weight: 500, fill: C.slate }), { at: s(2) + 0.9, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 17.3
      '17.3': ({ s }) => {
        let o = heading('Lock the command and the source');
        const tF = s(1) + 0.5, tS = s(2) + 0.4;
        let fm = win(110, 270, 860, 590, 'Issue User Certificate');
        fm += field(140, 349, 800, 'Identity *', 'backup@ops.example');
        fm += text(140, 449, 'Principals (roles) *', { size: 24, weight: 700, fill: C.slate }) + rect(140, 465, 800, 52, { fill: C.white, stroke: C.slate, sw: 2, r: 10 }) + chip(156, 491, 'backup', { kind: 'user', size: 26 });
        fm += field(140, 545, 800, 'Force command (optional)', typed('/usr/local/bin/run-backup', tF), { fill: C.white, bold: true, stroke: A.now() >= tF ? C.orange : C.slate });
        fm += field(140, 641, 800, 'Source address (optional)', typed('10.0.8.0/24', tS), { fill: C.white, bold: true, stroke: A.now() >= tS ? C.orange : C.slate });
        fm += button(670, 772, 270, 64, 'Issue Certificate', { primary: true });
        o += show(fm, { at: 0.3, from: 'left', dist: 40 });

        // right 1: the attacker's command is replaced
        const tA = s(1) + 1.8, tB = s(1) + 3.2;
        const strike = ease(prog(tB - 0.3, 0.4));
        let d1 = rect(1020, 270, 800, 250, { fill: C.term, stroke: C.navyDeep, sw: 2, r: 14 });
        d1 += text(1050, 308, "the attacker's client asks for:", { size: 24, fill: '#A9ABD0' });
        d1 += text(1050, 358, '$ ssh backup@db-int cat /etc/shadow', { size: 28, mono: true, fill: strike > 0 ? '#FF8A8A' : C.termText });
        d1 += `<line x1="1050" y1="358" x2="${1050 + 35 * 14 * strike}" y2="358" stroke="#FF8A8A" stroke-width="4"/>`;
        if (A.now() >= tB) {
          d1 += text(1050, 424, 'sshd runs this instead:', { size: 24, fill: '#A9ABD0' });
          d1 += text(1050, 474, '/usr/local/bin/run-backup', { size: 32, mono: true, weight: 700, fill: '#6FE3B5' });
        }
        o += show(d1, { at: tA - 0.5, from: 'right', dist: 40 });

        // right 2: source address
        const tR = s(2) + 1.4;
        let d2 = rect(1020, 560, 800, 290, { fill: C.white, stroke: C.slate, sw: 3, r: 14 });
        d2 += text(1050, 598, 'Source address', { size: 26, weight: 700, fill: C.slate }) + text(1290, 598, '10.0.8.0/24', { size: 28, mono: true, weight: 700, fill: C.orangeInk });
        d2 += text(1050, 640, 'the address the server sees', { size: 24, fill: C.slate });
        o += show(d2, { at: tS + 0.3, from: 'right', dist: 40 });
        o += show(card({ x: 1050, y: 672, w: 740, h: 70, kind: 'good', title: '✓  10.0.8.17  accepted', size: 28, align: 'start' }), { at: tR, from: 'up', dist: 14 });
        o += show(card({ x: 1050, y: 756, w: 740, h: 70, kind: 'danger', title: '✕  203.0.113.9  refused', size: 28, align: 'start' }), { at: tR + 1.0, from: 'up', dist: 14 });

        // limits live in the certificate
        o += show(card({ x: 110, y: 886, w: 1710, h: 80, kind: 'warn', title: 'These limits live in the certificate: control who can issue backup', size: 30 }), { at: s(3) + 0.3, from: 'up', dist: 20 });
        return o;
      },

      // ---------------------------------------------------------------- 17.4
      '17.4': ({ s }) => {
        let o = heading('Remove what it does not need');
        const tPress = s(1) + 1.0;
        const names = ['permit-X11-forwarding', 'permit-agent-forwarding', 'permit-port-forwarding', 'permit-pty', 'permit-user-rc'];
        const v = (i) => 1 - ease(prog(tPress + 0.18 * i, 0.35));
        const pressed = A.now() >= tPress && A.now() < tPress + 0.6;
        let fm = win(110, 280, 960, 570, 'Issue User Certificate');
        fm += text(140, 380, 'Extensions', { size: 28, weight: 700, fill: C.slate });
        fm += button(730, 352, 310, 54, 'Harden — clear all', { pressed });
        names.forEach((n, i) => {
          const y = 424 + i * 80;
          fm += rect(140, y, 900, 68, { fill: C.mist, stroke: C.line, sw: 2, r: 10 });
          fm += toggle(164, y + 13, v(i));
          fm += text(280, y + 36, n, { size: 28, mono: true, weight: 500 });
        });
        o += show(fm, { at: 0.3, from: 'left', dist: 40 });
        // highlights on the three rows named in the narration
        const hl = [[3, s(0) + 1.1], [2, s(0) + 2.5], [1, s(0) + 3.6]];
        hl.forEach(([i, at]) => {
          const y = 424 + i * 80;
          o += show(rect(137, y - 3, 906, 74, { fill: 'none', stroke: C.amber, sw: 4, r: 12 }), { at, from: 'none', out: tPress });
        });
        // right: what a leaked key could use
        o += show(text(1130, 318, 'A leaked key could use:', { size: 30, weight: 700, fill: C.navy }), { at: s(0) + 0.5, from: 'right', dist: 30 });
        const rr = [['a terminal on the host', 'permit-pty', s(0) + 1.1, 0], ['port forwarding', 'permit-port-forwarding', s(0) + 2.5, 1], ['agent forwarding', 'permit-agent-forwarding', s(0) + 3.6, 2]];
        rr.forEach(([t1, t2, at, i]) => {
          const y = 360 + i * 150;
          const done = A.now() >= tPress + 0.35 + (3 - i) * 0.18 + 0.4;
          let g = card({ x: 1130, y, w: 690, h: 126, kind: done ? 'good' : 'warn', title: t1, body: [done ? `${t2} · off` : `${t2} · on`], size: 30, bodySize: 26, mono: false });
          g += mark(1780, y + 63, done ? '✓' : '!', { r: 24, color: done ? C.green : C.amber });
          o += show(g, { at, from: 'right', dist: 40 });
        });
        o += show(text(960, 940, 'fewer extensions, less damage if the key leaks', { size: 30, weight: 500, anchor: 'middle', fill: C.green }), { at: s(2) + 0.3, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 17.5
      '17.5': ({ s }) => {
        let o = heading('Short certificates for each run');
        // phase 1: one fresh certificate per run
        [0, 1, 2].forEach((i) => {
          const x = 110 + i * 590;
          let g = text(x + 250, 380, `run ${i + 1}`, { size: 34, weight: 700, anchor: 'middle' });
          g += card({ x, y: 430, w: 500, h: 190, kind: 'user', title: 'certificate', body: ['valid 15 minutes'], size: 36, bodySize: 30 });
          g += text(x + 250, 670, 'expires, nobody renews it', { size: 26, anchor: 'middle', fill: C.slate });
          o += show(g, { at: s(0) + 0.3 + i * 1.5, from: 'up', dist: 30, out: s(1) - 0.1 });
        });

        // phase 2: mint a token with limits
        const t1 = s(1) + 1.6, t2 = s(1) + 2.6, t3 = s(1) + 4.0, tMint = s(1) + 5.2;
        let fm = win(110, 270, 1000, 630, 'Fleet tokens');
        fm += field(140, 352, 400, 'Name', 'acme-ci');
        fm += text(600, 356, 'Scope', { size: 24, weight: 700, fill: C.slate }) + checkbox(600, 408, true, 'sign-user', { size: 28 });
        // limits box
        let lb = rect(140, 440, 940, 340, { fill: C.orangeSoft, stroke: C.orange, sw: 3, r: 14 });
        lb += text(170, 475, 'sign-user limits', { size: 30, weight: 700, fill: C.orangeInk });
        lb += text(170, 520, 'Allowed principals', { size: 24, weight: 700, fill: C.slate });
        lb += checkbox(170, 566, A.now() >= t1, 'acme-deployer', { size: 28 }) + checkbox(560, 566, false, 'backup', { size: 28 });
        lb += checkbox(170, 616, false, 'developers', { size: 28 }) + checkbox(560, 616, false, 'client-acme', { size: 28 });
        lb += text(170, 672, 'Max certificate lifetime', { size: 24, weight: 700, fill: C.slate });
        const sel = A.now() >= t3 ? '15 minutes (suggested for CI)' : 'No limit';
        lb += rect(170, 690, 600, 52, { fill: C.white, stroke: A.now() >= t3 ? C.orange : C.slate, sw: 2, r: 10 }) + text(190, 717, sel, { size: 28, weight: A.now() >= t3 ? 700 : 400, fill: A.now() >= t3 ? C.navy : C.muted }) + text(738, 717, '▾', { size: 26, anchor: 'middle', fill: C.slate });
        fm += show(lb, { at: t2 - 1.2, from: 'up', dist: 20 });
        fm += button(800, 826, 280, 56, 'Mint token', { primary: true, pressed: A.now() >= tMint && A.now() < tMint + 0.5 });
        o += show(fm, { at: s(1) + 0.2, from: 'up', dist: 30, out: s(2) - 0.1 });
        {
          let rc = rect(1160, 440, 660, 220, { fill: C.white, stroke: C.orange, sw: 3, r: 16 });
          rc += text(1490, 484, 'This token can sign', { size: 34, weight: 700, anchor: 'middle' });
          rc += show(text(1196, 558, 'only principal: acme-deployer', { size: 30 }), { at: t1 + 0.2, from: 'right', dist: 20 });
          rc += show(text(1196, 612, 'only for up to 15 minutes', { size: 30 }), { at: t3 + 0.2, from: 'right', dist: 20 });
          o += show(rc, { at: s(1) + 1.0, from: 'right', dist: 40, out: s(2) - 0.1 });
        }

        // phase 3: Limits column, Unrestricted pill, the 403
        const th = 58, rh = 104, tx = 110, ty = 280, tw = 1700;
        let tb = rect(tx, ty, tw, th + rh * 2, { fill: C.white, stroke: C.line, sw: 2, r: 12 });
        tb += `<path d="M${tx} ${ty + 12} a12 12 0 0 1 12 -12 h${tw - 24} a12 12 0 0 1 12 12 v${th - 12} h${-tw} z" fill="${C.mist}"/>`;
        tb += text(tx + 24, ty + th / 2, 'Name', { size: 26, weight: 700 }) + text(tx + 400, ty + th / 2, 'Limits', { size: 26, weight: 700 });
        tb += `<line x1="${tx}" y1="${ty + th + rh}" x2="${tx + tw}" y2="${ty + th + rh}" stroke="${C.line}" stroke-width="1.5"/>`;
        tb += text(tx + 24, ty + th + rh / 2, 'acme-ci', { size: 30, mono: true, weight: 700 });
        tb += text(tx + 400, ty + th + rh / 2 - 22, 'Principals: acme-deployer', { size: 28 }) + text(tx + 400, ty + th + rh / 2 + 22, 'Max lifetime: 15 min', { size: 28 });
        tb += text(tx + 24, ty + th + rh * 1.5, 'legacy-ci', { size: 30, mono: true, weight: 700 });
        o += show(tb, { at: s(2) + 0.1, from: 'up', dist: 30, out: s(3) - 0.1 });
        o += show(chip(tx + 400, ty + th + rh * 1.5, 'Unrestricted', { kind: 'warn', size: 28 }) + text(tx + 640, ty + th + rh * 1.5, 'can sign any principal in its zone', { size: 26, fill: C.slate }), { at: s(2) + 1.8, from: 'right', dist: 30, out: s(3) - 0.1 });
        let er = rect(110, 600, 1700, 130, { fill: C.redSoft, stroke: C.red, sw: 3, r: 14 });
        er += text(140, 636, 'a request to sign root, with the limited token:', { size: 26, fill: C.slate, weight: 500 });
        er += text(140, 686, '403 TOKEN_LIMIT: token "acme-ci" may not sign principal(s) root — allowed: acme-deployer', { size: 27, mono: true, weight: 700, fill: '#8E1B1B' });
        o += show(er, { at: s(2) + 3.8, from: 'up', dist: 24, out: s(3) - 0.1 });

        // phase 4: trusted service holds the token; the job gets only the certificate
        let sv = rect(110, 330, 480, 300, { fill: C.white, stroke: C.navy, sw: 4, r: 18 });
        sv += text(350, 380, 'trusted service', { size: 34, weight: 700, anchor: 'middle' });
        sv += A.keyCard(160, 430, { w: 380, h: 100, label: 'token acme-ci', sub: 'limited', kind: 'machine', size: 28 });
        sv += lock(350, 574, { s: 1.0, color: C.navy });
        o += show(sv, { at: s(3) + 0.3, from: 'left', dist: 50 });
        o += arrow({ x1: 600, y1: 480, x2: 770, y2: 480, at: s(3) + 1.4, d: 0.6, color: C.orangeInk, width: 6 });
        o += show(card({ x: 780, y: 380, w: 380, h: 200, kind: 'user', title: 'certificate', body: ['15 min', 'extensions: []'], size: 36, bodySize: 30, mono: false }), { at: s(3) + 1.4, from: 'left', dist: 40 });
        o += arrow({ x1: 1170, y1: 480, x2: 1330, y2: 480, at: s(3) + 2.4, d: 0.6, color: C.orangeInk, width: 6 });
        o += show(robot(1560, 470, 1.4) + text(1560, 640, 'CI job', { size: 34, weight: 700, anchor: 'middle' }), { at: s(3) + 2.4, from: 'right', dist: 40 });
        o += show(text(960, 760, 'the job gets the certificate, never the token', { size: 32, weight: 700, anchor: 'middle', fill: C.slate }), { at: s(3) + 3.6, from: 'up', dist: 14 });
        o += nextCard('18 Changing access', s(3));
        return o;
      },
    },
  };
})();
