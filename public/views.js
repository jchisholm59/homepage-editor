// Info widgets, the settings explorer, raw file editing and backups.
import Sortable from '/vendor/sortable/sortable.esm.js';
import {h, api, modal, toast, confirmBox, markdown, renderDiff, clone, firstKey, YAML} from './lib.js';
import {store, loadFile, markDirty, discard, reviewAndSave} from './store.js';

// ---- Info widgets (widgets.yaml): a list of {type: options} ---------------------------------
export async function renderInfoWidgets(root) {
  const name = 'widgets.yaml';
  const file = await loadFile(name);
  if (file.errors?.length) return root.replaceChildren(yamlErrorBanner(name, file.errors));
  file.model ??= [];
  const redraw = () => renderInfoWidgets(root);
  const changed = () => { markDirty(name); redraw(); };
  const list = h('div', {class: 'list'});
  file.model.forEach((item, i) => {
    const type = firstKey(item);
    const def = store.catalog.infoWidgets.find(w => w.type === type);
    list.append(h('div', {class: 'list-row'},
      h('span', {class: 'drag'}, '⠿'),
      h('div', {class: 'grow'}, h('b', {}, def?.title ?? type), ' ', h('span', {class: 'muted'}, summarize(item[type]))),
      h('button', {class: 'ghost small', onclick: () => editInfoWidget(file.model, i, changed)}, 'Edit'),
      h('button', {class: 'ghost small', onclick: async () => {
        if (await confirmBox('Remove widget', `Remove the ${def?.title ?? type} widget?`, 'Remove', true)) { file.model.splice(i, 1); changed(); }
      }}, '🗑')));
  });
  Sortable.create(list, {handle: '.drag', animation: 150, onEnd: e => {
    if (e.oldIndex === e.newIndex) return;
    const [moved] = file.model.splice(e.oldIndex, 1);
    file.model.splice(e.newIndex, 0, moved);
    changed();
  }});
  const add = h('select', {style: 'width:auto', onchange: e => {
    const def = store.catalog.infoWidgets.find(w => w.type === e.target.value);
    e.target.value = '';
    if (!def) return;
    const example = safeParse(def.example);
    const item = Array.isArray(example) && example[0]?.[def.type] !== undefined ? example[0] : {[def.type]: {}};
    file.model.push(item);
    editInfoWidget(file.model, file.model.length - 1, changed, true);
  }}, h('option', {value: ''}, '+ Add info widget…'), store.catalog.infoWidgets.map(w => h('option', {value: w.type}, w.title)));
  root.replaceChildren(
    toolbar(name, file, redraw, add),
    h('p', {class: 'muted'}, 'Info widgets sit across the top of Homepage: clock, weather, search, system resources and more. Drag to reorder.'),
    list);
}

function editInfoWidget(list, i, changed, isNew = false) {
  const item = list[i];
  const type = firstKey(item);
  const def = store.catalog.infoWidgets.find(w => w.type === type);
  const ta = h('textarea', {rows: 16, spellcheck: 'false'});
  ta.value = YAML.stringify(item[type] ?? {}, {lineWidth: 0});
  const err = h('div', {class: 'errors'});
  const m = modal(`${def?.title ?? type} widget`, {onClose: () => { if (isNew && !applied) { list.splice(i, 1); changed(); } }});
  let applied = false;
  m.body.append(h('div', {class: 'split', style: 'margin-top:10px'},
    h('div', {}, h('label', {}, 'Options (YAML)'), ta, err,
      h('p', {class: 'hint'}, 'Pre-filled from the docs example. Replace the example values (locations, API keys…) with yours.')),
    def ? h('div', {}, h('div', {class: 'toolbar'}, h('b', {}, 'Homepage docs'), h('span', {class: 'spacer'}), h('a', {href: def.doc, target: '_blank'}, 'Open docs ↗')), markdown(def.markdown)) : h('div')));
  m.foot.append(h('span', {class: 'spacer'}), h('button', {class: 'ghost', onclick: () => m.close()}, 'Cancel'),
    h('button', {onclick: () => {
      try {
        list[i] = {[type]: YAML.parse(ta.value) ?? {}};
        applied = true; m.close(); changed();
      } catch (e) { err.textContent = e.message; }
    }}, 'Apply'));
}

