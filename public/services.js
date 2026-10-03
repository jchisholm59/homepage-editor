// Services and Bookmarks: groups of cards with drag-and-drop, an editor for each entry, widget
// suggestions from the catalog, link checking and broken-icon detection.
import Sortable from '/vendor/sortable/sortable.esm.js';
import {h, api, modal, toast, confirmBox, promptBox, iconImg, iconUrl, markdown, suggestWidget, clone, firstKey, YAML} from './lib.js';
import {store, loadFile, markDirty, discard, reviewAndSave} from './store.js';
import {pickIcon, localIconsServed, LOCAL_ICON_FIX} from './icons.js';

const linkStatus = new Map();   // url -> {ok, status, error, note}

// kind: 'services' | 'bookmarks'
export async function renderGroupsView(root, kind) {
  const name = `${kind}.yaml`;
  const file = await loadFile(name);
  if (file.errors?.length) {
    root.replaceChildren(h('div', {class: 'banner'}, `${name} has YAML errors, so it can only be edited as text (Files tab):`,
      h('pre', {}, file.errors.join('\n'))));
    return;
  }
  file.model ??= [];
  const broken = new Set();
  const brokenNote = h('span', {class: 'muted'});
  const onBroken = ref => { broken.add(ref); brokenNote.textContent = `${broken.size} broken icon${broken.size > 1 ? 's' : ''} (red ✕)`; };

  const redraw = () => renderGroupsView(root, kind);
  const changed = () => { markDirty(name); redraw(); };

  const groupsEl = h('div', {class: 'groups'});
  groupsEl._list = file.model;
  file.model.forEach((g, gi) => groupsEl.append(groupBlock(kind, file.model, gi, changed, onBroken)));
  sortable(groupsEl, 'groups', changed);

  const banners = h('div');
  const toolbar = h('div', {class: 'toolbar'},
    h('button', {onclick: async () => {
      const g = await promptBox('New group', 'Group name');
      if (g) { file.model.push({[g]: []}); changed(); }
    }}, '+ Group'),
    h('button', {class: 'ghost', onclick: () => checkLinks(kind, file.model, redraw)}, 'Check links'),
    brokenNote,
    h('span', {class: 'spacer'}),
    file.dirty ? h('button', {class: 'ghost', onclick: async () => {
      if (await confirmBox('Discard changes', `Throw away your unsaved changes to ${name}?`, 'Discard', true)) { discard(name); redraw(); }
    }}, 'Discard changes') : null,
    h('button', {disabled: !file.dirty, onclick: async () => { if (await reviewAndSave(name)) redraw(); }}, 'Review & Save'));

  root.replaceChildren(toolbar, banners, groupsEl.childElementCount ? groupsEl : h('p', {class: 'muted'}, `No ${kind} yet.`));

  // Local icons used but not served by Homepage: explain the one-time fix.
  const usesLocal = JSON.stringify(file.model).includes('"/icons/');
  const svc = await localIconsServed();
  if (svc.served === false && (usesLocal || svc.sample)) {
    banners.append(h('div', {class: 'banner'}, h('b', {}, 'Custom icons: '),
      'your config/icons folder has icons, but Homepage can\'t show them because that folder isn\'t mounted where Homepage serves icons. ',
      'Reference them as /icons/<file> after this one-time fix:', h('pre', {}, LOCAL_ICON_FIX)));
  }
}

function sortable(el, group, onChange) {
  Sortable.create(el, {
    group, animation: 150, handle: group === 'groups' ? '.group-head .drag' : undefined,
    filter: 'button', preventOnFilter: false, ghostClass: 'sortable-ghost',
    onEnd: e => {
      if (e.from === e.to && e.oldIndex === e.newIndex) return;
      const [moved] = e.from._list.splice(e.oldIndex, 1);
      e.to._list.splice(e.newIndex, 0, moved);
      onChange();
    },
  });
}

