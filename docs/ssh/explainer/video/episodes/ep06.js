// Episode 06 — Lifecycle: expiry, revocation, rotation.
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, move, text, rect, card, chip, code, arrow, server, person, laptop, keyCard, ca, heading, nextCard, mark, ease, prog, clamp, lerp, textW } = A;

  // ---------- shared helpers ----------
  /** Text with bold parts: parts = [str | [str, true]] */
  function rich(x, y, parts, { size = 28, anchor = 'start', fill = C.navy } = {}) {
    const spans = parts.map((p) => {
      const [str, b] = Array.isArray(p) ? p : [p, false];
      return `<tspan font-weight="${b ? 700 : 400}">${A.esc(str)}</tspan>`;
    }).join('');
    return `<text x="${x}" y="${y}" font-family="${A.FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle" xml:space="preserve">${spans}</text>`;
  }
  /** Button (rounded rect + label). */
  function button(x, y, w, h, label, { kind = 'plain', pressed = false, disabled = false, size = 26 } = {}) {
    let fill = C.white, stroke = C.navy, tc = C.navy;
    if (kind === 'danger') { fill = C.red; stroke = C.red; tc = C.white; }
    if (kind === 'primary') { fill = C.navy; stroke = C.navy; tc = C.white; }
    if (pressed) { fill = C.navy; stroke = C.navy; tc = C.white; }
    if (disabled) { fill = C.mist; stroke = C.line; tc = C.muted; }
    return rect(x, y, w, h, { fill, stroke, sw: 2.5, r: 10 }) + text(x + w / 2, y + h / 2 + 1, label, { size, weight: 700, anchor: 'middle', fill: tc });
  }
  /** Window with a navy title bar. */
  function win(x, y, w, h, title, { stroke = C.navy } = {}) {
    return rect(x, y, w, h, { fill: C.white, stroke, sw: 3, r: 16 }) +
      `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${42} h${-w} z" fill="${stroke}"/>` +
      text(x + 30, y + 29, title, { size: 26, weight: 700, fill: C.white });
  }
  /** Analog clock. h, m in degrees (0 = 12 o'clock). */
  function clock(cx, cy, r, { h = 0, m = 0, color = C.navy, fill = C.white } = {}) {
    let o = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${color}" stroke-width="${r * 0.08}"/>`;
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      o += `<line x1="${cx + Math.sin(a) * r * 0.82}" y1="${cy - Math.cos(a) * r * 0.82}" x2="${cx + Math.sin(a) * r * 0.92}" y2="${cy - Math.cos(a) * r * 0.92}" stroke="${color}" stroke-width="${r * 0.04}"/>`;
    }
    const hand = (deg, len, w) => { const a = (deg * Math.PI) / 180; return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.sin(a) * r * len}" y2="${cy - Math.cos(a) * r * len}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`; };
    return o + hand(h, 0.5, r * 0.07) + hand(m, 0.75, r * 0.05) + `<circle cx="${cx}" cy="${cy}" r="${r * 0.07}" fill="${color}"/>`;
  }
  /** Envelope with a lock. */
  function envelope(cx, cy, { w = 150, h = 100, color = C.navy } = {}) {
    const x = cx - w / 2, y = cy - h / 2;
    return rect(x, y, w, h, { fill: C.white, stroke: color, sw: 3.5, r: 10 }) +
      `<path d="M${x + 6} ${y + 8} L${cx} ${cy + 8} L${x + w - 6} ${y + 8}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round"/>` +
      A.lock(cx, cy + h * 0.2, { s: 0.9, color: C.green });
  }
  const greyCa = (cx, cy, r, label, sub) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.line}" stroke="${C.slate}" stroke-width="4"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="none" stroke="${C.white}" stroke-width="2.5" stroke-dasharray="6 6"/>` +
    text(cx, cy - 10, label, { size: r * 0.32, weight: 700, fill: C.slate, anchor: 'middle' }) + text(cx, cy + r * 0.3, sub, { size: r * 0.2, fill: C.slate, anchor: 'middle' });
  const certMini = (x, y, w, h, title, sub, { kind = 'user' } = {}) => card({ x, y, w, h, kind, title, body: sub ? [sub] : [], size: 28, bodySize: 22, r: 12, sw: 2.5 });

  EPISODES['06'] = {
    scenes: {
      // ---------------------------------------------------------------- 06.1
      '06.1': ({ s, e }) => {
        let o = heading('Tier one: expiry');
        const t1on = A.now() >= s(1);
        const l1 = 'Tier 1 — short lifetime (primary)';
        o += show(chip(110, 290, l1, { kind: t1on ? 'user' : 'ghost', size: 26 }), { at: s(0) + 0.1 });
        o += show(chip(110 + textW(l1, 26) + 31 + 30, 290, 'Tier 2 — emergency stop', { kind: 'ghost', size: 26 }), { at: s(0) + 0.5 });
        // bars
        const x0 = 110, bw = 1000, sw = bw / 7;
        const m = ease(prog(s(3) + 0.3, 4.0));
        const fade = 1 - 0.65 * ease(clamp((m - 0.8) / 0.2));
        let ub = '';
        ub += text(x0, 345, 'User certificate: 1 week', { size: 30, weight: 700, fill: C.orangeInk });
        for (let i = 0; i < 7; i++) ub += `<g opacity="${i === 6 ? fade : 1}">` + rect(x0 + i * sw + 2, 375, sw - 4, 70, { fill: C.orange, stroke: C.orangeInk, sw: 2, r: 8 }) + '</g>' + text(x0 + i * sw + sw / 2, 482, `Day ${i + 1}`, { size: 24, anchor: 'middle', fill: C.slate });
        o += show(ub, { at: s(2) });
        if (A.now() >= s(2)) o += show(text(x0 + bw - 30, 345, '7 days', { size: 28, anchor: 'end', fill: C.orangeInk, weight: 700 }), { at: s(2) + 0.2 });
        // marker
        if (A.now() >= s(3) + 0.3) {
          const mx = x0 + bw * m;
          o += `<line x1="${mx}" y1="362" x2="${mx}" y2="460" stroke="${C.navy}" stroke-width="5"/>` + `<path d="M${mx - 12} 350 h24 l-12 16 z" fill="${C.navy}"/>`;
          if (m > 0.9) o += text(x0 + bw - 6, 520, 'expired', { size: 26, anchor: 'end', fill: C.slate, weight: 700 });
        }
        // host bar
        o += show(text(x0, 560, 'Host certificate: 1 year', { size: 30, weight: 700, fill: C.green }) +
          rect(x0, 585, bw, 70, { fill: C.green, stroke: '#0A7C58', sw: 2, r: 8 }) + text(x0 + bw / 2, 621, '365 days', { size: 28, anchor: 'middle', fill: C.white, weight: 700 }), { at: s(2) + (e(2) - s(2)) * 0.5 });
        // disable identity dialog
        const dx = 1190, dy = 330, dw = 630, dh = 330;
        const press = A.now() >= e(3) - 1.4 && A.now() < e(3) - 0.9;
        o += show(win(dx, dy, dw, dh, 'Disable identity?') +
          text(dx + 30, dy + 100, 'It will no longer be able to', { size: 28 }) + text(dx + 30, dy + 140, 'receive new certificates.', { size: 28 }) +
          button(dx + dw - 440, dy + dh - 90, 190, 58, 'Cancel') + button(dx + dw - 230, dy + dh - 90, 200, 58, 'Disable', { kind: 'primary', pressed: press }), { at: s(3) + 0.3, from: 'left' });
        // warning
        o += show(card({ x: 110, y: 740, w: 1700, h: 150, kind: 'warn', title: 'Old authorized_keys entries still work', body: ['→ remove them first, before you rely on expiry'], size: 36, bodySize: 30 }), { at: s(4), from: 'up' });
        return o;
      },

      // ---------------------------------------------------------------- 06.2
      '06.2': ({ s, e }) => {
        let o = heading('Tier two: the revocation list');
        const px = 110, py = 300, pw = 600, ph = 420;
        let kp = rect(px, py, pw, ph, { fill: C.redSoft, stroke: C.red, sw: 3, r: 16 });
        kp += `<path d="M${px} ${py + 16} a16 16 0 0 1 16 -16 h${pw - 32} a16 16 0 0 1 16 16 v${44} h${-pw} z" fill="${C.red}"/>`;
        kp += text(px + 30, py + 30, 'KRL — key revocation list', { size: 28, weight: 700, fill: C.white });
        [['revoked key  SHA256:Qm7…', 0], ['revoked serial  17', 1]].forEach(([l, i]) => {
          kp += rect(px + 24, py + 76 + i * 70, pw - 48, 56, { fill: C.white, stroke: C.line, sw: 2, r: 10 }) + text(px + 46, py + 104 + i * 70, l, { size: 26, mono: true, fill: C.slate });
        });
        o += show(kp, { at: s(0) + 0.3, from: 'left' });
        o += show(chip(px + pw / 2, 270, 'Tier 2 — emergency stop', { kind: 'danger', size: 26, anchor: 'middle' }), { at: s(0) + 1.2 });
        // certificate dropped in
        const cx0 = px + 24, cy0 = py + 76 + 2 * 70 + 6;
        const cardSvg = certMini(cx0, cy0, pw - 48, 110, 'alice@acme.example', 'serial 42 · user certificate');
        o += move(show(cardSvg, { at: s(1) }), { at: s(1), d: 1.0, dy: -190 });
        if (A.now() >= s(1) + 1.1) o += show(chip(px + pw / 2, cy0 + 150, 'revoked', { kind: 'danger', size: 26, anchor: 'middle' }), { at: s(1) + 1.1, from: 'none' });
        // server side
        const sx = 1000, sw = 820, sy = 300;
        o += show(rect(sx, sy, sw, 300, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) +
          `<path d="M${sx} ${sy + 16} a16 16 0 0 1 16 -16 h${sw - 32} a16 16 0 0 1 16 16 v${44} h${-sw} z" fill="${C.navy}"/>` +
          text(sx + 30, sy + 30, 'web1.acme.example', { size: 28, weight: 700, fill: C.white, mono: true }) +
          code({ x: sx + 24, y: sy + 70, w: sw - 48, size: 26, title: '/etc/ssh/revoked_keys', lines: ['serial 17', 'serial 42  (alice@acme.example)'], lineAt: [null, s(2) + 1.8] }).svg +
          text(sx + 30, sy + 262, 'sshd_config:', { size: 24, fill: C.slate }) + text(sx + 180, sy + 262, 'RevokedKeys /etc/ssh/revoked_keys', { size: 26, mono: true, weight: 700 }), { at: s(2) - 0.2, from: 'right' });
        o += arrow({ x1: px + pw + 10, y1: py + 230, x2: sx - 10, y2: sy + 150, at: s(2), d: 0.9, color: C.red, width: 5, label: 'the file', labelSize: 26 });
        o += show(chip(sx + sw / 2, 640, 'sshd reads it on every login: no reload', { kind: 'good', size: 26, anchor: 'middle' }), { at: s(2) + 1.0 });
        // gate
        if (A.now() >= s(2) + 1.2) {
          const bad = A.now() >= s(2) + 2.4;
          o += show(A.gate(1130, 800, { state: bad ? 'bad' : 'ok', r: 44, label: 'not revoked', labelSize: 26 }) +
            text(1210, 790, 'alice@acme.example', { size: 30, weight: 700 }) + text(1210, 832, bad ? 'login rejected' : 'login check…', { size: 28, fill: bad ? C.red : C.slate, weight: 500 }), { at: s(2) + 1.2, from: 'up', dist: 20 });
        }
        return o;
      },

      // ---------------------------------------------------------------- 06.3
      '06.3': ({ s, e }) => {
        let o = heading('Getting the list to the servers');
        const sx = 1580, sy = 400;
        o += show(card({ x: 110, y: 300, w: 400, h: 200, kind: 'pki', title: 'PKI Manager', body: ['holds the KRL'], size: 36, bodySize: 28 }), { at: 0.2, from: 'left' });
        // s0: no push
        const push = arrow({ x1: 540, y1: 340, x2: 1250, y2: 340, at: s(0) + 0.3, d: 0.9, color: C.line, width: 6, dashed: true });
        o += push;
        if (A.now() >= s(0) + 1.2) o += show(mark(900, 340, '✕', { r: 34, color: C.amber }) + text(900, 400, 'no push', { size: 28, anchor: 'middle', fill: C.amber, weight: 700 }), { at: s(0) + 1.2, from: 'pop', cx: 900, cy: 340 });
        // s1: each server pulls
        o += show(server(sx, sy, { s: 1.0, label: 'web1.acme.example', labelSize: 26 }), { at: s(1), from: 'right' });
        o += show(chip(sx, 330 - 80, 'krl-client', { kind: 'good', size: 26, anchor: 'middle', mono: true }), { at: s(1) + 0.8, from: 'up', dist: 14 });
        o += arrow({ x1: 1250, y1: 450, x2: 540, y2: 450, at: s(1) + 0.5, d: 1.0, color: C.navy, width: 5, label: 'pull', labelSize: 28 });
        // s2: clock ~15 min
        if (A.now() >= s(2)) {
          const a = (A.now() - s(2)) * 90;
          o += show(clock(1450, 575, 44, { h: 0, m: a, color: C.navy }) + text(1450, 640, '~15 min', { size: 28, anchor: 'middle', weight: 700 }), { at: s(2), from: 'pop', cx: 1450, cy: 575 });
        }
        // s3: envelope
        if (A.now() >= s(3)) {
          const D = e(3) - s(3);
          const p = ease(prog(s(3) + 0.3, Math.max(2.2, D * 0.45)));
          const ex = lerp(620, 1250, p);
          o += show(envelope(ex, 530, { w: 130, h: 90 }), { at: s(3) + 0.1, from: 'none' });
          o += show(text(930, 610, "encrypted to this host's ECDSA key", { size: 28, anchor: 'middle', fill: C.green, weight: 700 }), { at: s(3) + 0.6 });
        }
        // s4: signature check then install
        if (A.now() >= s(4)) {
          o += show(A.gate(150, 730, { state: 'ok', r: 34 }) + text(205, 715, 'Host CA signature checked', { size: 28, weight: 700 }) +
            text(205, 757, '/etc/ssh/ssh-host-ca.pub', { size: 26, mono: true, fill: C.green, weight: 700 }), { at: s(4), from: 'left', dist: 30 });
          o += arrow({ x1: 640, y1: 735, x2: 880, y2: 735, at: s(4) + 1.2, d: 0.6, color: C.green, width: 5, label: 'then', labelSize: 26 });
          o += show(card({ x: 900, y: 680, w: 800, h: 110, kind: 'good', title: '/etc/ssh/revoked_keys', body: ['installed'], size: 30, bodySize: 26 }), { at: s(4) + 1.8, from: 'up', dist: 20 });
        }
        // s5: grey secondary path
        o += show(card({ x: 110, y: 830, w: 1700, h: 120, kind: 'ghost', title: 'Simpler: cron + curl /krl/<userCaId>.bin', body: ['no signature check · no per-host blocks'], size: 30, bodySize: 26, dash: '10 8' }), { at: s(5), from: 'up', dist: 20 });
        return o;
      },

      // ---------------------------------------------------------------- 06.4
      '06.4': ({ s, e }) => {
        const D0 = e(0) - s(0), D1 = e(1) - s(1), D3 = e(3) - s(3);
        const tClick = s(0) + D0 * 0.6;
        const tConfirm = s(1) + D1 * 0.5;
        const tFall = tConfirm + 0.4;
        const tDis = tFall + 1.2;
        let o = heading('When someone leaves, when a server goes');
        // ---------- phase 1 (user) ----------
        const iy = 290;
        let p1 = '';
        const disabled = A.now() >= tDis;
        p1 += rect(110, iy, 760, 560, { fill: C.white, stroke: disabled ? C.line : C.orange, sw: 3, r: 16 });
        p1 += text(140, iy + 50, 'alice@acme.example', { size: 34, weight: 700, fill: disabled ? C.muted : C.navy });
        p1 += chip(640, iy + 50, disabled ? 'disabled' : 'active', { kind: disabled ? 'ghost' : 'good', size: 24 });
        p1 += text(140, iy + 120, 'User certificates', { size: 26, fill: C.slate, weight: 700 });
        const fallen = A.now() >= tFall;
        const slot = (i) => ({ x: 140, y: iy + 150 + i * 115 });
        for (let i = 0; i < 2; i++) {
          const q = slot(i);
          if (!fallen) p1 += certMini(q.x, q.y, 440, 95, `serial ${42 + i}`, `developers · ${5 - i * 2} days left`);
          else p1 += rect(q.x, q.y, 440, 95, { fill: 'none', stroke: C.line, sw: 2, r: 12, dash: '8 8' });
        }
        if (fallen) p1 += text(360, iy + 150 + 2 * 115 + 20, 'no active certificates', { size: 24, fill: C.muted, anchor: 'middle' });
        const btnY = iy + 470;
        const pressO = A.now() >= tClick && A.now() < tClick + 0.5;
        if (!disabled) p1 += button(140, btnY, 170, 60, 'Issue', { disabled });
        if (!disabled) p1 += button(330, btnY, 190, 60, 'Disable', { disabled });
        if (!disabled) p1 += button(540, btnY, 200, 60, 'Offboard', { pressed: pressO, disabled });
        o += show(p1, { at: 0.2, out: s(3) - 0.1, outD: 0.5 });
        // dialog
        const dx = 960, dy = 290, dw = 860, dh = 520;
        if (A.now() >= s(1) && A.now() < tConfirm + 0.8) {
          const pressC = A.now() >= tConfirm && A.now() < tConfirm + 0.5;
          const rn = 'left the company';
          const typed = rn.slice(0, Math.max(0, Math.floor((A.now() - (s(1) + D1 * 0.2)) * 30)));
          let d = win(dx, dy, dw, dh, 'Offboard alice@acme.example?');
          d += rich(dx + 34, dy + 110, ['This revokes ', ['2 active certificates', true], ' of'], { size: 28 });
          d += rich(dx + 34, dy + 150, [['alice@acme.example', true], ' and ', ['disables the identity', true], '.'], { size: 28 });
          d += text(dx + 34, dy + 215, '• Both certificates go on the KRL', { size: 26 });
          d += text(dx + 34, dy + 255, '• No new certificates can be issued', { size: 26 });
          d += text(dx + 34, dy + 295, '• This cannot be undone', { size: 26, weight: 700, fill: C.red });
          d += text(dx + 34, dy + 360, 'Reason', { size: 24, fill: C.slate, weight: 700 });
          d += rect(dx + 34, dy + 380, dw - 68, 56, { fill: C.mist, stroke: C.line, sw: 2, r: 10 }) + text(dx + 52, dy + 409, typed, { size: 26 });
          d += button(dx + dw - 450, dy + dh - 66, 190, 52, 'Cancel') + button(dx + dw - 240, dy + dh - 66, 210, 52, 'Offboard', { kind: 'danger', pressed: false });
          if (pressC) d += rect(dx + dw - 240, dy + dh - 66, 210, 52, { fill: '#8E1B1B', stroke: '#8E1B1B', sw: 2.5, r: 10 }) + text(dx + dw - 135, dy + dh - 39, 'Offboard', { size: 26, weight: 700, anchor: 'middle', fill: C.white });
          o += show(d, { at: s(1) + 0.15, from: 'left', out: tConfirm + 0.4, outD: 0.4 });
        }
        // KRL panel with falling cards
        if (A.now() >= tConfirm + 0.5) {
          let k = rect(dx, dy, dw, 330, { fill: C.redSoft, stroke: C.red, sw: 3, r: 16 }) +
            `<path d="M${dx} ${dy + 16} a16 16 0 0 1 16 -16 h${dw - 32} a16 16 0 0 1 16 16 v${44} h${-dw} z" fill="${C.red}"/>` +
            text(dx + 30, dy + 30, 'KRL', { size: 28, weight: 700, fill: C.white });
          let cards = '';
          for (let i = 0; i < 2; i++) {
            const q = slot(i);
            const rx = dx + 30 + i * 0, ry = dy + 75 + i * 110;
            cards += move(certMini(rx, ry, 440, 95, `serial ${42 + i}`, `developers · revoked`), { at: tFall + i * 0.25, d: 1.0, dx: q.x - rx, dy: q.y - ry });
          }
          k += cards;
          k += text(dx + 530, dy + 140, '← revoked', { size: 28, fill: C.red, weight: 700 });
          o += show(k, { at: tConfirm + 0.5, from: 'none', out: s(3) - 0.1, outD: 0.5 });
        }
        if (A.now() >= tDis) o += show(chip(dx + dw / 2, dy + 400, 'identity disabled · cannot be undone', { kind: 'file', size: 28, anchor: 'middle' }), { at: tDis, out: s(3) - 0.1, outD: 0.5 });
        // disable alone
        o += show(chip(110, 910, 'Disable alone: no new certificates, nothing revoked', { kind: 'warn', size: 26 }), { at: s(2), from: 'up', dist: 14, out: s(3) - 0.1, outD: 0.5 });
        if (A.now() >= s(2) + 0.2 && A.now() < s(3)) {
          o += `<rect x="${330 - 6}" y="${iy + 470 - 6}" width="202" height="72" rx="14" fill="none" stroke="${C.amber}" stroke-width="4"/>`;
        }

        // ---------- phase 2 (host) ----------
        if (A.now() >= s(3) + 0.2) {
          const hx = 110, hy = 290, hw = 880, hh = 340;
          const tClick2 = s(3) + D3 * 0.7;
          const tOff = s(4) + 0.4;
          const done = A.now() >= tOff + 0.9;
          let h = rect(hx, hy, hw, hh, { fill: C.white, stroke: done ? C.line : C.navy, sw: 3, r: 16 });
          h += text(hx + 34, hy + 50, 'old-db', { size: 38, weight: 700, mono: true, fill: done ? C.muted : C.navy });
          h += chip(hx + 220, hy + 50, done ? 'offboarded' : 'active', { kind: done ? 'ghost' : 'good', size: 24 });
          h += button(hx + hw - 230, hy + 22, 200, 56, 'Offboard', { pressed: A.now() >= tClick2 && A.now() < tClick2 + 0.5, disabled: done });
          h += text(hx + 34, hy + 120, 'Principal mappings', { size: 26, fill: C.slate, weight: 700 });
          const rowsOp = 1 - ease(prog(tOff, 0.8));
          if (rowsOp > 0.01) {
            h += `<g opacity="${rowsOp}">` + ['old-db · developers → deploy', 'old-db · sysadmins → root'].map((r, i) =>
              rect(hx + 34, hy + 150 + i * 84, hw - 68, 66, { fill: C.orangeSoft, stroke: C.orange, sw: 2, r: 10 }) + text(hx + 58, hy + 183 + i * 84, r, { size: 28, mono: true, weight: 700 })).join('') + '</g>';
          } else h += text(hx + hw / 2, hy + 230, 'no mappings', { size: 28, fill: C.muted, anchor: 'middle' });
          o += show(h, { at: s(3) + 0.2, from: 'up', dist: 30 });
          if (done) o += show(chip(hx + hw / 2, hy + hh + 50, 'No more certificates for this host', { kind: 'file', size: 28, anchor: 'middle' }), { at: tOff + 0.9 });
          // s5: shredder
          if (A.now() >= s(5)) {
            const kx = 1060, ky = 330;
            const q = ease(prog(s(5) + 0.9, 1.6));
            const kc = keyCard(kx, ky, { w: 700, h: 110, label: 'Host key', sub: '/etc/ssh/ssh_host_ecdsa_key', kind: 'host', size: 30 });
            o += show(`<clipPath id="shclip"><rect x="1000" y="300" width="800" height="178"/></clipPath><g clip-path="url(#shclip)"><g transform="translate(0 ${q * 150})">${kc}</g></g>`, { at: s(5), from: 'right' });
            // shredder
            const shx = 1180, shy = 480;
            let sh = rect(shx, shy, 460, 100, { fill: C.slate, stroke: C.navyDeep, sw: 3, r: 14 }) + rect(shx + 40, shy + 18, 380, 14, { fill: C.navyDeep, stroke: 'none', sw: 0, r: 7 }) +
              `<circle cx="${shx + 420}" cy="${shy + 62}" r="9" fill="${C.greenBright}"/>`;
            for (let i = 0; i < 14; i++) {
              const len = 14 + q * (60 + (i % 4) * 14);
              sh += rect(shx + 30 + i * 28, shy + 100, 14, len, { fill: C.green, stroke: 'none', sw: 0, r: 3 });
            }
            o += show(sh, { at: s(5) + 0.2, from: 'up', dist: 20 });
            o += show(card({ x: 1060, y: 710, w: 700, h: 100, kind: 'good', title: "Destroy the server's host key", body: [], size: 32 }), { at: s(5) + 1.5, from: 'up', dist: 20 });
            o += show(chip(1060, 860, 'Laptops do not check the KRL', { kind: 'warn', size: 28 }), { at: s(5) + 2.5, from: 'up', dist: 14 });
          }
        }
        return o;
      },

      // ---------------------------------------------------------------- 06.5
      '06.5': ({ s, e }) => {
        let o = heading('Rotating a CA');
        const D1 = e(1) - s(1), D3 = e(3) - s(3);
        const retireAt = s(3) + Math.min(D3 * 0.7, 3.2);
        const retired = A.now() >= retireAt;
        // old CA
        o += show(retired ? greyCa(260, 390, 85, 'User CA', 'old') : ca(260, 390, { r: 85, kind: 'user', label: 'User CA', sub: 'old', labelSize: 30 }), { at: 0.2, from: 'pop', cx: 260, cy: 390 });
        if (A.now() >= s(1)) o += show(chip(260, 510, retired ? 'old — retired' : 'old — rotating', { kind: retired ? 'ghost' : 'user', size: 26, anchor: 'middle' }), { at: s(1) + 0.1, from: 'none' });
        // new CA
        o += show(ca(260, 700, { r: 85, kind: 'user', label: 'User CA', sub: 'new', labelSize: 30 }), { at: s(1) + 0.4, from: 'pop', cx: 260, cy: 700 });
        o += show(chip(260, 820, 'new — active', { kind: 'user', size: 26, anchor: 'middle' }), { at: s(1) + 1.0 });
        // old certificates
        const tExp = s(3) + 2.2;
        [0, 1, 2].forEach((i) => {
          const op = 1 - ease(prog(tExp + i * 0.25, 0.6));
          if (op > 0.01) o += show(`<g opacity="${op}">${certMini(400, 330 + i * 70, 280, 60, 'old certificate', null)}</g>`, { at: s(0) + 0.8 + i * 0.3, from: 'left', dist: 30 });
        });
        // trust file on the server
        const px = 760, py = 300, pw = 1060;
        o += show(rect(px, py, pw, 270, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) +
          `<path d="M${px} ${py + 16} a16 16 0 0 1 16 -16 h${pw - 32} a16 16 0 0 1 16 16 v${44} h${-pw} z" fill="${C.navy}"/>` +
          text(px + 30, py + 30, 'web1.acme.example', { size: 28, weight: 700, fill: C.white, mono: true }) +
          code({ x: px + 24, y: py + 70, w: pw - 48, size: 26, title: '/etc/ssh/ssh-user-ca.pub', lines: ['ssh-ed25519 AAAAC3Nz… user-ca-old', 'ssh-ed25519 AAAAC3Nz… user-ca-new'], lineAt: [null, s(2) + 0.4], hl: [{ line: 1, at: s(2) + 0.4, color: C.orange, opacity: 0.18 }] }).svg, { at: s(1) + 1.2, from: 'right' });
        // new certificate vs the server
        const tNew = s(1) + D1 * 0.5;
        o += arrow({ x1: 360, y1: 700, x2: 940, y2: 700, at: tNew, d: 1.0, color: C.orange, width: 5, label: 'new certificate', labelSize: 26 });
        if (A.now() >= tNew + 1.0) {
          const ok = A.now() >= s(2) + 1.6;
          o += show(A.gate(1000, 700, { state: ok ? 'ok' : 'bad', r: 40 }) +
            text(1070, 700, ok ? 'accepted: both keys are trusted' : 'rejected: new CA is not in the trust file', { size: 28, weight: 700, fill: ok ? C.green : C.red }), { at: tNew + 1.0, from: 'right', dist: 30 });
        }
        // calendar
        if (A.now() >= s(3)) {
          const day = Math.min(8, 1 + Math.floor(ease(prog(s(3) + 0.2, 2.2)) * 7.99));
          o += show(rect(1280, 770, 540, 180, { fill: C.white, stroke: C.navy, sw: 3, r: 14 }) + `<path d="M1280 784 a14 14 0 0 1 14 -14 h512 a14 14 0 0 1 14 14 v36 h-540 z" fill="${C.navy}"/>` +
            text(1550, 790, 'Calendar', { size: 26, weight: 700, fill: C.white, anchor: 'middle' }) +
            text(1550, 860, `Day ${day}`, { size: 60, weight: 700, anchor: 'middle' }) +
            text(1550, 920, day >= 8 ? 'all old certificates expired' : 'old certificates expiring…', { size: 26, anchor: 'middle', fill: day >= 8 ? C.green : C.slate, weight: 500 }), { at: s(3), from: 'up', dist: 20 });
        }
        return o;
      },

      // ---------------------------------------------------------------- 06.6
      '06.6': ({ s, e }) => {
        let o = heading('Clocks');
        // clocks
        const real = clock(260, 450, 110, { h: 0, m: 0, color: C.navy });
        const drift = A.now() * 30;
        const wrong = clock(640, 450, 110, { h: 100 + drift / 10, m: 200 + drift, color: C.amber, fill: C.amberSoft });
        o += show(real + text(260, 600, 'real time', { size: 28, anchor: 'middle', weight: 700 }), { at: 0.3, from: 'pop', cx: 260, cy: 450 });
        o += show(wrong + text(640, 600, 'server clock: drifting', { size: 28, anchor: 'middle', weight: 700, fill: C.amber }), { at: s(0) + 0.6, from: 'pop', cx: 640, cy: 450 });
        // certificate that flickers
        const valid = A.now() < s(2) ? true : Math.floor(A.now() * 2.4) % 2 === 0;
        const cx0 = 960, cy0 = 330, cw = 560;
        const k = valid ? { fill: C.orangeSoft, stroke: C.orange } : { fill: C.redSoft, stroke: C.red };
        o += show(rect(cx0 + 0, cy0, cw, 210, { fill: k.fill, stroke: k.stroke, sw: 4, r: 16 }) +
          text(cx0 + 30, cy0 + 50, "Alice's certificate", { size: 32, weight: 700 }) + text(cx0 + 30, cy0 + 100, 'valid until 10:00', { size: 28, mono: true, fill: C.slate }) +
          chip(cx0 + 30, cy0 + 160, valid ? 'valid' : 'expired', { kind: valid ? 'good' : 'danger', size: 30 }), { at: s(2), from: 'right' });
        if (A.now() >= s(2) + 0.1) o += show(text(cx0 + cw + 30, cy0 + 105, '?', { size: 90, weight: 700, fill: C.amber }), { at: s(2) + 0.5, from: 'none' });
        // NTP
        o += show(chip(110, 700, 'NTP / chrony on every server', { kind: 'plain', size: 28 }), { at: s(1) });
        o += show(chip(110, 770, 'NTP / chrony on every laptop', { kind: 'plain', size: 28 }), { at: s(1) + 0.5 });
        // terminal
        const tm = A.terminal({
          x: 960, y: 640, w: 860, size: 26, title: 'web1.acme.example',
          items: [{ t: '$ timedatectl', at: s(3) }, { t: 'System clock synchronized: yes', out: true, at: s(3) + 1.2, color: '#7DE0B8' }, { t: 'NTP service: active', out: true, at: s(3) + 1.2 }],
        });
        o += show(tm.svg, { at: s(3) - 0.1 });
        o += nextCard('07 Per-host blocks', s(3) + 1.5);
        return o;
      },
    },
  };
})();
