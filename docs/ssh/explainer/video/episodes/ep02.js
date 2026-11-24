// Episode 02 — Two CAs, trust crosses over.
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, chip, code, arrow, server, laptop, ca, lock, heading, nextCard, table, ease, prog } = A;

  // point inside narration item k, p = 0..1
  const mk = (s, e) => (k, p = 0) => s(k) + p * (e(k) - s(k));

  // speech bubble (above its speaker) with a tail pointing down at (tx, ty)
  function bubble(x, y, w, h, tx, ty, sub, kind) {
    const k = A.KIND[kind];
    const bx = Math.max(x + 60, Math.min(x + w - 60, tx)), yb = y + h;
    const body = rect(x, y, w, h, { fill: C.white, stroke: k.stroke, sw: 3, r: 22 });
    const tail = `<path d="M${bx - 26} ${yb} L${tx} ${ty} L${bx + 26} ${yb}" fill="${C.white}" stroke="${k.stroke}" stroke-width="3" stroke-linejoin="round"/>` +
      `<line x1="${bx - 24}" y1="${yb}" x2="${bx + 24}" y2="${yb}" stroke="${C.white}" stroke-width="6"/>`;
    const q = `<text x="${x + w / 2}" y="${y + 50}" font-family="${A.FONT}" font-size="38" font-weight="700" fill="${C.navy}" text-anchor="middle" dominant-baseline="middle">Who are <tspan font-style="italic" fill="${k.stroke}">you</tspan>?</text>`;
    return body + tail + q + text(x + w / 2, y + 98, sub, { size: 27, fill: C.slate, anchor: 'middle' });
  }

  // simple app window: title bar + body
  function win(x, y, w, h, title) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.slate, sw: 2.5, r: 14 });
    o += `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v${46 - 14} h${-w} z" fill="${C.mist}"/>`;
    o += `<line x1="${x}" y1="${y + 46}" x2="${x + w}" y2="${y + 46}" stroke="${C.line}" stroke-width="2"/>`;
    o += text(x + 24, y + 24, title, { size: 24, weight: 700, fill: C.slate });
    return o;
  }
  function field(x, y, w, label, value, { mono = false, fill = C.mist, stroke = C.slate, valueFill = C.navy, vs = 26 } = {}) {
    return text(x, y, label, { size: 24, weight: 700, fill: C.navy }) +
      rect(x, y + 20, w, 58, { fill, stroke, sw: 2, r: 10 }) +
      text(x + 20, y + 49, value, { size: vs, fill: valueFill, mono });
  }

  EPISODES['02'] = {
    scenes: {
      // ---------------------------------------------------------------- 02.1
      '02.1': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('Two questions in every login');
        const LX = 360, LY = 590, SX = 1560, SY = 590;
        o += show(laptop(LX, LY, { s: 1.5, label: 'laptop' }), { at: 0.2, from: 'left' });
        o += show(server(SX, SY, { s: 1.3, label: 'web1.acme.example' }), { at: 0.4, from: 'right' });
        // server asks the user
        o += show(bubble(1000, 290, 440, 140, 1520, 488, 'Is this really Alice?', 'machine'), { at: s(1), from: 'pop', cx: 1520, cy: 488 });
        // laptop asks the server
        o += show(bubble(470, 290, 440, 140, 400, 488, 'Is this really web1?', 'machine'), { at: s(2), from: 'pop', cx: 400, cy: 488 });
        // two separate CAs answer
        o += show(ca(SX, 850, { r: 78, kind: 'user', label: 'User CA' }) + chip(SX, 965, 'vouches for users', { kind: 'user', size: 24, anchor: 'middle' }), { at: s(3), from: 'pop', cx: SX, cy: 850 });
        o += show(ca(LX, 850, { r: 78, kind: 'host', label: 'Host CA' }) + chip(LX, 965, 'vouches for servers', { kind: 'host', size: 24, anchor: 'middle' }), { at: f(3, 0.4), from: 'pop', cx: LX, cy: 850 });
        return o;
      },

      // ---------------------------------------------------------------- 02.2
      '02.2': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('The User CA');
        const caX = 270, y = 540;
        o += show(ca(caX, y, { r: 105, kind: 'user', label: 'User CA' }), { at: 0.2, from: 'pop', cx: caX, cy: y });
        o += show(chip(caX, y + 160, "signs people's keys", { kind: 'user', size: 26, anchor: 'middle' }), { at: s(0) + 0.8 });
        o += show(server(830, y, { s: 1.2, label: 'web1.acme.example' }), { at: 0.5, from: 'right' });
        o += arrow({ x1: caX + 125, y1: y, x2: 735, y2: y, at: s(1), d: 0.9, color: C.orange, width: 6, label: 'public key', labelSize: 26 });
        const c1 = code({ x: 1010, y: 360, w: 800, size: 26, kind: 'user', title: '/etc/ssh/ssh-user-ca.pub', lines: ['ecdsa-sha2-nistp256 AAAAE2Vj… user-ca'] });
        o += show(c1.svg, { at: f(1, 0.3), from: 'left' });
        const c2 = code({ x: 1010, y: 540, w: 800, size: 26, kind: 'file', title: '/etc/ssh/sshd_config.d/60-ssh-ca.conf', lines: ['TrustedUserCAKeys /etc/ssh/ssh-user-ca.pub'], hl: [{ line: 0, at: f(1, 0.75), color: C.orange }] });
        o += show(c2.svg, { at: f(1, 0.65), from: 'left' });
        return o;
      },

      // ---------------------------------------------------------------- 02.3
      '02.3': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('The Host CA');
        const caX = 1650, y = 540, lx = 1070;
        o += show(ca(caX, y, { r: 105, kind: 'host', label: 'Host CA' }), { at: 0.2, from: 'pop', cx: caX, cy: y });
        o += show(chip(caX, y + 160, "signs servers' keys", { kind: 'host', size: 26, anchor: 'middle' }), { at: s(0) + 0.8 });
        o += show(laptop(lx, y, { s: 1.4, label: 'laptop' }), { at: 0.5, from: 'left' });
        o += arrow({ x1: caX - 125, y1: y, x2: lx + 190, y2: y, at: s(1), d: 0.9, color: C.green, width: 6, label: 'public key', labelSize: 26 });
        // known_hosts file
        const fx = 110, fy = 380, size = 24;
        const kh = code({ x: fx, y: fy, w: 790, size, kind: 'host', title: '~/.ssh/known_hosts', lines: ['@cert-authority *.acme.example ecdsa-sha2-nistp256 AAAA…'] });
        o += show(kh.svg, { at: f(1, 0.4), from: 'left' });
        // highlight of the pattern *.acme.example
        if (A.now() >= s(2)) {
          const p = ease(prog(s(2) + 0.1, 0.5));
          const th = Math.round(size * 0.85) * 1.9, ly = fy + th + 22 + size * 0.5;
          const hx = fx + 22 + 16 * size * 0.5, hw = 14 * size * 0.5;
          o += `<rect x="${hx - 6}" y="${ly - 20}" width="${(hw + 12) * p}" height="40" rx="8" fill="${C.greenBright}" opacity="0.4" stroke="${C.green}" stroke-width="2.5"/>`;
          o += show(text(hx + hw / 2, ly + 62, '▲ any server under this domain', { size: 26, weight: 700, fill: C.green, anchor: 'middle' }), { at: s(2) + 0.5, from: 'up', dist: 12 });
          o += show(chip(fx + 150, 620, 'web1.acme.example', { kind: 'good', size: 26, anchor: 'middle', mono: true }) +
            chip(fx + 490, 620, 'db1.acme.example', { kind: 'good', size: 26, anchor: 'middle', mono: true }), { at: f(2, 0.5) });
        }
        return o;
      },

      // ---------------------------------------------------------------- 02.4
      '02.4': ({ s, e }) => {
        const f = mk(s, e);
        let o = heading('Trust crosses over');
        const L = { x: 400 }, R = { x: 1520 };
        const capY = 340, macY = 560;
        o += show(laptop(L.x, macY, { s: 1.2, label: 'laptop' }), { at: 0.1, from: 'left' });
        o += show(server(R.x, macY, { s: 1.0, label: 'web1.acme.example' }), { at: 0.1, from: 'right' });
        o += show(ca(L.x, capY, { r: 72, kind: 'user', label: 'User CA' }), { at: s(0), from: 'pop', cx: L.x, cy: capY });
        o += show(ca(R.x, capY, { r: 72, kind: 'host', label: 'Host CA' }), { at: s(0), from: 'pop', cx: R.x, cy: capY });
        // the X: orange to the server, green to the laptop
        o += arrow({ x1: L.x + 90, y1: capY + 30, x2: R.x - 55, y2: macY - 80, at: s(0) + 0.5, d: 1.1, color: C.orange, width: 7 });
        o += arrow({ x1: R.x - 90, y1: capY + 30, x2: L.x + 100, y2: macY - 75, at: s(0) + 0.9, d: 1.1, color: C.green, width: 7 });
        o += show(chip(R.x, macY + 160, 'holds the User CA key', { kind: 'user', size: 26, anchor: 'middle' }), { at: s(1) + 0.2 });
        o += show(chip(L.x, macY + 160, 'holds the Host CA line', { kind: 'host', size: 26, anchor: 'middle' }), { at: f(1, 0.5) });
        // table
        const tbl = table({
          x: 460, y: 770, cols: ['You install', 'Where', 'So that'], colW: [310, 270, 420], size: 26, rowH: 46,
          rows: [['User CA key', 'every server', 'servers trust users'], ['Host CA line', 'every client', 'clients trust servers']],
          colors: [[C.orangeInk, C.body, C.body], [C.green, C.body, C.body]],
        });
        o += show(tbl, { at: s(2) + 0.2, from: 'up', dist: 24 });
        o += show(chip(960, 965, 'wire only one direction: half of the setup works', { kind: 'warn', size: 26, anchor: 'middle' }), { at: s(2) + 0.6, out: s(3) });
        o += show(chip(700, 965, 'orange goes to servers', { kind: 'user', size: 28, anchor: 'middle' }) + chip(1230, 965, 'green goes to clients', { kind: 'host', size: 28, anchor: 'middle' }), { at: s(3) + 0.5 });
        return o;
      },

      // ---------------------------------------------------------------- 02.5
      '02.5': ({ s, e }) => {
        const f = mk(s, e);
        const now = A.now();
        let o = heading('Creating them', { sub: 'SSH  →  Certificate Authorities  →  Create SSH Certificate Authority' });
        // form
        const fx = 110, fy = 300;
        const isHost = now >= f(0, 0.5);
        let form = win(fx, fy, 790, 500, 'Create SSH Certificate Authority');
        form += field(fx + 32, fy + 96, 726, 'CA Type *', isHost ? 'Host CA — signs host (server) certificates' : 'User CA — signs user login certificates', { fill: isHost ? C.greenSoft : C.orangeSoft, stroke: isHost ? C.green : C.orange });
        form += field(fx + 32, fy + 208, 726, 'Zone *', 'default');
        form += field(fx + 32, fy + 320, 726, 'Label (optional)', isHost ? 'Corp Host CA' : 'Corp User CA');
        form += chip(fx + 32 + 85, fy + 450, 'Create SSH CA', { kind: isHost ? 'host' : 'user', size: 26, anchor: 'middle' });
        o += show(form, { at: 0.2, from: 'left' });
        // list
        const lx = 960, ly = 300;
        let list = win(lx, ly, 850, 270, 'SSH · Certificate Authorities');
        o += show(list, { at: 0.4, from: 'right' });
        const row = (y, kind, label, name) => ca(lx + 62, y, { r: 30, kind, label: kind === 'user' ? 'U' : 'H', labelSize: 30 }) +
          text(lx + 120, y - 2, label, { size: 28, weight: 700, fill: C.navy }) + text(lx + 120 + A.textW(label, 28) + 40, y - 2, name, { size: 26, fill: C.muted }) +
          chip(lx + 760, y, 'active', { kind: 'good', size: 24, anchor: 'middle' });
        o += show(row(ly + 110, 'user', 'User CA', 'Corp User CA'), { at: f(0, 0.4), from: 'right', dist: 30 });
        o += show(row(ly + 195, 'host', 'Host CA', 'Corp Host CA'), { at: f(0, 0.85), from: 'right', dist: 30 });
        // KMS
        const kx = 960, ky = 620;
        const kms = rect(kx, ky, 850, 200, { fill: C.navy, stroke: C.navyDeep, sw: 2, r: 16 }) +
          lock(kx + 90, ky + 90, { s: 1.8, color: C.orange }) +
          text(kx + 170, ky + 64, 'Key management system', { size: 32, weight: 700, fill: C.white }) +
          text(kx + 170, ky + 112, 'CA private keys: generated here,', { size: 27, fill: '#C9CAE6' }) +
          text(kx + 170, ky + 148, 'never exported', { size: 27, fill: '#C9CAE6' });
        o += show(kms, { at: s(1), from: 'up' });
        o += show(arrow({ x1: lx + 425, y1: ly + 285, x2: lx + 425, y2: ky - 6, at: s(1) + 0.3, d: 0.6, color: C.slate, width: 4, dashed: true }), {});
        o += nextCard('03 Host certificates', s(2));
        return o;
      },
    },
  };
})();