// A group: {Name: [entries]} where an entry is a service/bookmark {Name: props} or a nested group {Name: [...]}.
function groupBlock(kind, parentList, index, changed, onBroken, nested = false) {
  const groupObj = parentList[index];
  const gname = firstKey(groupObj);
  if (!Array.isArray(groupObj[gname])) groupObj[gname] = groupObj[gname] ? [] : [];
  const entries = groupObj[gname];
  const items = h('div', {class: 'items'});
  items._list = entries;
  entries.forEach((entry, i) => {
    const ename = firstKey(entry);
    if (Array.isArray(entry[ename]) && kind === 'services') items.append(h('div', {class: 'items nested'}, groupBlock(kind, entries, i, changed, onBroken, true)));
    else items.append(card(kind, entries, i, changed, onBroken));
  });
  sortable(items, kind, changed);
  return h('div', {class: 'group'},
    h('div', {class: 'group-head'},
      h('span', {class: 'drag', title: 'Drag to reorder'}, '⠿'),
      h('span', {class: 'name', title: 'Rename', onclick: async () => {
        const n = await promptBox('Rename group', 'Group name', gname);
        if (n && n !== gname) { parentList[index] = {[n]: entries}; changed(); }
      }}, nested ? `↳ ${gname}` : gname),
      h('span', {class: 'count'}, `${entries.length}`),
      h('span', {class: 'actions'},
        h('button', {class: 'small', onclick: () => editEntry(kind, entries, -1, changed)}, kind === 'services' ? '+ Service' : '+ Bookmark'),
        kind === 'services' ? h('button', {class: 'ghost small', title: 'Add a group inside this group', onclick: async () => {
          const n = await promptBox('New nested group', 'Group name');
          if (n) { entries.push({[n]: []}); changed(); }
        }}, '+ Sub-group') : null,
        h('button', {class: 'ghost small', title: 'Delete group', onclick: async () => {
          if (entries.length && !await confirmBox('Delete group', `Delete "${gname}" and its ${entries.length} entries?`, 'Delete', true)) return;
          parentList.splice(index, 1); changed();
        }}, '🗑'))),
    items);
}

// Bookmarks store their props as a one-item list: {Name: [{abbr, href, icon}]}.
const propsOf = (kind, entry) => {
  const v = entry[firstKey(entry)];
  if (kind === 'bookmarks') return (Array.isArray(v) ? v[0] : v) ?? {};
  return v ?? {};
};

function card(kind, list, i, changed, onBroken) {
  const entry = list[i];
  const name = firstKey(entry);
  const p = propsOf(kind, entry);
  const badges = [];
  if (kind === 'services') {
    const w = p.widget ?? (Array.isArray(p.widgets) ? p.widgets[0] : null);
    if (w?.type) badges.push(h('span', {class: 'badge widget', title: 'Has a live widget'}, `⚡ ${w.type}${p.widgets?.length > 1 ? ` +${p.widgets.length - 1}` : ''}`));
    else {
      const s = suggestWidget(store.catalog, name, p);
      if (s) badges.push(h('span', {class: 'badge suggest', title: `Homepage has a ${s.title} widget. Open to add it.`}, `+ ${s.title} widget available`));
    }
    if (p.siteMonitor) badges.push(h('span', {class: 'badge', title: `Site monitor: ${p.siteMonitor}`}, 'monitor'));
    if (p.ping) badges.push(h('span', {class: 'badge', title: `Ping: ${p.ping}`}, 'ping'));
    if (p.container) badges.push(h('span', {class: 'badge', title: `Docker ${p.server ?? ''}/${p.container}`}, 'docker'));
  }
  const st = p.href && linkStatus.get(p.href);
  if (st) badges.push(h('span', {class: `badge ${st.ok ? 'ok' : 'bad'}`, title: st.error ?? st.note ?? `HTTP ${st.status}`},
    st.ok ? (st.note ? 'link ok (self-signed)' : 'link ok') : `link ${st.status || st.error}`));
  return h('div', {class: 'card', onclick: () => editEntry(kind, list, i, changed)},
    iconImg(p.icon, onBroken),
    h('div', {class: 'body'},
      h('div', {class: 'title'}, name),
      h('div', {class: 'sub'}, p.description ?? p.href ?? ''),
      p.description && p.href ? h('div', {class: 'sub'}, p.href) : null,
      badges.length ? h('div', {class: 'badges'}, badges) : null));
}

