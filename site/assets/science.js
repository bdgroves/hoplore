// Spin-it-in-3D for the Science page. 3Dmol.js (about 500 KB) loads only
// when someone asks for a molecule; the shapes come from molecules.json,
// written by tools/molecules.py.
const LIB = 'https://cdn.jsdelivr.net/npm/3dmol@2.5.5/build/3Dmol-min.js';
const dialog = document.getElementById('mol-dialog');
const view = document.getElementById('mol-view');
let lib = null;
let shapes = null;
let viewer = null;

const load = () =>
  (lib ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = ok;
    s.onerror = () => fail(new Error('the 3D viewer did not load'));
    document.head.append(s);
  }));

async function show(name, title) {
  document.getElementById('mol-title').textContent = title;
  dialog.showModal();
  view.textContent = 'Loading…';
  try {
    await load();
    shapes ??= await (await fetch('../assets/molecules/molecules.json')).json();
    view.textContent = '';
    viewer?.clear();
    const dark = document.documentElement.dataset.theme === 'dark';
    viewer = window.$3Dmol.createViewer(view, { backgroundColor: dark ? '#1c1a16' : '#fdfaf4' });
    viewer.addModel(shapes[name], 'sdf');
    viewer.setStyle({}, { stick: { radius: 0.14 }, sphere: { scale: 0.26 } });
    viewer.zoomTo();
    viewer.spin('y', 0.6);
    viewer.render();
  } catch (e) {
    view.textContent = `Couldn't show it: ${e.message}.`;
  }
}

for (const b of document.querySelectorAll('.mol-3d')) {
  b.addEventListener('click', () => show(b.dataset.mol, b.closest('figure').querySelector('b').textContent));
}
document.getElementById('mol-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => viewer?.spin(false));
