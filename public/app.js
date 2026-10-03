// Entry point: tabs, preview panel, startup.
import {api, toast, confirmBox} from './lib.js';
import {store, loadFile, openSaveDialog} from './store.js';
import {renderGroupsView} from './services.js';
import {renderImprove} from './improve.js';
import {renderAppearance} from './appearance.js';
import {renderInfoWidgets, renderSettings, renderFiles, renderBackups} from './views.js';

const view = document.getElementById('view');
const views = {
  improve: () => renderImprove(view),
  appearance: () => renderAppearance(view),
  services: () => renderGroupsView(view, 'services'),
  bookmarks: () => renderGroupsView(view, 'bookmarks'),
  widgets: () => renderInfoWidgets(view),
  settings: () => renderSettings(view),
  files: () => renderFiles(view),
  backups: () => renderBackups(view),
};

async function show(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  try { localStorage.setItem('tab', name); } catch {}
  try {
    await views[name]();
  } catch (e) {
    view.textContent = `Couldn't load: ${e.message}`;
    toast(e.message, true);
  }
}

document.getElementById('save-all').addEventListener('click', openSaveDialog);

document.getElementById('tabs').addEventListener('click', e => {
  if (e.target.dataset.view) show(e.target.dataset.view);
});

const preview = document.getElementById('preview');
const frame = document.getElementById('preview-frame');
const toggle = document.getElementById('preview-toggle');
// Load the preview explicitly (an empty iframe's .src differs between browsers, so don't rely on it),
// and say what's happening in the panel instead of leaving it blank.
const previewStatus = document.getElementById('preview-status');
let previewTimer;
function loadPreview() {
  previewStatus.hidden = false;
  previewStatus.textContent = `Loading ${store.info.homepageUrl} …`;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewStatus.textContent = `Homepage hasn't finished loading here after 15 s. Use "Open ↗" to view it in its own tab, and tell Claude what this panel shows.`;
  }, 15000);
  frame.src = `${store.info.homepageUrl}/?editor-preview=${Date.now()}`;
}
frame.addEventListener('load', () => {
  if (!frame.getAttribute('src')) return;
  clearTimeout(previewTimer);
  previewStatus.hidden = true;
});
function setPreview(on) {
  preview.hidden = !on;
  toggle.textContent = on ? 'Preview ◂' : 'Preview ▸';
  if (on && !frame.getAttribute('src')) loadPreview();
  try { localStorage.setItem('preview', on ? '1' : ''); } catch {}
}
toggle.addEventListener('click', () => setPreview(preview.hidden));
document.getElementById('preview-reload').addEventListener('click', loadPreview);

(async () => {
  [store.info, store.catalog] = await Promise.all([api('/api/info'), api('/api/catalog')]);
  document.getElementById('hp-version').textContent = `for Homepage ${store.catalog.homepageVersion}`;
  document.getElementById('preview-open').href = store.info.homepageUrl;
  await loadFile('docker.yaml').catch(() => {});
  const restart = document.getElementById('restart-homepage');
  restart.hidden = !store.info.canRestart;
  restart.addEventListener('click', async () => {
    if (!await confirmBox('Restart Homepage', 'Homepage only picks up newly added icons and background images after a restart. It takes about 10 seconds.', 'Restart')) return;
    restart.disabled = true; restart.textContent = 'Restarting…';
    try {
      await api('/api/restart-homepage', {json: {}});
      toast('Homepage restarted');
      setTimeout(() => { if (frame.getAttribute('src')) loadPreview(); }, 4000);
    } catch (e) { toast(e.message, true); }
    restart.disabled = false; restart.textContent = 'Restart Homepage';
  });
  let tab = 'improve', prev = '';
  try { tab = localStorage.getItem('tab') || tab; prev = localStorage.getItem('preview'); } catch {}
  if (prev) setPreview(true);
  show(views[tab] ? tab : 'improve');
})();
