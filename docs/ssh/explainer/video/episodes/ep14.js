// Episode 14 — People and profiles (series 2, principals in depth).
// Scene functions get ctx: { t, s(k), e(k), dur, n } — s(k)/e(k) = start/end (scene-local s) of narration item k.
(function () {
  const { C, show, text, rect, card, arrow, server, lock, heading, nextCard, mark, ease, prog, textW } = A;

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
  const tagL = (x, cy, label, o = {}) => tag(x + tagW(label, o.size ?? 30) / 2, cy, label, o);
  /** Pill sized to its label with a safe margin (A.chip underestimates wide text). */
  function chip(x, y, label, { kind = 'user', size = 26, anchor = 'start', mono = false } = {}) {
    const k = A.KIND[kind];
    const w = textW(label, size, mono) * 1.1 + size * 1.5, h = size * 1.6;
    const x0 = anchor === 'middle' ? x - w / 2 : x;
    return rect(x0, y - h / 2, w, h, { fill: k.fill, stroke: k.stroke, sw: 2, r: h / 2 }) +
      text(x0 + w / 2, y + 1, label, { size, fill: k.text, anchor: 'middle', weight: 500, mono });
  }
  /** Caption at y 958 that can fade out. */
  const cap = (str, { at, out, kind } = {}) => show(text(960, 958, str, { size: 30, anchor: 'middle', weight: 500, fill: kind === 'good' ? C.green : kind === 'bad' ? C.red : C.slate }), { at, out, from: 'up', dist: 14, outD: 0.3 });

  // ---------- the fleet map ----------
  // 6 class boxes; each has its server icons and its account slots. Slots light up at given times.
  const GROUPS = [
    { id: 'dev', title: 'Dev', n: 6, accts: ['deploy', 'root', 'audit'], x: 110, y: 440 },
    { id: 'tools', title: 'Internal tools', n: 2, accts: ['appsvc', 'root', 'audit'], x: 680, y: 440 },
    { id: 'sens', title: 'Internal sensitive', n: 4, accts: ['root', 'audit'], x: 1250, y: 440 },
    { id: 'acme', title: 'Acme production', n: 3, accts: ['deploy', 'root', 'audit'], x: 110, y: 680 },
    { id: 'globex', title: 'Globex production', n: 2, accts: ['deploy', 'root', 'audit'], x: 680, y: 680 },
    { id: 'initech', title: 'Initech production', n: 2, accts: ['deploy', 'root', 'audit'], x: 1250, y: 680 },
  ];
  const GW = 550, GH = 215;
  const slotW = (label, locked) => textW(label, 24, true) * 1.1 + 40 + (locked ? 30 : 0);

  /**
   * lights: { groupId: { account: time } }  -> slot lights up (green) at time
   * locks:  { groupId: { account: time } }  -> slot shows a lock (denied) at time
   */
  function fleetMap({ lights = {}, locks = {} }) {
    let o = '';
    GROUPS.forEach((g) => {
      const L = lights[g.id] || {};
      const K = locks[g.id] || {};
      const times = Object.values(L);
      const first = times.length ? Math.min(...times) : null;
      // box: grey by default, green once something is allowed
      o += rect(g.x, g.y, GW, GH, { fill: C.white, stroke: C.line, sw: 3, r: 16 });
      if (first != null) o += show(rect(g.x, g.y, GW, GH, { fill: C.greenSoft, stroke: C.green, sw: 3.5, r: 16 }), { at: first, from: 'none', d: 0.5 });
      o += text(g.x + 28, g.y + 36, g.title, { size: 28, weight: 700, fill: first != null && A.now() >= first ? C.navy : C.muted });
      // servers (pale, then navy when the box is lit)
      const sx = (i) => g.x + 58 + i * 64, sy = g.y + 108;
      for (let i = 0; i < g.n; i++) o += server(sx(i), sy, { s: 0.34, color: '#C4C6D6' });
      if (first != null) for (let i = 0; i < g.n; i++) o += show(server(sx(i), sy, { s: 0.34 }), { at: first, from: 'none', d: 0.5 });
      // account slots
      let x = g.x + 28;
      const y = g.y + GH - 40;
      g.accts.forEach((a) => {
        const locked = K[a] != null;
        const w = slotW(a, locked);
        const ghost = rect(x, y - 22, w, 44, { fill: C.white, stroke: C.line, sw: 2, r: 22 }) + text(x + (locked ? (w - 30) / 2 : w / 2), y + 1, a, { size: 24, mono: true, anchor: 'middle', fill: C.muted });
        o += ghost;
        if (L[a] != null) {
          o += show(rect(x, y - 22, w, 44, { fill: C.green, stroke: '#0A7C58', sw: 2, r: 22 }) + text(x + w / 2, y + 1, a, { size: 24, mono: true, anchor: 'middle', fill: C.white, weight: 700 }), { at: L[a], from: 'pop', cx: x + w / 2, cy: y, d: 0.4 });
        }
        if (locked) {
          o += show(rect(x, y - 22, w, 44, { fill: C.redSoft, stroke: C.red, sw: 2, r: 22 }) + text(x + (w - 30) / 2, y + 1, a, { size: 24, mono: true, anchor: 'middle', fill: '#8E1B1B', weight: 700 }) + lock(x + w - 24, y - 4, { s: 0.55, color: C.red }), { at: K[a], from: 'pop', cx: x + w / 2, cy: y, d: 0.4 });
        }
        x += w + 12;
      });
    });
    return o;
  }

  /** Person band: avatar, name, role, and the certificate's principal tags. tags: [{ label, at, kind, strike }] */
  function personBand(initial, name, role, tags, { at }) {
    const x = 110, y = 280, w = 1710, h = 120;
    let o = rect(x, y, w, h, { fill: C.white, stroke: C.orange, sw: 3, r: 16 }) + rect(x, y, 14, h, { fill: C.orange, stroke: 'none', sw: 0, r: 7 });
    o += `<circle cx="${x + 78}" cy="${y + h / 2}" r="38" fill="${C.navy}"/>` + text(x + 78, y + h / 2 + 2, initial, { size: 40, weight: 700, fill: C.white, anchor: 'middle' });
    o += text(x + 140, y + 42, name, { size: 36, weight: 700 }) + text(x + 140, y + 84, role, { size: 24, fill: C.slate });
    o += text(x + 500, y + h / 2, 'Principals', { size: 26, weight: 500, fill: C.slate });
    let out = show(o, { at, from: 'up', dist: 20 });
    let tx = x + 650;
    tags.forEach((t) => {
      const tw = tagW(t.label, 30), cy = y + h / 2;
      let g = tag(tx + tw / 2, cy, t.label, { kind: t.kind ?? 'user', size: 30 });
      if (t.strike) g += `<line x1="${tx - 6}" y1="${cy + 26}" x2="${tx + tw + 6}" y2="${cy - 26}" stroke="${C.red}" stroke-width="5" stroke-linecap="round"/>`;
      out += show(g, { at: t.at, from: 'pop', cx: tx + tw / 2, cy, d: 0.45 });
      tx += tw + 18;
    });
    return out;
  }

  EPISODES['14'] = {
    scenes: {
      // ---------------------------------------------------------------- 14.1
      '14.1': ({ s, e }) => {
        let o = heading('A junior developer');
        const D1 = e(1) - s(1), D2 = e(2) - s(2);
        o += personBand('A', 'Ana', 'junior developer · Acme', [
          { label: 'developers', at: s(1) + 0.5 },
          { label: 'client-acme', at: s(1) + Math.max(1.3, D1 * 0.6) },
        ], { at: s(0) });
        o += fleetMapShown({
          lights: {
            dev: { deploy: s(2) + 0.5 },
            tools: { appsvc: s(2) + Math.max(1.5, D2 * 0.25) },
            acme: { deploy: s(2) + Math.max(2.5, D2 * 0.5) },
          },
        }, s(0) + 0.6);
        o += cap('nothing else', { at: e(2) - 1.0, kind: 'good' });
        return o;
      },

      // ---------------------------------------------------------------- 14.2
      '14.2': ({ s, e }) => {
        let o = heading('Two customers');
        const D0 = e(0) - s(0);
        o += personBand('P', 'Pau', 'senior developer', [
          { label: 'developers', at: s(0) + 0.6 },
          { label: 'client-acme', at: s(0) + Math.max(1.6, D0 * 0.35) },
          { label: 'client-globex', at: s(0) + Math.max(2.6, D0 * 0.55) },
        ], { at: s(0) - 0.2 });
        o += fleetMapShown({
          lights: {
            dev: { deploy: s(0) + 1.0 },
            tools: { appsvc: s(0) + 1.2 },
            acme: { deploy: s(0) + Math.max(2.0, D0 * 0.4) },
            globex: { deploy: s(0) + Math.max(3.0, D0 * 0.62) },
          },
        }, s(0));
        o += cap('no change on any server', { at: s(1) + 0.6, kind: 'good' });
        return o;
      },

      // ---------------------------------------------------------------- 14.3
      '14.3': ({ s, e }) => {
        let o = heading('The sysadmin');
        const lights = {};
        const all = ['dev', 'tools', 'sens', 'acme', 'globex', 'initech'];
        all.forEach((g, i) => { lights[g] = { root: s(1) + 0.9 + i * 0.18 }; });
        const second = { dev: 'deploy', tools: 'appsvc', acme: 'deploy', globex: 'deploy', initech: 'deploy' };
        Object.entries(second).forEach(([g, a], i) => { lights[g][a] = s(1) + 2.3 + i * 0.15; });
        o += personBand('M', 'Marta', 'sysadmin', [{ label: 'sysadmins', at: s(1) + 0.3, kind: 'soft' }], { at: s(0) });
        o += fleetMapShown({ lights }, s(0) + 0.3);
        // item 2: no customer principal needed
        const bx = 110 + 650 + tagW('sysadmins', 30) + 60;
        o += show(tagL(bx, 340, 'client-acme', { kind: 'grey', size: 30 }) + `<line x1="${bx - 6}" y1="366" x2="${bx + tagW('client-acme', 30) + 6}" y2="314" stroke="${C.red}" stroke-width="5" stroke-linecap="round"/>`, { at: s(2) + 0.2, from: 'pop', cx: bx + 100, cy: 340 });
        o += cap('no customer principal needed', { at: s(2) + 0.8, kind: 'good' });
        return o;
      },

      // ---------------------------------------------------------------- 14.4
      '14.4': ({ s, e }) => {
        let o = heading('Security is not admin');
        const D0 = e(0) - s(0), D1 = e(1) - s(1);
        const all = ['dev', 'tools', 'sens', 'acme', 'globex', 'initech'];
        const lights = {}, locks = {};
        all.forEach((g, i) => { lights[g] = { audit: s(1) + 0.4 + i * 0.2 }; });
        all.forEach((g, i) => { locks[g] = { root: s(1) + Math.max(2.2, D1 * 0.55) + i * 0.15 }; });
        o += personBand('S', 'Sara', 'security lead', [
          { label: 'security', at: s(0) + Math.max(1.2, D0 * 0.4) },
          { label: 'sysadmins', at: s(0) + Math.max(2.6, D0 * 0.75), kind: 'grey', strike: true },
        ], { at: s(0) });
        o += fleetMapShown({ lights, locks }, s(0) + 0.3);
        o += cap('audits the logs ≠ changes the logs', { at: s(2) + 0.2, out: s(3) - 0.1 });
        o += cap('audit ≠ admin: separation of duties', { at: s(3) + 0.1, kind: 'good' });
        return o;
      },

      // ---------------------------------------------------------------- 14.5
      '14.5': ({ s, e }) => {
        let o = heading('Check before you issue');
        const D0 = e(0) - s(0), D2 = e(2) - s(2);
        const FX = 110, FY = 270, FW = 1710, FH = 600;
        // page frame + title band
        let pg = rect(FX, FY, FW, FH, { fill: C.white, stroke: C.navy, sw: 3, r: 16 });
        pg += `<path d="M${FX} ${FY + 16} a16 16 0 0 1 16 -16 h${FW - 32} a16 16 0 0 1 16 16 v${66 - 16} h${-FW} z" fill="${C.navy}"/>`;
        pg += text(FX + 30, FY + 35, 'Issue User Certificate', { size: 34, weight: 700, fill: C.white });
        o += show(pg, { at: s(0) - 0.2, from: 'up', dist: 20 });
        // field: Principals (roles) *
        o += show(text(FX + 30, FY + 104, 'Principals (roles) *', { size: 24, weight: 500, fill: C.slate }) + tagL(FX + 30, FY + 154, 'developers', { kind: 'soft', size: 28 }) + tagL(FX + 30 + tagW('developers', 28) + 14, FY + 154, 'client-acme', { kind: 'soft', size: 28 }), { at: s(0) + 0.3, from: 'up', dist: 14 });
        // panel: Where these principals grant login
        const PX = FX + 30, PY = FY + 200, PW = FW - 60, PH = 260;
        const readIt = A.now() >= s(1);
        let pn = rect(PX, PY, PW, PH, { fill: C.mist, stroke: readIt ? C.orange : C.line, sw: readIt ? 4 : 2.5, r: 14 });
        pn += text(PX + 26, PY + 38, 'Where these principals grant login', { size: 30, weight: 700 });
        pn += text(PX + PW - 26, PY + 38, 'in the identity’s zone', { size: 24, fill: C.slate, anchor: 'end' });
        o += show(pn, { at: s(0) + 0.9, from: 'up', dist: 16 });
        const ry = [PY + 110, PY + 190];
        const accChip = (x, y, a) => chip(x, y, a, { kind: 'machine', size: 24, mono: true });
        // row 1: developers
        const r1 = tagL(PX + 26, ry[0], 'developers', { kind: 'user', size: 26 }) + text(PX + 26 + tagW('developers', 26) + 18, ry[0] + 1, '→', { size: 32, fill: C.slate }) +
          text(PX + 470, ry[0] + 1, 'dev-01 … dev-06', { size: 26, mono: true }) + accChip(PX + 700, ry[0], 'deploy') +
          text(PX + 860, ry[0] + 1, 'ci', { size: 26, mono: true }) + accChip(PX + 910, ry[0], 'appsvc') + text(PX + 1060, ry[0] + 1, '…', { size: 30, fill: C.slate });
        o += show(r1, { at: s(0) + Math.max(1.8, D0 * 0.3), from: 'left', dist: 30 });
        // row 2: client-acme
        const r2 = tagL(PX + 26, ry[1], 'client-acme', { kind: 'user', size: 26 }) + text(PX + 26 + tagW('client-acme', 26) + 18, ry[1] + 1, '→', { size: 32, fill: C.slate }) +
          text(PX + 470, ry[1] + 1, 'acme-web, acme-db, acme-app', { size: 26, mono: true }) + accChip(PX + 880, ry[1], 'deploy');
        o += show(r2, { at: s(0) + Math.max(3.4, D0 * 0.6), from: 'left', dist: 30 });
        // item 1: read it before you click -> pointer to the button
        const BX = FX + FW - 30 - 300, BY = FY + FH - 30 - 64;
        o += show(rect(BX, BY, 300, 64, { fill: C.navy, stroke: C.navy, sw: 0, r: 12 }) + text(BX + 150, BY + 33, 'Issue Certificate', { size: 30, weight: 700, fill: C.white, anchor: 'middle' }), { at: s(0) + 1.2, from: 'up', dist: 14 });
        o += show(arrow({ x1: BX - 40, y1: BY + 32, x2: BX - 8, y2: BY + 32, at: s(1) + 0.5, d: 0.4, color: C.orange, width: 5 }) + text(BX - 56, BY + 33, 'read it first', { size: 28, weight: 700, anchor: 'end', fill: C.orangeInk }), { at: s(1) + 0.3, out: s(2) + 0.1, from: 'right', dist: 20 });
        // item 2: recorded mappings, not what is installed; check Stale
        const sy = FY + FH - 62;
        const c1 = card({ x: FX + 30, y: sy - 35, w: 400, h: 70, kind: 'good', title: 'Recorded in PKI Manager', size: 26 });
        const c2 = card({ x: FX + 30 + 400 + 70, y: sy - 35, w: 400, h: 70, kind: 'file', title: 'Installed on the server', size: 26 });
        o += show(c1, { at: s(2) + 0.2, from: 'up', dist: 16 });
        o += show(text(FX + 30 + 400 + 35, sy + 1, '≠', { size: 44, weight: 700, anchor: 'middle', fill: C.slate }), { at: s(2) + 0.9, from: 'pop', cx: FX + 465, cy: sy });
        o += show(c2, { at: s(2) + 1.2, from: 'up', dist: 16 });
        o += show(chip(FX + 30 + 940, sy, 'host not Stale?', { kind: 'warn', size: 28 }), { at: s(2) + Math.max(3.0, D2 * 0.75), from: 'pop', cx: FX + 1100, cy: sy });
        o += nextCard('15 Customers', s(2));
        void mark; void ease; void prog;
        return o;
      },
    },
  };

  /** fleetMap wrapped in a fade-in at `at` (the map is built with absolute light times). */
  function fleetMapShown(opts, at) {
    return show(fleetMap(opts), { at, from: 'up', dist: 20 });
  }
})();
