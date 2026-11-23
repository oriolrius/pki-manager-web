// Episode 01 — Why SSH certificates.
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
// Narration items = script sentences, with sentences under 4 words merged into the next one.
(function () {
  const { C, show, text, rect, card, chip, code, terminal, arrow, server, laptop, person, ca, keyCard, stamp, heading, caption, nextCard, mark, ease, prog, clamp, lerp } = A;

  // shared layout: 5 people x 10 servers
  const P = [0, 1, 2, 3, 4].map((i) => ({ x: 330, y: 300 + i * 150 }));
  const S = Array.from({ length: 10 }, (_, i) => ({ x: i < 5 ? 1390 : 1610, y: 290 + (i % 5) * 150 }));
  const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'];

  function people(o = {}) {
    return P.map((p, i) => person(p.x, p.y, { s: 0.62, label: names[i], labelSize: 22, color: o.grey === i ? C.line : C.navy })).join('');
  }
  function servers(o = {}) {
    return S.map((s, i) => server(s.x, s.y, { s: 0.42, label: `srv${i + 1}`, labelSize: 18, state: o.state?.[i] })).join('');
  }

  EPISODES['01'] = {
    scenes: {
      '01.1': ({ s }) => {
        const term = terminal({
          x: 110, y: 300, w: 1000, size: 28, title: 'alice@laptop',
          items: [
            { t: '$ ssh deploy@web1.acme.example', at: s(0) + 0.3 },
            { t: "The authenticity of host 'web1.acme.example' can't be", out: true, at: s(0) + 1.6 },
            { t: 'established. ED25519 key fingerprint is SHA256:Xk3…', out: true, at: s(0) + 1.6 },
            { t: 'Are you sure you want to continue connecting (yes/no)?', out: true, at: s(0) + 1.6, color: '#FFD08A' },
            { t: '$ yes', at: s(2) + 0.6 },
          ],
        });
        let o = heading('Two daily habits');
        o += show(term.svg, { at: 0.2 });
        const strike = (y, at) => {
          if (A.now() < at) return '';
          const p = ease(prog(at, 0.5));
          return `<line x1="1230" y1="${y}" x2="${1230 + 560 * p}" y2="${y}" stroke="${C.red}" stroke-width="6" stroke-linecap="round"/>`;
        };
        o += show(card({ x: 1230, y: 330, w: 560, h: 120, kind: 'file', title: 'authorized_keys', body: ['a key copied to every server'] }), { at: s(1), from: 'right' });
        o += show(card({ x: 1230, y: 500, w: 560, h: 120, kind: 'file', title: 'yes', body: ['to an unknown fingerprint'] }), { at: s(2), from: 'right' });
        o += strike(390, s(3) + 0.8) + strike(560, s(3) + 1.3);
        o += show(card({ x: 1230, y: 690, w: 560, h: 130, kind: 'user', title: 'SSH certificates', body: ['managed with PKI Manager'] }), { at: s(3) + 1.6, from: 'pop', cx: 1510, cy: 755 });
        return o;
      },

      '01.2': ({ s }) => {
        let o = heading('Problem one: key sprawl');
        // 50 lines, drawn progressively during item 1
        let lines = '';
        P.forEach((p, i) => S.forEach((q, j) => {
          const at = s(1) + (i * 10 + j) * 0.05;
          const leaving = i === 2;
          const survivor = leaving && j === 7;
          let op = 0.55;
          if (leaving && !survivor) op *= 1 - ease(clamp((A.now() - (s(2) + 0.8 + j * 0.15)) / 0.4));
          if (op <= 0.01) return;
          const col = survivor && A.now() > s(3) ? C.red : leaving && A.now() > s(2) ? C.slate : C.orange;
          const w = survivor && A.now() > s(3) ? 6 : 2.2;
          lines += arrow({ x1: p.x + 50, y1: p.y, x2: q.x - 60, y2: q.y, at, d: 0.4, color: col, width: w, head: false, opacity: survivor && A.now() > s(3) ? 1 : op });
        }));
        o += lines;
        o += show(people({ grey: A.now() > s(2) ? 2 : -1 }), { at: 0.1 });
        o += show(servers(), { at: 0.3 });
        o += show(chip(960, 965, '5 people × 10 servers = 50 keys to maintain', { kind: 'file', size: 28, anchor: 'middle' }), { at: s(1) + 1 });
        if (A.now() > s(3)) o += show(chip(1500, 225, 'srv8 still trusts Carol', { kind: 'danger', size: 26, anchor: 'middle' }), { at: s(3) + 0.3, from: 'down' });
        return o;
      },

      '01.3': ({ s }) => {
        let o = heading('Problem two: trust on first use');
        o += show(laptop(420, 520, { label: 'your laptop', s: 1.2 }), { at: 0.1, from: 'left' });
        o += show(server(1500, 510, { label: 'web1.acme.example', s: 1.1 }), { at: 0.3, from: 'right' });
        o += arrow({ x1: 560, y1: 500, x2: 1400, y2: 500, at: s(1), d: 0.9, color: C.slate, width: 5 });
        o += show(mark(980, 500, '?', { r: 46, color: C.amber }), { at: s(1) + 0.9, from: 'pop', cx: 980, cy: 500 });
        o += show(chip(980, 600, 'yes … and hope', { kind: 'warn', size: 28, anchor: 'middle' }), { at: s(2) });
        if (A.now() >= s(3)) {
          o += show(rect(330, 690, 1260, 120, { fill: C.redSoft, stroke: C.red, sw: 3, r: 12 }) +
            text(960, 730, '@@@  WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!  @@@', { size: 30, mono: true, anchor: 'middle', fill: C.red, weight: 700 }) +
            text(960, 775, 'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!', { size: 24, mono: true, anchor: 'middle', fill: '#8E1B1B' }), { at: s(3) + 0.8, from: 'pop', cx: 960, cy: 750 });
        }
        if (A.now() >= s(4)) {
          const p = ease(prog(s(4) + 0.4, 0.6));
          o += show(code({ x: 520, y: 845, w: 880, size: 24, title: '~/.ssh/known_hosts', lines: ['web1.acme.example ecdsa-sha2-nistp256 AAAAE2VjZHNh…'] }).svg +
            `<line x1="540" y1="925" x2="${540 + 840 * p}" y2="925" stroke="${C.red}" stroke-width="5"/>`, { at: s(4) });
        }
        return o;
      },

      '01.4': ({ s }) => {
        let o = heading('The idea: one trusted signer');
        const caX = 860, caY = 590;
        // the old mesh fades away
        if (A.now() < s(1) + 1) {
          const op = 0.4 * (1 - ease(prog(s(0) + 0.5, 1.2)));
          P.forEach((p) => S.forEach((q) => { o += arrow({ x1: p.x + 50, y1: p.y, x2: q.x - 60, y2: q.y, color: C.orange, width: 2, head: false, opacity: op }); }));
        }
        o += show(ca(caX, caY, { r: 105, kind: 'user', label: 'CA', labelSize: 64 }) + text(caX, caY + 140, 'certificate authority', { size: 26, anchor: 'middle', fill: C.orangeInk, weight: 700 }), { at: s(1) + 0.6, from: 'pop', cx: caX, cy: caY });
        // people -> CA (keys travel to be signed)
        P.forEach((p, i) => { o += arrow({ x1: p.x + 55, y1: p.y, x2: caX - 115, y2: caY + (i - 2) * 30, at: s(2) + i * 0.12, d: 0.5, color: C.orange, width: 3 }); });
        // CA -> servers (one trust line each)
        S.forEach((q, j) => { o += arrow({ x1: caX + 110, y1: caY + (j % 5 - 2) * 28, x2: q.x - 60, y2: q.y, at: s(3) + j * 0.08, d: 0.5, color: C.orangeInk, width: 3, head: true }); });
        o += people() + servers();
        o += show(chip(960, 965, '5 people + 10 servers: one line per server, installed once', { kind: 'user', size: 28, anchor: 'middle' }), { at: s(4) });
        return o;
      },

      '01.5': ({ s }) => {
        let o = heading('What is inside a certificate');
        const X = 610, Y = 290, W = 700;
        o += show(keyCard(X, Y, { w: W, h: 100, label: 'Your public key', sub: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5…', size: 30 }), { at: 0.2 });
        const fields = [
          ['Key ID', 'alice@acme.example'],
          ['Principals (roles)', 'developers'],
          ['Valid', '7 days: from … to …'],
          ['Serial', '42'],
        ];
        const broken = A.now() > s(3) + 0.4;
        fields.forEach(([k, v], i) => {
          const at = s(1) + 1 + i * 0.9;
          const y = Y + 125 + i * 92;
          const bad = broken && i === 1;
          o += show(rect(X, y, W, 76, { fill: bad ? C.redSoft : C.mist, stroke: bad ? C.red : C.slate, sw: 2, r: 10 }) +
            text(X + 26, y + 38, k, { size: 28, weight: 700, fill: C.navy }) +
            text(X + W - 26, y + 38, bad ? 'sysadmins' : v, { size: 28, mono: true, anchor: 'end', fill: bad ? C.red : C.navy }), { at, from: 'right', dist: 60 });
        });
        if (!broken) o += stamp(X + W + 40, Y + 330, { at: s(2) + 0.2, kind: 'user', r: 78, label: 'CA' });
        else o += show(`<g transform="translate(${X + W + 40} ${Y + 330}) rotate(-12)">` + ca(0, 0, { r: 78, kind: 'danger', label: '✕', labelSize: 70 }) + '</g>', { at: s(3) + 0.4, from: 'none' }) +
          show(chip(X + W + 40, Y + 450, 'signature broken', { kind: 'danger', size: 26, anchor: 'middle' }), { at: s(3) + 0.6 });
        o += show(text(960, 960, 'Read one:  ssh-keygen -L -f ~/.ssh/id_ed25519-cert.pub', { size: 30, mono: true, anchor: 'middle', fill: C.slate }), { at: s(2) + 1 });
        return o;
      },

      '01.6': ({ s }) => {
        let o = heading('Where PKI Manager fits');
        const bx = 300, by = 300;
        o += show(card({ x: bx, y: by, w: 560, h: 520, kind: 'pki', title: '', body: [] }) + text(bx + 280, by + 60, 'PKI Manager', { size: 44, weight: 700, anchor: 'middle', fill: C.navy }) +
          `<rect x="${bx + 210}" y="${by + 90}" width="140" height="6" rx="3" fill="${C.orange}"/>`, { at: 0.1, from: 'left' });
        o += show(rect(bx + 70, by + 330, 420, 150, { fill: C.navy, stroke: C.navyDeep, sw: 2, r: 14 }) + A.lock(bx + 140, by + 395, { s: 1.2, color: C.orange }) +
          text(bx + 190, by + 380, 'Key management', { size: 28, fill: C.white, weight: 700 }) + text(bx + 190, by + 422, 'CA private keys stay here', { size: 23, fill: '#C9CAE6' }), { at: s(1), from: 'up' });
        o += show(ca(bx + 170, by + 200, { r: 62, kind: 'user', label: 'User CA', labelSize: 22 }) + ca(bx + 390, by + 200, { r: 62, kind: 'host', label: 'Host CA', labelSize: 22 }), { at: s(0) + 0.8, from: 'pop', cx: bx + 280, cy: by + 200 });
        const files = [['host certificate', 'host'], ['user certificate', 'user'], ['sshd config file', 'file'], ['CA public keys', 'file']];
        files.forEach(([f, k], i) => {
          const at = s(2) + 0.8 + i * 0.4;
          const y = 300 + i * 115;
          o += arrow({ x1: bx + 570, y1: by + 260, x2: 1060, y2: y + 40, at, d: 0.5, color: C.slate, width: 3 });
          o += show(card({ x: 1070, y, w: 330, h: 80, kind: k, title: f, size: 26 }), { at: at + 0.4, from: 'left', dist: 30 });
        });
        o += show(server(1660, 470, { label: 'your servers', s: 0.9 }) + laptop(1660, 760, { label: 'your laptops', s: 0.9 }), { at: s(3), from: 'right' });
        o += show(person(1490, 720, { s: 0.5 }) + text(1490, 790, 'you / Ansible', { size: 24, anchor: 'middle', fill: C.navy, weight: 700 }), { at: s(3) + 1.2, from: 'up' });
        o += show(chip(1490, 215 + 30, 'PKI Manager never logs in to your machines', { kind: 'file', size: 26, anchor: 'middle' }), { at: s(3) + 0.4, from: 'down' });
        o += nextCard('02 Two CAs', s(4));
        return o;
      },
    },
  };
})();