async function checkLinks(kind, model, redraw) {
  const urls = [];
  const walk = list => list?.forEach(entry => {
    const v = entry[firstKey(entry)];
    if (Array.isArray(v) && kind === 'services') return walk(v);
    const p = propsOf(kind, entry);
    if (p.href) urls.push(p.href);
  });
  model.forEach(g => walk(g[firstKey(g)]));
  toast(`Checking ${urls.length} links…`);
  try {
    const res = await api('/api/check-links', {json: {urls}});
    res.forEach(r => linkStatus.set(r.url, r));
    const bad = res.filter(r => !r.ok).length;
    toast(bad ? `${bad} of ${res.length} links didn't respond (red badges)` : `All ${res.length} links respond`, bad > 0);
    redraw();
  } catch (e) { toast(e.message, true); }
}

// ---- Entry editor ---------------------------------------------------------------------------
const SERVICE_FIELDS = [
  ['href', 'Link (href)', 'Where clicking the card goes, e.g. http://192.168.2.210:5000'],
  ['description', 'Description', 'Small text under the name'],
];

export function openEntryEditor(kind, list, index, changed, opts = {}) {
  return editEntry(kind, list, index, changed, opts);
}

function editEntry(kind, list, index, changed, opts = {}) {
  const isNew = index < 0;
  const entry = isNew ? {[kind === 'services' ? 'New service' : 'New bookmark']: {}} : clone(list[index]);
  let name = firstKey(entry);
  let p = clone(propsOf(kind, entry));
  const m = modal(isNew ? `New ${kind === 'services' ? 'service' : 'bookmark'}` : name);
  const tabsEl = h('div', {class: 'tabs2'});
  const pane = h('div');
  const tabs = kind === 'services'
    ? [['basics', 'Basics'], ['widget', 'Widget'], ['status', 'Status & Docker'], ['yaml', 'YAML']]
    : [['basics', 'Basics'], ['yaml', 'YAML']];
  let current = 'basics';
  let yamlText = null;   // set while the YAML tab is open

  const show = tab => {
    if (current === 'yaml' && tab !== 'yaml' && !applyYaml()) return;
    current = tab;
    tabsEl.replaceChildren(...tabs.map(([id, label]) => h('button', {class: id === tab ? 'active' : '', onclick: () => show(id)}, label)));
    pane.replaceChildren(({basics, widget: widgetTab, status, yaml: yamlTab})[tab]());
  };

  const set = (k, v) => { if (v === '' || v == null) delete p[k]; else p[k] = v; };
  const text = (k, label, hint, attrs = {}) => {
    const input = h('input', {value: p[k] ?? '', ...attrs, oninput: e => set(k, e.target.value.trim())});
    return h('div', {}, h('label', {}, label), input, hint ? h('div', {class: 'hint'}, hint) : null);
  };

  function basics() {
    const nameInput = h('input', {value: name, oninput: e => (name = e.target.value)});
    const iconBox = h('span');
    const drawIcon = () => iconBox.replaceChildren(iconImg(p.icon));
    drawIcon();
    const iconInput = h('input', {value: p.icon ?? '', placeholder: 'e.g. frigate.svg, sh-frigate, mdi-cctv, /icons/my.png', oninput: e => { set('icon', e.target.value.trim()); drawIcon(); }});
    const out = h('div', {},
      h('label', {}, 'Name'), nameInput,
      h('label', {}, 'Icon'),
      h('div', {class: 'icon-field'}, iconBox, iconInput, h('button', {class: 'ghost', onclick: async () => {
        const ref = await pickIcon(p.icon, name.split(/\s+/)[0]);
        if (ref != null) { set('icon', ref); iconInput.value = ref; drawIcon(); }
      }}, 'Choose…')),
      ...SERVICE_FIELDS.map(([k, l, hint]) => text(k, l, hint)));
    if (kind === 'bookmarks') out.append(text('abbr', 'Abbreviation', 'Two letters shown when there is no icon, e.g. GH'));
    out.append(h('div', {class: 'row'},
      h('div', {}, h('label', {}, 'Open in'), select(p.target, ['', '_blank', '_self', '_top'], v => set('target', v),
        {'': 'Default (from settings)', _blank: 'New tab', _self: 'Same tab', _top: 'Top window'}))));
    if (kind === 'services') {
      const s = !p.widget && !p.widgets && suggestWidget(store.catalog, name, p);
      if (s) out.append(h('div', {class: 'suggest-box'}, `Homepage has a live ${s.title} widget that can show stats on this card. `,
        h('button', {class: 'small', onclick: () => { p.widget = {type: s.type}; show('widget'); }}, `Set up ${s.title} widget`)));
    }
    return out;
  }

  function status() {
    const servers = Object.keys(store.files['docker.yaml']?.data ?? {});
    return h('div', {},
      h('p', {class: 'muted'}, 'Optional health indicators shown on the card.'),
      text('siteMonitor', 'Site monitor URL', 'Homepage checks this URL and shows response time / down status. Usually the same as the link.'),
      text('ping', 'Ping host', 'Host or IP to ping, e.g. 192.168.2.210 (shows latency).'),
      h('div', {class: 'row'},
        h('div', {}, h('label', {}, 'Status style'), select(p.statusStyle, ['', 'dot', 'basic'], v => set('statusStyle', v), {'': 'Default', dot: 'Dot', basic: 'Basic text'}))),
      h('h3', {}, 'Docker'),
      h('p', {class: 'muted'}, 'Show container status and stats. Uses a server defined in docker.yaml.'),
      h('div', {class: 'row'},
        h('div', {}, h('label', {}, 'Docker server'), servers.length
          ? select(p.server, ['', ...servers], v => set('server', v), {'': '(none)'})
          : h('div', {class: 'hint'}, 'No servers in docker.yaml yet.')),
        text('container', 'Container name', 'e.g. frigate')),
      h('div', {class: 'checks', style: 'margin-top:10px'}, h('label', {}, h('input', {type: 'checkbox', checked: p.showStats === true, onchange: e => set('showStats', e.target.checked || undefined)}), 'Show container stats on the card')));
  }

  function widgetTab() {
    if (Array.isArray(p.widgets)) {
      return h('div', {}, h('p', {}, `This service has ${p.widgets.length} widgets (a "widgets:" list). Edit them on the YAML tab.`));
    }
    return widgetEditor(p, w => { if (w) p.widget = w; else delete p.widget; }, name);
  }

  function yamlTab() {
    yamlText = h('textarea', {rows: 22, spellcheck: 'false'});
    yamlText.value = YAML.stringify(p ?? {}, {lineWidth: 0});
    return h('div', {},
      h('p', {class: 'muted'}, 'Every option for this entry. Anything you can find in the Homepage docs can be added here.'),
      yamlText, h('div', {class: 'errors', id: 'yaml-err'}));
  }

  function applyYaml() {
    if (!yamlText) return true;
    try {
      const v = YAML.parse(yamlText.value) ?? {};
      if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Must be a set of "key: value" lines');
      p = v;
      yamlText = null;
      return true;
    } catch (e) {
      pane.querySelector('#yaml-err').textContent = e.message;
      return false;
    }
  }

  m.body.append(tabsEl, pane);
  m.foot.append(
    isNew ? null : h('button', {class: 'danger', onclick: async () => {
      if (!await confirmBox('Delete', `Delete "${name}"?`, 'Delete', true)) return;
      list.splice(index, 1); m.close(); changed();
    }}, 'Delete'),
    h('span', {class: 'spacer'}),
    h('button', {class: 'ghost', onclick: () => m.close()}, 'Cancel'),
    h('button', {onclick: async () => {
      if (current === 'yaml' && !applyYaml()) return;
      if (!name.trim()) return toast('A name is needed', true);
      const problems = kind === 'services' ? widgetProblems(p) : {missing: [], usual: []};
      if (problems.missing.length) {
        show('widget');
        return toast(`The ${p.widget.type} widget needs: ${problems.missing.join(', ')}. Fill it in, or remove the widget type.`, true);
      }
      if (problems.usual.length && !await confirmBox('Widget settings', `The ${p.widget.type} widget usually also needs: ${problems.usual.join(', ')}. Without them it may show "API Error". Apply anyway?`, 'Apply anyway')) return;
      const value = kind === 'bookmarks' ? [p] : p;
      const next = {[name.trim()]: value};
      if (isNew) list.push(next); else list[index] = next;
      m.close(); changed();
    }}, isNew ? 'Add' : 'Apply'));
  if (opts.widget && kind === 'services') { p.widget ??= {type: opts.widget}; show('widget'); }
  else show('basics');
}

