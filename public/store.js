// Loaded config files, their working copies, and the review-then-save flow.
import {api, h, modal, renderDiff, toast, clone} from './lib.js';

export const store = {
  info: null,
  catalog: null,
  files: {},            // name -> {text, data, mtime, errors, model, dirty}
  listeners: new Set(),
};

export async function loadFile(name, force = false) {
  if (store.files[name] && !force) return store.files[name];
  const f = await api(`/api/file/${encodeURIComponent(name)}`);
  store.files[name] = {...f, model: clone(f.data), dirty: false};
  updateDirty();
  return store.files[name];
}

export function markDirty(name) {
  store.files[name].dirty = true;
  updateDirty();
}

export function discard(name) {
  const f = store.files[name];
  f.model = clone(f.data);
  f.dirty = false;
  updateDirty();
}

export const anyDirty = () => Object.values(store.files).some(f => f.dirty);

function updateDirty() {
  document.getElementById('dirty-note').hidden = !anyDirty();
}

window.addEventListener('beforeunload', e => { if (anyDirty()) e.preventDefault(); });

// Show what will change, then save. body = {data} (merged, keeps comments) or {text}.
export async function reviewAndSave(name, body = {data: store.files[name].model}) {
  let preview;
  try {
    preview = await api(`/api/preview/${encodeURIComponent(name)}`, {json: body});
  } catch (e) {
    return toast(e.message, true);
  }
  if (!preview.changed) {
    toast(`No changes to ${name}`);
    return false;
  }
  return new Promise(resolve => {
    let saved = false;
    const m = modal(`Review changes to ${name}`, {onClose: () => resolve(saved)});
    const contentOnly = preview.diff !== preview.contentDiff;
    const diffBox = h('div');
    const show = ignoreWs => diffBox.replaceChildren(renderDiff(ignoreWs ? preview.contentDiff : preview.diff));
    show(contentOnly);
    if (contentOnly) {
      m.body.append(h('div', {class: 'banner info'},
        'This save also tidies the file\'s indentation (formatting only, nothing else changes). ',
        'The diff below hides those spacing changes so you can see the real edits. ',
        h('label', {class: 'inline'}, h('input', {type: 'checkbox', style: 'width:auto', onchange: e => show(!e.target.checked)}), ' show spacing changes too')));
    }
    if (preview.errors?.length) m.body.append(h('div', {class: 'errors'}, preview.errors.join('\n')));
    m.body.append(h('p', {class: 'muted'}, 'Secrets are hidden in this view. A backup of the current file is made before saving.'), diffBox);
    const saveBtn = h('button', {disabled: preview.errors?.length > 0, onclick: async () => {
      saveBtn.disabled = true;
      try {
        const f = store.files[name];
        const r = await api(`/api/save/${encodeURIComponent(name)}`, {json: {...body, baseMtime: f?.exists ? f.mtime : undefined}});
        saved = r.saved;
        await loadFile(name, true);
        toast(`Saved ${name}${r.backup ? ' (backup made)' : ''}`);
        reloadPreview();
        m.close();
      } catch (e) {
        toast(e.message, true);
        saveBtn.disabled = false;
      }
    }}, 'Save to Homepage');
    m.foot.append(h('span', {class: 'spacer'}), h('button', {class: 'ghost', onclick: () => m.close()}, 'Back to editing'), saveBtn);
  });
}

export function reloadPreview() {
  const f = document.getElementById('preview-frame');
  if (f.src) f.src = f.src;
}
