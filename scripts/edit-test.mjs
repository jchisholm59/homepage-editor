// Apply typical editor operations to a copy of services.yaml and show content-only diffs.
import fs from 'node:fs';
import YAML from 'yaml';
import {structuredPatch} from 'diff';
import {syncDocument} from '../lib/sync.js';

const text = fs.readFileSync(`${process.argv[2]}/services.yaml`, 'utf8');
const base = (() => { const d = YAML.parseDocument(text); syncDocument(d, d.toJS()); return d.toString({lineWidth: 0}); })();
const redact = l => l.replace(/(key|password|apiKey|token)(\s*:\s*).*/i, '$1$2<redacted>');

function run(label, mutate) {
  const doc = YAML.parseDocument(text);
  const data = doc.toJS();
  mutate(data);
  syncDocument(doc, data);
  const out = doc.toString({lineWidth: 0});
  const ok = JSON.stringify(YAML.parse(out)) === JSON.stringify(data);
  const lines = structuredPatch('a', 'b', base, out, '', '', {context: 0}).hunks.flatMap(h => h.lines);
  console.log(`== ${label}: ${ok ? 'data OK' : 'DATA MISMATCH'}, ${lines.length} changed lines`);
  console.log(lines.slice(0, 10).map(l => '   ' + redact(l)).join('\n'));
}
const svc = (d, g, s) => d[g][Object.keys(d[g])[0]][s];
const group = (d, g) => d[g][Object.keys(d[g])[0]];

run('change a description', d => { const s = svc(d, 0, 0); s[Object.keys(s)[0]].description = 'Updated description'; });
run('move last group to the top', d => d.unshift(d.pop()));
run('rename a service', d => { const g = group(d, 0); const [k] = Object.keys(g[1]); g[1] = {'Renamed Service': g[1][k]}; });
run('delete a service', d => group(d, 0).splice(2, 1));
run('add a widget', d => { const s = svc(d, 0, 1); s[Object.keys(s)[0]].widget = {type: 'frigate', url: 'http://192.168.1.50:5000'}; });
