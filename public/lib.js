// Shared helpers: DOM building, API calls, modals, toasts, diffs, icon URLs, catalog lookups.
import {marked} from '/vendor/marked/marked.esm.js';
import * as YAML from '/vendor/yaml/index.js';

export {YAML};

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export async function api(path, opts = {}) {
  const init = {...opts};
  if (opts.json !== undefined) {
    init.method ??= 'POST';
    init.headers = {'Content-Type': 'application/json'};
    init.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, init);
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body?.error ?? body ?? `HTTP ${r.status}`);
  return body;
}

export function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = bad ? 'bad' : '';
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), bad ? 7000 : 3500);
}

// A modal; returns {close, body, foot}. onClose runs when dismissed.
export function modal(title, {narrow = false, onClose} = {}) {
  const root = document.getElementById('modal-root');
  const body = h('div', {class: 'modal-body'});
  const foot = h('div', {class: 'modal-foot'});
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = e => { if (e.key === 'Escape' && root.lastChild === back) close(); };
  const back = h('div', {class: 'modal-back', onmousedown: e => { if (e.target === back) close(); }},
    h('div', {class: `modal${narrow ? ' narrow' : ''}`},
      h('div', {class: 'modal-head'}, h('h2', {}, title), h('button', {class: 'ghost small close', onclick: close}, '✕')),
      body, foot));
  document.addEventListener('keydown', esc);
  root.append(back);
  return {close, body, foot};
}

export function confirmBox(title, message, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const m = modal(title, {narrow: true, onClose: () => { if (!done) resolve(false); }});
    m.body.append(h('p', {}, message));
    m.foot.append(h('span', {class: 'spacer'}),
      h('button', {class: 'ghost', onclick: () => m.close()}, 'Cancel'),
      h('button', {class: danger ? 'danger' : '', onclick: () => { done = true; m.close(); resolve(true); }}, okLabel));
  });
}

export function promptBox(title, label, value = '') {
  return new Promise(resolve => {
    let done = false;
    const input = h('input', {value});
    const ok = () => { done = true; m.close(); resolve(input.value.trim()); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    const m = modal(title, {narrow: true, onClose: () => { if (!done) resolve(null); }});
    m.body.append(h('label', {}, label), input);
    m.foot.append(h('span', {class: 'spacer'}), h('button', {class: 'ghost', onclick: () => m.close()}, 'Cancel'), h('button', {onclick: ok}, 'OK'));
    setTimeout(() => input.focus(), 0);
  });
}

export function renderDiff(patch) {
  const lines = patch.split('\n').slice(2);   // drop the ---/+++ header
  return h('div', {class: 'diff'}, lines.map(l => h('div', {
    class: l.startsWith('@@') ? 'h' : l.startsWith('+') ? 'a' : l.startsWith('-') ? 'd' : '',
  }, redactLine(l) || ' ')));
}

// Never show secrets in diffs (the files themselves are unchanged).
const SECRET_KEY = /^([+\- ]?\s*-?\s*)((?:[\w.-]*?)(?:key|password|pass|token|secret)[\w.-]*\s*:\s*)(\S.*)$/i;
export const redactLine = l => l.replace(SECRET_KEY, (_, a, b) => `${a}${b}••••••`);

export const markdown = md => h('div', {class: 'docs', html: marked.parse(cleanDocs(md))});
// Docs use mkdocs-only syntax (!!! admonitions, relative links); make it readable here.
function cleanDocs(md) {
  return md
    .replace(/^!!! (\w+)\s*"?([^"\n]*)"?\n((?:[ \t]+.*\n?|\n)*)/gm, (_, kind, title, body) =>
      `> **${title || kind}**\n${body.split('\n').map(l => `> ${l.trim()}`).join('\n')}\n`)
    .replace(/\]\((?!https?:)([^)]+?)\.md(#[^)]*)?\)/g, (_, p, hash = '') => `](https://gethomepage.dev/${p.replace(/^(\.\.\/)+/, '')}/${hash})`);
}

