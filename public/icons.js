// Icon picker: search Dashboard Icons, selfh.st, Material Design and Simple Icons, pick a local
// icon, upload one, or download one from a URL into config/icons.
import {api, h, modal, iconUrl, toast} from './lib.js';

let index = null;
let served = null;

export async function iconIndex() {
  index ??= await api('/api/icons/index');
  return index;
}

// Only a positive answer is remembered: "not served" must be re-checked, since it's fixed by a
// change made outside the editor (an old cached "no" once told the user to redo that change).
export async function localIconsServed() {
  if (served?.served) return served;
  served = await api('/api/icons/served').catch(() => ({served: null}));
  return served;
}

export function refreshLocalIcons() { index = null; }

export const LOCAL_ICON_FIX = `In /root/homepage/docker-compose.yml, add this line under the homepage service's "volumes:"
      - /root/homepage/config/icons:/app/public/icons
then run:  cd /root/homepage && docker compose up -d`;

// Resolves with the chosen icon reference, or null if cancelled.
export function pickIcon(current = '', hint = '') {
  return new Promise(async resolve => {
    let picked = false;
    const m = modal('Choose an icon', {onClose: () => { if (!picked) resolve(null); }});
    const choose = ref => { picked = true; m.close(); resolve(ref); };

    const q = h('input', {placeholder: 'Search icons, e.g. frigate, proxmox, camera…', value: hint || ''});
    const source = h('select', {style: 'width:auto'},
      ['all', 'dashboard', 'selfhst', 'local', 'mdi', 'si'].map(v => h('option', {value: v},
        {all: 'All sources', dashboard: 'Dashboard Icons', selfhst: 'selfh.st icons', local: 'My icons (config/icons)', mdi: 'Material Design (mdi-)', si: 'Simple Icons (si-)'}[v])));
    const grid = h('div', {class: 'icon-grid'});
    const status = h('div', {class: 'hint'});
    const manual = h('input', {value: current, placeholder: 'or type a reference: name.svg, sh-name, mdi-name, si-name, /icons/file.png, https://…'});
    const manualPreview = h('span');
    const updateManual = () => {
      const url = iconUrl(manual.value.trim());
      manualPreview.replaceChildren(url ? h('img', {src: url, style: 'width:36px;height:36px;object-fit:contain'}) : '');
    };
    manual.addEventListener('input', updateManual);
    updateManual();

    const fileInput = h('input', {type: 'file', accept: 'image/*', style: 'display:none', onchange: async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const r = await api(`/api/icons/upload?name=${encodeURIComponent(file.name)}`, {method: 'POST', headers: {'Content-Type': file.type}, body: file});
        refreshLocalIcons();
        toast(`Saved ${r.file} to config/icons`);
        choose(r.ref);
      } catch (e) { toast(e.message, true); }
    }});
    const fromUrl = async () => {
      const url = prompt('Image URL to download into config/icons:');
      if (!url) return;
      const name = prompt('Save as (file name without extension):', hint || '') ?? '';
      try {
        const r = await api('/api/icons/fetch', {json: {url, name}});
        refreshLocalIcons();
        toast(`Downloaded ${r.file} to config/icons`);
        choose(r.ref);
      } catch (e) { toast(e.message, true); }
    };

    const warn = h('div');
    m.body.append(
      h('div', {class: 'toolbar', style: 'margin-top:10px'}, h('div', {style: 'flex:1;min-width:220px'}, q), source),
      warn, status, grid,
      h('label', {}, 'Use a specific reference'),
      h('div', {class: 'icon-field'}, manual, manualPreview),
      h('div', {class: 'hint'}, 'Dashboard Icons: "name" uses the PNG, "name.svg" the SVG. selfh.st: "sh-name". Colours for mdi/si: "mdi-name-#ff8800".'),
    );
    m.foot.append(
      h('button', {class: 'ghost', onclick: () => fileInput.click()}, 'Upload image…'), fileInput,
      h('button', {class: 'ghost', onclick: fromUrl}, 'Download from URL…'),
      h('span', {class: 'spacer'}),
      h('button', {class: 'ghost', onclick: () => m.close()}, 'Cancel'),
      h('button', {onclick: () => choose(manual.value.trim())}, 'Use reference'));

    status.textContent = 'Loading icon lists…';
    const idx = await iconIndex().catch(e => (toast(e.message, true), null));
    const svc = await localIconsServed();
    if (svc.served === false) {
      warn.replaceChildren(h('div', {class: 'banner'}, h('b', {}, 'Your own icons (config/icons) are not visible to Homepage yet. '),
        'Icons you upload are saved, but show as broken on your dashboard until this one-time fix:', h('pre', {}, LOCAL_ICON_FIX)));
    }

    // "PulseTower", "uptime-kuma", "home assistant" -> whole term plus its separate words.
    const words = text => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_.\-]+/).filter(w => w.length >= 3);

    function results() {
      const raw = q.value.trim();
      const term = raw.toLowerCase().replace(/\s+/g, '-');
      const parts = [...new Set([term.replace(/-/g, ''), ...words(raw)])].filter(Boolean);
      const src = source.value;
      const out = [];
      const seen = new Set();
      const add = (ref, label, from, guess = false) => { if (!seen.has(ref)) { seen.add(ref); out.push({ref, label, from, guess}); } };
      const hit = (...names) => !term || names.some(n => { const x = n.toLowerCase().replace(/[^a-z0-9]/g, ''); return parts.some(p => x.includes(p)); });
      const rank = (...names) => names.some(n => n.toLowerCase().replace(/[^a-z0-9]/g, '') === term.replace(/-/g, '')) ? 0 : 1;
      // The current icon's file, if it is one of your own icons (e.g. "icon-192.png" -> /icons/icon-192.png).
      const base = current?.split('/').pop();
      if (idx && base && idx.local.includes(base)) add(`/icons/${base}`, base, 'my icons (current file)');
      if (idx) {
        const found = [];
        if (src === 'all' || src === 'local')
          idx.local.filter(f => hit(f)).forEach(f => found.push([rank(f), `/icons/${f}`, f, 'my icons']));
        if (src === 'all' || src === 'dashboard') {
          const svg = new Set(idx.dashboard.svg);
          idx.dashboard.png.filter(n => hit(n)).slice(0, 400).forEach(n => found.push([rank(n), svg.has(n) ? `${n}.svg` : n, n, 'dashboard']));
        }
        if (src === 'all' || src === 'selfhst')
          idx.selfhst.filter(i => hit(i.ref, i.name)).slice(0, 300).forEach(i => found.push([rank(i.ref, i.name), i.svg ? `sh-${i.ref}.svg` : `sh-${i.ref}`, i.name, 'selfh.st']));
        found.sort((a, b) => a[0] - b[0]).forEach(([, ref, label, from]) => add(ref, label, from));
      }
      // No index for these two; try the typed words directly. Tiles that don't exist remove themselves.
      for (const p of term ? parts : []) {
        if (src === 'all' || src === 'mdi') add(`mdi-${p}`, `mdi-${p}`, 'material', true);
        if (src === 'all' || src === 'si') add(`si-${p}`, `si-${p}`, 'simple icons', true);
      }
      return out.slice(0, 160);
    }

    function draw() {
      const list = results();
      const setStatus = () => {
        const n = grid.childElementCount;
        status.textContent = idx?.errors?.length ? `Some icon lists failed to load: ${idx.errors.join('; ')}` :
          n ? `${n}${n >= 160 ? '+' : ''} icon${n === 1 ? '' : 's'}. Click one to use it.` :
          'No matching icons. Try another word (e.g. what the app does: "monitor", "camera", "network"), or upload / download your own below.';
      };
      grid.replaceChildren(...list.map(i => {
        const img = h('img', {src: iconUrl(i.ref), loading: 'lazy', alt: ''});
        const cell = h('div', {class: 'icon-cell', title: i.ref, onclick: () => choose(i.ref)}, img,
          h('div', {}, i.label), h('div', {class: 'ref'}, i.ref), h('div', {class: 'src'}, i.from));
        img.addEventListener('error', () => { cell.remove(); setStatus(); });
        return cell;
      }));
      setStatus();
    }
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 150); });
    source.addEventListener('change', draw);
    draw();
    q.focus();
  });
}
