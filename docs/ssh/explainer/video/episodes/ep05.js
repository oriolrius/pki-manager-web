// Episode 05 — Principals: the one rule that matters.
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, move, text, rect, card, chip, code, arrow, server, person, laptop, keyCard, stamp, heading, nextCard, mark, ease, prog, clamp, lerp, textW } = A;

  // ---------- shared helpers ----------
  const TAGS = {
    user: { fill: C.orange, stroke: C.orangeInk, text: C.white },
    grey: { fill: C.mist, stroke: C.slate, text: C.slate },
    green: { fill: C.green, stroke: '#0A7C58', text: C.white },
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
  /** Alice's user certificate (orange). Returns svg + the centre of the principals tag. */
  function userCert(x, y, w, h, { principals = ['developers'], tagKind = 'soft', title = "Alice's certificate" } = {}) {
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.orange, sw: 3, r: 16 });
    o += `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${44} h${-w} z" fill="${C.orange}"/>`;
    o += text(x + 46, y + 30, title, { size: 28, weight: 700, fill: C.white });
    const rows = [['Key ID', 'alice@acme.example'], ['Valid', '7 days']];
    rows.forEach(([k, v], i) => {
      const cy = y + 100 + i * 70;
      o += text(x + 26, cy, k, { size: 26, fill: C.slate, weight: 500 });
      o += text(x + w - 26, cy, v, { size: 26, mono: true, anchor: 'end' });
    });
    const py = y + 100 + 2 * 70;
    o += text(x + 26, py, 'Principals', { size: 26, fill: C.slate, weight: 500 });
    let tx = x + w - 26;
    let pos = null;
    [...principals].reverse().forEach((p, i) => {
      const tw = tagW(p, 26);
      tx -= tw / 2;
      o += tag(tx, py, p, { kind: tagKind, size: 26 });
      if (i === principals.length - 1) pos = { x: tx, y: py };
      if (i === 0 && principals.length === 1) pos = { x: tx, y: py };
      tx -= tw / 2 + 12;
    });
    return { svg: o, tag: pos };
  }
  /** A server panel: navy title band + body (white). */
  function serverPanel(x, y, w, h, label, { stroke = C.navy } = {}) {
    let o = rect(x, y, w, h, { fill: C.white, stroke, sw: 3, r: 16 });
    o += `<path d="M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v${44} h${-w} z" fill="${C.navy}"/>`;
    o += text(x + 46, y + 30, label, { size: 28, weight: 700, fill: C.white, mono: true });
    return o;
  }
  const AP_PATH = '/etc/ssh/auth_principals/deploy';

  EPISODES['05'] = {
    scenes: {
      // ---------------------------------------------------------------- 05.1
      '05.1': ({ s }) => {
        let o = heading('A principal is a label');
        const cx = 960, cy = 470;
        const bob = Math.sin(A.now() * 1.8) * 9;
        o += show(`<ellipse cx="${cx}" cy="${cy + 105}" rx="${150 - bob * 2}" ry="14" fill="${C.line}" opacity="0.7"/>` +
          `<g transform="translate(0 ${bob})">${tag(cx, cy, 'developers', { kind: 'grey', size: 64 })}</g>`, { at: s(0) + 0.1, from: 'pop', cx, cy });
        o += show(text(cx, cy + 190, '= no access', { size: 52, weight: 700, anchor: 'middle', fill: C.slate }), { at: s(1) });
        o += show(card({ x: 360, y: 740, w: 1200, h: 150, kind: 'file', title: 'Like a Unix group name', body: ['It means something only when a server accepts it'], size: 36, bodySize: 30 }), { at: s(2), from: 'up' });
        return o;
      },

      // ---------------------------------------------------------------- 05.2
      '05.2': ({ s, e }) => {
        let o = heading('The two-places rule');
        const D1 = e(1) - s(1);
        const cx0 = 110, cy0 = 340, cw = 640, ch = 310;
        const px = 1000, pw = 820;
        // place 1: certificate
        const cert = userCert(cx0, cy0, cw, ch);
        o += show(cert.svg + mark(cx0, cy0, '1', { r: 24, color: C.orangeInk }), { at: s(1) + 0.2, from: 'left' });
        // place 2: file on the server
        const fileT = s(1) + D1 * 0.55;
        const codeBlock = code({
          x: px + 30, y: cy0 + 78, w: pw - 60, size: 28, title: AP_PATH,
          lines: ['developers', 'developers@web1.acme.example'],
          hl: [{ line: 0, at: s(3) + 1.0, color: C.green, opacity: 0.25 }],
        });
        o += show(serverPanel(px, cy0, pw, ch, 'web1.acme.example') + codeBlock.svg +
          text(px + pw / 2, cy0 + ch - 36, '↑ line 2: per-host form, used by access blocks', { size: 24, fill: C.slate, anchor: 'middle', opacity: A.now() >= s(2) + 1.2 ? 1 : 0 }) +
          mark(px, cy0, '2', { r: 24, color: C.navy }), { at: fileT, from: 'right' });
        // login chip
        o += show(chip(px, 275, 'ssh deploy@web1.acme.example', { kind: 'plain', size: 26, mono: true }), { at: s(2), from: 'down', dist: 20 });
        o += show(text(px + 520, 275, 'reads the file for deploy', { size: 26, fill: C.slate, weight: 500 }), { at: s(2) + 0.7 });
        // the two tags slide together and lock
        const my = 745, mx = 960;
        const t0 = s(3) + 0.2, p = ease(prog(t0, 1.1));
        if (A.now() >= t0) {
          if (p < 1) {
            const a = { x: lerp(cert.tag.x, mx, p), y: lerp(cert.tag.y, my, p) };
            const b = { x: lerp(px + 30 + 22 + 70, mx, p), y: lerp(cy0 + 78 + 45.6 + 22 + 14, my, p) };
            o += tag(b.x, b.y, 'developers', { kind: 'grey', size: 30 }) + tag(a.x, a.y, 'developers', { kind: 'user', size: 30 });
          } else {
            o += show(tag(mx, my, 'developers', { kind: 'green', size: 34 }) + A.lock(mx - 190, my + 4, { s: 1.5, color: C.green }) +
              mark(mx + 190, my, '✓', { r: 34, color: C.green }), { at: t0 + 1.1, d: 0.3, from: 'none' });
          }
        }
        // formula
        o += show(rect(250, 820, 1420, 84, { fill: C.mist, stroke: C.slate, sw: 2, r: 14 }) +
          text(960, 862, 'login ⇔ principals(cert) ∩ auth_principals/<account> ≠ ∅', { size: 34, mono: true, anchor: 'middle', fill: C.navy, weight: 700 }), { at: s(3) + 1.6 });
        o += show(chip(960, 950, 'The deploy account must already exist on the server', { kind: 'plain', size: 28, anchor: 'middle' }), { at: s(4), from: 'up', dist: 20 });
        return o;
      },

      // ---------------------------------------------------------------- 05.3
      '05.3': ({ s, e }) => {
        let o = heading('The trap');
        const D0 = e(0) - s(0);
        const y0 = 270, h0 = 290;
        const cert = userCert(110, y0, 640, h0);
        o += show(cert.svg, { at: 0.2, from: 'left' });
        const px = 1000, pw = 820;
        o += show(serverPanel(px, y0, pw, h0, 'web1.acme.example') +
          code({ x: px + 30, y: y0 + 78, w: pw - 60, size: 28, title: AP_PATH, lines: [{ text: '(empty file)', color: C.muted }] }).svg, { at: 0.3, from: 'right' });
        // gates
        const gx = [330, 700, 1070, 1440];
        const labels = ['not revoked', 'signature', 'dates', 'principal'];
        const bad = A.now() >= s(0) + D0 * 0.55;
        const GY = 700;
        o += show(`<line x1="${gx[0]}" y1="${GY}" x2="${gx[3]}" y2="${GY}" stroke="${C.line}" stroke-width="6"/>`, { at: s(0) });
        labels.forEach((l, i) => {
          const at = s(0) + 0.3 + i * 0.5;
          const st = i < 3 ? 'ok' : (bad ? 'bad' : 'pending');
          o += show(A.gate(gx[i], GY, { state: st, r: 36, label: l, labelSize: 26 }), { at, from: 'pop', cx: gx[i], cy: GY, d: 0.35 });
        });
        o += show(text(110, GY, 'sshd checks', { size: 26, fill: C.slate, weight: 500 }), { at: s(0) });
        // terminals
        const t1 = A.terminal({
          x: 110, y: 820, w: 760, size: 26, title: 'alice@laptop',
          items: [{ t: '$ ssh deploy@web1.acme.example', at: s(0) + 0.8 }, { t: 'Permission denied (publickey).', out: true, at: s(0) + D0 * 0.55 + 0.2, color: '#FFB4B4' }],
        });
        o += show(t1.svg, { at: s(0) + 0.5 });
        const t2 = A.terminal({
          x: 920, y: 820, w: 900, size: 26, title: 'journalctl -u ssh',
          items: [{ t: '$ journalctl -u ssh', at: s(0) + D0 * 0.55 + 0.6 }, { t: 'error: Certificate does not contain an authorized principal', out: true, at: s(0) + D0 * 0.55 + 1.7, color: '#FFB4B4' }],
        });
        o += show(t2.svg, { at: s(0) + D0 * 0.55 });
        // narration beats
        if (A.now() >= s(1)) o += show(chip(430, 610, 'certificate is fine', { kind: 'good', size: 26, anchor: 'middle' }), { at: s(1), from: 'up', dist: 14 });
        if (A.now() >= s(2)) o += show(rect(px - 8, y0 - 8, pw + 16, h0 + 16, { fill: 'none', stroke: C.red, sw: 4, r: 20, dash: '14 10' }) +
          chip(1410, 610, 'mapping is missing', { kind: 'danger', size: 26, anchor: 'middle' }), { at: s(2), from: 'none' });
        if (A.now() >= s(3)) o += show(chip(920, 610, 'the most common mistake', { kind: 'warn', size: 26, anchor: 'middle' }), { at: s(3), from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 05.4
      '05.4': ({ s, e }) => {
        let o = heading('Mapping in PKI Manager');
        const wx = 110, wy = 270, ww = 1000, wh = 660;
        // window frame
        let w = rect(wx, wy, ww, wh, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
        w += `<path d="M${wx} ${wy + 16} a16 16 0 0 1 16 -16 h${ww - 32} a16 16 0 0 1 16 16 v${42} h${-ww} z" fill="${C.navy}"/>`;
        w += text(wx + 30, wy + 29, 'PKI Manager  ›  SSH  ›  Principals', { size: 26, weight: 700, fill: C.white });
        o += show(w, { at: s(0), from: 'up' });
        // catalog
        const catOn = A.now() >= s(1);
        if (catOn) o += show(rect(wx + 30, wy + 76, ww - 60, 96, { fill: C.mist, stroke: C.line, sw: 2, r: 12 }) +
          text(wx + 54, wy + 124, 'Catalog', { size: 28, weight: 700 }) + tag(wx + 330, wy + 124, 'developers', { kind: 'user', size: 28 }) +
          text(wx + ww - 54, wy + 124, 'created once', { size: 24, fill: C.muted, anchor: 'end' }), { at: s(1), from: 'up', dist: 24 });
        // host card
        const hy = wy + 196;
        const stale = A.now() >= s(2) + 0.9;
        const pushedAt = e(4) - 1.5;
        const pushed = A.now() >= pushedAt + 0.5;
        const hostCard = (() => {
          let h = rect(wx + 30, hy, ww - 60, 420, { fill: C.white, stroke: C.line, sw: 2, r: 12 });
          h += text(wx + 54, hy + 38, 'web1.acme.example', { size: 30, weight: 700, mono: true });
          return h;
        })();
        o += show(hostCard, { at: s(2) - 0.2, from: 'up', dist: 24 });
        if (A.now() >= s(2)) {
          o += show(rect(wx + 54, hy + 80, ww - 108, 70, { fill: C.orangeSoft, stroke: C.orange, sw: 2, r: 10 }) +
            text(wx + 80, hy + 115, 'web1 · developers → deploy', { size: 30, mono: true, weight: 700 }), { at: s(2), from: 'right', dist: 40 });
        }
        // badge
        if (stale && !pushed) {
          // real UI: the Stale pill simply disappears after Mark pushed
          const pk = 'warn';
          const lab = '⚠ Stale — needs push';
          const bx = wx + 54 + textW('web1.acme.example', 30, true) + 30;
          o += show(chip(bx, hy + 38, lab, { kind: pk, size: 24 }), { at: s(2) + 0.9, from: 'none' });
        }
        // rendered file
        if (A.now() >= s(3)) {
          const fc = code({ x: wx + 54, y: hy + 180, w: ww - 108, size: 26, title: AP_PATH, lines: ['developers', 'developers@web1.acme.example'] });
          o += show(fc.svg + text(wx + 54 + 22, hy + 180 + fc.h + 28, 'PKI Manager renders the exact file', { size: 24, fill: C.slate }), { at: s(3), from: 'up', dist: 20 });
        }
        // Mark pushed button
        if (stale && !pushed) {
          const press = A.now() >= pushedAt && A.now() < pushedAt + 0.5;
          o += rect(wx + ww - 250, hy + 12, 200, 54, { fill: press ? C.navy : C.white, stroke: C.navy, sw: 2.5, r: 10 }) +
            text(wx + ww - 150, hy + 40, 'Mark pushed', { size: 26, weight: 700, anchor: 'middle', fill: press ? C.white : C.navy });
        } else if (pushed) o += rect(wx + ww - 250, hy + 12, 200, 54, { fill: C.mist, stroke: C.line, sw: 2, r: 10 }) + text(wx + ww - 150, hy + 40, 'Mark pushed', { size: 26, anchor: 'middle', fill: C.muted });
        // server on the right + file copy
        o += show(server(1500, 440, { s: 1.1, label: 'web1.acme.example', labelSize: 26 }), { at: s(4) - 0.5, from: 'right' });
        if (A.now() >= s(4)) {
          o += arrow({ x1: 1130, y1: 745, x2: 1300, y2: 640, at: s(4) + 0.2, d: 0.9, color: C.slate, width: 4, curve: -40 });
          o += show(text(1300, 790, 'you deploy the file', { size: 26, fill: C.slate, anchor: 'middle', weight: 500 }), { at: s(4) + 0.6 });
          o += show(card({ x: 1310, y: 605, w: 400, h: 70, kind: 'file', title: 'auth_principals/deploy', size: 24 }), { at: s(4) + 1.1, from: 'up', dist: 16 });
        }
        if (A.now() >= s(5)) o += show(card({ x: 1190, y: 820, w: 630, h: 130, kind: 'warn', title: 'Mark pushed only records it', body: ['It deploys nothing'], size: 32, bodySize: 28 }), { at: s(5), from: 'up', dist: 20 });
        return o;
      },

      // ---------------------------------------------------------------- 05.5
      '05.5': ({ s }) => {
        let o = heading('Two decisions, split');
        const lx = 110, lw = 760, rx = 1050, rw = 770, py = 280, ph = 500;
        const colOn = A.now() >= s(1);
        o += show(rect(lx, py, lw, ph, { fill: C.orangeSoft, stroke: C.orange, sw: 3, r: 18 }) +
          text(lx + lw / 2, py + 50, 'Certificate = identity', { size: 38, weight: 700, fill: C.orangeInk, anchor: 'middle' }) +
          text(lx + lw / 2, py + 96, '(follows the person)', { size: 28, fill: C.orangeInk, anchor: 'middle' }), { at: s(1) - 0.2, from: 'left' });
        o += show(rect(rx, py, rw, ph, { fill: C.mist, stroke: C.slate, sw: 3, r: 18 }) +
          text(rx + rw / 2, py + 50, 'auth_principals = policy', { size: 38, weight: 700, fill: C.slate, anchor: 'middle', mono: false }) +
          text(rx + rw / 2, py + 96, '(follows the server)', { size: 28, fill: C.slate, anchor: 'middle' }), { at: s(2) - 0.2, from: 'right' });
        void colOn;
        const personCard = (x, y, name) => rect(x, y, 330, 170, { fill: C.white, stroke: C.orange, sw: 3, r: 14 }) +
          person(x + 70, y + 70, { s: 0.55, color: C.orange }) + text(x + 125, y + 62, name, { size: 32, weight: 700 }) +
          text(x + 125, y + 108, 'developers', { size: 26, mono: true, fill: C.orangeInk });
        const srvCard = (x, y, name) => rect(x, y, 330, 170, { fill: C.white, stroke: C.navy, sw: 3, r: 14 }) +
          text(x + 165, y + 50, name, { size: 30, weight: 700, mono: true, anchor: 'middle' }) +
          text(x + 165, y + 100, 'deploy ← developers', { size: 24, mono: true, fill: C.slate, anchor: 'middle' }) +
          text(x + 165, y + 135, 'root ← sysadmins', { size: 24, mono: true, fill: C.slate, anchor: 'middle' });
        o += show(personCard(lx + 40, 420, 'Alice'), { at: s(1) + 0.5, from: 'up', dist: 20 });
        o += show(srvCard(rx + 40, 420, 'web1'), { at: s(2) + 0.5, from: 'up', dist: 20 });
        // add a server: right column only
        o += show(srvCard(rx + 400, 420, 'db1'), { at: s(3) + 0.1, from: 'down', dist: 160, d: 0.7 });
        o += show(chip(lx + lw / 2, 690, '0 certificates touched', { kind: 'user', size: 28, anchor: 'middle' }), { at: s(3) + 1.0 });
        // hire a person: left column only
        o += show(personCard(lx + 390, 420, 'Bob'), { at: s(4) + 0.1, from: 'down', dist: 160, d: 0.7 });
        o += show(chip(rx + rw / 2, 690, '0 servers touched', { kind: 'file', size: 28, anchor: 'middle' }), { at: s(4) + 1.0 });
        o += show(text(960, 880, 'Who you are  ≠  who may enter which account', { size: 32, anchor: 'middle', fill: C.slate, weight: 500 }), { at: s(4) + 1.2 });
        return o;
      },

      // ---------------------------------------------------------------- 05.6
      '05.6': ({ s, e }) => {
        let o = heading('A small fleet design');
        // vocabulary row
        let y = 300;
        const row = [['roles', [['developers', 'user'], ['sysadmins', 'user']]], ['customer scopes', [['client-acme', 'soft'], ['client-globex', 'soft']]]];
        let x = 110;
        let r = '';
        row.forEach(([lab, tags]) => {
          r += text(x, y, lab, { size: 26, fill: C.slate, weight: 500 });
          x += textW(lab, 26) + 24;
          tags.forEach(([t, k]) => { const w = tagW(t, 26); r += tag(x + w / 2, y, t, { kind: k, size: 26 }); x += w + 14; });
          x += 50;
        });
        o += show(r, { at: s(0) + 0.2 });
        // groups
        const G = [
          { x: 110, name: 'dev', rows: ['deploy ← developers sysadmins', 'root ← sysadmins'], n: 3 },
          { x: 700, name: 'internal', rows: ['deploy ← developers sysadmins', 'root ← sysadmins'], n: 2 },
          { x: 1290, name: 'Acme production', rows: ['deploy ← client-acme sysadmins', 'root ← sysadmins'], n: 3 },
        ];
        const gw = 530, gy = 350, gh = 345;
        G.forEach((g, i) => {
          const at = s(0) + 0.8 + i * 0.5;
          const acme = i === 2;
          let gsv = rect(g.x, gy, gw, gh, { fill: C.white, stroke: acme ? C.navy : C.slate, sw: acme ? 4 : 3, r: 16 });
          gsv += `<path d="M${g.x} ${gy + 16} a16 16 0 0 1 16 -16 h${gw - 32} a16 16 0 0 1 16 16 v${50} h${-gw} z" fill="${C.navy}"/>`;
          gsv += text(g.x + gw / 2, gy + 33, g.name, { size: 30, weight: 700, fill: C.white, anchor: 'middle' });
          for (let k = 0; k < g.n; k++) gsv += server(g.x + 80 + k * 90, gy + 125, { s: 0.36 });
          gsv += code({
            x: g.x + 20, y: gy + 180, w: gw - 40, size: 24, title: 'accepted principals', lines: g.rows,
            hl: acme ? [{ line: 0, at: s(1), color: C.green, opacity: 0.25 }] : [],
          }).svg;
          o += show(gsv, { at, from: 'up', dist: 30 });
        });
        // Globex developer bounces off Acme production
        const cy0 = 765, ch = 110;
        const t0 = s(2) + 1.0;
        const bounce = A.now() < t0 ? 0 : (() => {
          const u = A.now() - t0;
          if (u < 0.6) return ease(u / 0.6);
          if (u < 1.1) return 1 - ease((u - 0.6) / 0.5);
          return 0;
        })();
        const certY = cy0 - bounce * 48;
        const certSvg = (() => {
          const w = 530;
          let c = rect(1290, certY, w, ch, { fill: C.white, stroke: C.orange, sw: 3, r: 14 });
          c += `<path d="M1290 ${certY + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v32 h${-w} z" fill="${C.orange}"/>`;
          c += text(1290 + 24, certY + 24, "Globex developer's certificate", { size: 24, weight: 700, fill: C.white });
          const t1 = tagW('developers', 24), t2 = tagW('client-globex', 24);
          c += tag(1290 + 24 + t1 / 2, certY + 78, 'developers', { kind: 'soft', size: 24 });
          c += tag(1290 + 24 + t1 + 12 + t2 / 2, certY + 78, 'client-globex', { kind: 'soft', size: 24 });
          return c;
        })();
        o += show(certSvg, { at: s(2) + 0.2, from: 'up', dist: 24 });
        if (A.now() >= t0 + 0.55) {
          o += show(mark(1555, 724, '✕', { r: 28, color: C.red }), { at: t0 + 0.55, from: 'pop', cx: 1555, cy: 724, d: 0.3 });
        }
        if (A.now() >= t0 + 1.0) o += show(chip(110, 815, 'Valid certificate, but no matching principal: denied', { kind: 'danger', size: 28 }), { at: t0 + 1.0, from: 'up', dist: 14 });
        o += nextCard('06 Lifecycle', s(3));
        return o;
      },
    },
  };
})();
