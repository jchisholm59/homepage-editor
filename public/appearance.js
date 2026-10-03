// Appearance: theme, colour palette, background image and filters, card and header styles, with a
// mock-up that uses Homepage's own palette values and layering (bg colour, image, overlay, filters).
import {h, api, toast, modal, iconUrl, iconImg, clone, firstKey, YAML} from './lib.js';
import {store, loadFile, reviewAndSave, updateDirty} from './store.js';
import {iconIndex, refreshLocalIcons} from './icons.js';

const BLUR = {'': 'None', xs: 'Extra small', sm: 'Small', md: 'Medium', lg: 'Large', xl: 'Extra large', '2xl': '2× large', '3xl': '3× large'};
const BLUR_PX = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 40, '3xl': 64};
const SATURATE = ['0', '50', '100', '150', '200'];
const BRIGHTNESS = ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150', '200'];
const EXAMPLE_BG = 'https://images.unsplash.com/photo-1502790671504-542ad42d5189?auto=format&fit=crop&w=2560&q=80';
const HEADER_STYLES = {
  underlined: 'Group names with a line under them (Homepage\'s default).',
  boxed: 'Each group name sits in its own box.',
  clean: 'Just the group name, no line or box.',
  boxedWidgets: 'Like boxed, and the top-bar widgets get a box too.',
};

