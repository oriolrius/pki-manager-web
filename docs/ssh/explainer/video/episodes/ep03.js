// Episode 03 — Host certificates: no more "fingerprint?" prompt.
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, terminal, arrow, server, laptop, ca, keyCard, lock, stamp, heading, nextCard, mark, ease, prog } = A;

  // point inside narration item k, p = 0..1
  const mk = (s, e) => (k, p = 0) => s(k) + p * (e(k) - s(k));

  // simple app window: title bar + body
  function win(x, y, w, h, title) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.slate, sw: 2.5, r: 14 });
    o += `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v${46 - 14} h${-w} z" fill="${C.mist}"/>`;
    o += `<line x1="${x}" y1="${y + 46}" x2="${x + w}" y2="${y + 46}" stroke="${C.line}" stroke-width="2"/>`;
    o += text(x + 24, y + 24, title, { size: 24, weight: 700, fill: C.slate });
    return o;
  }
  function field(x, y, w, label, value, { mono = false, fill = C.mist, stroke = C.slate, valueFill = C.navy, vs = 26, h = 58 } = {}) {
    return text(x, y, label, { size: 24, weight: 700, fill: C.navy }) +
      rect(x, y + 20, w, h, { fill, stroke, sw: 2, r: 10 }) +
      text(x + 20, y + 20 + h / 2, value, { size: vs, fill: valueFill, mono });
  }

  EPISODES['03'] = {
    scenes: {
      // ---------------------------------------------------------------- 03.1
      '03.1': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('The key stays on the server');
        // machine boundary
        const mx = 110, my = 290, mw = 960, mh = 500;
        const box = rect(mx, my, mw, mh, { fill: '#EEEFF7', stroke: C.navy, sw: 3, r: 20, dash: '14 10' }) +
          server(mx + 52, my + 48, { s: 0.36 }) +
          text(mx + 98, my + 47, 'web1.acme.example', { size: 32, weight: 700, mono: true, fill: C.navy });
        o += show(box, { at: s(0) + 0.3, from: 'left' });
        // terminal inside
        const term = terminal({
          x: mx + 30, y: my + 100, w: 900, size: 27, title: 'root@web1',
          items: [
            { t: '$ cat /etc/ssh/ssh_host_ecdsa_key.pub', at: s(2) + 0.3 },
            { t: 'ecdsa-sha2-nistp256 AAAAE2VjZHNh… root@web1', out: true, at: s(2) + 1.8, color: C.greenBright },
          ],
          minLines: 2,
        });
        o += show(term.svg, { at: s(2), from: 'up', dist: 20 });
        // private key: locked, stays
        const px = mx + 30, py = my + 300;
        const priv = rect(px, py, 420, 150, { fill: C.mist, stroke: C.slate, sw: 3, r: 14 }) + lock(px + 60, py + 62, { s: 1.7, color: C.slate }) +
          text(px + 120, py + 52, 'ssh_host_ecdsa_key', { size: 26, weight: 700, mono: true }) +
          text(px + 120, py + 94, 'private key', { size: 26, fill: C.slate }) +
          text(px + 120, py + 126, 'never leaves', { size: 24, fill: C.slate, weight: 700 });
        o += show(priv, { at: s(1) + 0.5, from: 'up' });
        // public key card
        const qx = mx + 510, qy = my + 300;
        o += show(keyCard(qx, qy, { w: 420, h: 150, kind: 'host', size: 26, label: 'ssh_host_ecdsa_key.pub', sub: 'public key' }), { at: s(2) + 1.8, from: 'up' });
        // PKI Manager on the right
        const kx = 1390, ky = 330, kw = 420, kh = 330;
        o += show(rect(kx, ky, kw, kh, { fill: C.white, stroke: C.orange, sw: 3, r: 16 }) + text(kx + kw / 2, ky + 56, 'PKI Manager', { size: 38, weight: 700, anchor: 'middle' }) + text(kx + kw / 2, ky + 106, 'pki.acme.example', { size: 26, anchor: 'middle', mono: true, fill: C.slate }), { at: s(3) - 0.2, from: 'right' });
        o += arrow({ x1: qx + 420 + 10, y1: qy + 75, x2: kx - 10, y2: ky + 190, at: s(3) + 0.2, d: 1.0, color: C.green, width: 6, label: 'only the .pub', labelSize: 26 });
        o += show(keyCard(kx + 50, ky + 200, { w: 320, h: 90, kind: 'host', size: 24, label: 'host public key', sub: 'ecdsa' }), { at: f(3, 0.85), from: 'pop', cx: kx + 210, cy: ky + 245 });
        o += show(chip(kx + kw / 2, 760, 'ECDSA only', { kind: 'host', size: 28, anchor: 'middle' }), { at: s(4) });
        o += show(text(kx + kw / 2, 820, 'episode 6 shows why', { size: 26, fill: C.slate, anchor: 'middle' }), { at: s(4) + 0.4 });
        return o;
      },

      // ---------------------------------------------------------------- 03.2
      '03.2': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('Register and issue');
        const fx = 110, fy = 290;
        o += show(win(fx, fy, 820, 540, 'Hosts  →  Register host'), { at: 0.2, from: 'left' });
        o += show(field(fx + 32, fy + 92, 756, 'FQDN', 'web1.acme.example', { mono: true }), { at: s(0) + 0.6, from: 'none' });
        o += show(field(fx + 32, fy + 204, 756, 'Public key', 'ecdsa-sha2-nistp256 AAAAE2VjZHNh…', { mono: true, vs: 25 }), { at: f(0, 0.55), from: 'none' });
        const cb = rect(fx + 32, fy + 336, 44, 44, { fill: C.green, stroke: C.green, sw: 2, r: 8 }) + text(fx + 54, fy + 360, '✓', { size: 32, weight: 700, fill: C.white, anchor: 'middle' }) +
          text(fx + 96, fy + 359, 'Issue a host certificate immediately', { size: 27, fill: C.navy });
        o += show(cb, { at: f(0, 0.8), from: 'none' });
        o += show(chip(fx + 32 + 100, fy + 460, 'Register host', { kind: 'host', size: 28, anchor: 'middle' }), { at: f(0, 0.9), from: 'none' });
        // refused
        o += show(chip(fx + 150, 890, '✕  private keys', { kind: 'danger', size: 26, anchor: 'middle' }) + chip(fx + 520, 890, '✕  any other key type', { kind: 'danger', size: 26, anchor: 'middle' }), { at: s(1) + 0.3, from: 'up', dist: 16 });
        // key -> stamp -> certificate
        const rx = 1000;
        o += show(keyCard(rx, 300, { w: 810, h: 100, kind: 'file', size: 29, label: 'host public key', sub: 'ecdsa-sha2-nistp256 AAAAE2VjZHNh…' }), { at: s(2) - 0.2, from: 'right' });
        o += stamp(rx + 720, 350, { at: s(2) + 0.5, kind: 'host', r: 66, label: 'Host CA' });
        o += arrow({ x1: rx + 405, y1: 410, x2: rx + 405, y2: 500, at: s(2) + 1.1, d: 0.6, color: C.green, width: 5 });
        o += show(card({
          x: rx, y: 510, w: 810, h: 250, kind: 'good', align: 'left', size: 34, bodySize: 28, mono: true, title: 'host certificate',
          body: ['principals: web1.acme.example', 'valid: 52 weeks', 'signed by: Host CA'],
        }), { at: s(2) + 1.5, from: 'up' });
        o += show(chip(rx + 210, 850, 'ssh web1.acme.example  ✓', { kind: 'good', size: 26, anchor: 'middle', mono: true }) + chip(rx + 600, 850, 'ssh web1  ✕', { kind: 'danger', size: 26, anchor: 'middle', mono: true }), { at: s(3) + 0.4, from: 'up', dist: 16 });
        o += show(text(rx + 405, 920, 'clients must use the exact name in the certificate', { size: 26, fill: C.slate, anchor: 'middle' }), { at: s(3) + 0.9 });
        return o;
      },

      // ---------------------------------------------------------------- 03.3
      '03.3': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('The deploy bundle');
        const px = 110, py = 290;
        let panel = win(px, py, 520, 500, 'Host · web1.acme.example');
        panel += field(px + 30, py + 90, 460, 'FQDN', 'web1.acme.example', { mono: true, vs: 25 });
        panel += field(px + 30, py + 200, 460, 'Certificate', 'host cert · 52 weeks', { vs: 25 });
        panel += rect(px + 30, py + 330, 460, 120, { fill: C.orangeSoft, stroke: C.orange, sw: 3, r: 12 }) +
          text(px + 260, py + 372, 'Files to place', { size: 30, weight: 700, anchor: 'middle', fill: C.navy }) +
          text(px + 260, py + 412, 'on this server', { size: 30, weight: 700, anchor: 'middle', fill: C.navy });
        o += show(panel, { at: 0.2, from: 'left' });
        const files = [
          ['host', 'host certificate', '/etc/ssh/ssh_host_ecdsa_key-cert.pub', 0.12],
          ['user', 'User CA public key', '/etc/ssh/ssh-user-ca.pub', 0.28],
          ['host', 'Host CA public key', '/etc/ssh/ssh-host-ca.pub', 0.36],
          ['file', 'sshd config file', '/etc/ssh/sshd_config.d/60-ssh-ca.conf', 0.5],
          ['file', 'principals files', '/etc/ssh/auth_principals/<account>', 0.66],
          ['file', 'creates the revocation file', 'sudo install -m 0444 /dev/null /etc/ssh/revoked_keys', 0.82],
        ];
        files.forEach(([kind, title, path, p], i) => {
          const y = 290 + i * 106;
          o += show(card({ x: 700, y, w: 1110, h: 94, kind, align: 'left', size: 26, bodySize: 26, mono: true, title, body: [path] }), { at: f(1, p), from: 'left', dist: 140 });
        });
        return o;
      },

      // ---------------------------------------------------------------- 03.4
      '03.4': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('The config file, line by line');
        const x = 110, y = 290, size = 28;
        const L = [
          '# Managed by PKI Manager SSH CA (host web1.acme.example)',
          'HostKey /etc/ssh/ssh_host_ecdsa_key',
          'HostCertificate /etc/ssh/ssh_host_ecdsa_key-cert.pub',
          'TrustedUserCAKeys /etc/ssh/ssh-user-ca.pub',
          'AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u',
          'RevokedKeys /etc/ssh/revoked_keys',
        ];
        const c = code({
          x, y, w: 900, size, kind: 'file', title: '/etc/ssh/sshd_config.d/60-ssh-ca.conf', lines: L,
          hl: [
            { line: 1, at: s(1), color: C.green, opacity: 0.22 },
            { line: 2, at: s(2), color: C.green, opacity: 0.22 },
            { line: 3, at: s(3), color: C.orange, opacity: 0.22 },
            { line: 4, at: s(4), color: C.slate, opacity: 0.2 },
            { line: 5, at: s(5), color: C.slate, opacity: 0.2 },
          ],
        });
        o += show(c.svg, { at: 0.2, from: 'left' });
        // numbered explanations, aligned with the lines
        const th = Math.round(size * 0.85) * 1.9, lh = size * 1.42;
        const ly = (i) => y + th + 22 + i * lh + size * 0.5;
        const notes = [
          [1, 'the host key', C.green, s(1)],
          [2, 'show this certificate to clients', C.green, s(2)],
          [3, 'trust users signed by the User CA', C.orangeInk, s(3)],
          [4, 'allowed roles for each account', C.slate, s(4)],
          [5, 'refuse revoked keys', C.slate, s(5)],
        ];
        notes.forEach(([n, label, col, at]) => {
          o += show(mark(1080, ly(n), String(n), { r: 20, color: col }) + text(1116, ly(n) + 1, label, { size: 28, weight: 700, fill: col }), { at, from: 'left', dist: 30 });
        });
        o += show(chip(110, 700, 'revoked_keys must exist, even empty', { kind: 'warn', size: 28 }), { at: s(6), from: 'up', dist: 16 });
        o += show(chip(110, 770, 'missing file: sshd refuses every key login', { kind: 'danger', size: 28 }), { at: s(7), from: 'up', dist: 16 });
        // footnote
        const fn = code({ x: 110, y: 840, w: 900, size: 26, kind: 'file', title: '/etc/ssh/sshd_config  (main file)', lines: ['Include /etc/ssh/sshd_config.d/*.conf'] });
        o += show(fn.svg, { at: s(0) + 1.2, from: 'up', dist: 16 });
        o += show(text(1060, 905, 'must contain this line (default on current distributions)', { size: 26, fill: C.slate }), { at: s(0) + 1.6 });
        return o;
      },

      // ---------------------------------------------------------------- 03.5
      '03.5': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('Test, then reload');
        o += show(card({ x: 110, y: 290, w: 1000, h: 130, kind: 'good', align: 'left', size: 32, bodySize: 27, title: 'First: give clients the Host CA line', body: ['one @cert-authority line in known_hosts'] }), { at: s(0), from: 'left' });
        o += show(chip(1450, 355, 'this server now shows only its ECDSA key', { kind: 'warn', size: 26, anchor: 'middle' }), { at: f(0, 0.6), from: 'right', dist: 30 });
        const tOut = Math.min(s(1) + 4.6, e(1) - 1.0);
        const term = terminal({
          x: 110, y: 470, w: 1500, size: 28, title: 'root@web1', minLines: 3,
          items: [
            { t: '$ sudo install -m 0444 /dev/null /etc/ssh/revoked_keys', at: s(1) + 0.1 },
            { t: '$ sudo sshd -t && sudo systemctl reload ssh\u00A0\u00A0\u00A0\u00A0\u00A0# RHEL: sshd', at: s(1) + 1.9 },
            { t: 'config OK · reloaded', out: true, at: tOut, color: C.greenBright },
          ],
        });
        o += show(term.svg, { at: s(1) - 0.1, from: 'up', dist: 20 });
        o += show(mark(1730, 600, '✓', { r: 54, color: C.green }), { at: tOut + 0.1, from: 'pop', cx: 1730, cy: 600 });
        o += show(chip(960, 780, 'reload, not restart: open sessions stay up', { kind: 'good', size: 30, anchor: 'middle' }), { at: tOut + 0.4, from: 'up', dist: 16 });
        return o;
      },

      // ---------------------------------------------------------------- 03.6
      '03.6': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('The client side');
        const x = 110, y = 280, size = 26;
        const term = terminal({
          x, y, w: 1500, size, title: 'alice@laptop', minLines: 4,
          items: [
            { t: '$ curl "https://pki.acme.example/ssh/zones/default/cert-authority?pattern=*.acme.example" \\', at: s(0) + 0.5 },
            { t: '\u00A0\u00A0\u00A0\u00A0>> ~/.ssh/known_hosts', at: s(0) + 3.3 },
            { t: '$ ssh deploy@web1.acme.example', at: s(2) + 0.2 },
            { t: 'deploy@web1:~$', out: true, at: s(2) + 1.6, color: C.greenBright },
          ],
        });
        o += show(term.svg, { at: 0.2, from: 'up', dist: 20 });
        // highlight the public URL
        if (A.now() >= s(1)) {
          const p = ease(prog(s(1) + 0.1, 0.6));
          const hx = x + 22 + size + 6 * size * 0.5, hw = 80 * size * 0.5, hy = y + 46 + 18 + size * 0.5;
          o += `<rect x="${hx - 4}" y="${hy - 19}" width="${(hw + 8) * p}" height="38" rx="8" fill="${C.greenBright}" opacity="0.3" stroke="${C.greenBright}" stroke-width="2"/>`;
          o += show(chip(hx + hw / 2, 545, '▲  public address', { kind: 'good', size: 26, anchor: 'middle' }), { at: s(1) + 0.5, from: 'up', dist: 12 });
        }
        // handshake picture
        const my = 740;
        o += show(laptop(330, my, { s: 1.0, label: 'laptop' }), { at: s(2) - 0.3, from: 'left' });
        o += show(server(1590, my - 10, { s: 0.9, label: 'web1.acme.example' }), { at: s(2) - 0.3, from: 'right' });
        o += arrow({ x1: 1490, y1: my, x2: 580, y2: my, at: s(2) + 0.6, d: 1.0, color: C.green, width: 6, label: 'host certificate', labelSize: 26 });
        const ok = A.now() >= s(2) + 2.0;
        o += show(ok ? mark(1035, my - 130, '✓', { r: 44, color: C.green }) : mark(1035, my - 130, '?', { r: 44, color: C.amber }), { at: s(2) + 1.0, from: 'pop', cx: 1035, cy: my - 130 });
        if (ok) o += show(text(1035 + 70, my - 130, 'green stamp: trusted', { size: 28, weight: 700, fill: C.green }), { at: s(2) + 2.0, from: 'left', dist: 20 });
        o += show(chip(700, 950, 'rebuilt server · new key signed · still no warning', { kind: 'good', size: 26, anchor: 'middle' }), { at: s(3) + 0.2, from: 'up', dist: 16 });
        o += nextCard('04 User certificates', f(3, 0.8));
        return o;
      },
    },
  };
})();
