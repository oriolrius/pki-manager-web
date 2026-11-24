// Episode 13 — Mapping a real fleet (series 2, principals in depth).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, move, text, rect, card, code, terminal, arrow, server, heading, nextCard, mark, ease, prog, clamp, textW } = A;

  // ---------- shared helpers ----------
  const TAGS = {
    user: { fill: C.orange, stroke: C.orangeInk, text: C.white },
    grey: { fill: C.mist, stroke: C.slate, text: C.slate },
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
  /** Tag whose left edge is at x. */
  const tagL = (x, cy, label, o = {}) => tag(x + tagW(label, o.size ?? 30) / 2, cy, label, o);
  const KINDS = A.KIND;
  /** Pill sized to its label with a safe margin (A.chip underestimates wide text). */
  function chip(x, y, label, { kind = 'user', size = 26, anchor = 'start', mono = false } = {}) {
    const k = KINDS[kind];
    const w = textW(label, size, mono) * 1.1 + size * 1.5, h = size * 1.6;
    const x0 = anchor === 'middle' ? x - w / 2 : x;
    return rect(x0, y - h / 2, w, h, { fill: k.fill, stroke: k.stroke, sw: 2, r: h / 2 }) +
      text(x0 + w / 2, y + 1, label, { size, fill: k.text, anchor: 'middle', weight: 500, mono });
  }
  /** Button (outline or filled). Centre-anchored text. */
  function button(x, y, w, h, label, { fill = C.white, stroke = C.navy, ink = C.navy, size = 26, weight = 700 } = {}) {
    return rect(x, y, w, h, { fill, stroke, sw: 2.5, r: 10 }) + text(x + w / 2, y + h / 2 + 1, label, { size, weight, fill: ink, anchor: 'middle' });
  }
  /** Flash a "pressed" state: returns true in [at, at + 0.45]. */
  const pressing = (at) => A.now() >= at && A.now() < at + 0.45;

  EPISODES['13'] = {
    scenes: {
      // ---------------------------------------------------------------- 13.1
      '13.1': ({ s, e }) => {
        let o = heading('Think in classes');
        o += show(text(110, 245, '19 servers', { size: 28, fill: C.muted }), { at: s(0), from: 'none' });
        o += show(chip(330, 243, 'server by server  ✕', { kind: 'danger', size: 24 }), { at: s(0) + 0.9, from: 'up', dist: 10 });
        const D2 = e(2) - s(2);
        // the four classes: frame + where the server icons go
        const G = [
          { key: 'prod', title: 'Customer production', x: 110, y: 290, w: 1030, h: 300, gap: 142, names: ['acme-web', 'acme-db', 'acme-app', 'globex-web', 'globex-db', 'initech-web', 'initech-db'] },
          { key: 'dev', title: 'Dev', x: 1170, y: 290, w: 650, h: 300, gap: 104, names: ['dev-01', 'dev-02', 'dev-03', 'dev-04', 'dev-05', 'dev-06'] },
          { key: 'tools', title: 'Internal tools', x: 110, y: 640, w: 430, h: 300, gap: 150, names: ['ci', 'monitor'] },
          { key: 'sens', title: 'Internal sensitive', x: 570, y: 640, w: 660, h: 300, gap: 140, names: ['vault', 'logs', 'backup', 'db-int'] },
        ];
        // final positions
        const items = [];
        G.forEach((g, gi) => {
          const span = (g.names.length - 1) * g.gap;
          g.names.forEach((n, i) => items.push({ n, gi, fx: g.x + g.w / 2 - span / 2 + i * g.gap, fy: g.y + 150 }));
        });
        // scattered start: jittered grid, deterministic shuffle
        items.forEach((it, i) => {
          const slot = (i * 8) % 19; // 8 and 19 are coprime: a permutation
          const col = slot % 7, row = Math.floor(slot / 7);
          it.sx = 190 + col * 240 + (((i * 37) % 61) - 30);
          it.sy = 380 + row * 230 + (((i * 53) % 49) - 24);
        });
        // frames: dashed until their title appears
        G.forEach((g, gi) => {
          const tAt = s(2) + (gi * D2) / 4.4;
          const named = A.now() >= tAt;
          let f = rect(g.x, g.y, g.w, g.h, { fill: named ? C.white : 'none', stroke: named ? C.navy : C.line, sw: 3, r: 18, dash: named ? undefined : '14 10' });
          o += show(f, { at: s(1) + 0.1, from: 'none' });
          if (named) {
            o += show(text(g.x + 30, g.y + 40, g.title, { size: 32, weight: 700 }) + text(g.x + g.w - 30, g.y + 40, String(g.names.length), { size: 30, weight: 700, fill: C.slate, anchor: 'end' }), { at: tAt, from: 'up', dist: 12, d: 0.4 });
          }
        });
        // icons: appear scattered at s(0), then fly into their class
        items.forEach((it, i) => {
          const icon = server(it.fx, it.fy, { s: 0.5, label: it.n, labelSize: 22 });
          const tMove = s(1) + 0.6 + i * 0.13;
          o += move(show(icon, { at: s(0) + 0.3 + i * 0.1, d: 0.4, from: 'none' }), { at: tMove, d: 0.9, dx: it.sx - it.fx, dy: it.sy - it.fy });
        });
        // item 1: why a class
        o += show(card({ x: 1260, y: 640, w: 560, h: 300, kind: 'good', title: 'One class', body: ['same risk', 'same people'], size: 38, bodySize: 32 }), { at: s(1) + 3.0, from: 'right', dist: 40 });
        return o;
      },

      // ---------------------------------------------------------------- 13.2
      '13.2': ({ s, e }) => {
        let o = heading('Accounts, and what they may do');
        const D1 = e(1) - s(1);
        const ACC = [
          { n: 'deploy', sub: 'releases' },
          { n: 'appsvc', sub: 'internal tools' },
          { n: 'root', sub: 'administration' },
          { n: 'audit', sub: 'security' },
        ];
        const cw = 400, ch = 350, cy0 = 290;
        const lit = A.now() >= s(3);
        ACC.forEach((a, i) => {
          const x = 110 + i * (cw + 30);
          const isAudit = a.n === 'audit';
          let g = rect(x, cy0, cw, ch, { fill: C.white, stroke: isAudit && lit ? C.green : C.navy, sw: 3, r: 18 });
          g += `<path d="M${x} ${cy0 + 18} a18 18 0 0 1 18 -18 h${cw - 36} a18 18 0 0 1 18 18 v${72 - 18} h${-cw} z" fill="${C.navy}"/>`;
          g += text(x + cw / 2, cy0 + 38, a.n, { size: 40, weight: 700, mono: true, fill: C.white, anchor: 'middle' });
          g += text(x + cw / 2, cy0 + 118, a.sub, { size: 30, fill: C.slate, anchor: 'middle', weight: 500 });
          o += show(g, { at: s(1) + 0.3 + i * Math.max(0.9, (D1 * 0.8) / 4), from: 'up', dist: 30 });
          if (isAudit) {
            const rows = [['✓', C.green, 'read access to logs'], ['✕', C.red, 'no sudo'], ['✕', C.red, 'no write on logs']];
            rows.forEach(([sym, col, label], k) => {
              const ry = cy0 + 190 + k * 52;
              o += show(mark(x + 44, ry, sym, { r: 18, color: col }) + text(x + 78, ry + 1, label, { size: 28, weight: 500 }), { at: s(3) + 0.9 + k * 0.9, from: 'left', dist: 20 });
            });
          }
        });
        // item 2: a principal only opens an account
        const sy = 745;
        o += show(tagL(110, sy, 'security', { kind: 'user', size: 30 }), { at: s(2), from: 'left', dist: 30 });
        o += arrow({ x1: 310, y1: sy, x2: 580, y2: sy, at: s(2) + 0.7, d: 0.7, color: C.orange, width: 5, label: 'opens', labelSize: 26 });
        o += show(chip(610, sy, 'audit', { kind: 'machine', size: 30, mono: true }), { at: s(2) + 1.3, from: 'pop', cx: 680, cy: sy, d: 0.4 });
        o += show(text(790, sy, 'The principal is the door. The account decides what is inside.', { size: 30, weight: 500, fill: C.slate }), { at: s(2) + 1.8, from: 'right', dist: 20 });
        // note
        o += show(chip(960, 905, 'Create the accounts with your normal provisioning', { kind: 'file', size: 28, anchor: 'middle' }), { at: s(3) + 3.2, from: 'up', dist: 14 });
        return o;
      },

      // ---------------------------------------------------------------- 13.3
      '13.3': ({ s, e }) => {
        let o = heading('The mapping per class');
        const x0 = 110, W = 1710;
        const colX = [110, 490, 1110, 1440], colW = [380, 620, 330, 380];
        const hy = 290, hh = 64, ry0 = 364, rp = 100, rh = 92;
        // column bands behind everything (item 4: root and audit, everywhere)
        // header
        let h = rect(x0, hy, W, hh, { fill: C.mist, stroke: C.line, sw: 2, r: 10 });
        ['Class', 'deploy / appsvc', 'root', 'audit'].forEach((c, i) => { h += text(colX[i] + 22, hy + hh / 2 + 1, c, { size: 28, weight: 700, mono: i > 0 }); });
        o += show(h, { at: s(0) - 0.2, from: 'up', dist: 14 });
        const ROWS = [
          { name: 'Dev', sub: 'dev-01 … dev-06', acc: 'deploy', tags: ['developers', 'sysadmins'] },
          { name: 'Internal tools', sub: 'ci, monitor', acc: 'appsvc', tags: ['developers', 'sysadmins'] },
          { name: 'Acme production', sub: 'acme-web, acme-db, acme-app', acc: 'deploy', tags: ['client-acme', 'sysadmins'] },
          { name: 'Internal sensitive', sub: 'vault, logs, backup, db-int', acc: null, tags: [] },
        ];
        ROWS.forEach((r, i) => {
          const y = ry0 + i * rp, cy = y + rh / 2;
          let g = rect(x0, y, W, rh, { fill: C.white, stroke: C.line, sw: 2, r: 10 });
          g += text(colX[0] + 22, cy - 15, r.name, { size: 30, weight: 700 }) + text(colX[0] + 22, cy + 22, r.sub, { size: 22, fill: C.slate });
          if (r.acc) {
            const accW = textW(r.acc, 28, true);
            g += text(colX[1] + 22, cy + 1, r.acc, { size: 28, mono: true, weight: 700 });
            g += text(colX[1] + 22 + accW + 14, cy + 1, '←', { size: 30, fill: C.slate });
            let tx = colX[1] + 22 + accW + 56;
            r.tags.forEach((t) => { const w = tagW(t, 26); g += tag(tx + w / 2, cy, t, { kind: t === 'sysadmins' ? 'soft' : 'user', size: 26 }); tx += w + 12; });
          } else g += text(colX[1] + 22, cy + 1, '—', { size: 36, fill: C.slate });
          o += show(g, { at: s(i) + 0.3, from: 'up', dist: 24 });
          // root + audit cells, filled in at item 4
          const tAt = s(4) + 0.3 + i * 0.35;
          o += show(tag(colX[2] + 22 + tagW('sysadmins', 26) / 2, cy, 'sysadmins', { kind: 'soft', size: 26 }), { at: tAt, from: 'pop', cx: colX[2] + 110, cy, d: 0.4 });
          o += show(tag(colX[3] + 22 + tagW('security', 26) / 2, cy, 'security', { kind: 'user', size: 26 }), { at: tAt + 0.12, from: 'pop', cx: colX[3] + 100, cy, d: 0.4 });
        });
        o += show(chip(110, 830, 'Globex and Initech: the same, with client-globex and client-initech', { kind: 'plain', size: 26 }), { at: s(2) + 1.6, from: 'up', dist: 14 });
        o += show(text(colX[2] + (colW[2] + colW[3]) / 2, 830, 'every class', { size: 28, weight: 700, anchor: 'middle', fill: C.orangeInk }), { at: s(4) + 1.5, from: 'up', dist: 12 });
        o += show(`<rect x="${colX[2] + 4}" y="${hy - 6}" width="${colW[2] + colW[3] - 8}" height="${rp * 4 + 76}" rx="14" fill="${C.orange}" fill-opacity="0.07" stroke="${C.orange}" stroke-width="3" stroke-dasharray="10 8"/>`, { at: s(4), from: 'none', d: 0.6 });
        void e;
        return o;
      },

      // ---------------------------------------------------------------- 13.4
      '13.4': ({ s, e }) => {
        let o = heading('Deploying the mappings');
        const D0 = e(0) - s(0), D1 = e(1) - s(1), D2 = e(2) - s(2), D3 = e(3) - s(3);
        const now = A.now();
        // ----- timeline
        const tFill = s(0) + 0.5;
        const tMap1 = Math.max(s(0) + 2.2, s(0) + D0 * 0.28);
        const tMap2 = tMap1 + 2.2;
        const tStale = tMap2 + 0.7;
        const tPress = s(1) + Math.max(3.4, D1 * 0.78);
        const tPushed = tPress + 0.4;
        const tX = s(3) + 0.3;
        const tDlg = s(3) + 0.8;
        const tRemove = Math.max(s(3) + 3.8, s(3) + D3 * 0.62);
        const tStale2 = tRemove + 0.5;
        void D2;
        // ----- the host card (left)
        const CX = 110, CY = 280, CW = 820, CH = 460;
        let c = rect(CX, CY, CW, CH, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
        c += `<path d="M${CX} ${CY + 16} a16 16 0 0 1 16 -16 h${CW - 32} a16 16 0 0 1 16 16 v${70 - 16} h${-CW} z" fill="${C.navy}"/>`;
        c += text(CX + 28, CY + 35, 'acme-web', { size: 34, weight: 700, mono: true, fill: C.white });
        o += show(c, { at: s(0) - 0.2, from: 'left', dist: 50 });
        // Stale pill + Mark pushed button live in the header while the host is stale
        const staleBadge = chip(CX + 205, CY + 35, 'Stale — needs push', { kind: 'warn', size: 24 });
        const markBtn = (flash) => button(CX + CW - 24 - 190, CY + 12, 190, 46, 'Mark pushed', { fill: flash ? C.green : C.white, stroke: flash ? C.green : C.white, ink: flash ? C.white : C.navy, size: 26 });
        const stale1 = show(staleBadge + markBtn(pressing(tPress)), { at: tStale, out: tPushed, from: 'down', dist: 10, d: 0.4, outD: 0.4 });
        const stale2 = show(staleBadge + markBtn(false), { at: tStale2, from: 'down', dist: 10, d: 0.4 });
        o += stale1 + stale2;
        // form: Principal / Local account / Map
        const lblY = CY + 106, inY = CY + 128;
        let f = text(CX + 30, lblY, 'Principal', { size: 24, weight: 500, fill: C.slate }) + text(CX + 390, lblY, 'Local account', { size: 24, weight: 500, fill: C.slate });
        f += rect(CX + 30, inY, 340, 56, { fill: C.white, stroke: C.line, sw: 2, r: 8 }) + rect(CX + 390, inY, 250, 56, { fill: C.white, stroke: C.line, sw: 2, r: 8 });
        const mapFlash = pressing(tMap1) || pressing(tMap2);
        f += button(CX + 660, inY, 130, 56, 'Map', { fill: mapFlash ? C.navy : C.white, ink: mapFlash ? C.white : C.navy, size: 28 });
        o += show(f, { at: s(0) + 0.1, from: 'up', dist: 14 });
        // typed values
        const typed = (str, at) => str.slice(0, Math.max(0, Math.floor((now - at) * 14)));
        let v = '';
        if (now >= tFill && now < tMap1 + 0.5) v += show(text(CX + 46, inY + 29, 'client-acme', { size: 28, mono: true, weight: 700, fill: C.orangeInk }), { at: tFill, from: 'none', d: 0.3 }) + text(CX + 406, inY + 29, typed('deploy', tFill + 0.4), { size: 28, mono: true, weight: 700 });
        else if (now >= tMap1 + 0.8 && now < tMap2 + 0.5) v += text(CX + 46, inY + 29, 'sysadmins', { size: 28, mono: true, weight: 700, fill: C.orangeInk }) + text(CX + 406, inY + 29, typed('root', tMap1 + 1.0), { size: 28, mono: true, weight: 700 });
        o += v;
        // Mappings list
        o += show(text(CX + 30, CY + 240, 'Mappings', { size: 32, weight: 700 }), { at: tMap1 - 0.2, from: 'up', dist: 10 });
        const rowSvg = (label, y, active) => {
          const xr = CX + CW - 30 - 66, yc = y + 31;
          return rect(CX + 30, y, CW - 60, 62, { fill: C.orangeSoft, stroke: C.orange, sw: 2, r: 10 }) +
            text(CX + 52, yc + 1, label, { size: 28, mono: true, weight: 700 }) +
            `<circle cx="${xr + 22}" cy="${yc}" r="22" fill="${active ? C.navy : C.white}" stroke="${active ? C.navy : C.slate}" stroke-width="2.5"/>` +
            text(xr + 22, yc, '×', { size: 34, anchor: 'middle', weight: 700, fill: active ? C.white : C.slate });
        };
        o += show(rowSvg('client-acme → deploy', CY + 280, false), { at: tMap1 + 0.2, from: 'up', dist: 16 });
        o += show(rowSvg('sysadmins → root', CY + 356, pressing(tX) || (now >= tX && now < tRemove)), { at: tMap2 + 0.2, from: 'up', dist: 16, out: tRemove, outD: 0.4 });
        // under the card: why the host is stale
        const note = chip(CX, 790, 'files changed, not on the server yet', { kind: 'warn', size: 26 });
        o += show(note, { at: tStale, out: tPushed, from: 'up', dist: 12 }) + show(note, { at: tStale2, from: 'up', dist: 12 });

        // ----- right side, item 0: the rendered files
        const fRoot = code({ x: 1405, y: 280, w: 415, size: 26, title: 'auth_principals/root', kind: 'file', lines: ['sysadmins'] });
        const fDep = code({ x: 960, y: 280, w: 415, size: 26, title: 'auth_principals/deploy', kind: 'file', lines: ['client-acme'] });
        o += show(fDep.svg, { at: tMap1 + 0.4, out: s(2) - 0.1, from: 'left', dist: 30, outD: 0.3 });
        o += show(fRoot.svg, { at: tMap2 + 0.4, out: s(2) - 0.1, from: 'left', dist: 30, outD: 0.3 });
        // item 1: Ansible, or by hand
        const tm = terminal({
          x: 960, y: 440, w: 860, size: 26, title: 'ansible',
          items: [
            { t: '$ ansible-playbook -i inventory.yml site.yml', at: s(1) + 0.4 },
            { t: 'TASK [auth_principals files]', out: true, at: s(1) + 1.9 },
            { t: 'changed: [acme-web]', out: true, at: s(1) + 2.6, color: C.greenBright },
          ],
        });
        o += show(tm.svg, { at: s(1) + 0.2, out: s(2) - 0.1, from: 'right', dist: 50, outD: 0.3 });
        o += show(chip(960, 440 + tm.h + 50, 'or copy the files by hand', { kind: 'plain', size: 28 }), { at: s(1) + 1.6, out: s(2) - 0.1, from: 'up', dist: 12, outD: 0.3 });
        // item 2: automation confirms the push with a hash
        const api = code({ x: 960, y: 280, w: 860, size: 26, title: 'automation: confirm the push', kind: 'file', lines: ['POST /api/v1/external/ssh/hosts/', '     acme-web/principals-pushed', '{"sha256": "…"}'] });
        o += show(api.svg, { at: s(2) + 0.1, out: s(3) - 0.1, from: 'right', dist: 50, outD: 0.3 });
        o += show(text(960, 280 + api.h + 44, 'sha256 = hash of the principals files', { size: 28, fill: C.slate, weight: 500 }), { at: s(2) + 1.6, out: s(3) - 0.1, from: 'up', dist: 12, outD: 0.3 });
        o += show(chip(960, 280 + api.h + 112, '200', { kind: 'good', size: 32, mono: true }), { at: s(2) + Math.max(2.4, D2 * 0.6), out: s(3) - 0.1, from: 'pop', cx: 1010, cy: 280 + api.h + 112, outD: 0.3 });
        // item 3: remove with the cross
        const DX = 960, DY = 330, DW = 860, DH = 390;
        let dlg = rect(DX + 8, DY + 10, DW, DH, { fill: '#000000', stroke: 'none', sw: 0, r: 18, opacity: 0.12 });
        dlg += rect(DX, DY, DW, DH, { fill: C.white, stroke: C.navy, sw: 3, r: 18 });
        dlg += text(DX + 34, DY + 54, 'Remove mapping sysadmins → root?', { size: 34, weight: 700 });
        ['This host keeps accepting principal “sysadmins” for', 'login as “root” until the updated auth_principals', 'files are deployed to it. Until then the host shows', '“Stale — needs push”.'].forEach((ln, i) => { dlg += text(DX + 34, DY + 118 + i * 38, ln, { size: 26, fill: C.body }); });
        const rmFlash = pressing(tRemove - 0.4);
        dlg += button(DX + DW - 34 - 270, DY + DH - 82, 270, 58, 'Remove mapping', { fill: rmFlash ? C.slate : C.navy, stroke: C.navy, ink: C.white, size: 28 });
        dlg += button(DX + DW - 34 - 270 - 20 - 150, DY + DH - 82, 150, 58, 'Cancel', { size: 28, weight: 500, stroke: C.line, ink: C.slate });
        o += show(dlg, { at: tDlg, out: tRemove, from: 'up', dist: 30, outD: 0.4 });
        o += nextCard('14 People and profiles', s(3));
        return o;
      },
    },
  };
})();