export async function renderAppearance(root) {
  const file = await loadFile('settings.yaml');
  let parsed;
  // Unsaved Appearance changes from an earlier visit live in file.model (file.draft is the Settings tab's text).
  try { parsed = file.dirty && file.draft == null ? clone(file.model) : YAML.parse(file.draft ?? file.text) ?? {}; } catch (e) {
    return root.replaceChildren(h('div', {class: 'banner'}, 'settings.yaml has a YAML error; fix it on the Settings tab first: ', e.message));
  }
  await loadFile('services.yaml');
  const s = clone(parsed);
  const original = JSON.stringify(file.data ?? {});   // compare with what's saved, not where this visit started
  const bg = () => (typeof s.background === 'object' && s.background ? s.background : {image: s.background ?? ''});
  const setBg = patch => {
    const next = {...bg(), ...patch};
    for (const k of Object.keys(next)) if (next[k] === '' || next[k] == null) delete next[k];
    if (!next.image) delete s.background;
    else if (Object.keys(next).length === 1) s.background = next.image;   // plain string when no filters
    else s.background = next;
    update();
  };
  const set = (k, v) => { if (v === '' || v == null) delete s[k]; else s[k] = v; update(); };

  const mock = h('div', {class: 'mock'});
  const saveBtn = h('button', {onclick: async () => {
    if (await reviewAndSave('settings.yaml', {data: s})) { store.files['settings.yaml'].draft = null; renderAppearance(root); }
  }}, 'Review & Save');
  const resetBtn = h('button', {class: 'ghost', onclick: () => {
    file.model = clone(file.data); file.draft = null; file.dirty = false; updateDirty(); renderAppearance(root);
  }}, 'Undo changes');
  const controls = h('div', {class: 'appearance-controls'});
  function update() {
    drawMock(mock, s);
    const changed = JSON.stringify(s) !== original;
    saveBtn.disabled = !changed;
    resetBtn.hidden = !changed;
    // Share the pending change with the header Save… button (saved as a merge, keeping comments).
    if (changed) { file.model = clone(s); file.draft = null; }
    file.dirty = changed;
    updateDirty();
    drawControls();
  }

  function drawControls() {
    const palettes = store.catalog.palettes;
    const b = bg();
    const hasFilters = b.blur !== undefined || b.saturate !== undefined || b.brightness !== undefined;
    controls.replaceChildren(
      section('Theme',
        seg([['', 'Visitor can switch'], ['dark', 'Dark'], ['light', 'Light']], s.theme ?? '', v => set('theme', v))),
      section('Colour palette', h('div', {class: 'hint', style: 'margin-bottom:6px'}, 'Tints the page, cards and text. "Unset" lets visitors pick.'),
        h('div', {class: 'swatches'},
          h('button', {class: `swatch none${!s.color ? ' active' : ''}`, title: 'Unset', onclick: () => set('color', '')}, '✕'),
          Object.entries(palettes).map(([name, p]) => h('button', {
            class: `swatch${s.color === name ? ' active' : ''}`, title: name, onclick: () => set('color', name),
            style: `background: linear-gradient(135deg, rgb(${p['800']}) 0 50%, rgb(${p['500']}) 50% 100%)`,
          })))),
      section('Background image',
        h('div', {class: 'toolbar'},
          h('input', {value: b.image ?? '', placeholder: 'https://… or /icons/my-background.jpg', onchange: e => setBg({image: e.target.value.trim()})}),
        ),
        h('div', {class: 'toolbar'},
          h('button', {class: 'ghost small', onclick: () => chooseLocal(img => setBg({image: img}))}, 'My images…'),
          h('button', {class: 'ghost small', onclick: () => uploadBackground(img => setBg({image: img}))}, 'Upload…'),
          h('button', {class: 'ghost small', onclick: () => setBg({image: EXAMPLE_BG})}, 'Try an example'),
          b.image ? h('button', {class: 'ghost small', onclick: () => { delete s.background; update(); }}, 'Remove') : null),
        b.image ? h('div', {},
          slider('Image strength', 'How much the image shows through the palette colour (100 = full image).',
            b.opacity ?? 100, 0, 100, 5, v => setBg({opacity: Number(v) === 100 && !hasFilters ? undefined : Number(v)})),
          h('div', {class: 'row3'},
            pick('Blur', BLUR, b.blur ?? null, v => setBg({blur: v === null ? undefined : v}), true),
            pick('Saturation', Object.fromEntries(SATURATE.map(x => [x, `${x}%`])), b.saturate ?? null, v => setBg({saturate: v === null ? undefined : Number(v)}), true),
            pick('Brightness', Object.fromEntries(BRIGHTNESS.map(x => [x, `${x}%`])), b.brightness ?? null, v => setBg({brightness: v === null ? undefined : Number(v)}), true)),
          hasFilters && s.cardBlur !== undefined ? h('div', {class: 'banner'}, 'Homepage notes that card blur doesn\'t work together with background blur/saturation/brightness. Use one or the other.') : null)
          : h('div', {class: 'hint'}, 'No image: the page uses the palette colour.')),
      section('Cards',
        h('div', {class: 'row'},
          pick('Card blur', BLUR, s.cardBlur ?? null, v => set('cardBlur', v), true, 'Frosted-glass effect over a background image.'),
          pick('Status style', {dot: 'Dot', basic: 'UP / DOWN text'}, s.statusStyle ?? null, v => set('statusStyle', v), true, 'How up/down checks show. Unset = response time in ms.')),
        h('div', {class: 'row'},
          pick('Icon style', {gradient: 'Gradient', theme: 'Match palette'}, s.iconStyle ?? null, v => set('iconStyle', v === 'gradient' ? null : v), true, 'Only affects mdi-/si- icons.')),
        h('div', {class: 'checks', style: 'margin-top:10px'},
          check('Equal height cards', s.useEqualHeights === true, v => set('useEqualHeights', v || null)),
          check('Full width page', s.fullWidth === true, v => set('fullWidth', v || null)))),
      section('Group headers',
        h('div', {class: 'header-styles'}, Object.entries(HEADER_STYLES).map(([k, desc]) => h('button', {
          class: `header-style${(s.headerStyle ?? 'underlined') === k ? ' active' : ''}`, onclick: () => set('headerStyle', k === 'underlined' ? null : k),
        }, h('b', {}, k), h('div', {class: 'hint'}, desc))))),
      section('Page',
        h('label', {}, 'Title (browser tab)'), h('input', {value: s.title ?? '', placeholder: 'Homepage', onchange: e => set('title', e.target.value.trim())}),
        h('label', {}, 'Favicon (tab icon)'),
        h('div', {class: 'icon-field'}, s.favicon ? h('img', {src: iconUrl(s.favicon), style: 'width:24px;height:24px'}) : null,
          h('input', {value: s.favicon ?? '', placeholder: 'https://…/favicon.ico or /icons/file.png', onchange: e => set('favicon', e.target.value.trim())}))),
    );
  }

  root.replaceChildren(
    h('div', {class: 'toolbar'}, h('span', {class: 'muted'}, 'Changes show in the mock-up straight away. Save to apply them to your real Homepage (with Preview ▸ open you\'ll see it refresh).'),
      h('span', {class: 'spacer'}), resetBtn, saveBtn),
    h('div', {class: 'appearance'}, controls, h('div', {class: 'mock-wrap'}, mock, h('div', {class: 'hint'}, 'Mock-up using your first group\'s services. Fonts and spacing are approximate; colours and layering match Homepage.'))));
  update();
}

