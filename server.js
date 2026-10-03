// Homepage Editor: a web UI for reading and editing gethomepage.dev config files in place.
// Edits keep comments and ordering (YAML Document API), every save is diffed, validated and backed up.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import YAML from 'yaml';
import {createTwoFilesPatch} from 'diff';
import {syncDocument} from './lib/sync.js';

const PORT = Number(process.env.PORT ?? 7200);
const CONFIG_DIR = process.env.CONFIG_DIR ?? '/config';
const BACKUP_DIR = process.env.BACKUP_DIR ?? '/backups';
const HOMEPAGE_URL = (process.env.HOMEPAGE_URL ?? 'http://homepage:3000').replace(/\/$/, '');
const PASSWORD = process.env.EDITOR_PASSWORD ?? '';
// Restart-only Docker API proxy (docker-socket-proxy with POST + ALLOW_RESTARTS), optional.
const DOCKER_PROXY = (process.env.DOCKER_PROXY ?? '').replace(/\/$/, '');
const HOMEPAGE_CONTAINER = process.env.HOMEPAGE_CONTAINER ?? 'homepage';
const ICON_DIR = path.join(CONFIG_DIR, 'icons');
const here = path.dirname(new URL(import.meta.url).pathname);
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'catalog', 'catalog.json'), 'utf8'));

const app = express();
app.disable('x-powered-by');

// Optional password (any username). Single-user LAN, but the editor can rewrite the dashboard.
app.use((req, res, next) => {
  if (!PASSWORD) return next();
  const m = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
  const pass = m ? Buffer.from(m[1], 'base64').toString().replace(/^[^:]*:/, '') : null;
  const ok = pass !== null && crypto.timingSafeEqual(
    crypto.createHash('sha256').update(pass).digest(), crypto.createHash('sha256').update(PASSWORD).digest());
  if (ok) return next();
  res.set('WWW-Authenticate', 'Basic realm="Homepage Editor"').status(401).send('Password required');
});

app.use(express.json({limit: '2mb'}));
app.use(express.static(path.join(here, 'public')));
app.use('/vendor/sortable', express.static(path.join(here, 'node_modules/sortablejs/modular')));
app.use('/vendor/marked', express.static(path.join(here, 'node_modules/marked/lib')));
app.use('/vendor/yaml', express.static(path.join(here, 'node_modules/yaml/browser/dist')));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(e.status ?? 500).json({error: e.message}));
const fail = (status, message) => Object.assign(new Error(message), {status});

// Only plain files directly inside the config dir (no paths), and only config-like extensions.
function configPath(name) {
  if (!/^[\w][\w.-]*\.(ya?ml|css|js)$/.test(name)) throw fail(400, `Not an editable config file: ${name}`);
  return path.join(CONFIG_DIR, name);
}

const isYaml = name => /\.ya?ml$/.test(name);

function readFile(name) {
  const p = configPath(name);
  if (!fs.existsSync(p)) return {name, text: '', mtime: 0, exists: false};
  return {name, text: fs.readFileSync(p, 'utf8'), mtime: fs.statSync(p).mtimeMs, exists: true};
}

// Parse YAML the way Homepage does, reporting errors with line numbers.
function parseYaml(text) {
  const doc = YAML.parseDocument(text, {keepSourceTokens: false});
  const errors = doc.errors.map(e => `${e.message}`);
  return {doc, errors, data: errors.length ? null : doc.toJS()};
}

// Turn an edit ({text} or {data}) into the new file text; {data} is merged into the existing
// document so untouched items keep their comments, quoting and order.
function render(name, body) {
  const current = readFile(name);
  let text;
  if (typeof body.text === 'string') text = body.text;
  else if (body.data !== undefined) {
    if (!isYaml(name)) throw fail(400, 'Structured edits are only for YAML files');
    const {doc, errors} = parseYaml(current.text || '---\n');
    if (errors.length) throw fail(400, `The current ${name} has YAML errors, edit it as text: ${errors[0]}`);
    syncDocument(doc, body.data);
    text = doc.toString({lineWidth: 0});
  } else throw fail(400, 'Nothing to save');
  const errors = isYaml(name) ? parseYaml(text).errors : [];
  const diff = createTwoFilesPatch(`${name} (current)`, `${name} (new)`, current.text, text, '', '', {context: 3});
  // Same diff ignoring indentation/spacing, so a first save that tidies mixed indentation
  // doesn't hide the real edits.
  const contentDiff = createTwoFilesPatch(`${name} (current)`, `${name} (new)`, current.text, text, '', '', {context: 3, ignoreWhitespace: true});
  return {current, text, errors, diff, contentDiff, changed: text !== current.text};
}

app.get('/api/info', (req, res) => res.json({
  homepageUrl: HOMEPAGE_URL, homepageVersion: catalog.homepageVersion, password: Boolean(PASSWORD),
  canRestart: Boolean(DOCKER_PROXY),
}));

