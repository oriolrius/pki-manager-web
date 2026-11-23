// Episode 07 — Per-host access blocks.
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, move, text, rect, card, chip, code, arrow, server, person, keyCard, heading, nextCard, mark, ease, prog, clamp, lerp, textW } = A;

  // ---------- shared helpers ----------
  function button(x, y, w, h, label, { kind = 'plain', pressed = false, disabled = false, size = 26 } = {}) {
    let fill = C.white, stroke = C.navy, tc = C.navy;
    if (kind === 'danger') { fill = C.red; stroke = C.red; tc = C.white; }
    if (kind === 'primary') { fill = C.navy; stroke = C.navy; tc = C.white; }
    if (pressed) { fill = C.navy; stroke = C.navy; tc = C.white; }
    if (disabled) { fill = C.mist; stroke = C.line; tc = C.muted; }
    return rect(x, y, w, h, { fill, stroke, sw: 2.5, r: 10 }) + text(x + w / 2, y + h / 2 + 1, label, { size, weight: 700, anchor: 'middle', fill: tc });
  }
  function win(x, y, w, h, title) {
    return rect(x, y, w, h, { fill: C.white, stroke: C.navy, sw: 3, r: 16 }) +
      `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${42} h${-w} z" fill="${C.navy}"/>` +
      text(x + 30, y + 29, title, { size: 26, weight: 700, fill: C.white });
  }
  function clock(cx, cy, r, { h = 0, m = 0, color = C.navy, fill = C.white, arc = null } = {}) {
    let o = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${color}" stroke-width="${r * 0.08}"/>`;
    if (arc != null) {
      const a = arc * Math.PI * 2, ex = cx + Math.sin(a) * (r + 10), ey = cy - Math.cos(a) * (r + 10);
      o += `<path d="M${cx} ${cy - r - 10} A${r + 10} ${r + 10} 0 ${arc > 0.5 ? 1 : 0} 1 ${ex} ${ey}" fill="none" stroke="${C.amber}" stroke-width="6" stroke-linecap="round"/>`;
    }
    const hand = (deg, len, w) => { const a = (deg * Math.PI) / 180; return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.sin(a) * r * len}" y2="${cy - Math.cos(a) * r * len}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`; };
    return o + hand(h, 0.5, r * 0.07) + hand(m, 0.75, r * 0.05) + `<circle cx="${cx}" cy="${cy}" r="${r * 0.07}" fill="${color}"/>`;
  }
  const box = (x, y, w, h, label, kind, size = 28) => card({ x, y, w, h, kind, title: label, size, r: 14, sw: 3 });

  EPISODES['07'] = {
    scenes: {
      // ---------------------------------------------------------------- 07.1
      '07.1': ({ s, e }) => {
        let o = heading('A narrower tool');
        const names = ['web1', 'web2', 'app1', 'git1', 'db1'];
        const ax = 330, ay = 570;
        const sx = 1500, sy = (i) => 300 + i * 140;
        const tR = s(2) + 0.5, tB = s(3) + 0.4;
        const revoke = A.now() >= tR && A.now() < tB;
        const block = A.now() >= tB;
        const isRed = (i) => revoke || (block && i === 4);
        // lines
        names.forEach((n, i) => {
          o += arrow({ x1: ax + 70, y1: ay, x2: sx - 70, y2: sy(i), at: s(0) + 0.3 + i * 0.15, d: 0.5, color: isRed(i) ? C.red : C.orange, width: isRed(i) ? 6 : 3.5, head: false });
        });
        o += show(person(ax, ay, { s: 0.8, label: 'Alice', labelSize: 28, sub: 'developers' }), { at: 0.1, from: 'left' });
        names.forEach((n, i) => {
          o += show(server(sx, sy(i), { s: 0.42, label: n, labelSize: 24 }) + (isRed(i) ? mark(sx + 34, sy(i) - 30, '✕', { r: 17, color: C.red }) : ''), { at: 0.2 + i * 0.1, from: 'right' });
        });
        // s1: db1 marked
        if (A.now() >= s(1)) o += show(`<rect x="${sx - 80}" y="${sy(4) - 52}" width="160" height="124" rx="16" fill="none" stroke="${C.amber}" stroke-width="5" stroke-dasharray="12 8"/>` +
          text(sx + 100, sy(4), 'not today', { size: 28, weight: 700, fill: C.amber, anchor: 'start' }), { at: s(1) + 0.6, from: 'none' });
        // action chips
        if (A.now() >= s(2) && !block) o += show(chip(ax, 790, 'Revoke the certificate', { kind: 'danger', size: 28, anchor: 'middle' }), { at: s(2), from: 'up', dist: 14 });
        if (block) o += show(chip(ax, 790, 'Block on db1', { kind: 'warn', size: 28, anchor: 'middle' }), { at: tB, from: 'up', dist: 14 });
        if (A.now() >= s(2) && !block) o += show(text(960, 950, 'Revoke: Alice is cut off on all 5 servers', { size: 30, anchor: 'middle', fill: C.red, weight: 700 }), { at: s(2) + 0.6, from: 'up', dist: 14 });
        if (block) o += show(text(960, 950, 'Block: Alice is cut off on db1 only', { size: 30, anchor: 'middle', fill: C.amber, weight: 700 }), { at: tB + 0.4, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 07.2
      '07.2': ({ s, e }) => {
        let o = heading('How it works');
        // formula
        const fy = 335, fh = 84;
        o += show(text(110, fy + fh / 2, 'KRL(db1) =', { size: 36, mono: true, weight: 700 }), { at: s(0) + 0.2 });
        o += show(box(330, fy, 342, fh, 'host-CA revocations', 'host'), { at: s(1) + 0.2, from: 'up', dist: 40 });
        o += show(text(703, fy + fh / 2, '∪', { size: 48, anchor: 'middle', weight: 700 }), { at: s(1) + 1.0 });
        o += show(box(735, fy, 342, fh, 'user-CA revocations', 'user'), { at: s(1) + 1.4, from: 'up', dist: 40 });
        o += show(text(1108, fy + fh / 2, '∪', { size: 48, anchor: 'middle', weight: 700 }), { at: s(1) + 2.2 });
        o += show(box(1140, fy, 270, fh, 'blocks on db1', 'danger'), { at: s(1) + 2.6, from: 'up', dist: 40 });
        // five per-host lists
        const hosts = ['web1', 'web2', 'app1', 'git1', 'db1'];
        hosts.forEach((h, i) => {
          const x = 110 + i * 342, y = 470, w = 300, hh = 200;
          const db = i === 4;
          const hot = db && A.now() >= s(2);
          let c = rect(x, y, w, hh, { fill: C.white, stroke: hot ? C.red : C.slate, sw: hot ? 4 : 2.5, r: 14 });
          c += text(x + 20, y + 34, `KRL ${h}`, { size: 28, mono: true, weight: 700 });
          c += rect(x + 16, y + 64, w - 32, 40, { fill: C.greenSoft, stroke: 'none', sw: 0, r: 8 }) + text(x + 28, y + 85, 'host-CA revocations', { size: 22, fill: '#075C41' });
          c += rect(x + 16, y + 112, w - 32, 40, { fill: C.orangeSoft, stroke: 'none', sw: 0, r: 8 }) + text(x + 28, y + 133, 'user-CA revocations', { size: 22, fill: C.orangeInk });
          if (hot) c += rect(x + 16, y + 158, w - 32, 36, { fill: C.redSoft, stroke: C.red, sw: 2, r: 8 }) + text(x + 28, y + 177, "Alice's key", { size: 24, fill: C.red, weight: 700 });
          o += show(c, { at: s(0) + 0.8 + i * 0.25, from: 'up', dist: 24 });
        });
        if (A.now() >= s(2)) o += show(chip(1540, 700, "Alice's certificate: still valid", { kind: 'good', size: 24, anchor: 'middle' }), { at: s(2) + 0.6, from: 'up', dist: 14 });
        // shared key
        if (A.now() >= s(3)) {
          const sy = 810;
          o += show(person(230, sy, { s: 0.55, label: 'alice@acme.example', labelSize: 22 }), { at: s(3), from: 'left', dist: 30 });
          o += show(person(1230, sy, { s: 0.55, label: 'alice-ci@acme.example', labelSize: 22 }), { at: s(3) + 0.3, from: 'right', dist: 30 });
          o += arrow({ x1: 300, y1: sy - 10, x2: 480, y2: sy - 10, at: s(3) + 0.5, d: 0.5, color: C.slate, width: 3.5 });
          o += arrow({ x1: 1160, y1: sy - 10, x2: 980, y2: sy - 10, at: s(3) + 0.8, d: 0.5, color: C.slate, width: 3.5 });
          o += show(keyCard(490, sy - 45, { w: 480, h: 90, label: 'Same public key', sub: 'SHA256:Qm7…', kind: 'file', size: 28 }), { at: s(3) + 0.7, from: 'up', dist: 20 });
          o += show(chip(1380, sy - 10, 'both blocked', { kind: 'danger', size: 28 }), { at: s(3) + 1.6, from: 'left', dist: 20 });
        }
        if (A.now() >= s(4)) o += show(chip(960, 955, 'PKI Manager warns you before it blocks a shared key', { kind: 'warn', size: 28, anchor: 'middle' }), { at: s(4), from: 'up', dist: 16 });
        return o;
      },

      // ---------------------------------------------------------------- 07.3
      '07.3': ({ s, e }) => {
        let o = heading('In PKI Manager');
        const D1 = e(1) - s(1);
        const wx = 110, wy = 270, ww = 1700, wh = 540;
        o += show(win(wx, wy, ww, wh, 'PKI Manager  ›  SSH  ›  Hosts  ›  db1.acme.example'), { at: 0.2 });
        // access card
        const ax = 150, ay = 350, aw = ww - 80, ah = 420;
        const tOpen = s(1) + 0.1, tPick = s(1) + D1 * 0.3, tType = s(1) + D1 * 0.4, tConfirm = s(1) + D1 * 0.85;
        const blocked = A.now() >= tConfirm + 0.4;
        let a = rect(ax, ay, aw, ah, { fill: C.white, stroke: C.line, sw: 2, r: 12 });
        a += text(ax + 36, ay + 44, 'Access', { size: 36, weight: 700 });
        a += text(ax + 190, ay + 46, 'who can reach this host, and through which principal', { size: 24, fill: C.slate });
        // rows
        const rows = [['Alice', 'developers', 'deploy'], ['Bob', 'sysadmins', 'root']];
        rows.forEach(([who, pr, acct], i) => {
          const y = ay + 100 + i * 90;
          const bad = blocked && i === 0;
          a += rect(ax + 24, y, aw - 48, 72, { fill: bad ? C.redSoft : C.mist, stroke: bad ? C.red : C.line, sw: 2, r: 10 });
          a += text(ax + 56, y + 37, `${who} · ${pr} → ${acct}`, { size: 30, weight: 500, mono: true, fill: bad ? '#8E1B1B' : C.navy });
          if (bad) {
            a += chip(ax + aw - 560, y + 36, 'Blocked', { kind: 'danger', size: 26 });
            a += text(ax + aw - 410, y + 37, 'incident 42', { size: 24, fill: C.slate });
            a += button(ax + aw - 230, y + 10, 180, 52, 'Unblock');
          }
        });
        o += show(a, { at: s(0) + 0.5, from: 'up', dist: 24 });
        // dropdown
        const dx = ax + aw - 360, dy = ay + 20;
        const picked = A.now() >= tPick;
        o += show(rect(dx, dy, 330, 56, { fill: C.white, stroke: C.navy, sw: 2.5, r: 10 }) +
          text(dx + 20, dy + 29, picked ? 'alice@acme.example' : 'Block user…', { size: 26, fill: picked ? C.navy : C.slate }) +
          `<path d="M${dx + 296} ${dy + 24} l10 10 l10 -10" fill="none" stroke="${C.navy}" stroke-width="3"/>`, { at: s(0) + 0.8, from: 'none' });
        if (A.now() >= tOpen && A.now() < tPick + 0.5) {
          o += show(rect(dx, dy + 62, 330, 112, { fill: C.white, stroke: C.navy, sw: 2.5, r: 10 }) +
            (A.now() >= tPick - 0.3 ? rect(dx + 6, dy + 68, 318, 48, { fill: C.orangeSoft, stroke: 'none', sw: 0, r: 8 }) : '') +
            text(dx + 20, dy + 92, 'alice@acme.example', { size: 26 }) + text(dx + 20, dy + 146, 'bob@acme.example', { size: 26 }), { at: tOpen, from: 'none', out: tPick + 0.1, outD: 0.3 });
        }
        // reason + confirm
        if (A.now() >= tPick + 0.2 && !blocked) {
          const rn = 'incident 42';
          const typed = rn.slice(0, Math.max(0, Math.floor((A.now() - tType) * 14)));
          const press = A.now() >= tConfirm && A.now() < tConfirm + 0.4;
          o += show(text(ax + 56, ay + 330, 'Reason', { size: 26, fill: C.slate, weight: 700 }) +
            rect(ax + 170, ay + 304, 640, 56, { fill: C.mist, stroke: C.line, sw: 2, r: 10 }) + text(ax + 190, ay + 333, typed, { size: 28 }) +
            button(ax + 840, ay + 304, 190, 56, 'Block', { kind: 'danger', pressed: false }) +
            (press ? rect(ax + 840, ay + 304, 190, 56, { fill: '#8E1B1B', stroke: '#8E1B1B', sw: 2.5, r: 10 }) + text(ax + 935, ay + 333, 'Block', { size: 26, weight: 700, anchor: 'middle', fill: C.white }) : ''), { at: tPick + 0.2, from: 'up', dist: 16 });
        }
        if (blocked) {
          o += show(chip(960, 880, 'One audited action · undo it with Unblock', { kind: 'plain', size: 28, anchor: 'middle' }), { at: s(2), from: 'up', dist: 14 });
        }
        return o;
      },

      // ---------------------------------------------------------------- 07.4
      '07.4': ({ s, e }) => {
        let o = heading('When it takes effect');
        const D1 = e(1) - s(1);
        // next pull chip + clock
        o += show(clock(138, 295, 24, { h: 0, m: A.now() * 70 }) + chip(180, 295, 'The block lands on the next pull: ~15 min', { kind: 'plain', size: 26 }), { at: s(0) + 0.2, from: 'left', dist: 30 });
        // window
        const wx = 110, wy = 350, ww = 1700, wh = 410;
        o += show(win(wx, wy, ww, wh, 'PKI Manager  ›  SSH  ›  KRL'), { at: s(0) + 0.3 });
        const hy = wy + 82;
        let t = text(wx + 40, hy, 'Host', { size: 26, weight: 700, fill: C.slate }) + text(wx + 500, hy, 'State', { size: 26, weight: 700, fill: C.slate }) + text(wx + 790, hy, 'Details', { size: 26, weight: 700, fill: C.slate });
        t += `<line x1="${wx + 24}" y1="${hy + 28}" x2="${wx + ww - 24}" y2="${hy + 28}" stroke="${C.line}" stroke-width="2"/>`;
        t += `<line x1="${wx + 24}" y1="${hy + 168}" x2="${wx + ww - 24}" y2="${hy + 168}" stroke="${C.line}" stroke-width="1.5"/>`;
        const r1 = hy + 98, r2 = hy + 238;
        t += text(wx + 40, r1, 'db1.acme.example', { size: 30, mono: true, weight: 700 });
        t += text(wx + 40, r2, 'legacy1.acme.example', { size: 30, mono: true, weight: 700 });
        o += show(t, { at: s(0) + 0.6, from: 'up', dist: 20 });
        // row 1: pill animates
        const tEnf = s(1) + Math.min(D1 * 0.4, 3.0);
        const enf = A.now() >= tEnf;
        o += show(chip(wx + 500, r1, enf ? '✓ Enforced' : 'Rolling out', { kind: enf ? 'good' : 'warn', size: 28 }), { at: s(0) + 1.0, from: 'none' });
        if (A.now() >= tEnf + 0.3) {
          o += show(`<path d="M${wx + 780} ${r1} l16 -14 v28 z" fill="${C.navy}"/>` + rect(wx + 795, r1 - 30, 560, 60, { fill: C.navy, stroke: C.navy, sw: 0, r: 10 }) +
            text(wx + 815, r1 + 1, "served to the host's puller at 10:42", { size: 26, fill: C.white }), { at: tEnf + 0.3, from: 'left', dist: 20 });
        }
        // krl-client (s2)
        if (A.now() >= s(2)) {
          o += show(chip(wx + 1400, r1, 'krl-client', { kind: 'good', size: 26, mono: true }), { at: s(2), from: 'up', dist: 14 });
          o += show(chip(wx + 790, r2, 'no krl-client', { kind: 'warn', size: 26, mono: true }), { at: s(2) + 0.6, from: 'up', dist: 14 });
        }
        // row 2: amber pill + clock that never completes
        o += show(chip(wx + 500, r2, 'Rolling out', { kind: 'warn', size: 28 }), { at: s(0) + 1.3, from: 'none' });
        if (A.now() >= s(3)) {
          const sweep = (((A.now() - s(3)) * 0.35) % 1) * 0.93;
          o += show(clock(wx + 1330, r2, 32, { h: 0, m: sweep * 360, arc: Math.max(0.02, sweep), color: C.navy }) + text(wx + 1390, r2, 'never completes', { size: 26, fill: C.amber, weight: 700 }), { at: s(3), from: 'right', dist: 30 });
        }
        o += show(chip(960, 850, 'This needs the KRL client', { kind: 'plain', size: 30, anchor: 'middle' }), { at: s(2) + 0.2, from: 'up', dist: 14 });
        if (A.now() >= s(3)) o += show(text(960, 950, 'A host without it stays at "Rolling out": the block never lands there', { size: 28, anchor: 'middle', fill: C.amber, weight: 700 }), { at: s(3) + 0.4, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 07.5
      '07.5': ({ s, e }) => {
        let o = heading('Limits to know');
        const D2 = e(2) - s(2);
        const ay = 410, xa = 420, xb = 1180;
        // timeline
        o += show(`<line x1="130" y1="${ay}" x2="1790" y2="${ay}" stroke="${C.line}" stroke-width="8" stroke-linecap="round"/>` +
          `<rect x="${xa}" y="${ay - 9}" width="${xb - xa}" height="18" rx="9" fill="${C.amber}"/>` +
          `<line x1="${xb}" y1="${ay}" x2="1790" y2="${ay}" stroke="${C.green}" stroke-width="8" stroke-linecap="round"/>` +
          `<circle cx="${xa}" cy="${ay}" r="20" fill="${C.red}"/><circle cx="${xb}" cy="${ay}" r="20" fill="${C.green}"/>` +
          text(xa, ay + 60, 'Block applied in PKI Manager', { size: 26, anchor: 'middle', weight: 700 }) +
          text(xb, ay + 60, 'Host pulls the new list: enforced', { size: 26, anchor: 'middle', weight: 700, fill: '#075C41' }), { at: 0.3 });
        o += show(text((xa + xb) / 2, ay - 68, '≤ 1 pull interval', { size: 34, anchor: 'middle', weight: 700, fill: C.amber }) +
          `<path d="M${xa} ${ay - 30} v-12 h${xb - xa} v12" fill="none" stroke="${C.amber}" stroke-width="4"/>`, { at: s(0) + 0.5, from: 'down', dist: 20 });
        // scenario: Alice tries a new key inside the window
        const ry = 680;
        const gated = A.now() >= s(2) + 0.8;
        if (A.now() >= s(1)) {
          o += show(person(250, ry, { s: 0.6, label: 'Alice', labelSize: 26 }), { at: s(1), from: 'left', dist: 30 });
          o += arrow({ x1: 320, y1: ry, x2: gated ? 380 : 520, y2: ry, at: s(1) + 0.4, d: 0.6, color: C.orange, width: 4 });
          o += show(`<g opacity="${gated ? 0.4 : 1}">` + card({ x: 540, y: ry - 55, w: 340, h: 110, kind: 'user', title: 'New key', body: ['new certificate'], size: 30, bodySize: 26 }) + '</g>', { at: s(1) + 1.0, from: 'right', dist: 40 });
          o += arrow({ x1: 890, y1: ry, x2: 1260, y2: ry, at: s(1) + 1.6, d: 0.7, color: gated ? C.line : C.amber, width: 4, dashed: gated });
          o += show(server(1340, ry, { s: 0.5, label: 'db1', labelSize: 26, state: gated ? undefined : undefined }), { at: s(1) + 0.4, from: 'right' });
          if (!gated) o += show(chip(1000, ry - 100, 'could get in', { kind: 'warn', size: 26, anchor: 'middle' }), { at: s(1) + 2.2, from: 'up', dist: 12 });
        }
        if (gated) {
          o += show(A.gate(410, ry, { state: 'bad', r: 32, label: 'issuance gate', labelSize: 24 }), { at: s(2) + 0.8, from: 'pop', cx: 410, cy: ry });
          o += show(chip(960, ry - 100, 'new certificates cannot open db1', { kind: 'good', size: 26, anchor: 'middle' }), { at: s(2) + 1.4, from: 'up', dist: 12 });
        }
        // note card
        o += show(rect(110, 820, 980, 110, { fill: C.amberSoft, stroke: C.amber, sw: 3, r: 14 }) +
          text(140, 855, 'Optional', { size: 26, weight: 700, fill: '#6B4000' }) + text(140, 898, 'SSH_BLOCK_ISSUANCE_GATE', { size: 34, mono: true, weight: 700, fill: '#6B4000' }), { at: s(2), from: 'up', dist: 20 });
        o += nextCard('08 Zones', s(2) + D2 * 0.7);
        return o;
      },
    },
  };
})();
