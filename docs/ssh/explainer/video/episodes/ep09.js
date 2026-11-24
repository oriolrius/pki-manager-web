// Episode 09 — Automation: fleet tokens and Ansible.
(function () {
  const { C, KIND, show, text, rect, card, chip, code, terminal, arrow, server, person, mark, nextCard, heading, ease, prog, lerp, clamp } = A;

  /** Playbook document icon (centre-anchored). */
  function playbook(cx, cy, { s = 1, label = 'playbook' } = {}) {
    const w = 130 * s, h = 160 * s, x = cx - w / 2, y = cy - h / 2;
    let o = `<path d="M${x} ${y + 10 * s} a10 10 0 0 1 10 -10 h${w - 40 * s} l${40 * s} ${40 * s} v${h - 50 * s} a10 10 0 0 1 -10 10 h${-(w - 10)} a10 10 0 0 1 -10 -10 z" fill="${C.white}" stroke="${C.navy}" stroke-width="3.5"/>`;
    o += `<path d="M${x + w - 40 * s} ${y} v${40 * s} h${40 * s}" fill="${C.mist}" stroke="${C.navy}" stroke-width="3.5"/>`;
    o += `<path d="M${cx - 18 * s} ${cy - 6 * s} l${44 * s} ${26 * s} l${-44 * s} ${26 * s} z" fill="${C.green}"/>`;
    o += rect(x + 18 * s, y + 20 * s, 44 * s, 8 * s, { fill: C.line, stroke: 'none', sw: 0, r: 4 });
    if (label) o += text(cx, y + h + 28, label, { size: 26, weight: 700, anchor: 'middle' });
    return o;
  }
  function clockIcon(cx, cy, r = 20, color = C.navy) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.white}" stroke="${color}" stroke-width="3.5"/>` +
      `<path d="M${cx} ${cy - r * 0.6} V${cy} L${cx + r * 0.5} ${cy + r * 0.25}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
  }
  /** Field box with label (UI redraw). */
  function field(x, y, w, label, value, { kind = 'file', size = 24, valueMono = false, lx = 30, fx = 250 } = {}) {
    const k = KIND[kind];
    return text(x + lx, y + 28, label, { size, fill: C.muted, weight: 500 }) +
      rect(x + fx, y, w, 56, { fill: kind === 'ghost' ? C.white : k.soft, stroke: k.stroke, sw: 2, r: 10 }) +
      text(x + fx + 18, y + 29, value, { size, mono: valueMono, fill: kind === 'ghost' ? C.muted : C.navy, weight: 500 });
  }
  /** SVG collapses spaces: keep code indentation with no-break spaces. */
  const nb = (l) => l.replace(/ /g, '\u00A0');
  function tick(cx, cy, on) {
    return rect(cx - 15, cy - 15, 30, 30, { fill: on ? C.green : C.white, stroke: on ? C.green : C.slate, sw: 2.5, r: 6 }) +
      (on ? text(cx, cy + 1, '✓', { size: 24, fill: C.white, anchor: 'middle', weight: 700 }) : '');
  }

  EPISODES['09'] = {
    scenes: {
      // ---------------------------------------------------------------
      '09.1': ({ s }) => {
        let o = heading('Manual does not scale');
        const phase1 = 1 - ease(clamp((A.now() - (s(1) - 0.2)) / 0.5));
        if (phase1 > 0.01) {
          let g = person(250, 590, { s: 0.9, label: 'you', labelSize: 26 });
          g += server(1500, 590, { s: 1.1, label: 'web1.acme.example', labelSize: 26 });
          const files = [['host certificate', 'host'], ['CA public keys', 'file'], ['principals file', 'file'], ['sshd config', 'file']];
          files.forEach(([f, k], i) => {
            const at = s(0) + 0.3 + i * 0.7;
            const p = ease(prog(at, 1.1));
            const cx = lerp(480, 1300, p);
            if (A.now() < at) return;
            const op = 1 - ease(clamp((p - 0.82) / 0.18));
            if (op > 0.01) g += `<g opacity="${op.toFixed(3)}">` + card({ x: cx - 140, y: 485 + i * 70 - 32, w: 280, h: 64, kind: k, title: f, size: 24 }) + '</g>';
          });
          g += text(870, 380, 'copy the files by hand', { size: 30, anchor: 'middle', fill: C.slate, weight: 500 });
          o += `<g opacity="${phase1.toFixed(3)}">${g}</g>`;
        }
        // phase 2: twenty servers + one playbook
        const t2 = s(1) + 0.2;
        if (A.now() >= t2) {
          const busX = 1020;
          o += show(playbook(250, 560, { s: 1.1, label: 'Ansible playbook' }), { at: t2, from: 'left' });
          o += arrow({ x1: 340, y1: 560, x2: busX, y2: 560, at: t2 + 0.5, d: 0.7, color: C.green, width: 5, head: false });
          o += `<line x1="${busX}" y1="330" x2="${busX}" y2="850" stroke="${C.green}" stroke-width="5" opacity="${ease(prog(t2 + 1.1, 0.5))}"/>`;
          for (let r = 0; r < 5; r++) {
            const y = 330 + r * 130;
            o += arrow({ x1: busX, y1: y, x2: 1700, y2: y, at: t2 + 1.2 + r * 0.15, d: 0.6, color: C.green, width: 3, head: false });
            for (let c = 0; c < 4; c++) {
              o += show(server(1160 + c * 160, y, { s: 0.52 }), { at: t2 + 1.4 + (r * 4 + c) * 0.05, d: 0.35, from: 'none' });
            }
          }
          o += show(chip(250, 800, 'fleet token', { kind: 'file', size: 26, anchor: 'middle' }) + chip(250, 870, 'Ansible role', { kind: 'host', size: 26, anchor: 'middle' }), { at: s(1) + 2.2 });
          o += show(text(1430, 955, '20 servers, one run', { size: 30, anchor: 'middle', weight: 700, fill: C.green }), { at: t2 + 2.4 });
        }
        return o;
      },

      // ---------------------------------------------------------------
      '09.2': ({ s }) => {
        let o = heading('Fleet tokens');
        // phase A: what a token is (s0 + s1)
        const a = 1 - ease(clamp((A.now() - (s(2) - 0.1)) / 0.5));
        if (a > 0.01) {
          let g = '';
          g += show(rect(460, 290, 1000, 170, { fill: C.mist, stroke: C.slate, sw: 3, r: 18 }) +
            text(960, 345, 'fleet token', { size: 30, weight: 700, anchor: 'middle' }) +
            text(960, 405, 'pkimg_3f9a1c7e…', { size: 40, mono: true, anchor: 'middle', fill: C.navy, weight: 700 }), { at: s(0) + 0.2, from: 'pop', cx: 960, cy: 375 });
          g += show(text(960, 505, 'a secret string for the automation API', { size: 28, anchor: 'middle', fill: C.slate }), { at: s(0) + 1.2 });
          const sc = [['one zone', 'machine', 'zone: prod'], ['its CAs', 'host', 'Host CA'], ['a list of operations', 'file', 'sign-host · get-principals · …']];
          sc.forEach(([t, k, v], i) => {
            g += show(card({ x: 150 + i * 580, y: 580, w: 540, h: 190, kind: k, title: t, body: [v], size: 30, bodySize: 26 }), { at: s(1) + 0.3 + i * 0.9 });
          });
          o += `<g opacity="${a.toFixed(3)}">${g}</g>`;
        }
        // phase B: Fleet tokens page (from s2)
        if (A.now() >= s(2) - 0.1) {
          const ux = 110, uy = 270, uw = 1010, uh = 650;
          let ui = rect(ux, uy, uw, uh, { fill: C.white, stroke: C.line, sw: 3, r: 14 });
          ui += `<path d="M${ux} ${uy + 14} a14 14 0 0 1 14 -14 h${uw - 28} a14 14 0 0 1 14 14 v${42} h${-uw} z" fill="${C.navy}"/>`;
          ui += text(ux + 26, uy + 28, 'SSH  ›  Fleet tokens', { size: 26, weight: 700, fill: C.white });
          o += show(ui, { at: s(2), from: 'up' });
          const fy = uy + 80;
          o += show(field(ux, fy, 700, 'Name', 'acme-fleet', { valueMono: true }), { at: s(2) + 0.5, from: 'none' });
          o += show(field(ux, fy + 76, 700, 'Zone', 'prod', {}), { at: s(2) + 0.7, from: 'none' });
          o += show(field(ux, fy + 152, 700, 'Preset', 'Self-provisioning host with KRL (recommended)', { kind: 'user', size: 23 }), { at: s(3) + 0.1, from: 'none' });
          // operations ticks
          const ops = ['sign-host', 'get-principals', 'register-host-pubkey'];
          const opsY = fy + 240;
          o += show(text(ux + 30, opsY + 20, 'Operations', { size: 24, fill: C.muted, weight: 500 }), { at: s(3) + 0.3, from: 'none' });
          let ox = ux + 250;
          ops.forEach((q, i) => {
            const w = q.length * 12.6 + 40;
            const at = s(3) + 0.8 + i * 0.5;
            o += show(tick(ox + 15, opsY + 20, true) + text(ox + 40, opsY + 21, q, { size: 24, mono: true }), { at, from: 'none' });
            ox += w + 24;
            void w;
          });
          o += show(field(ux, opsY + 70, 540, 'Host CA', 'Host CA ✓ preselected', { kind: 'host' }), { at: s(3) + 2.4, from: 'none' });
          o += show(field(ux, opsY + 146, 540, 'User CA', 'Not needed', { kind: 'ghost' }), { at: s(3) + 2.7, from: 'none' });
          // Mint token button
          const pressed = A.now() >= s(4) - 0.05;
          o += show(chip(ux + 30, uy + uh - 52, 'Mint token', { kind: pressed ? 'host' : 'user', size: 28 }), { at: s(3) + 3.0, from: 'none' });
          // caption: module
          o += show(text(960, 962, 'also: ssh_token_mint in the Ansible module', { size: 26, anchor: 'middle', fill: C.slate, mono: false }), { at: s(2) + 1.0 });
          // panel
          let pn = rect(1160, 290, 650, 330, { fill: C.amberSoft, stroke: C.amber, sw: 3, r: 16 });
          pn += text(1190, 335, 'Token "acme-fleet" created. Copy it now.', { size: 24, weight: 700, fill: '#6B4000' });
          pn += rect(1190, 375, 590, 64, { fill: C.white, stroke: C.amber, sw: 2, r: 10 }) + text(1210, 408, 'pkimg_3f9a1c7e5b…', { size: 28, mono: true });
          pn += chip(1700, 408, 'Copy', { kind: 'plain', size: 24, anchor: 'middle' });
          pn += text(1190, 490, 'You will not see this token again.', { size: 28, weight: 700, fill: C.amber });
          pn += text(1190, 545, 'PKI Manager keeps only a hash.', { size: 26, fill: '#6B4000' });
          o += show(pn, { at: s(4) + 0.3, from: 'left' });
          // vault
          const vx = 1480, vy = 790;
          let v = rect(vx - 110, vy - 100, 220, 200, { fill: C.navy, stroke: C.navyDeep, sw: 3, r: 18 });
          v += `<circle cx="${vx}" cy="${vy}" r="52" fill="none" stroke="${C.orange}" stroke-width="8"/>` + `<circle cx="${vx}" cy="${vy}" r="12" fill="${C.orange}"/>`;
          v += `<path d="M${vx} ${vy - 46} v30 M${vx + 46} ${vy} h-30 M${vx} ${vy + 46} v-30 M${vx - 46} ${vy} h30" stroke="${C.orange}" stroke-width="6"/>`;
          v += text(vx, vy + 135, 'Ansible Vault', { size: 28, weight: 700, anchor: 'middle' });
          o += show(v, { at: s(5) - 0.2, from: 'up' });
          // token drops into the vault
          if (A.now() >= s(5)) {
            const p = ease(prog(s(5) + 0.1, 1.0));
            const cx = lerp(1480, vx, p), cy = lerp(650, vy - 60, p);
            const op = 1 - ease(clamp((p - 0.85) / 0.15));
            o += `<g opacity="${op.toFixed(3)}">` + chip(cx, cy, 'pkimg_…', { kind: 'file', size: 24, anchor: 'middle', mono: true }) + '</g>';
          }
        }
        return o;
      },

      // ---------------------------------------------------------------
      '09.3': ({ s, e }) => {
        let o = heading('The Ansible role');
        const yaml = code({
          x: 110, y: 270, w: 960, size: 26, title: 'site.yml', kind: 'file',
          lines: [
            nb('- hosts: sshservers'),
            nb('  become: true'),
            nb('  vars:'),
            nb('    ssh_ca_base_url: https://pki.acme.example'),
            nb('    ssh_ca_fleet_token: "{{ vault_fleet_token }}"'),
            nb('  roles:'),
            nb('    - oriolrius.pki_manager.ssh_host_cert'),
          ],
          lineAt: [s(0) + 0.2, s(0) + 0.45, s(0) + 0.7, s(0) + 0.95, s(0) + 1.2, s(0) + 1.45, s(0) + 1.7],
          hl: [{ line: 6, at: s(0) + 2.3, color: C.green, opacity: 0.2 }],
        });
        o += yaml.svg;
        const term = terminal({ x: 110, y: 270 + yaml.h + 40, w: 960, size: 26, title: 'controller', items: [{ t: '$ ansible-playbook site.yml', at: s(1) + 0.2 }] });
        o += show(term.svg, { at: s(1), from: 'up' });
        const d3 = e(3) - s(3);
        const phases = [
          ['1', 'key + cert + CA keys', 'host', s(2) + 0.2],
          ['2', 'principals', 'file', s(3) + 0.35 * d3],
          ['3', 'sshd config', 'file', s(3) + 0.55 * d3],
          ['4', 'renewal', 'user', s(3) + 0.78 * d3],
        ];
        phases.forEach(([n, label, kind, at], i) => {
          const y = 285 + i * 165;
          const on = A.now() >= at;
          const p = ease(prog(at, 0.5));
          const k = KIND[kind === 'user' ? 'machine' : kind];
          const fill = on ? (kind === 'host' ? C.green : kind === 'user' ? C.navy : C.slate) : C.white;
          const stroke = on ? (kind === 'host' ? '#0A7C58' : kind === 'user' ? C.navyDeep : C.slate) : C.line;
          const tc = on ? C.white : C.muted;
          void k; void p;
          o += rect(1150, y, 660, 125, { fill, stroke, sw: on ? 4 : 3, r: 16, dash: on ? undefined : '10 8' });
          o += `<circle cx="1210" cy="${y + 62}" r="28" fill="${on ? C.white : C.line}"/>` + text(1210, y + 64, n, { size: 30, weight: 700, anchor: 'middle', fill: C.navy });
          o += text(1262, y + 62, label, { size: 32, weight: 700, fill: tc });
          if (i < 3) o += `<path d="M1480 ${y + 125} v40" stroke="${C.line}" stroke-width="3"/>`;
        });
        return o;
      },

      // ---------------------------------------------------------------
      '09.4': ({ s }) => {
        let o = heading('Turn on revocation');
        o += show(chip(110, 262, 'default: an empty revocation list', { kind: 'file', size: 26 }), { at: s(0) + 0.2 });
        const y = code({
          x: 110, y: 330, w: 1300, size: 24, title: 'group_vars/sshservers.yml', kind: 'file',
          lines: [
            nb('    ssh_host_cert_ecies_enabled: true          # encrypted KRL channel'),
            nb('    ssh_host_cert_krl_client_url: https://artifacts.acme.example/krl-client-linux-amd64'),
            nb('    ssh_host_cert_krl_client_checksum: "sha256:…"'),
          ],
          lineAt: [s(1) + 0.2, s(2) + 0.2, s(2) + 1.0],
          hl: [{ line: 0, at: s(1) + 0.5, color: C.green, opacity: 0.2 }],
        });
        o += y.svg;
        const ny = 330 + y.h + 40;
        o += show(card({ x: 110, y: ny, w: 600, h: 140, kind: 'warn', title: 'Also on the PKI Manager server', body: ['backend: SSH_ECIES_ENABLED=true'], size: 28, bodySize: 26, mono: true }), { at: s(3) + 0.2, from: 'up' });
        // servers with krl-client + 15 minute clock
        const gy = 790;
        [0, 1, 2].forEach((i) => {
          const gx = 790 + i * 340;
          const at = s(2) + 1.8 + i * 0.5;
          o += show(server(gx, gy, { s: 0.62, label: `web${i + 1}`, labelSize: 24 }), { at: s(2) + 1.4, from: 'none' });
          o += show(rect(gx + 60, gy - 38, 230, 90, { fill: C.white, stroke: C.navy, sw: 3, r: 12 }) + clockIcon(gx + 96, gy + 7, 22) +
            text(gx + 130, gy - 10, 'krl-client', { size: 24, weight: 700, mono: true }) + text(gx + 130, gy + 26, 'every 15 min', { size: 22, fill: C.muted }), { at, from: 'pop', cx: gx + 175, cy: gy + 7 });
        });
        return o;
      },

      // ---------------------------------------------------------------
      '09.5': ({ s }) => {
        let o = heading('Order matters');
        const xs = [130, 530, 930, 1330], W = 360, H = 120;
        const node = (col, y, kind, title, body, at) => {
          let g = card({ x: xs[col], y, w: W, h: H, kind, title, body: body ? [body] : [], size: 28, bodySize: 23 });
          return show(g, { at, from: 'left', dist: 30 });
        };
        const link = (c1, y, at, color = C.slate) => arrow({ x1: xs[c1] + W + 6, y1: y + H / 2, x2: xs[c1 + 1] - 6, y2: y + H / 2, at, d: 0.4, color, width: 4 });
        // wrong
        const y1 = 330, y2 = 540, y3 = 750;
        o += show(chip(130, y1 - 38, 'Wrong', { kind: 'danger', size: 26 }), { at: s(0) + 0.1 });
        o += node(0, y1, 'file', 'role run', 'principals file: empty', s(0) + 1.0);
        o += link(0, y1, s(0) + 1.8);
        o += node(1, y1, 'file', 'mappings created', null, s(0) + 2.3);
        o += link(1, y1, s(0) + 3.0, C.red);
        o += node(2, y1, 'danger', 'login denied', 'file never updated', s(0) + 3.6);
        // right
        o += show(chip(130, y2 - 38, 'Right', { kind: 'good', size: 26 }), { at: s(1) + 0.1 });
        o += node(0, y2, 'file', 'role run', null, s(1) + 0.3);
        o += link(0, y2, s(1) + 1.0);
        o += node(1, y2, 'file', 'create mappings', null, s(1) + 1.4);
        o += link(1, y2, s(1) + 2.2);
        o += node(2, y2, 'host', 'role run again', 'principals written', s(1) + 2.6);
        o += link(2, y2, s(1) + 3.4, C.green);
        o += node(3, y2, 'good', 'login OK', null, s(1) + 3.8);
        // or
        o += show(chip(130, y3 - 38, 'Or', { kind: 'host', size: 26 }), { at: s(2) + 0.1 });
        o += node(0, y3, 'host', 'register host first', 'in PKI Manager', s(2) + 0.3);
        o += link(0, y3, s(2) + 1.1);
        o += node(1, y3, 'file', 'role run', 'mappings already exist', s(2) + 1.4);
        o += link(1, y3, s(2) + 2.2, C.green);
        o += node(2, y3, 'good', 'login OK', null, s(2) + 2.5);
        return o;
      },

      // ---------------------------------------------------------------
      '09.6': ({ s }) => {
        let o = heading('Robots and CI');
        // CI icon
        const ci = rect(110, 330, 190, 150, { fill: C.navy, stroke: C.navyDeep, sw: 3, r: 18 }) +
          text(205, 385, 'CI', { size: 56, weight: 700, anchor: 'middle', fill: C.white }) + text(205, 440, 'pipeline', { size: 26, anchor: 'middle', fill: '#C9CAE6' });
        o += show(ci, { at: s(0) + 0.1, from: 'left' });
        o += arrow({ x1: 310, y1: 405, x2: 470, y2: 405, at: s(0) + 0.8, d: 0.5, color: C.slate, width: 4 });
        o += show(rect(480, 372, 560, 66, { fill: C.mist, stroke: C.slate, sw: 2.5, r: 12 }) + text(760, 406, 'POST /api/v1/external/ssh/sign-user', { size: 24, mono: true, anchor: 'middle', weight: 700 }), { at: s(0) + 1.0, from: 'none' });
        o += arrow({ x1: 1050, y1: 405, x2: 1130, y2: 405, at: s(0) + 1.8, d: 0.5, color: C.orange, width: 4 });
        // certificate
        let c = rect(1140, 290, 670, 270, { fill: C.orange, stroke: C.orangeInk, sw: 3, r: 18 });
        c += text(1170, 335, 'user certificate (robot)', { size: 30, weight: 700, fill: C.white });
        c += rect(1170, 365, 610, 66, { fill: C.white, stroke: 'none', sw: 0, r: 10 }) + text(1190, 399, 'force-command: /usr/bin/rsync …', { size: 24, mono: true, fill: C.navy });
        c += rect(1170, 450, 610, 66, { fill: C.white, stroke: 'none', sw: 0, r: 10 }) + text(1190, 484, 'source-address: 10.0.0.0/8', { size: 24, mono: true, fill: C.navy });
        o += show(rect(1140, 290, 670, 70, { fill: C.orange, stroke: C.orangeInk, sw: 3, r: 18 }) + text(1170, 325, 'user certificate (robot)', { size: 30, weight: 700, fill: C.white }), { at: s(0) + 2.4, from: 'right' });
        // options: lock lines
        const full = (A.now() >= s(1) + 0.1);
        if (full) o += show(c, { at: s(1) + 0.1, d: 0.5, from: 'none' });
        o += show(text(1475, 580, 'locked to one command and to source addresses', { size: 24, anchor: 'middle', fill: C.orangeInk, weight: 500 }), { at: s(1) + 1.6 });
        // warning + fix
        o += show(rect(110, 640, 900, 250, { fill: C.amberSoft, stroke: C.amber, sw: 3, r: 16 }) +
          text(140, 685, 'Risk: renewal keeps the token on the host', { size: 28, weight: 700, fill: '#6B4000' }) +
          text(140, 745, 'renewal stores the token in', { size: 26, fill: '#6B4000' }) +
          text(140, 795, '/etc/pki-manager/ssh-renew.env (0600)', { size: 26, mono: true, weight: 700, fill: '#6B4000' }), { at: s(2) + 0.2, from: 'up' });
        o += show(rect(1040, 640, 770, 250, { fill: C.greenSoft, stroke: C.green, sw: 3, r: 16 }) +
          text(1070, 685, 'Avoid it: renew from the controller', { size: 28, weight: 700, fill: '#075C41' }) +
          text(1070, 755, 'ssh_host_cert_renew_enabled: false', { size: 26, mono: true, weight: 700, fill: '#075C41' }) +
          text(1070, 820, 'no token stored on the host', { size: 26, fill: '#075C41' }), { at: s(3) + 0.3, from: 'up' });
        o += nextCard('10 Recap', s(3) + 2);
        return o;
      },
    },
  };
})();
