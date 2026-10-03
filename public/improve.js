// "Make it better": a checkup of the whole dashboard with one-click fixes. Fixes only change the
// working copy; nothing is written until you Review & Save (with a diff).
import {h, api, toast, iconUrl, suggestWidget, firstKey, YAML} from './lib.js';
import {store, loadFile, markDirty, reviewAndSave} from './store.js';
import {pickIcon, iconIndex, localIconsServed, LOCAL_ICON_FIX} from './icons.js';
import {openEntryEditor} from './services.js';
import {BUTTON_JS, hasButton} from './editor-button.js';

const SECRET = /(^|_)(key|apikey|password|pass|token|secret)$|apiKey|password|token|secret/i;

// Every service/bookmark entry with its location, so fixes can edit it in place.
function entries(kind) {
  const out = [];
  const walk = (list, group) => (list ?? []).forEach((entry, index) => {
    const name = firstKey(entry);
    const v = entry[name];
    if (kind === 'services' && Array.isArray(v)) return walk(v, `${group} › ${name}`);
    const props = kind === 'bookmarks' ? (Array.isArray(v) ? v[0] : v) ?? {} : v ?? {};
    out.push({kind, group, name, props, list, index});
  });
  (store.files[`${kind}.yaml`].model ?? []).forEach(g => walk(g[firstKey(g)], firstKey(g)));
  return out;
}

// Remember results so re-drawing after each fix doesn't re-test every icon.
const iconOk = new Map();
const loadsOk = url => iconOk.has(url) ? Promise.resolve(iconOk.get(url)) : testIcon(url).then(ok => (iconOk.set(url, ok), ok));
const testIcon = url => new Promise(resolve => {
  if (!url) return resolve(false);
  const img = new Image();
  const t = setTimeout(() => resolve(false), 8000);
  img.onload = () => { clearTimeout(t); resolve(true); };
  img.onerror = () => { clearTimeout(t); resolve(false); };
  img.src = url;
});