// Homepage rebuilds its page when its config hash changes; ask it to do so right away.
function revalidateHomepage() {
  fetch(`${HOMEPAGE_URL}/api/revalidate`, {signal: AbortSignal.timeout(10000)}).catch(() => {});
}

// New icons/background images are only served after Homepage restarts (Next.js static files).
app.post('/api/restart-homepage', wrap(async (req, res) => {
  if (!DOCKER_PROXY) throw fail(400, 'Restarting is not set up (no DOCKER_PROXY)');
  const r = await fetch(`${DOCKER_PROXY}/containers/${encodeURIComponent(HOMEPAGE_CONTAINER)}/restart?t=5`, {method: 'POST', signal: AbortSignal.timeout(60000)});
  if (r.status !== 204) throw fail(502, `Docker said HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  res.json({restarted: true});
}));

app.get('/api/catalog', (req, res) => res.json(catalog));

app.get('/api/files', wrap(async (req, res) => {
  const files = fs.readdirSync(CONFIG_DIR, {withFileTypes: true})
    .filter(d => d.isFile() && /\.(ya?ml|css|js)$/.test(d.name))
    .map(d => ({name: d.name, size: fs.statSync(path.join(CONFIG_DIR, d.name)).size}));
  res.json(files.sort((a, b) => a.name.localeCompare(b.name)));
}));

app.get('/api/file/:name', wrap(async (req, res) => {
  const f = readFile(req.params.name);
  const parsed = isYaml(f.name) ? parseYaml(f.text) : {errors: [], data: null};
  res.json({...f, data: parsed.data, errors: parsed.errors});
}));

app.post('/api/preview/:name', wrap(async (req, res) => {
  const {text, errors, diff, contentDiff, changed} = render(req.params.name, req.body);
  res.json({text, errors, diff, contentDiff, changed});
}));

app.post('/api/save/:name', wrap(async (req, res) => {
  const name = req.params.name;
  const {current, text, errors, changed} = render(name, req.body);
  if (errors.length) throw fail(400, `Not saved, the YAML is invalid: ${errors[0]}`);
  if (req.body.baseMtime !== undefined && current.exists && Math.abs(current.mtime - req.body.baseMtime) > 1)
    throw fail(409, `${name} was changed by something else since you opened it. Reload to see the latest version.`);
  if (!changed) return res.json({saved: false, mtime: current.mtime});
  const backup = backupFile(name, current);
  // Write in place (not rename) so the file keeps its owner and permissions.
  fs.writeFileSync(configPath(name), text);
  revalidateHomepage();
  res.json({saved: true, backup, mtime: fs.statSync(configPath(name)).mtimeMs});
}));

// ---- Backups: BACKUP_DIR/<timestamp>/<file>, written before every save -----------------------
function backupFile(name, current) {
  if (!current.exists) return null;
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(BACKUP_DIR, id), {recursive: true});
  fs.writeFileSync(path.join(BACKUP_DIR, id, name), current.text);
  pruneBackups();
  return id;
}

function pruneBackups(keep = 300) {
  const ids = listBackupIds();
  for (const id of ids.slice(keep)) fs.rmSync(path.join(BACKUP_DIR, id), {recursive: true, force: true});
}

const listBackupIds = () => fs.existsSync(BACKUP_DIR)
  ? fs.readdirSync(BACKUP_DIR).filter(d => /^\d{4}-/.test(d)).sort().reverse() : [];

app.get('/api/backups', wrap(async (req, res) => {
  res.json(listBackupIds().map(id => ({id, files: fs.readdirSync(path.join(BACKUP_DIR, id))})));
}));

app.get('/api/backup/:id/:name', wrap(async (req, res) => {
  const {id, name} = req.params;
  if (!/^\d{4}-[\w-]+$/.test(id)) throw fail(400, 'Bad backup id');
  configPath(name);
  const p = path.join(BACKUP_DIR, id, name);
  if (!fs.existsSync(p)) throw fail(404, 'No such backup');
  const text = fs.readFileSync(p, 'utf8');
  const current = readFile(name);
  res.json({text, diff: createTwoFilesPatch(`${name} (current)`, `${name} (backup ${id})`, current.text, text, '', '', {context: 3})});
}));

app.post('/api/restore/:id/:name', wrap(async (req, res) => {
  const {id, name} = req.params;
  if (!/^\d{4}-[\w-]+$/.test(id)) throw fail(400, 'Bad backup id');
  const p = path.join(BACKUP_DIR, id, name);
  if (!fs.existsSync(p)) throw fail(404, 'No such backup');
  const backup = backupFile(name, readFile(name));
  fs.writeFileSync(configPath(name), fs.readFileSync(p, 'utf8'));
  revalidateHomepage();
  res.json({restored: true, backup});
}));

// ---- Icons ---------------------------------------------------------------------------------
const CDN = {
  dashboard: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/tree.json',
  selfhst: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/index.json',
};
let iconIndex = {at: 0, data: null};

async function fetchJson(url) {
  const r = await fetch(url, {signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

app.get('/api/icons/index', wrap(async (req, res) => {
  if (!iconIndex.data || Date.now() - iconIndex.at > 24 * 3600e3) {
    const [dash, sh] = await Promise.allSettled([fetchJson(CDN.dashboard), fetchJson(CDN.selfhst)]);
    const strip = list => [...new Set((list ?? []).map(f => f.replace(/\.(png|svg|webp)$/, '')))];
    iconIndex = {at: Date.now(), data: {
      // Dashboard Icons: "name" (png by default) or "name.svg"/"name.webp".
      dashboard: dash.status === 'fulfilled' ? {png: strip(dash.value.png), svg: strip(dash.value.svg)} : {png: [], svg: []},
      // selfh.st: "sh-name" (png) or "sh-name.svg".
      selfhst: sh.status === 'fulfilled' ? sh.value.map(i => ({ref: i.Reference, name: i.Name, svg: i.SVG === 'Yes'})) : [],
      errors: [dash, sh].filter(r => r.status === 'rejected').map(r => r.reason.message),
    }};
  }
  res.json({...iconIndex.data, local: localIcons()});
}));

const localIcons = () => fs.existsSync(ICON_DIR)
  ? fs.readdirSync(ICON_DIR).filter(f => /\.(png|svg|webp|jpe?g|gif|ico)$/i.test(f)).sort() : [];

app.use('/local-icons', express.static(ICON_DIR, {dotfiles: 'deny', index: false}));

// Is config/icons actually served by Homepage at /icons/? (needs the extra Docker mount)
app.get('/api/icons/served', wrap(async (req, res) => {
  const sample = localIcons()[0];
  if (!sample) return res.json({served: null, reason: 'no local icons'});
  try {
    const r = await fetch(`${HOMEPAGE_URL}/icons/${encodeURIComponent(sample)}`, {signal: AbortSignal.timeout(5000)});
    res.json({served: r.ok && /image|svg|octet/.test(r.headers.get('content-type') ?? ''), sample});
  } catch (e) {
    res.json({served: false, sample, reason: e.message});
  }
}));

const safeIconName = n => n.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+/, '');
const IMAGE_TYPES = {'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico'};

function storeIcon(name, buf, type) {
  const ext = IMAGE_TYPES[type?.split(';')[0].trim()];
  if (!ext) throw fail(400, `Not an image (${type || 'unknown type'})`);
  if (buf.length > 15e6) throw fail(400, 'Image is over 15 MB');
  const base = safeIconName(name.replace(/\.[a-z0-9]+$/i, '')) || 'icon';
  fs.mkdirSync(ICON_DIR, {recursive: true});
  const file = `${base}.${ext}`;
  fs.writeFileSync(path.join(ICON_DIR, file), buf);
  return file;
}

// Download a remote image into config/icons (fixes sites that block hotlinking).
app.post('/api/icons/fetch', wrap(async (req, res) => {
  const {url, name} = req.body;
  if (!/^https?:\/\//.test(url ?? '')) throw fail(400, 'Need an http(s) URL');
  const r = await fetch(url, {signal: AbortSignal.timeout(15000), headers: {'User-Agent': 'Mozilla/5.0 (X11; Linux) Firefox/157.0', Referer: new URL(url).origin + '/'}});
  if (!r.ok) throw fail(400, `Download failed: HTTP ${r.status}`);
  const file = storeIcon(name || path.basename(new URL(url).pathname), Buffer.from(await r.arrayBuffer()), r.headers.get('content-type'));
  res.json({file, ref: `/icons/${file}`});
}));

app.post('/api/icons/upload', express.raw({type: 'image/*', limit: '15mb'}), wrap(async (req, res) => {
  const file = storeIcon(String(req.query.name ?? 'icon'), req.body, req.headers['content-type']);
  res.json({file, ref: `/icons/${file}`});
}));

// ---- Link checker --------------------------------------------------------------------------
app.post('/api/check-links', wrap(async (req, res) => {
  const urls = [...new Set((req.body.urls ?? []).filter(u => /^https?:\/\//.test(u)))].slice(0, 200);
  const check = async url => {
    for (const method of ['HEAD', 'GET']) {
      try {
        const r = await fetch(url, {method, redirect: 'manual', signal: AbortSignal.timeout(6000)});
        if (method === 'HEAD' && (r.status === 405 || r.status === 501)) continue;
        return {url, status: r.status, ok: r.status < 400 || r.status === 401 || r.status === 403};
      } catch (e) {
        const code = e.cause?.code ?? e.message;
        // Self-signed HTTPS (Proxmox, NAS UIs...) means the server answered, which is all we check.
        if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return {url, status: 0, ok: true, note: 'self-signed certificate'};
        if (method === 'GET') return {url, status: 0, ok: false, error: code};
      }
    }
  };
  const results = [];
  for (let i = 0; i < urls.length; i += 16) results.push(...await Promise.all(urls.slice(i, i + 16).map(check)));
  res.json(results);
}));

app.listen(PORT, () => console.log(`Homepage Editor on :${PORT}, config ${CONFIG_DIR}, backups ${BACKUP_DIR}`));