// ---- Icons: resolve a Homepage icon reference the same way Homepage does ---------------------
const JSD = 'https://cdn.jsdelivr.net';
export function iconUrl(ref) {
  if (!ref || typeof ref !== 'string') return null;
  if (/^https?:\/\//.test(ref)) return ref;
  if (ref.startsWith('/icons/')) return `/local-icons/${encodeURIComponent(ref.slice(7))}`;
  if (ref.startsWith('/')) return null;
  const color = s => s.replace(/-#[0-9a-f]{3,8}$/i, '');
  if (ref.startsWith('mdi-')) return `${JSD}/npm/@mdi/svg@latest/svg/${color(ref.slice(4))}.svg`;
  if (ref.startsWith('si-')) return `${JSD}/npm/simple-icons@latest/icons/${color(ref.slice(3))}.svg`;
  const [name, ext = 'png'] = splitExt(ref.startsWith('sh-') ? ref.slice(3) : ref);
  if (ref.startsWith('sh-')) return `${JSD}/gh/selfhst/icons@main/${ext}/${name}.${ext}`;
  return `${JSD}/gh/homarr-labs/dashboard-icons/${ext}/${name}.${ext}`;
}
function splitExt(s) {
  const m = s.match(/^(.*)\.(png|svg|webp)$/i);
  return m ? [m[1], m[2].toLowerCase()] : [s, undefined];
}

// <img> for an icon ref, swapped for a red placeholder if it fails to load.
export function iconImg(ref, onBroken) {
  const url = iconUrl(ref);
  if (!url) return h('div', {class: 'icon-ph', title: ref ? `Can't preview ${ref}` : 'No icon'}, ref ? '?' : '—');
  const img = h('img', {class: 'icon', src: url, loading: 'lazy', alt: '', title: ref});
  img.addEventListener('error', () => {
    img.replaceWith(h('div', {class: 'icon-ph broken', title: `Icon not found: ${ref}`}, '✕'));
    onBroken?.(ref);
  });
  return img;
}

// ---- Catalog helpers --------------------------------------------------------------------------
export const norm = s => String(s ?? '').toLowerCase().replace(/\.(png|svg|webp)$/, '').replace(/-(light|dark)$/, '').replace(/[^a-z0-9]/g, '');

// Common names whose Homepage widget type is spelled differently.
const ALIASES = {synology: 'diskstation', dsm: 'diskstation', pialert: 'netalertx', adguardhome: 'adguard',
  piholev6: 'pihole', proxmoxve: 'proxmox', pve: 'proxmox', plexmediaserver: 'plex', nginxproxymanager: 'npm',
  qbittorrent: 'qbittorrent', truenasscale: 'truenas', openmediavault: 'openmediavault', uptimekuma: 'uptimekuma'};

// Suggest a widget type for a service from its name, icon and URL.
export function suggestWidget(catalog, name, props = {}) {
  const byType = new Map(catalog.serviceWidgets.map(w => [w.type, w]));
  const byTitle = new Map(catalog.serviceWidgets.map(w => [norm(w.title), w]));
  const match = s => {
    const c = norm(s);
    if (!c) return null;
    const t = ALIASES[c] ?? c;
    return byType.get(t) ?? byTitle.get(t) ?? null;
  };
  // The name (or host name) must match; icons are often borrowed from another app (e.g. a
  // home-made NVR using the Frigate icon), so an icon that points elsewhere cancels the suggestion.
  const fromName = match(name) ?? match(hostWord(props.href));
  const fromIcon = match(props.icon);
  if (!fromName || (fromIcon && fromIcon !== fromName)) return null;
  return fromName;
}
function hostWord(href) {
  try { return new URL(href).hostname.split('.')[0].replace(/-?(home|local|lan|internal|remote)$/, ''); } catch { return ''; }
}

export const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const firstKey = o => (o && typeof o === 'object' ? Object.keys(o)[0] : undefined);