export async function renderImprove(root) {
  await Promise.all(['services.yaml', 'bookmarks.yaml', 'settings.yaml', 'widgets.yaml'].map(f => loadFile(f)));
  const redraw = () => renderImprove(root);
  const sections = h('div');
  root.replaceChildren(
    h('div', {class: 'banner info'}, 'A checkup of your whole dashboard. Fix buttons change your working copy only; ',
      'use the Save buttons at the bottom to review exactly what changes before anything is written.'),
    sections, saveBar());
  const add = (title, intro, rows, action) => sections.append(h('div', {class: 'group', style: 'margin-bottom:14px'},
    h('div', {class: 'group-head'}, h('span', {class: 'name'}, title), h('span', {class: 'count'}, rows === null ? '' : rows.length ? `${rows.length} to look at` : 'all good ✓'),
      h('span', {class: 'actions'}, action ?? null)),
    intro ? h('p', {class: 'muted', style: 'margin:0 0 8px'}, intro) : null,
    rows?.length ? h('div', {class: 'list'}, rows) : null));
  const touched = kind => { markDirty(`${kind}.yaml`); redraw(); };
  const all = [...entries('services'), ...entries('bookmarks')];
  const row = (e, text, ...buttons) => h('div', {class: 'list-row'},
    h('div', {class: 'grow'}, h('b', {}, e.name), ' ', h('span', {class: 'muted'}, `${e.kind === 'bookmarks' ? 'bookmark · ' : ''}${e.group}`), text ? h('div', {class: 'hint'}, text) : null), ...buttons);

  // 0. The Edit button on Homepage itself (custom.js)
  const custom = await loadFile('custom.js', true);
  add('Edit button on your Homepage', 'A small "Edit" button at the top right of Homepage that opens this editor in its own window.',
    hasButton(custom.text) ? [] : [h('div', {class: 'list-row'}, h('div', {class: 'grow'}, h('b', {}, 'Missing'), h('div', {class: 'hint'}, 'custom.js doesn\'t have the button block.')),
      h('button', {class: 'small', onclick: async () => {
        const text = `${custom.text.replace(/\s*$/, '')}${custom.text.trim() ? '\n\n' : ''}${BUTTON_JS}`;
        if (await reviewAndSave('custom.js', {text})) redraw();
      }}, 'Add it back'))]);

  // 1. Icons
  if (!iconOk.size) sections.append(h('p', {class: 'muted'}, 'Checking icons…'));
  const idx = await iconIndex().catch(() => ({local: []}));
  const served = await localIconsServed();
  const checks = await Promise.all(all.map(async e => ({e, ok: e.props.icon ? await loadsOk(iconUrl(e.props.icon)) : null})));
  sections.replaceChildren();
  const iconRows = checks.filter(c => c.ok === false || c.ok === null && c.e.kind === 'services').map(({e}) => {
    const ref = e.props.icon;
    const base = ref ? ref.split('/').pop() : '';
    const local = ref && !ref.startsWith('/icons/') && idx.local.includes(base) ? `/icons/${base}` : null;
    const setIcon = v => { e.props.icon = v; touched(e.kind); };
    return row(e, ref ? `Icon "${ref}" doesn't load${/^https?:/.test(ref) ? ' (that site may block other pages from using its images)' : ''}.` : 'No icon.',
      local ? h('button', {class: 'small', title: 'This file is in your config/icons folder', onclick: () => setIcon(local)}, `Use ${local}`) : null,
      /^https?:/.test(ref ?? '') ? h('button', {class: 'small', onclick: async () => {
        try { const r = await api('/api/icons/fetch', {json: {url: ref, name: e.name}}); toast(`Saved a local copy: ${r.file}`); setIcon(r.ref); }
        catch (err) { toast(err.message, true); }
      }}, 'Save a local copy') : null,
      h('button', {class: 'ghost small', onclick: async () => { const r = await pickIcon(ref, e.name.split(/[\s-]+/)[0]); if (r) setIcon(r); }}, 'Choose…'));
  });
  add('Icons', 'Broken or missing icons. Your own images live in config/icons and are referenced as /icons/<file>.', iconRows);
  if (served.served === false) sections.lastChild.append(h('div', {class: 'banner'}, h('b', {}, 'One-time fix needed for your own icons: '),
    'Homepage isn\'t serving config/icons yet, so /icons/… references stay broken until this is done (on granite):', h('pre', {}, LOCAL_ICON_FIX)));

  // 2. Live widgets
  const widgetRows = entries('services').filter(e => !e.props.widget && !e.props.widgets).map(e => ({e, s: suggestWidget(store.catalog, e.name, e.props)}))
    .filter(x => x.s).map(({e, s}) => row(e, `Homepage's ${s.title} widget can show live stats on this card${s.allowedFields ? ` (${s.allowedFields.slice(0, 4).join(', ')}…)` : ''}.`,
      h('button', {class: 'small', onclick: () => openEntryEditor('services', e.list, e.index, () => touched('services'), {widget: s.type})}, 'Set up widget'),
      h('a', {class: 'ghost small', href: s.doc, target: '_blank'}, 'Docs ↗')));
  add('Live widgets', 'Services that Homepage has a ready-made widget for. Each needs that app\'s URL and usually an API key or login (the editor shows where to get it).', widgetRows);

  // 3. Status indicators
  const noStatus = entries('services').filter(e => e.props.href && !e.props.siteMonitor && !e.props.ping);
  add('Up/down status', 'Shows a status dot (and response time) on each card, so you can see at a glance what\'s down.',
    noStatus.map(e => row(e, `No status check. Would monitor ${e.props.href}`)),
    noStatus.length ? h('button', {class: 'small', onclick: () => {
      noStatus.forEach(e => { e.props.siteMonitor = e.props.href; });
      toast(`Added status checks to ${noStatus.length} services`);
      touched('services');
    }}, `Add to all ${noStatus.length}`) : null);

  // 4. Layout and look
  const settings = YAML.parse(store.files['settings.yaml'].draft ?? store.files['settings.yaml'].text) ?? {};
  const groups = (store.files['services.yaml'].model ?? []).map(g => ({name: firstKey(g), count: (g[firstKey(g)] ?? []).length}));
  const missingLayout = groups.filter(g => !settings.layout?.[g.name]);
  const lookRows = [];
  if (missingLayout.length) lookRows.push(h('div', {class: 'list-row'}, h('div', {class: 'grow'},
    h('b', {}, 'Group layout'), h('div', {class: 'hint'}, `${missingLayout.length} group(s) use Homepage's default stacked columns. A row layout gives each group full width with up to 4 cards per row.`))));
  if (!settings.theme && !settings.color) lookRows.push(h('div', {class: 'list-row'}, h('div', {class: 'grow'}, h('b', {}, 'Theme & colour'), h('div', {class: 'hint'}, 'Not set (default). The preset uses dark + slate.'))));
  if (!settings.headerStyle) lookRows.push(h('div', {class: 'list-row'}, h('div', {class: 'grow'}, h('b', {}, 'Header style'), h('div', {class: 'hint'}, 'Not set. "boxed" gives each group a clear title bar.'))));
  if (!settings.statusStyle) lookRows.push(h('div', {class: 'list-row'}, h('div', {class: 'grow'}, h('b', {}, 'Status style'), h('div', {class: 'hint'}, 'Not set. "dot" shows a small coloured dot instead of a text badge.'))));
  if (!settings.title) lookRows.push(h('div', {class: 'list-row'}, h('div', {class: 'grow'}, h('b', {}, 'Page title'), h('div', {class: 'hint'}, 'Not set (browser tab says "Homepage").'))));
  add('Layout & look', 'Applies a tidy preset to settings.yaml, merged with what you have (your own values win). Fine-tune it later on the Settings tab.', lookRows,
    lookRows.length ? h('button', {class: 'small', onclick: async () => {
      const preset = {
        title: settings.title ?? 'Home Lab', theme: 'dark', color: 'slate', headerStyle: 'boxed', statusStyle: 'dot',
        useEqualHeights: true, cardBlur: 'sm',
        layout: Object.fromEntries(groups.map(g => [g.name, {style: 'row', columns: Math.max(1, Math.min(4, g.count))}])),
      };
      const merged = mergeKeepUser(preset, settings);
      try {
        const r = await api('/api/preview/settings.yaml', {json: {data: merged}});
        const f = store.files['settings.yaml'];
        f.draft = r.text; f.dirty = r.text !== f.text;
        document.getElementById('dirty-note').hidden = false;
        toast('Layout preset added to settings (not saved yet)');
        redraw();
      } catch (err) { toast(err.message, true); }
    }}, 'Apply preset') : null);

  // 5. Info widgets across the top
  const have = new Set((store.files['widgets.yaml'].model ?? []).map(firstKey));
  const infoIdeas = [['greeting', {text_size: 'xl', text: 'Home Lab'}], ['datetime', {text_size: 'xl', format: {dateStyle: 'long', timeStyle: 'short', hour12: false}}]]
    .filter(([t]) => !have.has(t));
  add('Top bar widgets', 'Small widgets across the top of the page.', infoIdeas.map(([t, opts]) => h('div', {class: 'list-row'},
    h('div', {class: 'grow'}, h('b', {}, store.catalog.infoWidgets.find(w => w.type === t)?.title ?? t), h('div', {class: 'hint'}, `Not shown yet. Adds: ${JSON.stringify(opts)}`)),
    h('button', {class: 'small', onclick: () => { store.files['widgets.yaml'].model.unshift({[t]: opts}); markDirty('widgets.yaml'); redraw(); }}, 'Add'))));

  // 6. Links
  add('Links', 'Checks every link from granite. Red = no answer (wrong address, typo, or the service is down).', null,
    h('button', {class: 'small', onclick: async e => {
      e.target.disabled = true; e.target.textContent = 'Checking…';
      const res = await api('/api/check-links', {json: {urls: all.map(x => x.props.href).filter(Boolean)}}).catch(err => (toast(err.message, true), []));
      const bad = new Map(res.filter(r => !r.ok).map(r => [r.url, r]));
      const rows = all.filter(x => bad.has(x.props.href)).map(x => row(x, `${x.props.href} → ${bad.get(x.props.href).error ?? `HTTP ${bad.get(x.props.href).status}`}`,
        h('button', {class: 'ghost small', onclick: () => openEntryEditor(x.kind, x.list, x.index, () => touched(x.kind))}, 'Edit')));
      const box = e.target.closest('.group');
      box.querySelector('.count').textContent = rows.length ? `${rows.length} not answering` : `all ${res.length} answer ✓`;
      box.querySelector('.list')?.remove();
      if (rows.length) box.append(h('div', {class: 'list'}, rows));
      e.target.textContent = 'Check again'; e.target.disabled = false;
    }}, 'Check all links'));

  // 7. Duplicates
  const byHref = new Map();
  all.forEach(e => e.props.href && byHref.set(e.props.href, [...(byHref.get(e.props.href) ?? []), e]));
  add('Duplicates', 'The same link appears on more than one card.', [...byHref.values()].filter(v => v.length > 1).map(v => h('div', {class: 'list-row'},
    h('div', {class: 'grow'}, h('b', {}, v[0].props.href), h('div', {class: 'hint'}, v.map(e => `${e.name} (${e.group})`).join(', '))))));

  // 8. Secrets in plain text
  const secretRows = [];
  const scan = (file, value, where) => {
    if (Array.isArray(value)) value.forEach((v, i) => scan(file, v, where));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
      if (SECRET.test(k) && typeof v === 'string' && v && !/\{\{HOMEPAGE_(VAR|FILE)_/.test(v) && !/^(your|api|apikey|key|password)/i.test(v)) secretRows.push(h('div', {class: 'list-row'},
        h('div', {class: 'grow'}, h('b', {}, `${file}: ${where ? `${where} › ` : ''}${k}`), h('div', {class: 'hint'}, 'Stored in plain text.'))));
      else scan(file, v, typeof v === 'object' && !Array.isArray(value) ? (where ? `${where} › ${k}` : k) : where);
    }
  };
  for (const f of ['services.yaml', 'widgets.yaml', 'settings.yaml', 'bookmarks.yaml']) scan(f, store.files[f].model ?? YAML.parse(store.files[f].text ?? ''), '');
  add('API keys & passwords', 'Homepage can read secrets from environment variables instead, written as {{HOMEPAGE_VAR_NAME}} in the config. Optional on a single-user LAN, but it keeps keys out of the files (and out of backups).', secretRows);
}

// Preset values fill gaps only; anything already in settings.yaml is kept.
function mergeKeepUser(preset, user) {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return user ?? preset;
  const out = {...preset, ...user};
  for (const k of Object.keys(preset)) if (user && typeof user[k] === 'object' && !Array.isArray(user[k])) out[k] = mergeKeepUser(preset[k], user[k]);
  return out;
}

function saveBar() {
  const files = ['services.yaml', 'bookmarks.yaml', 'widgets.yaml', 'settings.yaml'];
  const bar = h('div', {class: 'toolbar', style: 'position:sticky;bottom:0;background:var(--bg);padding:10px 0;border-top:1px solid var(--line)'},
    h('span', {class: 'muted'}, 'Save changes:'));
  for (const f of files) {
    const file = store.files[f];
    const dirty = f === 'settings.yaml' ? file?.draft != null && file.draft !== file.text : file?.dirty;
    bar.append(h('button', {disabled: !dirty, onclick: async () => {
      const body = f === 'settings.yaml' ? {text: file.draft} : {data: file.model};
      if (await reviewAndSave(f, body)) { if (f === 'settings.yaml') store.files[f].draft = null; document.querySelector('[data-view=improve]').click(); }
    }}, `Review & Save ${f}`));
  }
  return bar;
}
