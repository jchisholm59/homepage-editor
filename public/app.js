// Entry point: tabs, preview panel, startup.
import {api, toast, confirmBox} from './lib.js';
import {store, loadFile} from './store.js';
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

document.getElementById('tabs').addEventListener('click', e => {
  if (e.target.dataset.view) show(e.target.dataset.view);
});

const preview = document.getElementById('preview');
const frame = document.getElementById('preview-frame');
const toggle = document.getElementById('preview-toggle');
function setPreview(on) {
  preview.hidden = !on;
  toggle.textContent = on ? 'Preview ◂' : 'Preview ▸';
  if (on && !frame.src) frame.src = store.info.homepageUrl;
  try { localStorage.setItem('preview', on ? '1' : ''); } catch {}
}
toggle.addEventListener('click', () => setPreview(preview.hidden));
document.getElementById('preview-reload').addEventListener('click', () => { frame.src = store.info.homepageUrl; });

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
      setTimeout(() => { if (frame.src) frame.src = store.info.homepageUrl; }, 4000);
    } catch (e) { toast(e.message, true); }
    restart.disabled = false; restart.textContent = 'Restart Homepage';
  });
  let tab = 'improve', prev = '';
  try { tab = localStorage.getItem('tab') || tab; prev = localStorage.getItem('preview'); } catch {}
  if (prev) setPreview(true);
  show(views[tab] ? tab : 'improve');
})();