function select(value, options, onChange, labels = {}) {
  return h('select', {onchange: e => onChange(e.target.value)},
    options.map(o => h('option', {value: o, selected: (value ?? '') === o}, labels[o] ?? o)));
}

// ---- Widget editor: type picker, fields from the docs, visible-field chooser, docs panel ----
// Most widgets talk to the same server the card links to, so start with the link's origin.
function withDefaultUrl(w, href) {
  const def = store.catalog.serviceWidgets.find(x => x.type === w.type);
  if (w.url || !def?.fields.some(f => f.key === 'url')) return w;
  try { return {...w, url: new URL(href).origin}; } catch { return w; }
}

const USUALLY_NEEDED = /^(key|apiKey|password|username|user|token|secret|slug|topic|env)$/;

// Required (url) and usually-needed (non-optional) widget fields that are empty.
export function widgetProblems(p) {
  const w = p?.widget;
  const def = w?.type && store.catalog.serviceWidgets.find(x => x.type === w.type);
  if (!def) return {missing: [], usual: []};
  const empty = k => w[k] === undefined || w[k] === '';
  return {
    missing: def.fields.filter(f => f.key === 'url' && !f.optional && empty(f.key)).map(f => f.key),
    // Only credentials/identifiers; the docs also mark things like "custom" or "pool1" as non-optional.
    usual: def.fields.filter(f => USUALLY_NEEDED.test(f.key) && !f.optional && empty(f.key)).map(f => f.key),
  };
}

