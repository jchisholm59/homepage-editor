// Merge a plain JS value into an existing YAML Document, reusing the existing nodes wherever the
// value is unchanged or matches, so comments (including commented-out blocks), quoting style and
// ordering of everything the user didn't touch survive a structured edit.
import YAML, {isMap, isSeq, isScalar, isPair} from 'yaml';

export function syncDocument(doc, value) {
  doc.contents = syncNode(doc, doc.contents, value);
}

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Homepage lists are mostly single-key maps: groups, services, bookmarks, info widgets.
function identity(v) {
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    return keys.length === 1 ? `k:${keys[0]}` : null;
  }
  return null;
}

function nodeIdentity(node) {
  if (isMap(node) && node.items.length === 1) return `k:${keyOf(node.items[0])}`;
  return null;
}

const keyOf = pair => (isScalar(pair.key) ? pair.key.value : pair.key);

function syncNode(doc, node, value) {
  if (Array.isArray(value)) return isSeq(node) ? syncSeq(doc, node, value) : doc.createNode(value);
  if (isPlainObject(value)) return isMap(node) ? syncMap(doc, node, value) : doc.createNode(value);
  // Scalars: keep the node (and its comment / quoting) when the value is the same or only changed.
  if (isScalar(node)) {
    if (node.value !== value) {
      node.value = value;
      // A changed value can't keep a quoting style that no longer applies (e.g. block literal).
      if (typeof value !== 'string') node.type = undefined;
    }
    return node;
  }
  return value === null && node == null ? node : doc.createNode(value);
}

function syncMap(doc, node, value) {
  const byKey = new Map(node.items.map(p => [String(keyOf(p)), p]));
  const used = new Set();
  const items = [];
  const wanted = Object.entries(value);
  for (const [k, v] of wanted) {
    let pair = byKey.get(k);
    if (pair) {
      pair.value = syncNode(doc, pair.value, v);
    } else {
      // A renamed key: reuse an unused pair at the same position so its comments stay with it.
      const idx = items.length;
      const candidate = node.items[idx];
      if (candidate && !used.has(candidate) && !(String(keyOf(candidate)) in value)) {
        pair = candidate;
        if (isScalar(pair.key)) pair.key.value = k; else pair.key = doc.createNode(k);
        pair.value = syncNode(doc, pair.value, v);
      } else {
        pair = doc.createPair(k, v);
      }
    }
    used.add(pair);
    items.push(pair);
  }
  carryComments(node.items, used, items);
  node.items = items;
  return node;
}

function syncSeq(doc, node, value) {
  const used = new Set();
  const items = value.map((v, i) => {
    const id = identity(v);
    let match = id && node.items.find(n => !used.has(n) && nodeIdentity(n) === id);
    // Fall back to position when nothing matches by name (renamed item, or plain list values).
    if (!match) {
      const n = node.items[i];
      const nId = n && nodeIdentity(n);
      const nameTaken = nId && value.some(x => identity(x) === nId);
      if (n && !used.has(n) && !nameTaken && sameKind(n, v)) match = n;
    }
    if (match) {
      used.add(match);
      return syncNode(doc, match, v);
    }
    const created = doc.createNode(v);
    used.add(created);
    return created;
  });
  carryComments(node.items, used, items);
  node.items = items;
  return node;
}

function sameKind(node, v) {
  if (Array.isArray(v)) return isSeq(node);
  if (isPlainObject(v)) return isMap(node);
  return isScalar(node);
}

// When an item is deleted, keep the comments that sat above it (often a commented-out block)
// by moving them onto whichever item now follows it, or onto the end of the list.
function carryComments(oldItems, used, newItems) {
  oldItems.forEach((old, i) => {
    if (used.has(old)) return;
    const holder = isPair(old) ? old.key : old;
    const before = holder?.commentBefore;
    if (!before) return;
    const next = oldItems.slice(i + 1).find(n => used.has(n));
    const target = next ? (isPair(next) ? next.key : next) : null;
    if (target && typeof target === 'object') {
      target.commentBefore = target.commentBefore ? `${before}\n${target.commentBefore}` : before;
    } else if (newItems.length) {
      const last = newItems[newItems.length - 1];
      const lastHolder = isPair(last) ? last.value ?? last.key : last;
      if (lastHolder && typeof lastHolder === 'object') lastHolder.comment = lastHolder.comment ? `${lastHolder.comment}\n${before}` : before;
    }
  });
}

export {YAML};