function summarize(opts) {
  if (!opts || typeof opts !== 'object') return '';
  return Object.entries(opts).filter(([k]) => !/key|password|token|secret/i.test(k)).slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? '…' : v}`).join(' · ');
}

// ---- Settings explorer: every documented option, with "use this example" -------------------
let settingsSection = null;
export async function renderSettings(root) {
  const name = 'settings.yaml';
  const file = await loadFile(name);
  file.draft ??= file.text;
  const ta = h('textarea', {rows: 18, spellcheck: 'false', oninput: () => { file.draft = ta.value; file.dirty = file.draft !== file.text; validate(); updateButtons(); }});
  ta.value = file.draft;
  const err = h('div', {class: 'errors'});
  const validate = () => {
    try { YAML.parse(ta.value); err.textContent = ''; return true; } catch (e) { err.textContent = e.message; return false; }
  };
  validate();
  const saveBtn = h('button', {onclick: async () => {
    if (await reviewAndSave(name, {text: ta.value})) { file.draft = store.files[name].text; renderSettings(root); }
  }}, 'Review & Save');
  const resetBtn = h('button', {class: 'ghost', onclick: () => { file.draft = file.text; file.dirty = false; renderSettings(root); }}, 'Discard changes');
  const updateButtons = () => { saveBtn.disabled = ta.value === file.text; resetBtn.hidden = ta.value === file.text; markDirtyNote(); };
  updateButtons();

  // Merge an example into the current settings (keeps your comments), shown in the editor first.
  const useExample = async example => {
    if (!validate()) return toast('Fix the YAML errors in your settings first', true);
    const current = YAML.parse(ta.value) ?? {};
    const add = safeParse(example);
    if (!add || typeof add !== 'object' || Array.isArray(add)) return toast('This example is not a settings block', true);
    try {
      const r = await api(`/api/preview/${name}`, {json: {data: deepMerge(current, add)}});
      ta.value = r.text; file.draft = r.text; file.dirty = true; updateButtons();
      toast('Added to your settings below. Adjust the values, then Review & Save.');
      ta.scrollIntoView({behavior: 'smooth', block: 'center'});
    } catch (e) { toast(e.message, true); }
  };

  const pages = [['settings', 'Settings'], ['services', 'Services & widgets']];
  const all = pages.flatMap(([page, label]) => store.catalog.configs[page].sections.map(s => ({...s, page, pageLabel: label})));
  settingsSection ??= all.find(s => s.page === 'settings' && s.id === 'layout')?.id ?? all[0].id;
  const docsPane = h('div');
  const toc = h('div', {class: 'toc'});
  const select = s => {
    settingsSection = `${s.page}:${s.id}`;
    toc.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.key === settingsSection));
    const usable = s.page === 'settings';
    docsPane.replaceChildren(h('h2', {style: 'margin-top:0'}, s.title),
      markdownWithExamples(s, usable ? useExample : null),
      h('p', {}, h('a', {href: `${store.catalog.configs[s.page].doc}#${s.id}`, target: '_blank'}, 'Open this section on gethomepage.dev ↗')));
  };
  for (const [page, label] of pages) {
    toc.append(h('div', {class: 'muted', style: 'padding:6px 8px;font-size:11px;text-transform:uppercase'}, label));
    for (const s of store.catalog.configs[page].sections.filter(s => s.id !== 'intro'))
      toc.append(h('button', {class: s.level === 3 ? 'sub' : '', 'data-key': `${page}:${s.id}`, onclick: () => select(s)}, s.title));
  }
  root.replaceChildren(
    h('div', {class: 'explorer'}, toc, h('div', {},
      h('div', {class: 'banner info'}, 'Browse every documented option on the left. Examples have a ', h('b', {}, 'Use this'),
        ' button that merges them into your settings below, so you can see and adjust them before saving.'),
      docsPane,
      h('h2', {}, 'Your settings.yaml'),
      ta, err,
      h('div', {class: 'toolbar', style: 'margin-top:8px'}, h('span', {class: 'spacer'}), resetBtn, saveBtn))));
  const initial = all.find(s => `${s.page}:${s.id}` === settingsSection) ?? all.find(s => s.id === settingsSection) ?? all[0];
  select(initial);
}

// Docs markdown where each ```yaml block gets a "Use this" button.
function markdownWithExamples(section, onUse) {
  const box = markdown(section.markdown);
  if (onUse) {
    box.querySelectorAll('pre').forEach((pre, i) => {
      const example = section.examples[i];
      if (!example) return;
      pre.classList.add('example');
      pre.style.position = 'relative';
      pre.append(h('button', {class: 'small use', onclick: () => onUse(example)}, 'Use this'));
    });
  }
  return box;
}

function deepMerge(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !b || typeof b !== 'object' || Array.isArray(b)) return clone(b);
  const out = clone(a);
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : clone(v);
  return out;
}

const safeParse = t => { try { return YAML.parse(t); } catch { return null; } };

function markDirtyNote() {
  document.getElementById('dirty-note').hidden = !Object.values(store.files).some(f => f.dirty);
}