export function widgetEditor(p, setWidget, serviceName) {
  const catalog = store.catalog;
  let w = p.widget ? clone(p.widget) : null;
  const root = h('div');
  const commit = () => setWidget(w && w.type ? w : null);

  const draw = () => {
    const def = w?.type && catalog.serviceWidgets.find(x => x.type === w.type);
    const typeInput = h('input', {list: 'widget-types', value: w?.type ?? '', placeholder: 'Type to search, e.g. frigate',
      onchange: e => {
        const t = e.target.value.trim();
        const found = catalog.serviceWidgets.find(x => x.type === t || x.title.toLowerCase() === t.toLowerCase());
        w = t ? withDefaultUrl({...(w ?? {}), type: found?.type ?? t}, p.href) : null;
        commit(); draw();
      }});
    const datalist = h('datalist', {id: 'widget-types'}, catalog.serviceWidgets.map(x => h('option', {value: x.type}, x.title)));
    const suggestion = !w?.type && suggestWidget(catalog, serviceName, p);
    const left = h('div', {},
      h('label', {}, 'Widget type'), typeInput, datalist,
      h('div', {class: 'hint'}, `${catalog.serviceWidgets.length} widget types available. Remove the type to remove the widget.`),
      suggestion ? h('div', {class: 'suggest-box'}, `Suggested for this service: `, h('button', {class: 'small', onclick: () => { w = withDefaultUrl({type: suggestion.type}, p.href); commit(); draw(); }}, suggestion.title)) : null);

    if (def) {
      left.append(h('h3', {}, `${def.title} settings`));
      const known = new Set(def.fields.map(f => f.key));
      for (const f of def.fields) left.append(fieldInput(f));
      // Options already set that the docs example doesn't list (kept as-is).
      for (const k of Object.keys(w).filter(k => k !== 'type' && k !== 'fields' && !known.has(k)))
        left.append(fieldInput({key: k, example: '', comment: 'extra option', secret: /key|password|token|secret/i.test(k)}));
      left.append(h('div', {class: 'toolbar', style: 'margin-top:10px'}, h('button', {class: 'ghost small', onclick: async () => {
        const k = await promptBox('Add option', 'Option name (from the docs)');
        if (k) { w[k] = ''; draw(); }
      }}, '+ Other option')));
      if (def.allowedFields?.length) left.append(fieldsChooser(def));
    } else if (w?.type) {
      left.append(h('p', {class: 'banner'}, `"${w.type}" isn't a widget type in Homepage ${catalog.homepageVersion}. Check the spelling.`));
    }
    const docs = def ? h('div', {}, h('div', {class: 'toolbar'}, h('b', {}, 'From the Homepage docs'), h('span', {class: 'spacer'}),
      h('a', {href: def.doc, target: '_blank', rel: 'noopener'}, 'Open docs ↗')), markdown(def.markdown))
      : h('div', {class: 'docs'}, h('p', {}, 'Choose a widget type to see its documentation here.'),
        h('p', {class: 'muted'}, 'Widgets show live stats from the service on its card, usually using an API key or login from that service.'));
    root.replaceChildren(h('div', {class: 'split'}, left, docs));
  };

  function fieldInput(f) {
    const val = w[f.key];
    const bool = /^(true|false)$/.test(f.example);
    const num = /^-?\d+(\.\d+)?$/.test(f.example);
    const setVal = raw => {
      if (raw === '' || raw == null) delete w[f.key];
      else if (bool) w[f.key] = raw === 'true';
      else if (num && /^-?\d+(\.\d+)?$/.test(raw)) w[f.key] = Number(raw);
      else w[f.key] = raw;
      commit();
    };
    let input;
    if (bool) input = select(val === undefined ? '' : String(val), ['', 'true', 'false'], setVal, {'': '(default)'});
    else if (val !== undefined && typeof val === 'object') {
      input = h('textarea', {rows: 4, oninput: e => { try { w[f.key] = YAML.parse(e.target.value); commit(); } catch {} }});
      input.value = YAML.stringify(val);
    } else {
      input = h('input', {value: val ?? '', type: f.secret ? 'password' : 'text', placeholder: f.example ? `e.g. ${f.example}` : '', autocomplete: 'off', oninput: e => setVal(e.target.value.trim())});
      if (f.secret) input = h('div', {class: 'secret'}, input, h('button', {class: 'ghost small', type: 'button', onclick: e => {
        const i = e.target.previousSibling; i.type = i.type === 'password' ? 'text' : 'password';
      }}, 'show'));
    }
    const required = f.key === 'url' && !f.optional;
    const empty = w[f.key] === undefined || w[f.key] === '';
    return h('div', {}, h('label', {}, f.key, f.optional ? h('span', {class: 'muted'}, ' (optional)') : required ? h('span', {class: 'req'}, ' (required)') : null), input,
      required && empty ? h('div', {class: 'errors'}, 'Needed: the address Homepage (on granite) uses to reach this app\'s API.') : null,
      f.comment ? h('div', {class: 'hint'}, f.comment) : null);
  }

  function fieldsChooser(def) {
    const chosen = new Set(Array.isArray(w.fields) ? w.fields : []);
    const max = def.maxFields ?? 4;
    return h('div', {},
      h('label', {}, `Fields to show on the card (none ticked = Homepage's default; up to ${max})`),
      h('div', {class: 'checks'}, def.allowedFields.map(fld => h('label', {}, h('input', {type: 'checkbox', checked: chosen.has(fld), onchange: e => {
        if (e.target.checked) {
          if (chosen.size >= max) { e.target.checked = false; return toast(`At most ${max} fields`, true); }
          chosen.add(fld);
        } else chosen.delete(fld);
        const order = def.allowedFields.filter(x => chosen.has(x));
        if (order.length) w.fields = order; else delete w.fields;
        commit();
      }}), fld))));
  }

  draw();
  return root;
}