// ---- Mock-up -----------------------------------------------------------------------------
function drawMock(el, s) {
  const pal = store.catalog.palettes[s.color || 'slate'];
  const dark = (s.theme ?? 'dark') === 'dark';
  const bgColor = dark ? pal['800'] : pal['50'];
  const b = typeof s.background === 'object' && s.background ? s.background : {image: s.background};
  const overlay = typeof s.background === 'object' && b.opacity !== undefined ? 1 - b.opacity / 100 : (s.backgroundOpacity ?? 0);
  const filters = [b.blur !== undefined && `blur(${BLUR_PX[b.blur] ?? 8}px)`, b.saturate !== undefined && `saturate(${b.saturate}%)`,
    b.brightness !== undefined && `brightness(${b.brightness}%)`].filter(Boolean).join(' ');
  const text = dark ? `rgb(${pal['200']})` : `rgb(${pal['800']})`;
  const sub = dark ? `rgb(${pal['400']})` : `rgb(${pal['500']})`;
  const cardBg = dark ? 'rgb(255 255 255 / .05)' : `rgb(${pal['100']} / .2)`;
  const cardBlur = s.cardBlur !== undefined ? `blur(${BLUR_PX[s.cardBlur] ?? 8}px)` : '';
  const header = s.headerStyle ?? 'underlined';
  const status = s.statusStyle === 'dot' ? h('span', {class: 'm-dot'}) : s.statusStyle === 'basic' ? h('span', {class: 'm-basic'}, 'UP') : h('span', {class: 'm-ms', style: `color:${sub}`}, '42 ms');

  const services = store.files['services.yaml'].model ?? [];
  const groups = services.slice(0, 2).map(g => ({name: firstKey(g), items: (g[firstKey(g)] ?? []).filter(e => !Array.isArray(e[firstKey(e)])).slice(0, 4)}));
  const card = e => {
    const name = firstKey(e);
    const p = e[name] ?? {};
    return h('div', {class: 'm-card', style: `background:${cardBg};backdrop-filter:${cardBlur};-webkit-backdrop-filter:${cardBlur}`},
      iconImg(p.icon), h('div', {class: 'm-card-body'}, h('div', {style: `color:${text};font-weight:600`}, name), h('div', {style: `color:${sub};font-size:11px`}, p.description ?? '')), status.cloneNode(true));
  };
  const groupHead = name => {
    if (header === 'boxed' || header === 'boxedWidgets') return h('div', {class: 'm-head boxed', style: `background:${cardBg};color:${text}`}, name);
    if (header === 'clean') return h('div', {class: 'm-head', style: `color:${text}`}, name);
    return h('div', {class: 'm-head underlined', style: `color:${text};border-color:${sub}`}, name);
  };
  el.style.backgroundColor = `rgb(${bgColor})`;
  el.replaceChildren(
    b.image ? h('div', {class: 'm-bg', style: `background-image: linear-gradient(rgb(${bgColor} / ${overlay}), rgb(${bgColor} / ${overlay})), url('${iconUrl(b.image) ?? b.image}')`}) : null,
    h('div', {class: 'm-inner', style: `backdrop-filter:${filters};-webkit-backdrop-filter:${filters}`},
      h('div', {class: `m-widgets${header === 'boxedWidgets' ? ' boxed' : ''}`, style: `color:${text};${header === 'boxedWidgets' ? `background:${cardBg}` : ''}`},
        h('span', {style: 'font-size:18px;font-weight:600'}, s.title || 'Homepage'), h('span', {class: 'spacer'}),
        h('span', {style: `color:${sub}`}, new Date().toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}))),
      groups.map(g => h('div', {class: 'm-group'}, groupHead(g.name), h('div', {class: 'm-cards'}, g.items.map(card))))));
}

// ---- Small controls ------------------------------------------------------------------------
const section = (title, ...children) => h('div', {class: 'group', style: 'margin-bottom:12px'}, h('div', {class: 'group-head'}, h('span', {class: 'name'}, title)), ...children);

function seg(options, value, onChange) {
  return h('div', {class: 'seg'}, options.map(([v, label]) => h('button', {class: v === value ? 'active' : '', onclick: () => onChange(v)}, label)));
}

function pick(label, options, value, onChange, allowUnset = false, hint) {
  const sel = h('select', {onchange: e => onChange(e.target.value === '__unset' ? null : e.target.value)},
    allowUnset ? h('option', {value: '__unset', selected: value === null}, '(not set)') : null,
    Object.entries(options).map(([v, l]) => h('option', {value: v, selected: value !== null && String(value) === v}, l)));
  return h('div', {}, h('label', {}, label), sel, hint ? h('div', {class: 'hint'}, hint) : null);
}

function slider(label, hint, value, min, max, step, onChange) {
  const out = h('span', {class: 'muted'}, ` ${value}`);
  const input = h('input', {type: 'range', min, max, step, value, oninput: e => { out.textContent = ` ${e.target.value}`; }, onchange: e => onChange(e.target.value)});
  return h('div', {}, h('label', {}, label, out), input, h('div', {class: 'hint'}, hint));
}

const check = (label, value, onChange) => h('label', {}, h('input', {type: 'checkbox', checked: value, onchange: e => onChange(e.target.checked)}), label);

// Pick an image already in config/icons (served by Homepage at /icons/).
async function chooseLocal(onPick) {
  const idx = await iconIndex();
  const m = modal('My images (config/icons)');
  const grid = h('div', {class: 'icon-grid'}, idx.local.map(f => h('div', {class: 'icon-cell', onclick: () => { m.close(); onPick(`/icons/${f}`); }},
    h('img', {src: `/local-icons/${encodeURIComponent(f)}`, loading: 'lazy'}), h('div', {class: 'ref'}, f))));
  m.body.append(h('p', {class: 'muted'}, 'Large photos work best as backgrounds. Use Upload… to add one.'), grid);
}

function uploadBackground(onPick) {
  const input = h('input', {type: 'file', accept: 'image/*'});
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const r = await api(`/api/icons/upload?name=${encodeURIComponent(f.name)}`, {method: 'POST', headers: {'Content-Type': f.type}, body: f});
      refreshLocalIcons();
      toast(`Saved ${r.file}. Restart Homepage (top right) after saving so it can show the new image.`);
      onPick(r.ref);
    } catch (e) { toast(e.message, true); }
  });
  input.click();
}
