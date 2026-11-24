// Episode 04 — User certificates: log in with a signed key.
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, terminal, arrow, server, laptop, person, keyCard, lock, stamp, gate, heading, nextCard, mark, ease, prog, clamp } = A;
  const NB = ' ';

  // point inside narration item k, p = 0..1
  const mk = (s, e) => (k, p = 0) => s(k) + p * (e(k) - s(k));

  function win(x, y, w, h, title, mono = false) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.slate, sw: 2.5, r: 14 });
    o += `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v${46 - 14} h${-w} z" fill="${C.mist}"/>`;
    o += `<line x1="${x}" y1="${y + 46}" x2="${x + w}" y2="${y + 46}" stroke="${C.line}" stroke-width="2"/>`;
    o += text(x + 24, y + 24, title, { size: 24, weight: 700, fill: C.slate, mono });
    return o;
  }
  function field(x, y, w, label, value, { mono = false, fill = C.mist, stroke = C.slate, valueFill = C.navy, vs = 26, h = 58 } = {}) {
    return text(x, y, label, { size: 24, weight: 700, fill: C.navy }) +
      rect(x, y + 20, w, h, { fill, stroke, sw: 2, r: 10 }) +
      (value ? text(x + 20, y + 20 + h / 2, value, { size: vs, fill: valueFill, mono }) : '');
  }
  function robot(cx, cy, s = 1) {
    return `<line x1="${cx}" y1="${cy - 44 * s}" x2="${cx}" y2="${cy - 28 * s}" stroke="${C.navy}" stroke-width="${5 * s}"/>` +
      `<circle cx="${cx}" cy="${cy - 48 * s}" r="${7 * s}" fill="${C.orange}"/>` +
      rect(cx - 38 * s, cy - 28 * s, 76 * s, 60 * s, { fill: C.navy, stroke: C.navyDeep, sw: 2, r: 14 * s }) +
      `<circle cx="${cx - 15 * s}" cy="${cy - 2 * s}" r="${8 * s}" fill="${C.greenBright}"/><circle cx="${cx + 15 * s}" cy="${cy - 2 * s}" r="${8 * s}" fill="${C.greenBright}"/>` +
      rect(cx - 26 * s, cy + 38 * s, 52 * s, 26 * s, { fill: C.navy, stroke: C.navyDeep, sw: 2, r: 8 * s });
  }

  EPISODES['04'] = {
    scenes: {
      // ---------------------------------------------------------------- 04.1
      '04.1': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('An identity for Alice');
        const fx = 110, fy = 290;
        o += show(win(fx, fy, 820, 360, 'User certificates  →  New Identity'), { at: 0.2, from: 'left' });
        o += show(field(fx + 32, fy + 92, 756, 'Subject', 'alice@acme.example', { mono: true }), { at: s(0) + 1.2, from: 'none' });
        o += show(chip(fx + 32 + 110, fy + 270, 'Create identity', { kind: 'user', size: 28, anchor: 'middle' }), { at: f(0, 0.6), from: 'none' });
        // identity card
        const ix = 1000, iy = 290;
        const idc = rect(ix, iy, 810, 200, { fill: C.orangeSoft, stroke: C.orange, sw: 3, r: 16 }) + person(ix + 110, iy + 95, { s: 1.0, color: C.navy }) +
          text(ix + 210, iy + 70, 'Alice', { size: 40, weight: 700 }) + text(ix + 210, iy + 118, 'alice@acme.example', { size: 28, mono: true, fill: C.slate }) +
          chip(ix + 210, iy + 160, 'active', { kind: 'good', size: 26 });
        o += show(idc, { at: f(0, 0.8), from: 'pop', cx: ix + 405, cy: iy + 100 });
        // person or robot
        const row = (cx, label, icon) => icon + text(cx, 690, label, { size: 28, weight: 700, anchor: 'middle' });
        o += show(row(1190, 'a person', person(1190, 600, { s: 1.0 })) + row(1540, 'or a robot', robot(1540, 590, 1.1)), { at: s(1) + 0.3, from: 'up' });
        o += show(chip(1365, 790, 'can hold certificates', { kind: 'user', size: 30, anchor: 'middle' }), { at: f(1, 0.6), from: 'up', dist: 16 });
        return o;
      },

      // ---------------------------------------------------------------- 04.2
      '04.2': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('Alice keeps her private key');
        const mx = 110, my = 290, mw = 960, mh = 540;
        o += show(rect(mx, my, mw, mh, { fill: '#EEEFF7', stroke: C.navy, sw: 3, r: 20, dash: '14 10' }) + laptop(mx + 62, my + 50, { s: 0.38 }) +
          text(mx + 120, my + 47, "Alice's laptop", { size: 32, weight: 700 }), { at: 0.2, from: 'left' });
        const term = terminal({
          x: mx + 30, y: my + 100, w: 900, size: 27, title: 'alice@laptop', minLines: 3,
          items: [
            { t: '$ ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519', at: s(0) + 0.4 },
            { t: '$ cat ~/.ssh/id_ed25519.pub', at: f(0, 0.42) },
            { t: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5… alice@laptop', out: true, at: f(0, 0.55), color: C.greenBright },
          ],
        });
        o += show(term.svg, { at: s(0), from: 'up', dist: 20 });
        const py = my + 340;
        const priv = rect(mx + 30, py, 420, 150, { fill: C.mist, stroke: C.slate, sw: 3, r: 14 }) + lock(mx + 90, py + 62, { s: 1.7, color: C.slate }) +
          text(mx + 150, py + 52, 'id_ed25519', { size: 28, weight: 700, mono: true }) + text(mx + 150, py + 94, 'private key', { size: 26, fill: C.slate }) +
          text(mx + 150, py + 126, 'never leaves', { size: 24, fill: C.slate, weight: 700 });
        o += show(priv, { at: f(0, 0.4), from: 'up' });
        const qx = mx + 510;
        o += show(keyCard(qx, py, { w: 420, h: 150, kind: 'user', size: 28, label: 'id_ed25519.pub', sub: 'public key' }), { at: f(0, 0.62), from: 'up' });
        o += show(chip(mx + 240, 880, 'stays on the laptop', { kind: 'file', size: 26, anchor: 'middle' }), { at: s(2), from: 'up', dist: 14 });
        // PKI Manager
        const kx = 1390, ky = 330, kw = 420, kh = 300;
        o += show(rect(kx, ky, kw, kh, { fill: C.white, stroke: C.orange, sw: 3, r: 16 }) + text(kx + kw / 2, ky + 56, 'PKI Manager', { size: 38, weight: 700, anchor: 'middle' }) +
          text(kx + kw / 2, ky + 106, 'pki.acme.example', { size: 26, anchor: 'middle', mono: true, fill: C.slate }), { at: f(0, 0.65), from: 'right' });
        o += arrow({ x1: qx + 430, y1: py + 75, x2: kx - 10, y2: ky + 200, at: f(0, 0.8), d: 0.9, color: C.orange, width: 6, label: 'only the .pub', labelSize: 26 });
        o += show(keyCard(kx + 50, ky + 190, { w: 320, h: 90, kind: 'user', size: 24, label: 'Alice public key', sub: 'ed25519' }), { at: f(0, 0.95), from: 'pop', cx: kx + 210, cy: ky + 235 });
        // accepted key types
        o += show(chip(kx + 100, 700, '✓  Ed25519', { kind: 'good', size: 28, anchor: 'middle' }) + chip(kx + 320, 700, '✓  ECDSA', { kind: 'good', size: 28, anchor: 'middle' }), { at: s(1) + 0.4, from: 'up', dist: 14 });
        o += show(chip(kx + kw / 2, 780, '✕  RSA keys', { kind: 'danger', size: 28, anchor: 'middle' }), { at: f(1, 0.7), from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 04.3
      '04.3': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('Issue the certificate');
        const fx = 110, fy = 290;
        o += show(win(fx, fy, 900, 640, 'Issue Certificate'), { at: 0.2, from: 'left' });
        o += show(field(fx + 32, fy + 90, 836, 'Identity', 'Alice  ·  alice@acme.example'), { at: s(1) + 0.2, from: 'none' });
        o += show(field(fx + 32, fy + 200, 836, 'Public key', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5…', { mono: true, vs: 25 }), { at: f(1, 0.35), from: 'none' });
        o += show(field(fx + 32, fy + 310, 836, 'Principals', '') + chip(fx + 52, fy + 359, 'developers', { kind: 'user', size: 26 }), { at: f(1, 0.7), from: 'none' });
        o += show(field(fx + 32, fy + 420, 836, 'Validity', '') + chip(fx + 52, fy + 469, '7 days', { kind: 'user', size: 26 }), { at: s(2) + 0.2, from: 'none' });
        o += show(chip(fx + 32 + 120, fy + 590, 'Issue certificate', { kind: 'user', size: 28, anchor: 'middle' }), { at: s(2) + 0.6, from: 'none' });
        o += show(text(fx + 460, fy + 469, 'default: one week, on purpose', { size: 26, fill: C.orangeInk, weight: 700 }), { at: s(2) + 1.0, from: 'left', dist: 20 });
        // side panel: principal mapping
        const px = 1070;
        o += show(rect(px, 290, 740, 230, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) + text(px + 30, 332, 'Principal mapping', { size: 28, weight: 700, fill: C.slate }) +
          chip(px + 30, 410, 'developers', { kind: 'user', size: 28 }) + text(px + 245, 410, '→', { size: 36, weight: 700, fill: C.slate, anchor: 'middle' }) +
          chip(px + 285, 410, 'deploy', { kind: 'file', size: 28 }) + text(px + 440, 410, 'on', { size: 28, fill: C.slate }) + chip(px + 488, 410, 'web1', { kind: 'host', size: 28 }) +
          text(px + 30, 480, 'mistakes show up before you issue', { size: 26, fill: C.amber, weight: 700 }), { at: s(3), from: 'right', dist: 50 });
        // key card + stamp
        o += show(keyCard(px, 610, { w: 740, h: 110, kind: 'file', size: 29, label: "Alice's public key", sub: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5…' }), { at: f(3, 0.45), from: 'right' });
        o += stamp(px + 630, 665, { at: f(3, 0.8), kind: 'user', r: 72, label: 'User CA' });
        o += show(chip(px + 370, 790, 'signed by the User CA', { kind: 'user', size: 28, anchor: 'middle' }), { at: f(3, 0.85), from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 04.4
      '04.4': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('Install it next to the key');
        const fx = 110, fy = 300;
        o += show(win(fx, fy, 700, 400, '~/.ssh/', true), { at: 0.2, from: 'left' });
        const row = (i, name, tag, kind) => {
          const y = fy + 70 + i * 100;
          const k = A.KIND[kind];
          const fill = kind === 'user' ? C.orangeSoft : C.mist, stroke = kind === 'user' ? C.orange : C.slate;
          return rect(fx + 30, y, 640, 80, { fill, stroke, sw: 2.5, r: 12 }) + text(fx + 56, y + 40, name, { size: 30, weight: 700, mono: true, fill: kind === 'user' ? C.orangeInk : C.navy }) +
            text(fx + 650, y + 40, tag, { size: 26, anchor: 'end', fill: C.slate }) + (k ? '' : '');
        };
        o += show(row(0, 'id_ed25519', 'private key', 'file'), { at: 0.4, from: 'none' });
        o += show(row(1, 'id_ed25519.pub', 'public key', 'file'), { at: 0.6, from: 'none' });
        o += show(row(2, 'id_ed25519-cert.pub', 'certificate', 'user'), { at: s(0) + 1.0, from: 'right', dist: 260, d: 0.9 });
        o += show(text(fx + 350, 760, 'same name as the key + "-cert.pub"', { size: 26, fill: C.slate, anchor: 'middle' }), { at: f(0, 0.7) });
        o += show(chip(fx + 350, 830, 'ssh sends it automatically', { kind: 'user', size: 28, anchor: 'middle' }), { at: s(1) + 0.2, from: 'up', dist: 14 });
        // config block
        const L = [
          'Host *.acme.example',
          NB + NB + 'IdentityFile ~/.ssh/id_ed25519',
          NB + NB + 'CertificateFile ~/.ssh/id_ed25519-cert.pub',
          NB + NB + 'IdentitiesOnly yes',
        ];
        const cb = code({ x: 880, y: 360, w: 930, size: 28, kind: 'file', title: '~/.ssh/config', lines: L, hl: [{ line: 2, at: f(2, 0.5), color: C.orange, opacity: 0.2 }] });
        o += show(text(880, 322, 'PKI Manager gives her a ready block:', { size: 28, fill: C.slate, weight: 700 }), { at: s(2) });
        o += show(cb.svg, { at: s(2) + 0.3, from: 'right', dist: 50 });
        return o;
      },

      // ---------------------------------------------------------------- 04.5
      '04.5': ({ s, e }) => {
        const f = mk(s, e);
        const now = A.now();
        let o = heading('Read it, then log in');
        const x = 110, y = 280, size = 26;
        const term = terminal({
          x, y, w: 900, size, title: 'alice@laptop', minLines: 6,
          items: [
            { t: '$ ssh-keygen -L -f ~/.ssh/id_ed25519-cert.pub', at: s(0) + 0.3 },
            { t: NB.repeat(4) + 'Type: ssh-ed25519-cert-v01@openssh.com user certificate', out: true, at: s(0) + 2.0 },
            { t: NB.repeat(4) + 'Key ID: "alice@acme.example"', out: true, at: s(0) + 2.0 },
            { t: NB.repeat(4) + 'Valid: from 2026-11-23T10:00:00 to 2026-11-30T10:00:00', out: true, at: s(0) + 2.0 },
            { t: NB.repeat(4) + 'Principals:', out: true, at: s(0) + 2.0 },
            { t: NB.repeat(12) + 'developers', out: true, at: s(0) + 2.0 },
          ],
        });
        o += show(term.svg, { at: 0.2, from: 'up', dist: 20 });
        // highlights + notes aligned with the lines
        const lh = size * 1.45, ly = (row) => y + 46 + 18 + row * lh + size * 0.5;
        const hls = [
          [2, 1, 'Key ID', 'who the key belongs to', f(1, 0.1)],
          [3, 1, 'Valid: from … to …', 'the dates', f(1, 0.4)],
          [4, 2, 'Principals', 'the roles', f(1, 0.7)],
        ];
        hls.forEach(([row, n, , note, at]) => {
          if (now < at) return;
          const p = ease(prog(at, 0.4));
          o += `<rect x="${x + 12}" y="${ly(row) - lh / 2 + 2}" width="${876 * p}" height="${lh * n - 4}" rx="8" fill="${C.orange}" opacity="0.28"/>`;
          o += show(text(x + 930 + 30, ly(row) + (n - 1) * lh / 2, '←  ' + note, { size: 28, weight: 700, fill: C.orangeInk }), { at: at + 0.2, from: 'left', dist: 20 });
        });
        // login
        const my = 800;
        o += show(laptop(230, my, { s: 0.9, label: 'laptop' }), { at: s(2), from: 'left' });
        o += show(server(760, my - 5, { s: 0.9, label: 'web1.acme.example' }), { at: s(2), from: 'up' });
        o += arrow({ x1: 340, y1: my, x2: 690, y2: my, at: s(2) + 0.4, d: 0.8, color: C.orange, width: 6 });
        o += show(text(515, my - 40, 'ssh deploy@web1', { size: 24, mono: true, fill: C.slate, anchor: 'middle' }), { at: s(2) + 0.6 });
        // four checks
        const gx = [1010, 1235, 1460, 1685], gy = 800;
        const labels = ['not revoked', 'signature', 'dates', 'principal'];
        const when = [f(2, 0.5), f(2, 0.64), f(2, 0.78), f(2, 0.9)];
        let g = rect(930, 700, 880, 200, { fill: C.mist, stroke: C.line, sw: 2, r: 14 }) + text(960, 730, 'The server checks', { size: 26, weight: 700, fill: C.slate });
        gx.forEach((cx, i) => { g += gate(cx, gy - 10, { state: now >= when[i] ? 'ok' : 'pending', label: labels[i], r: 34, labelSize: 24 }); });
        o += show(g, { at: f(2, 0.3), from: 'up', dist: 16 });
        o += show(chip(1370, 950, 'authorized_keys: no new line added', { kind: 'good', size: 28, anchor: 'middle', mono: true }), { at: s(3) + 0.2, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 04.6
      '04.6': ({ s, e }) => {
        const f = mk(s, e);
        const now = A.now();
        let o = heading('Next week');
        // calendar: counts 1..7 then day 8
        const flipFrom = s(0) + 0.3, flipTo = f(0, 0.65);
        const p = clamp((now - flipFrom) / (flipTo - flipFrom));
        const day = 1 + Math.floor(7 * ease(p) + 0.0001);
        const cx = 110, cy = 300, cw = 380;
        const expired = now >= flipTo;
        const cal = rect(cx, cy, cw, 400, { fill: C.white, stroke: C.slate, sw: 3, r: 18 }) +
          `<path d="M${cx} ${cy + 18} a18 18 0 0 1 18 -18 h${cw - 36} a18 18 0 0 1 18 18 v70 h${-cw} z" fill="${C.navy}"/>` +
          text(cx + cw / 2, cy + 46, 'one week', { size: 32, weight: 700, fill: C.white, anchor: 'middle' }) +
          text(cx + cw / 2, cy + 200, `Day ${Math.min(day, 8)}`, { size: 88, weight: 700, fill: expired ? C.amber : C.navy, anchor: 'middle' }) +
          [0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${cx + 48 + i * 47}" cy="${cy + 330}" r="15" fill="${i < Math.min(day, 7) ? C.orange : C.line}"/>`).join('');
        o += show(cal, { at: 0.2, from: 'left' });
        // old certificate
        const oc = expired
          ? card({ x: 600, y: 300, w: 520, h: 200, kind: 'ghost', title: 'user certificate', body: ['valid 7 days'], size: 32, bodySize: 26 }) +
            chip(860, 462, 'expired', { kind: 'file', size: 26, anchor: 'middle' })
          : card({ x: 600, y: 300, w: 520, h: 200, kind: 'user', title: 'user certificate', body: ['valid 7 days'], size: 32, bodySize: 26 });
        o += show(oc, { at: 0.4, from: 'none' });
        // new certificate, same key
        o += show(card({ x: 600, y: 540, w: 520, h: 170, kind: 'user', title: 'new user certificate', body: ['valid 7 days'], size: 32, bodySize: 26 }), { at: s(1) + 0.3, from: 'pop', cx: 860, cy: 625 });
        o += show(keyCard(1250, 415, { w: 560, h: 120, kind: 'file', size: 29, label: 'the same public key', sub: 'ssh-ed25519 AAAAC3Nz…' }), { at: s(1) - 0.1, from: 'right' });
        o += arrow({ x1: 1250, y1: 450, x2: 1130, y2: 400, at: s(1) + 0.6, d: 0.5, color: C.slate, width: 4, dashed: true, head: false });
        o += arrow({ x1: 1250, y1: 500, x2: 1130, y2: 620, at: s(1) + 0.8, d: 0.5, color: C.orange, width: 5 });
        // servers do not move
        const sy = 850;
        o += show(server(520, sy, { s: 0.5, label: 'web1', labelSize: 24 }) + server(720, sy, { s: 0.5, label: 'db1', labelSize: 24 }), { at: 0.5, from: 'none' });
        o += show(chip(1080, sy, 'Nothing changes on any server', { kind: 'good', size: 30, anchor: 'middle' }), { at: s(2) + 0.2, from: 'up', dist: 14 });
        o += nextCard('05 Principals', f(3, 0.7));
        return o;
      },
    },
  };
})();
