// Build catalog/catalog.json from a checkout of the Homepage repo's docs, so the editor knows every
// widget type, its fields and examples, and the documented settings, for the Homepage version in use.
//   git clone --depth 1 --branch v1.13.2 https://github.com/gethomepage/homepage.git /tmp/homepage-src
//   node scripts/build-catalog.mjs /tmp/homepage-src v1.13.2
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const [src, version = 'unknown'] = process.argv.slice(2);
if (!src) { console.error('usage: build-catalog.mjs <homepage-src> [version]'); process.exit(1); }
const docs = path.join(src, 'docs');
const SITE = 'https://gethomepage.dev';
const SECRET = /(^|[^a-z])(key|apikey|password|pass|token|secret)$|apiKey|password|token|secret/i;

function readDoc(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const front = m ? YAML.parse(m[1]) ?? {} : {};
  return {front, body: m ? raw.slice(m[0].length) : raw};
}

const yamlBlocks = md => [...md.matchAll(/```ya?ml\n([\s\S]*?)```/g)].map(b => b[1]);

// Top-level keys of a `widget:` mapping, with their inline comments ("# optional, ...").
function widgetFields(block) {
  const lines = block.split('\n');
  const start = lines.findIndex(l => /^\s*widget:\s*$/.test(l));
  if (start < 0) return null;
  const base = lines[start].match(/^\s*/)[0].length;
  const fields = [];
  let type = null, indent = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    const ind = line.match(/^\s*/)[0].length;
    if (ind <= base) break;
    indent ??= ind;
    if (ind !== indent) continue;            // nested value of the previous key
    const kv = line.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*?)\s*(?:#\s*(.*))?$/);
    if (!kv) continue;
    const [, key, value, comment = ''] = kv;
    if (key === 'type') { type = value.replace(/['"]/g, ''); continue; }
    fields.push({key, example: value, comment, optional: /optional/i.test(comment), secret: SECRET.test(key)});
  }
  return type ? {type, fields} : null;
}

function widgetDocs(dir, kind) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'index.md').sort()) {
    const slug = f.replace(/\.md$/, '');
    const {front, body} = readDoc(path.join(dir, f));
    // "Allowed fields: `[...]`", "Allowed fields (up to 4): `[...]`", or a bullet list of modes below it.
    const allowedText = body.match(/Allowed fields[^:\n]*:([\s\S]*?)(?:\n\s*\n(?!\s*-)|```)/)?.[1] ?? '';
    const allowed = [...allowedText.matchAll(/`(\[[^`]*\])`/g)].map(m => m[1]).join(',');
    const maxFields = body.match(/Allowed fields \(up to (\d+)\)/)?.[1];
    const blocks = yamlBlocks(body);
    const seen = new Set();
    for (const block of blocks) {
      const w = kind === 'service' ? widgetFields(block) : infoWidget(block);
      if (!w || seen.has(w.type)) continue;
      seen.add(w.type);
      out.push({
        type: w.type, slug, title: front.title ?? slug,
        doc: `${SITE}/widgets/${kind === 'service' ? 'services' : 'info'}/${slug}/`,
        // Lenient: some docs have typos like an unclosed quote.
        allowedFields: allowed ? [...new Set([...allowed.matchAll(/[A-Za-z0-9_.-]+/g)].map(m => m[0]))] : null,
        maxFields: maxFields ? Number(maxFields) : null,
        fields: w.fields, example: block.trimEnd(), markdown: body.trim(),
      });
    }
    if (!seen.size && kind === 'info') out.push({type: slug, slug, title: front.title ?? slug, doc: `${SITE}/widgets/info/${slug}/`, fields: [], example: blocks[0]?.trimEnd() ?? '', markdown: body.trim()});
  }
  return out;
}

// Info widgets are list items `- type:` followed by their options.
function infoWidget(block) {
  let doc;
  try { doc = YAML.parse(block); } catch { return null; }
  const item = Array.isArray(doc) ? doc[0] : null;
  if (!item || typeof item !== 'object') return null;
  const [type] = Object.keys(item);
  const opts = item[type] && typeof item[type] === 'object' ? item[type] : {};
  return {type, fields: Object.entries(opts).map(([key, v]) => ({key, example: typeof v === 'object' ? JSON.stringify(v) : String(v), comment: '', optional: true, secret: SECRET.test(key)}))};
}

// Split a config doc into its ## / ### sections, each with its examples, for the help panels.
function sections(file, page) {
  const {front, body} = readDoc(path.join(docs, 'configs', file));
  const parts = body.split(/^(?=#{2,3} )/m);
  const intro = parts[0].startsWith('#') ? null : parts.shift();
  const out = intro?.trim() ? [{id: 'intro', title: front.title ?? page, level: 1, markdown: intro.trim(), examples: yamlBlocks(intro)}] : [];
  for (const p of parts) {
    const h = p.match(/^(#{2,3}) (.+)\n/);
    const title = h[2].trim();
    out.push({id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title, level: h[1].length,
      markdown: p.slice(h[0].length).trim(), examples: yamlBlocks(p).map(e => e.trimEnd())});
  }
  return {title: front.title ?? page, doc: `${SITE}/configs/${page}/`, sections: out};
}

// Colour palettes (theme-<name> classes) with their RGB shades, for the Appearance page swatches.
function palettes() {
  const css = fs.readFileSync(path.join(src, 'src', 'styles', 'theme.css'), 'utf8');
  const out = {};
  for (const m of css.matchAll(/^\.theme-([a-z]+)\s*\{([^}]*)\}/gm)) {
    const shades = Object.fromEntries([...m[2].matchAll(/--color-(\d+):\s*([\d ]+);/g)].map(x => [x[1], x[2].trim()]));
    if (Object.keys(shades).length) out[m[1]] = shades;
  }
  return out;
}

const catalog = {
  palettes: palettes(),
  homepageVersion: version,
  generated: new Date().toISOString().slice(0, 10),
  serviceWidgets: widgetDocs(path.join(docs, 'widgets', 'services'), 'service'),
  infoWidgets: widgetDocs(path.join(docs, 'widgets', 'info'), 'info'),
  configs: Object.fromEntries(['settings', 'services', 'bookmarks', 'info-widgets', 'docker', 'custom-css-js']
    .map(p => [p, sections(`${p}.md`, p)])),
};
// Widget-type docs share a page (e.g. several *arr apps); keep one entry per type, sorted by title.
catalog.serviceWidgets.sort((a, b) => a.title.localeCompare(b.title));
fs.mkdirSync(new URL('../catalog/', import.meta.url), {recursive: true});
fs.writeFileSync(new URL('../catalog/catalog.json', import.meta.url), JSON.stringify(catalog));
console.log(`service widgets: ${catalog.serviceWidgets.length}, info widgets: ${catalog.infoWidgets.length}, ` +
  `settings sections: ${catalog.configs.settings.sections.length}`);
