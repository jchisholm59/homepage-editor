import fs from 'node:fs';
import YAML from 'yaml';
import {syncDocument} from '../lib/sync.js';
import {createTwoFilesPatch} from 'diff';
const D = process.argv[2];
for (const f of fs.readdirSync(D).filter(f => /\.yaml$/.test(f))) {
  const text = fs.readFileSync(`${D}/${f}`, 'utf8');
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) { console.log(f, 'PARSE ERRORS', doc.errors.map(e => e.message)); continue; }
  const plain = doc.toString({lineWidth: 0});
  syncDocument(doc, doc.toJS());
  const out = doc.toString({lineWidth: 0});
  const d = createTwoFilesPatch('orig', 'out', text, out, '', '', {context: 0});
  const changes = d.split('\n').filter(l => /^[-+][^-+]/.test(l));
  console.log(f.padEnd(22), out === text ? 'IDENTICAL' : `${changes.length} changed lines`, plain === out ? '' : '(sync differs from plain re-serialize!)');
  if (out !== text) console.log(changes.slice(0, 12).map(l => '   ' + l.replace(/(key|password|apiKey|token)(\s*:\s*).*/i, '$1$2<redacted>')).join('\n'));
}
