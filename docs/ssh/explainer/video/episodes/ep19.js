// Episode 19 — Test your design (series 2, scenes 19.1–19.3).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, terminal, arrow, mark, heading, ease, prog, clamp, textW } = A;

  EPISODES['19'] = {
    scenes: {
      // ---------------------------------------------------------------- 19.1
      '19.1': ({ s, e }) => {
        const D4 = e(4) - s(4);
        let o = heading('Test one person end to end');
        // Ana's certificate
        let ct = rect(110, 290, 520, 275, { fill: C.white, stroke: C.orange, sw: 3, r: 16 });
        ct += text(140, 328, "Ana's certificate", { size: 30, weight: 700, fill: C.orangeInk });
        ct += text(140, 384, 'principals', { size: 24, fill: C.slate });
        ct += chip(140, 428, 'developers', { kind: 'user', size: 26 }) + chip(330, 428, 'client-acme', { kind: 'user', size: 26 });
        ct += text(140, 490, 'serial 63', { size: 26, mono: true, fill: C.slate });
        ct += text(140, 522, 'CA SHA256:Ro2…', { size: 26, mono: true, fill: C.slate });
        o += show(ct, { at: s(1) + 0.1, from: 'left', dist: 50 });
        // terminal with three attempts
        const t1 = s(1) + 1.4, t2 = s(2) + 0.2, t3 = s(3) + 0.2;
        const term = terminal({
          x: 680, y: 290, w: 1140, size: 28, title: 'ana@laptop', minLines: 6,
          items: [
            { t: '$ ssh deploy@acme-web', at: t1 },
            { t: 'logged in as deploy', out: true, at: t1 + 0.9, color: '#6FE3B5' },
            { t: '$ ssh deploy@globex-web', at: t2 },
            { t: 'Permission denied (publickey).', out: true, at: t2 + 0.9, color: '#FF8A8A' },
            { t: '$ ssh root@acme-web', at: t3 },
            { t: 'Permission denied (publickey).', out: true, at: t3 + 0.9, color: '#FF8A8A' },
          ],
        });
        o += show(term.svg, { at: s(0) + 0.3, from: 'up', dist: 24 });
        const rowY = (i) => 290 + 46 + 18 + i * 28 * 1.45 + 14;
        o += show(mark(1760, rowY(0) + 20, '✓', { r: 24, color: C.green }), { at: t1 + 1.0, from: 'pop', cx: 1760, cy: rowY(0) + 20 });
        o += show(mark(1760, rowY(2) + 20, '✕', { r: 24, color: C.red }), { at: t2 + 1.0, from: 'pop', cx: 1760, cy: rowY(2) + 20 });
        o += show(mark(1760, rowY(4) + 20, '✕', { r: 24, color: C.red }), { at: t3 + 1.0, from: 'pop', cx: 1760, cy: rowY(4) + 20 });
        // log line <-> certificate record
        const tm = s(4) + 0.2;
        const logC = code({
          x: 110, y: 660, w: 700, size: 26, title: 'acme-web · sshd log', kind: 'file',
          lines: ['Accepted publickey for deploy', 'ID ana@ops.example (serial 63) CA SHA256:Ro2…'],
          hl: [{ line: 1, at: tm + 1.8, color: C.orange, opacity: 0.22 }],
        });
        const recC = code({
          x: 1010, y: 660, w: 810, size: 26, title: 'PKI Manager · certificate record', kind: 'user',
          lines: ['keyId ana@ops.example', 'principals developers client-acme', 'serial 63', 'CA SHA256:Ro2…'],
          hl: [{ line: 2, at: tm + 1.8, color: C.orange, opacity: 0.22 }, { line: 3, at: tm + 1.8, color: C.orange, opacity: 0.22 }],
        });
        o += show(logC.svg, { at: tm, from: 'left', dist: 50 });
        o += show(recC.svg, { at: tm + 0.8, from: 'right', dist: 50 });
        o += arrow({ x1: 820, y1: 770, x2: 1000, y2: 770, at: tm + 1.6, d: 0.5, color: C.orangeInk, width: 5, label: 'match', labelSize: 26 });
        o += show(chip(960, 940, 'same serial + same CA', { kind: 'good', size: 28, anchor: 'middle' }), { at: tm + 2.4, from: 'up', dist: 14 });
        void D4;
        return o;
      },

      // ---------------------------------------------------------------- 19.2
      '19.2': ({ s, e }) => {
        const D3 = e(3) - s(3);
        let o = heading('The usual mistakes');
        o += show(chip(700, 168, 'while you test, look for these', { kind: 'warn', size: 28 }), { at: s(0) + 0.2, from: 'right', dist: 30 });
        const items = [
          ['per-person principals', s(1) + 0.2],
          ['security = sysadmins', s(2) + 0.2],
          ["robot uses a person's cert", s(3) + 0.2],
          ['sign-user token in the job', s(3) + D3 * 0.5],
          ['+1y certificates', s(4) + 0.2],
          ['old authorized_keys / passwords', s(5) + 0.2],
        ];
        items.forEach(([label, at], i) => {
          const x = 110 + (i % 2) * 860, y = 300 + Math.floor(i / 2) * 200;
          const g = card({ x, y, w: 840, h: 150, kind: 'danger', title: label, size: 34, align: 'left' }) + mark(x + 800, y + 36, '✕', { r: 22, color: C.red });
          o += show(g, { at, from: 'up', dist: 30, cx: x + 420, cy: y + 75 });
        });
        return o;
      },

      // ---------------------------------------------------------------- 19.3
      '19.3': ({ s, e }) => {
        const dim = 1 - 0.94 * ease(prog(s(2) - 0.1, 0.6));
        const D1 = e(1) - s(1);
        let o = '';
        let pic = heading('Principals in depth, in one picture');
        const rowLabel = (y, a, b) => text(110, y - 14, a, { size: 32, weight: 700 }) + text(110, y + 24, b, { size: 26, fill: C.slate });
        // row 1: three families
        pic += show(rowLabel(365, 'Principals', '3 families'), { at: s(0) + 0.1, from: 'left', dist: 30 });
        [['Roles', ['developers, sysadmins,', 'security']], ['Customers', ['client-acme, client-globex,', 'client-initech']], ['Special', ['break-glass']]].forEach(([t, b], i) => {
          pic += show(card({ x: 560 + i * 400, y: 290, w: 380, h: 150, kind: 'user', title: t, body: b, size: 30, bodySize: 24, mono: true }), { at: s(0) + 0.3 + i * 0.25, from: 'up', dist: 24 });
        });
        // row 2: four server classes
        pic += show(rowLabel(560, 'Servers', '4 classes'), { at: s(1) + 0.2, from: 'left', dist: 30 });
        ['Customer production', 'Dev', 'Internal tools', 'Internal sensitive'].forEach((t, i) => {
          pic += show(card({ x: 560 + i * 300, y: 505, w: 285, h: 110, kind: 'machine', title: t, size: 24 }), { at: s(1) + 0.4 + i * 0.25, from: 'up', dist: 24 });
        });
        // row 3: four levers
        const tL = s(1) + D1 * 0.4;
        pic += show(rowLabel(740, 'Changes', '4 levers'), { at: tL, from: 'left', dist: 30 });
        ['new certificate', 'mapping change', 'revoke', 'block'].forEach((t, i) => {
          pic += show(card({ x: 560 + i * 300, y: 690, w: 285, h: 100, kind: 'plain', title: t, size: 26 }), { at: tL + 0.2 + i * 0.25, from: 'up', dist: 24 });
        });
        // short certificates, tested design
        const tT = s(1) + D1 * 0.75;
        pic += show(chip(560, 880, 'short certificates', { kind: 'good', size: 30 }), { at: tT, from: 'up', dist: 16 });
        pic += show(chip(1000, 880, 'a tested design', { kind: 'good', size: 30 }), { at: tT + 0.5, from: 'up', dist: 16 });
        o += `<g opacity="${dim.toFixed(3)}">${pic}</g>`;
        // end card
        let end = rect(260, 300, 1400, 490, { fill: C.navy, stroke: C.navyDeep, sw: 4, r: 28 });
        end += text(960, 370, 'Principals in depth', { size: 34, anchor: 'middle', fill: '#C9CAE6', weight: 500 });
        end += text(960, 440, 'The principals guide: the full mapping tables', { size: 38, anchor: 'middle', fill: C.white, weight: 700 });
        end += rect(380, 480, 1160, 90, { fill: C.white, stroke: C.orange, sw: 4, r: 16 });
        end += text(960, 526, 'docs/ssh/principals-guide.md', { size: 42, mono: true, anchor: 'middle', fill: C.navy, weight: 700 });
        end += text(960, 626, 'Companion page: every diagram, every command', { size: 30, anchor: 'middle', fill: '#C9CAE6', weight: 500 });
        end += rect(380, 660, 1160, 80, { fill: C.white, stroke: C.line, sw: 3, r: 16 });
        end += text(960, 701, 'docs/ssh/explainer/index.html', { size: 38, mono: true, anchor: 'middle', fill: C.navy, weight: 700 });
        o += show(end, { at: s(2) + 0.1, from: 'pop', cx: 960, cy: 535 });
        return o;
      },
    },
  };
})();
