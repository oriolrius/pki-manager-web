// Episode 10 — Recap and troubleshooting.
(function () {
  const { C, KIND, show, text, rect, card, chip, code, terminal, arrow, server, laptop, ca, gate, mark, heading, ease, prog, lerp, clamp } = A;
  /** SVG collapses spaces: keep indentation / alignment with no-break spaces. */
  const nb = (l) => l.replace(/ /g, ' ');

  EPISODES['10'] = {
    scenes: {
      // ---------------------------------------------------------------
      '10.1': ({ s }) => {
        let o = heading('The setup in six steps');
        const steps = [
          { t: 'Create the CAs', sub: ['User CA + Host CA'], fill: 'split', a: C.orange, b: C.green },
          { t: 'Hand out trust', sub: ['User CA → servers', 'Host CA → laptops'], fill: 'split', a: C.orange, b: C.green },
          { t: 'Enrol each host', sub: ['host certificates'], fill: 'one', a: C.green },
          { t: 'Principals', sub: ['map to accounts'], fill: 'one', a: C.slate },
          { t: 'User certificates', sub: ['matching principals'], fill: 'one', a: C.orange },
          { t: 'End access', sub: ['short lifetimes', 'KRL when urgent'], fill: 'split', a: C.amber, b: C.red },
        ];
        const W = 270, G = 15, X0 = 120, BOT = 985;
        steps.forEach((st, i) => {
          const x = X0 + i * (W + G);
          const top = 810 - i * 85;
          const h = BOT - top;
          let g = '';
          if (st.fill === 'split') {
            g += `<path d="M${x} ${top + 14} a14 14 0 0 1 14 -14 h${W / 2 - 14} v${h} h${-W / 2} z" fill="${st.a}"/>`;
            g += `<path d="M${x + W / 2} ${top} h${W / 2 - 14} a14 14 0 0 1 14 14 v${h - 14} h${-W / 2} z" fill="${st.b}"/>`;
          } else {
            g += rect(x, top, W, h, { fill: st.a, stroke: 'none', sw: 0, r: 14 });
          }
          g += `<circle cx="${x + 38}" cy="${top + 42}" r="24" fill="${C.white}"/>` + text(x + 38, top + 44, String(i + 1), { size: 30, weight: 700, anchor: 'middle', fill: C.navy });
          g += text(x + 18, top + 100, st.t, { size: 27, weight: 700, fill: C.white });
          st.sub.forEach((l, j) => { g += text(x + 18, top + 140 + j * 32, l, { size: 24, fill: C.white }); });
          o += show(g, { at: s(i + 1) + 0.05, from: 'up', dist: 70, d: 0.6 });
        });
        return o;
      },

      // ---------------------------------------------------------------
      '10.2': ({ s }) => {
        let o = heading('Asks about the fingerprint?');
        o += show(card({ x: 110, y: 270, w: 880, h: 130, kind: 'warn', title: 'Symptom', body: ['Are you sure you want to continue connecting?'], size: 28, bodySize: 26, mono: true }), { at: s(1) + 0.1 });
        o += show(card({ x: 110, y: 440, w: 880, h: 100, kind: 'danger', title: 'The laptop does not trust the Host CA', size: 28 }), { at: s(2) + 0.1 });
        const kh = code({
          x: 110, y: 580, w: 880, size: 24, title: '~/.ssh/known_hosts', kind: 'file',
          lines: [nb('@cert-authority *.acme.example ecdsa-sha2-nistp256 AAAA…')],
          hl: [{ line: 0, at: s(3) + 0.8, color: C.green, opacity: 0.25 }],
        });
        o += show(kh.svg, { at: s(3) + 0.1 });
        o += show(text(110, 580 + kh.h + 34, 'the pattern must match the server name', { size: 26, fill: C.slate, weight: 500 }), { at: s(3) + 1.2 });
        // right: exact name
        o += show(rect(1040, 270, 770, 640, { fill: C.white, stroke: C.line, sw: 3, r: 16 }) +
          text(1070, 318, 'Pattern', { size: 24, fill: C.muted }) + text(1070, 360, '*.acme.example', { size: 34, mono: true, weight: 700, fill: C.green }), { at: s(3) + 0.3 });
        const rows = [
          ['ssh deploy@web1.acme.example', 'the exact name in the certificate', true],
          ['ssh deploy@10.0.0.5', 'an IP address does not match', false],
          ['ssh deploy@web1', 'a short name does not match', false],
        ];
        rows.forEach(([cmd, why, ok], i) => {
          const y = 440 + i * 150;
          o += show(rect(1070, y, 710, 125, { fill: ok ? C.greenSoft : C.redSoft, stroke: ok ? C.green : C.red, sw: 2.5, r: 12 }) +
            text(1096, y + 44, cmd, { size: 28, mono: true, weight: 700 }) + text(1096, y + 90, why, { size: 24, fill: C.slate }) +
            mark(1730, y + 62, ok ? '✓' : '✕', { r: 28, color: ok ? C.green : C.red }), { at: s(4) + 0.2 + i * 0.7, from: 'left', dist: 40 });
        });
        return o;
      },

      // ---------------------------------------------------------------
      '10.3': ({ s }) => {
        let o = heading('Permission denied, certificate valid');
        const t0 = terminal({ x: 110, y: 270, w: 1700, size: 26, title: 'alice@laptop', items: [
          { t: '$ ssh deploy@web1.acme.example', at: s(0) + 0.1 },
          { t: 'Permission denied (publickey).', out: true, at: s(0) + 1.3, color: '#FF8A8A' },
        ] });
        o += show(t0.svg, { at: s(0) });
        const ty = 270 + t0.h + 40;
        const tk = terminal({ x: 110, y: ty, w: 820, size: 24, title: 'ssh-keygen -L', items: [
          { t: '$ ssh-keygen -L -f ~/.ssh/id_ed25519-cert.pub', at: s(1) + 0.2 },
          { t: 'Key ID: "alice@acme.example"', out: true, at: s(1) + 1.6 },
          { t: 'Valid: from … to …', out: true, at: s(1) + 1.6 },
          { t: 'Principals: developers', out: true, at: s(1) + 1.6, color: '#FFB27A', bold: true },
        ], minLines: 4 });
        o += show(tk.svg, { at: s(1) });
        // right: principals file (empty)
        const pf = code({ x: 1000, y: ty, w: 810, size: 24, title: '/etc/ssh/auth_principals/deploy', kind: 'file', lines: [{ text: nb('(empty)'), color: C.red }, ' ', ' '], hl: [{ line: 0, at: s(2) + 0.8, color: C.red, opacity: 0.18 }] });
        o += show(pf.svg, { at: s(2) });
        o += show(mark(965, ty + tk.h / 2, '≠', { r: 30, color: C.red }), { at: s(2) + 1.0, from: 'pop', cx: 965, cy: ty + tk.h / 2 });
        o += show(text(1405, ty + pf.h + 36, 'no principal matches → denied', { size: 26, weight: 700, fill: C.red, anchor: 'middle' }), { at: s(2) + 1.4 });
        // stale
        const sy = ty + Math.max(tk.h, pf.h) + 90;
        o += show(rect(110, sy, 1700, 100, { fill: C.amberSoft, stroke: C.amber, sw: 3, r: 14 }) +
          text(140, sy + 50, 'Also check the host status:', { size: 28, weight: 500, fill: '#6B4000' }) +
          chip(720, sy + 50, 'web1 · Stale — needs push', { kind: 'warn', size: 28 }) +
          text(1290, sy + 50, 'deploy the files again', { size: 26, fill: '#6B4000' }), { at: s(3) + 0.2, from: 'up' });
        return o;
      },

      // ---------------------------------------------------------------
      '10.4': ({ s }) => {
        let o = heading('Other quick checks');
        const W = 540, H = 520, Y = 280;
        const colX = [110, 690, 1270];
        const panel = (x, kind, symptom, body, at) => {
          const k = KIND[kind];
          let g = rect(x, Y, W, H, { fill: C.white, stroke: C.line, sw: 3, r: 18 });
          g += rect(x + 20, Y + 20, W - 40, 110, { fill: k.fill, stroke: k.stroke, sw: 3, r: 14 });
          symptom.forEach((l, i) => { g += text(x + W / 2, Y + 75 + (i - (symptom.length - 1) / 2) * 36, l, { size: 28, weight: 700, anchor: 'middle', fill: k.text }); });
          g += `<path d="M${x + W / 2} ${Y + 142} v36" stroke="${C.slate}" stroke-width="4"/><path d="M${x + W / 2 - 12} ${Y + 168} l12 14 l12 -14" fill="none" stroke="${C.slate}" stroke-width="4"/>`;
          g += body;
          return show(g, { at, from: 'up' });
        };
        o += panel(colX[0], 'danger', ['all key logins denied', 'for every user'],
          text(colX[0] + W / 2, Y + 235, 'the revocation file is', { size: 26, anchor: 'middle', fill: C.slate }) +
          text(colX[0] + W / 2, Y + 270, 'missing or unreadable', { size: 26, anchor: 'middle', fill: C.slate }) +
          rect(colX[0] + 20, Y + 320, W - 40, 80, { fill: C.mist, stroke: C.slate, sw: 2, r: 10 }) +
          text(colX[0] + W / 2, Y + 361, '/etc/ssh/revoked_keys', { size: 26, mono: true, weight: 700, anchor: 'middle' }), s(0) + 0.1);
        o += panel(colX[1], 'warn', ['expired too early', 'or not valid yet'],
          text(colX[1] + W / 2, Y + 235, 'check the clocks', { size: 26, anchor: 'middle', fill: C.slate }) +
          rect(colX[1] + 20, Y + 320, W - 40, 80, { fill: C.mist, stroke: C.slate, sw: 2, r: 10 }) +
          text(colX[1] + W / 2 + 20, Y + 361, 'NTP', { size: 34, mono: true, weight: 700, anchor: 'middle' }) +
          `<g>` + `<circle cx="${colX[1] + 110}" cy="${Y + 360}" r="22" fill="${C.white}" stroke="${C.navy}" stroke-width="3.5"/><path d="M${colX[1] + 110} ${Y + 345} V${Y + 360} L${colX[1] + 122} ${Y + 366}" fill="none" stroke="${C.navy}" stroke-width="3.5" stroke-linecap="round"/>` + `</g>`, s(2) + 0.1);
        o += panel(colX[2], 'plain', ['anything else', 'debug'],
          text(colX[2] + 30, Y + 225, 'laptop', { size: 24, fill: C.muted }) +
          rect(colX[2] + 20, Y + 245, W - 40, 62, { fill: C.mist, stroke: C.slate, sw: 2, r: 10 }) + text(colX[2] + W / 2, Y + 277, 'ssh -v', { size: 28, mono: true, weight: 700, anchor: 'middle' }) +
          text(colX[2] + 30, Y + 345, 'server', { size: 24, fill: C.muted }) +
          rect(colX[2] + 20, Y + 365, W - 40, 62, { fill: C.mist, stroke: C.slate, sw: 2, r: 10 }) + text(colX[2] + W / 2, Y + 397, 'journalctl -u ssh', { size: 28, mono: true, weight: 700, anchor: 'middle' }) +
          text(colX[2] + W / 2, Y + 458, '(RHEL: -u sshd)', { size: 24, mono: true, anchor: 'middle', fill: C.slate }), s(3) + 0.8);
        o += show(chip(960, 900, 'they tell you which check failed', { kind: 'host', size: 30, anchor: 'middle' }), { at: s(4) + 0.2 });
        return o;
      },

      // ---------------------------------------------------------------
      '10.5': ({ s }) => {
        const dim = 1 - ease(prog(s(3) - 0.2, 0.6));
        let o = heading('One CA, short lifetimes, one tool');
        let panels = '';
        const W = 530, Y = 280, H = 520, X = [110, 695, 1280];
        // P1: one CA (episodes 01-02)
        let p1 = rect(X[0], Y, W, H, { fill: C.white, stroke: C.line, sw: 3, r: 18 });
        p1 += text(X[0] + W / 2, Y + 50, 'One CA', { size: 34, weight: 700, anchor: 'middle' });
        p1 += ca(X[0] + 150, Y + 175, { r: 60, kind: 'user', label: 'User CA', labelSize: 22 }) + ca(X[0] + 380, Y + 175, { r: 60, kind: 'host', label: 'Host CA', labelSize: 22 });
        p1 += server(X[0] + 400, Y + 345, { s: 0.55, label: 'servers', labelSize: 22 }) + laptop(X[0] + 130, Y + 345, { s: 0.6, label: 'laptops', labelSize: 22 });
        p1 += arrow({ x1: X[0] + 175, y1: Y + 225, x2: X[0] + 385, y2: Y + 320, color: C.orange, width: 5, at: 0, d: 0.01 });
        p1 += arrow({ x1: X[0] + 355, y1: Y + 225, x2: X[0] + 150, y2: Y + 320, color: C.green, width: 5, at: 0, d: 0.01 });
        p1 += text(X[0] + W / 2, Y + 465, 'instead of hundreds of keys', { size: 26, anchor: 'middle', fill: C.slate });
        panels += show(p1, { at: s(0) + 0.1, from: 'up' });
        // P2: short lifetimes (four gates from episode 04)
        let p2 = rect(X[1], Y, W, H, { fill: C.white, stroke: C.line, sw: 3, r: 18 });
        p2 += text(X[1] + W / 2, Y + 50, 'Short lifetimes', { size: 34, weight: 700, anchor: 'middle' });
        p2 += chip(X[1] + W / 2, Y + 125, 'valid 7 days', { kind: 'user', size: 28, anchor: 'middle' });
        const gl = ['not revoked', 'signature', 'dates', 'principal'];
        gl.forEach((l, i) => {
          const gx = X[1] + 75 + (i % 2) * 245, gy = Y + 235 + Math.floor(i / 2) * 105;
          p2 += gate(gx, gy, { state: 'ok', r: 28 }) + text(gx + 42, gy + 2, l, { size: 24, weight: 500 });
        });
        p2 += text(X[1] + W / 2, Y + 465, 'instead of cleanup', { size: 26, anchor: 'middle', fill: C.slate });
        panels += show(p2, { at: s(1) + 0.1, from: 'up' });
        // P3: PKI Manager signs, tracks, generates
        let p3 = rect(X[2], Y, W, H, { fill: C.white, stroke: C.line, sw: 3, r: 18 });
        p3 += text(X[2] + W / 2, Y + 50, 'PKI Manager', { size: 34, weight: 700, anchor: 'middle' });
        p3 += chip(X[2] + 120, Y + 115, 'sign', { kind: 'user', size: 26, anchor: 'middle' }) + chip(X[2] + 265, Y + 115, 'track', { kind: 'machine', size: 26, anchor: 'middle' }) + chip(X[2] + 425, Y + 115, 'generate', { kind: 'host', size: 26, anchor: 'middle' });
        [['host certificates', 'host'], ['user certificates', 'user'], ['principals files', 'file'], ['sshd config', 'file']].forEach(([l, k], i) => {
          p3 += card({ x: X[2] + 40, y: Y + 165 + i * 66, w: W - 80, h: 54, kind: k, title: l, size: 24, r: 12, sw: 2.5 });
        });
        p3 += text(X[2] + W / 2, Y + 465, 'every file, generated', { size: 26, anchor: 'middle', fill: C.slate });
        panels += show(p3, { at: s(2) + 0.1, from: 'up' });
        o += `<g opacity="${dim.toFixed(3)}">${panels}</g>`;
        // end card: the companion page
        let end = rect(260, 330, 1400, 340, { fill: C.navy, stroke: C.navyDeep, sw: 4, r: 28 });
        end += text(960, 400, 'SSH certificates with PKI Manager', { size: 34, anchor: 'middle', fill: '#C9CAE6', weight: 500 });
        end += text(960, 475, 'Companion page: every diagram, every command', { size: 36, anchor: 'middle', fill: C.white, weight: 700 });
        end += rect(380, 530, 1160, 90, { fill: C.white, stroke: C.orange, sw: 4, r: 16 });
        end += text(960, 576, 'docs/ssh/explainer/index.html', { size: 42, mono: true, anchor: 'middle', fill: C.navy, weight: 700 });
        o += show(end, { at: s(3) + 0.1, from: 'pop', cx: 960, cy: 500 });
        o += show(chip(480, 790, 'one CA', { kind: 'user', size: 32, anchor: 'middle' }) + chip(960, 790, 'short lifetimes', { kind: 'warn', size: 32, anchor: 'middle' }) + chip(1440, 790, 'PKI Manager', { kind: 'machine', size: 32, anchor: 'middle' }), { at: s(3) + 0.6 });
        return o;
      },
    },
  };
})();