// ---- Files: edit any config file as text ---------------------------------------------------
export async function renderFiles(root, selected) {
  const files = await api('/api/files');
  selected ??= renderFiles.last ?? 'services.yaml';
  renderFiles.last = selected;
  const file = await loadFile(selected, !store.files[selected]?.dirty);
  file.draft ??= file.text;
  const ta = h('textarea', {rows: 30, spellcheck: 'false'});
  ta.value = file.draft;
  const err = h('div', {class: 'errors'});
  const isYaml = /\.ya?ml$/.test(selected);
  const saveBtn = h('button', {}, 'Review & Save');
  const update = () => {
    file.draft = ta.value;
    file.dirty = ta.value !== file.text;
    saveBtn.disabled = !file.dirty;
    if (isYaml) { try { YAML.parse(ta.value); err.textContent = ''; } catch (e) { err.textContent = e.message; } }
    markDirtyNote();
  };
  ta.addEventListener('input', update);
  saveBtn.onclick = async () => {
    if (await reviewAndSave(selected, {text: ta.value})) {
      store.files[selected].draft = store.files[selected].text;
      renderFiles(root, selected);
    }
  };
  update();
  root.replaceChildren(
    h('div', {class: 'toolbar'},
      h('select', {style: 'width:auto', onchange: e => renderFiles(root, e.target.value)},
        files.map(f => h('option', {value: f.name, selected: f.name === selected}, `${f.name} (${f.size} bytes)`))),
      h('span', {class: 'muted'}, 'Plain-text editing for anything the other tabs don\'t cover (custom.css, docker.yaml…).'),
      h('span', {class: 'spacer'}), saveBtn),
    file.dirty && store.files[selected].model && JSON.stringify(store.files[selected].model) !== JSON.stringify(store.files[selected].data)
      ? h('div', {class: 'banner'}, `You also have unsaved changes to ${selected} in another tab. Save or discard those first; this text editor shows the file as saved.`)
      : null,
    ta, err);
}

// ---- Backups ---------------------------------------------------------------------------------
export async function renderBackups(root) {
  const backups = await api('/api/backups');
  const rows = backups.map(b => h('div', {class: 'list-row'},
    h('div', {class: 'grow'}, h('b', {}, formatId(b.id)), ' ', h('span', {class: 'muted'}, b.files.join(', '))),
    b.files.map(f => h('button', {class: 'ghost small', onclick: () => showBackup(b.id, f, () => renderBackups(root))}, `View ${f}`))));
  root.replaceChildren(
    h('p', {class: 'muted'}, 'A copy of each file is saved here just before every save or restore (the newest 300 are kept). ',
      'Stored on granite in /root/homepage/editor-backups.'),
    rows.length ? h('div', {class: 'list'}, rows) : h('p', {}, 'No backups yet. They appear after your first save.'));
}

async function showBackup(id, name, after) {
  const r = await api(`/api/backup/${id}/${name}`);
  const m = modal(`${name} from ${formatId(id)}`);
  m.body.append(h('p', {class: 'muted'}, 'Red lines are in the current file, green lines are in the backup. Restoring replaces the current file (which is itself backed up first).'), renderDiff(r.diff));
  m.foot.append(h('span', {class: 'spacer'}), h('button', {class: 'ghost', onclick: () => m.close()}, 'Close'),
    h('button', {class: 'danger', onclick: async () => {
      if (!await confirmBox('Restore backup', `Replace the current ${name} with this backup?`, 'Restore', true)) return;
      try {
        await api(`/api/restore/${id}/${name}`, {json: {}});
        await loadFile(name, true);
        store.files[name].draft = null;
        toast(`Restored ${name}`);
        m.close(); after();
      } catch (e) { toast(e.message, true); }
    }}, 'Restore this version'));
}

const formatId = id => id.replace(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d).*$/, '$1 $2:$3:$4 UTC');

function toolbar(name, file, redraw, ...extra) {
  return h('div', {class: 'toolbar'}, ...extra, h('span', {class: 'spacer'}),
    file.dirty ? h('button', {class: 'ghost', onclick: async () => {
      if (await confirmBox('Discard changes', `Throw away your unsaved changes to ${name}?`, 'Discard', true)) { discard(name); redraw(); }
    }}, 'Discard changes') : null,
    h('button', {disabled: !file.dirty, onclick: async () => { if (await reviewAndSave(name)) redraw(); }}, 'Review & Save'));
}

function yamlErrorBanner(name, errors) {
  return h('div', {class: 'banner'}, `${name} has YAML errors, so it can only be edited as text (Files tab):`, h('pre', {}, errors.join('\n')));
}
