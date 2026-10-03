import { onTypeFonts } from './backdrop-type.js';
import { SHAPE } from './geometry.js';
import { KNIFE, buildKnifeMesh } from './knife.js';
import { initialPiece, buildWorld, splitPiece, lineCrossesPiece, transferPieceMotion } from './pieces.js';
import { SoftBody } from './physics.js';
import { M4, Renderer } from './renderer.js';
import { hex, PALETTES, BG_RENDER } from './palettes.js';
import { drawOfflineBear, offlineHitTest } from './offline-preview.js';
import { buildSmoothSkin, skinSmooth } from './smooth-skin.js';
import { VIEWS, ZOOM, orbitCamera, wheelZoom, pinchZoom } from './camera-controls.js';
import { itemScale, makeStack, poseStack, buildSkewer, stackPreview, skewerRayDistance } from './stack.js';

// ─────────────────────────────────────────────────────────────
//  App: sim ↔ render glue, camera, picking, UI
// ─────────────────────────────────────────────────────────────

const $ = s => document.querySelector(s);

function setStatus(text, state) {
  const el = $('#status');
  $('#statusText').textContent = text;
  el.dataset.state = state;
}

function showFallback(title, detail) {
  const f = $('#fallback');
  f.hidden = false;
  $('#fallbackTitle').textContent = title;
  $('#fallbackDetail').textContent = detail;
  document.body.classList.add('no-gpu');
  setStatus('STILL PREVIEW', 'off');
  for (const el of document.querySelectorAll('[data-tool], #firmness, #damping, #nudge, #slow, #mesh, #pause')) el.disabled = true;
  $('#hintText').innerHTML = '<b>Still preview</b>Tap a candy to colour it. Drag to turn.';
}

async function main() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = $('#gl');

  // ── build everything once ──
  // Each piece has its own elastic body; at the start, the whole bear is one piece.
  const showcase = palette => [initialPiece('pear', [0, 0], palette)];
  let pieces = showcase('amber');
  let world = buildWorld(pieces);
  let sim = new SoftBody(world.sim, { firmness: 0.5, damping: reduced.matches ? 0.65 : 0.4 });
  const restCenter = sim.centroid();
  let renderMesh = world.render;
  let nV = renderMesh.rest.length / 3;
  let skinIdx = world.skinIdx, skinW = world.skinW;
  let index = renderMesh.index;
  let bodyTriEnd = renderMesh.body.count;
  let vComp = renderMesh.vComp;

  let currentPalette = 'amber', currentView = 'quarter';
  let offlineDraw = null, syncLiveView = null;
  let selectedCandy = pieces[0].candyId;
  let stacked=false, stackLayout=null, skewerMesh=null;
  const slots = [[0,0], [3.4,0], [-3.4,0], [0,3.4], [3.4,3.4], [-3.4,3.4], [0,-3.4], [3.4,-3.4], [-3.4,-3.4]];
  const NAMES = { bear: 'Barry', orange: 'Orange slice', watermelon: 'Watermelon slice', cucumber: 'Cucumber' };
  let replaceScene = next => {
    pieces = next; world = buildWorld(pieces); renderMesh = world.render;
    sim=new SoftBody(world.sim,{firmness:sim.firmness,damping:sim.damping});
    if(stacked) { stackLayout=makeStack(sim);poseStack(sim,stackLayout);skewerMesh=buildSkewer(stackLayout.height); }
    else { stackLayout=null;skewerMesh=null; }
    updateCollection(); offlineDraw?.();
  };
  // recolour keeps identity and motion: live view swaps meshes without refitting the camera
  let recolorScene = next => replaceScene(next);
  const NAMES_ALL = { ...NAMES, pear: 'Pear' };
  const candyOf = id => pieces.find(p => p.candyId === id);
  const candyCount = () => new Set(pieces.map(p => p.candyId)).size;
  const colourOf = p => p ? (p.type === 'bear' ? p.palette : p.tintPalette || null) : null;
  const menu = $('#candyMenu');
  let menuAt = null;
  function placeMenu(x, y) {
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight, pad = 10, W = innerWidth, H = innerHeight;
    let left = x + 18, top = y - h / 2;
    if (left + w > W - pad) left = x - w - 18;
    left = Math.max(pad, Math.min(W - w - pad, left));
    top = Math.max(pad + 46, Math.min(H - h - 90, top));
    menu.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  function openMenu(candyId, x, y) {
    if (candyId == null || !candyOf(candyId)) { closeMenu(); return; }
    selectedCandy = candyId; menuAt = [x, y];
    updateCollection();
    placeMenu(x, y);
  }
  function closeMenu() { menu.hidden = true; menuAt = null; }
  function selectCandy(candyId) { if (candyId != null && candyOf(candyId)) { selectedCandy = candyId; updateCollection(); } }
  function updateCollection() {
    const n = candyCount();
    if (!candyOf(selectedCandy)) { selectedCandy = pieces[0]?.candyId; if (!menu.hidden) closeMenu(); }
    $('#candyCount').textContent = `${n}/6 · ${pieces.length} pc`;
    $('#stack').textContent=stacked?'Unstack':'Stack';
    $('#stack').setAttribute('aria-pressed',String(stacked));
    $('#stack').title=stacked?'Remove the toothpick and return the candies to the table':'Stack the current candies on a wooden toothpick';
    const splitButton=$('[data-tool="knife"]');
    splitButton.disabled=stacked||document.body.classList.contains('no-gpu');
    splitButton.title=stacked?'Unstack before splitting a candy':'Split (K)';
    $('#removeCandy').disabled = n < 2;
    const sel = candyOf(selectedCandy);
    const selPieces = pieces.filter(p => p.candyId === selectedCandy).length;
    $('#duplicateCandy').disabled = !sel || n >= 6 || pieces.length + selPieces > 14;
    for (const b of document.querySelectorAll('[data-add]')) b.disabled = n >= 6 || pieces.length >= 14;
    $('#candyName').textContent = sel ? `${NAMES_ALL[sel.type] || sel.type}${selPieces > 1 ? ` · ${selPieces} pieces` : ''}` : 'Candy';
    const c = colourOf(sel);
    for (const b of document.querySelectorAll('.swatch')) b.setAttribute('aria-checked', String(b.dataset.key === c));
  }
  const pieceCentre = p => { let x = 0, z = 0; for (const q of p.I) { x += q[0]; z += q[1]; } return [x / p.I.length, z / p.I.length]; };
  const freeSlot = () => { const cs = pieces.map(pieceCentre); return slots.find(s => cs.every(c => Math.hypot(c[0] - s[0], c[1] - s[1]) > 2.4)); };
  for (const button of document.querySelectorAll('[data-add]')) button.addEventListener('click', () => {
    const slot = freeSlot();
    if (!slot || pieces.length >= 14 || candyCount() >= 6) { toast('Room for six candies at most.'); return; }
    const candy = initialPiece(button.dataset.add, slot, currentPalette);
    selectedCandy = candy.candyId; closeMenu();
    replaceScene([...pieces, candy]);
  });
  $('#removeCandy').addEventListener('click', () => {
    if (candyCount() > 1) { closeMenu(); replaceScene(pieces.filter(p => p.candyId !== selectedCandy)); }
  });
  // Duplicate keeps the cut pieces and colour, placed in the next free slot.
  $('#duplicateCandy').addEventListener('click', () => {
    const src = pieces.filter(p => p.candyId === selectedCandy);
    const slot = freeSlot();
    if (!src.length || !slot || candyCount() >= 6 || pieces.length + src.length > 14) { toast('No room for another copy.'); return; }
    const o = src[0].offset || [0, 0], dx = slot[0] - o[0], dz = slot[1] - o[1];
    const id = initialPiece(src[0].type, slot).candyId;
    const copies = src.map(p => ({ ...p, I: p.I.map(q => [q[0] + dx, q[1] + dz]), offset: slot.slice(), candyId: id, cache: null }));
    selectedCandy = id; closeMenu();
    replaceScene([...pieces, ...copies]);
  });
  $('#closeMenu').addEventListener('click', closeMenu);
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== canvas && e.target.id !== 'offlinePreview') closeMenu(); });
  $('#reset').addEventListener('click', () => {
    stacked=false;
    const next = showcase(currentPalette);
    selectedCandy = next[0].candyId; closeMenu();
    setView('quarter');
    replaceScene(next);
  });
  $('#stack').addEventListener('click', () => {
    stacked=!stacked;closeMenu();
    replaceScene(pieces,true);
    setView(stacked?'side':'quarter');
  });
  const swatches = $('#swatches');
  for (const [key, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.key = key;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name);
    b.title = p.name;
    b.innerHTML = `<span class="chip"><i style="background:${hex(p.skin)}"></i><i style="background:${hex(p.pale.map(c => c * 0.95))}"></i><i style="background:${hex(p.ui.flesh)}"></i></span><span class="swname">${p.name}</span>`;
    b.addEventListener('click', () => setPalette(key));
    swatches.appendChild(b);
  }
  // Colour applies to the selected candy only: bears use piece.palette, other candies piece.tintPalette.
  function setPalette(key) {
    const sel = candyOf(selectedCandy);
    if (!sel || !PALETTES[key]) return;
    if (sel.type === 'bear') currentPalette = key;
    if (colourOf(sel) === key) return;
    recolorScene(pieces.map(pc => pc.candyId !== selectedCandy ? pc
      : pc.type === 'bear' ? { ...pc, palette: key, cache: null } : { ...pc, tintPalette: key, cache: null }));
    offlineDraw?.();
  }
  updateCollection();
  // toolbar popovers (Feel, View): one open at a time, dismissed outside or with Escape
  const popBtns = [...document.querySelectorAll('[data-pop]')];
  function closePops(except) {
    for (const b of popBtns) if (b !== except) { b.setAttribute('aria-expanded', 'false'); $('#' + b.getAttribute('aria-controls')).hidden = true; }
  }
  for (const b of popBtns) b.addEventListener('click', () => {
    const pop = $('#' + b.getAttribute('aria-controls')), open = pop.hidden;
    closePops(b); pop.hidden = !open; b.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.pop-wrap')) closePops(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); closePops(); } });
  window.addEventListener('resize', () => { if (menuAt) placeMenu(menuAt[0], menuAt[1]); });
  function setView(name) {
    if (!VIEWS[name]) return;
    currentView = name;
    for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === name));
    syncLiveView?.(VIEWS[name]);
    offCam.az = VIEWS[name].az; offCam.el = VIEWS[name].el; offCam.zoom = 1;
    offlineDraw?.();
  }
  // Still-preview camera: same orbit/zoom helpers as the live view; zoom 1 = fit inside the clear area.
  const offCam = { az: VIEWS.quarter.az, el: VIEWS.quarter.el, zoom: 1 };
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));
  setView('quarter');
  const offCanvas = $('#offlinePreview');
  // insets that keep the candy clear of the heading, hint and specimen card
  function offlineSafe() {
    const c = offCanvas.getBoundingClientRect(), W = c.width, H = c.height, pad = 12;
    const safe = { left: pad, top: pad, right: pad, bottom: pad };
    for (const el of document.querySelectorAll('.masthead, .toolbar, .hint, .status, .fallback-notice')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).display === 'none') continue;
      const opts = [['left', r.right - c.left], ['right', c.right - r.left], ['top', r.bottom - c.top], ['bottom', c.bottom - r.top]]
        .filter(([side, v]) => v > 0 && v < ((side === 'left' || side === 'right') ? W : H) * 0.6);
      if (!opts.length) continue;
      const [side, v] = opts.reduce((a, b) => (b[1] < a[1] ? b : a));
      safe[side] = Math.max(safe[side], v + pad);
    }
    // never shrink the clear area below 40% of either axis
    for (const [a, b, L] of [['left', 'right', W], ['top', 'bottom', H]]) {
      const over = safe[a] + safe[b] - L * 0.6;
      if (over > 0) { const k = (L * 0.6) / (safe[a] + safe[b]); safe[a] *= k; safe[b] *= k; }
    }
    return safe;
  }
  let offlineFrame = 0;
  offlineDraw = () => {
    if (offlineFrame) return;
    offlineFrame = requestAnimationFrame(() => {
      offlineFrame = 0;
      if ($('#fallback').hidden) return;
      $('.fallback-notice').style.top=`${$('.masthead').getBoundingClientRect().bottom+10}px`;
      drawOfflineBear(offCanvas, stackPreview(renderMesh,stackLayout,skewerMesh), PALETTES[currentPalette], currentView, { ...offCam, safe: offlineSafe() });
    });
  };
  window.addEventListener('resize', () => offlineDraw());
  onTypeFonts(() => offlineDraw());
  {
    const pts = new Map(); let pinch = null;
    const clearPreset = () => { for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', 'false'); };
    offCanvas.style.touchAction = 'none';
    offCanvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button > 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { offCanvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: offCam.zoom }; }
      offCanvas.style.cursor = 'move';
      e.preventDefault();
    });
    offCanvas.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; pinchZoom(offCam, pinch.z0, pinch.d0, Math.hypot(a.x - b.x, a.y - b.y)); }
      else if (dx || dy) { orbitCamera(offCam, dx, dy); clearPreset(); }
      offlineDraw();
    });
    let tap = null;
    offCanvas.addEventListener('pointerdown', e => { tap = pts.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' } : null; });
    offCanvas.addEventListener('pointerup', e => {
      if (!tap || tap.id !== e.pointerId || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) { tap = null; return; }
      const r = offCanvas.getBoundingClientRect();
      const comp = offlineHitTest(offCanvas, e.clientX - r.left, e.clientY - r.top, tap.touch ? 14 : 5);
      tap = null;
      if (comp >= 0 && pieces[comp]) openMenu(pieces[comp].candyId, e.clientX, e.clientY); else closeMenu();
    });
    const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) offCanvas.style.cursor = ''; };
    offCanvas.addEventListener('pointerup', end);
    offCanvas.addEventListener('pointercancel', end);
    offCanvas.addEventListener('wheel', e => { e.preventDefault(); wheelZoom(offCam, e.deltaY, e.deltaMode); offlineDraw(); }, { passive: false });
    offCanvas.addEventListener('dblclick', () => setView('quarter'));
  }
  window.__gumlab = { get stacked() { return stacked; }, get stackHeight() { return stackLayout?.height||0; }, get pieces() { return pieces.length; }, get collection() { return pieces.map(p => ({ id: p.candyId, type: p.type, palette: p.palette, tintPalette:p.tintPalette, scale:itemScale(p), offset: p.offset })); } };

  let renderer;
  try {
    if (!navigator.gpu) throw new Error('no-webgpu');
    renderer = await Renderer.create(canvas, renderMesh, sim.edges, sim.n);
  } catch (err) {
    console.warn(err);
    const msg = String(err && err.message || err);
    if (msg === 'no-webgpu') showFallback('Still preview.', 'No WebGPU here, so nothing is simulated. Stretch and slice need a WebGPU browser.');
    else if (msg === 'no-adapter') showFallback('Still preview.', 'No GPU adapter, so nothing is simulated. Enable hardware acceleration to stretch and slice.');
    else showFallback('Still preview.', 'Renderer failed: ' + msg.slice(0, 140));
    offlineDraw();
    return;
  }
  // a lost device (driver reset, GPU switch) gets two attempts at a clean rebuild before giving up
  let recoveries = 0;
  const wire = r => {
    r.onError = e => console.error('[webgpu]', e.message);
    r.onLost = async info => {
      if (info.reason === 'destroyed') return;
      if (recoveries++ < 2) {
        try {
          const fresh = await Renderer.create(canvas, renderMesh, sim.edges, sim.n);
          fresh.dyn = dyn; fresh.setKnife(knifeMesh); fresh.setSkewer(skewerMesh); renderer = fresh; wire(fresh); resize();
          requestAnimationFrame(frame);
          return;
        } catch (e) { console.warn(e); }
      }
      showFallback('The GPU device was lost.', (info.message || '') + ' Reload the page to restart the study.');
      offlineDraw();
    };
  };
  wire(renderer);
  let dyn = renderer.dyn;
  let smoothSkin = buildSmoothSkin(sim, renderMesh, skinIdx, skinW);

  // ── state ──
  const state = {
    paused: false, slow: false, showMesh: false, tool: 'hand',
    az: VIEWS.quarter.az, el: VIEWS.quarter.el, zoom: ZOOM.initial,
    time: 0,
  };
  syncLiveView = view => { state.az = view.az; state.el = view.el; state.zoom = stacked?1:ZOOM.initial; };


  // ── skinning: body and raised details follow the elastic tetrahedra ──
  function skin() {
    skinSmooth(smoothSkin, sim.rest, sim.x, renderMesh.rest, dyn);
    for (let t = 0; t < index.length; t += 3) {
      const a = 6 * index[t], b = 6 * index[t + 1], c = 6 * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      dyn[a + 3] += nx; dyn[a + 4] += ny; dyn[a + 5] += nz;
      dyn[b + 3] += nx; dyn[b + 4] += ny; dyn[b + 5] += nz;
      dyn[c + 3] += nx; dyn[c + 4] += ny; dyn[c + 5] += nz;
    }
    for (let o = 0; o < dyn.length; o += 6) {
      const l = Math.hypot(dyn[o + 3], dyn[o + 4], dyn[o + 5]) || 1;
      dyn[o + 3] /= l; dyn[o + 4] /= l; dyn[o + 5] /= l;
    }
  }

  // ── camera & framing ──
  const cam = { viewProj: null, view: null, invViewProj: null, pos: [0, 0, 0], fwd: [0, 0, -1] };
  const target = [restCenter[0], SHAPE.T * 0.45, restCenter[2]];
  const FOV = 27 * Math.PI / 180;
  function safeRect() {
    const cr = canvas.getBoundingClientRect();
    const margin = Math.min(cr.width, cr.height) * 0.075;
    return { x: margin, y: margin, w: cr.width - margin * 2, h: cr.height - margin * 2 };
  }
  // Framing is measured only on deliberate scene changes (start, add, remove, reset);
  // stretching, throwing and cutting never move the camera under the user's hand.
  let fitRadius = 1.48;
  function fitScene() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < sim.x.length; i += 3) { x0 = Math.min(x0, sim.x[i]); x1 = Math.max(x1, sim.x[i]); z0 = Math.min(z0, sim.x[i + 2]); z1 = Math.max(z1, sim.x[i + 2]); }
    target[0] = (x0 + x1) / 2; target[2] = (z0 + z1) / 2;
    target[1]=stacked&&stackLayout?stackLayout.height*.5:SHAPE.T*.45;
    fitRadius = 1.48;
    for (let i = 0; i < sim.x.length; i += 3) fitRadius = Math.max(fitRadius,
      Math.hypot(sim.x[i] - target[0], sim.x[i + 1] - target[1], sim.x[i + 2] - target[2]) + 0.15);
    if(stacked&&stackLayout) fitRadius=Math.max(fitRadius,stackLayout.height*.5+.15);
  }
  fitScene();
  function updateCamera() {
    const W = renderer.w, H = renderer.h;
    const cr = canvas.getBoundingClientRect();
    const r = safeRect();
    const aspect = W / H;
    const hf = r.h / cr.height, wf = r.w / cr.width;
    // Fit the gummy's full silhouette inside the stage, regardless of where controls sit.
    const Rh = fitRadius, Rv = fitRadius;
    const t2 = Math.tan(FOV / 2);
    const dist = Math.max(Rv / (t2 * 0.9 * hf), Rh / (t2 * 0.92 * aspect * wf)) * state.zoom;
    const ce = Math.cos(state.el);
    const eye = [target[0] + dist * Math.sin(state.az) * ce, target[1] + dist * Math.sin(state.el), target[2] + dist * Math.cos(state.az) * ce];
    const view = M4.lookAt(eye, target, [0, 1, 0]);
    const proj = M4.perspective(FOV, aspect, 0.02, 80);
    // lens shift so the target lands at the centre of the safe rect
    const cx = (r.x + r.w / 2) / cr.width, cy = (r.y + r.h / 2) / cr.height;
    proj[8] -= (cx * 2 - 1); proj[9] -= -(cy * 2 - 1);
    cam.view = view; cam.viewProj = M4.mul(proj, view); cam.invViewProj = M4.invert(cam.viewProj);
    cam.pos = eye;
    const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(...f); cam.fwd = f.map(v => v / fl);
  }

  // light rig: key from behind-left and above (so thin edges glow toward the camera)
  const keyDir = (() => { const d = [-0.45, 0.86, -0.36]; const l = Math.hypot(...d); return d.map(v => v / l); })();
  const light = { dir: keyDir, intensity: 2.3, lightVP: null, topVP: null };
  function updateLight() {
    // Shadow and height maps follow the candy when it is dragged.
    const c = sim.centroid();
    const at = [c[0], stacked?stackLayout.height*.5:0.3, c[2]];
    let span = stacked?Math.max(2.6,stackLayout.height*.65):2.6;
    for (let i = 0; i < sim.x.length; i += 3) span = Math.max(span, Math.hypot(sim.x[i] - c[0], sim.x[i + 2] - c[2]) + 0.6);
    light.lightVP = M4.mul(M4.ortho(-span, span, -span, span, 0.1, 30), M4.lookAt([at[0] + keyDir[0] * 15, at[1] + keyDir[1] * 15, at[2] + keyDir[2] * 15], at, [0, 0, 1]));
    // top-down height map: camera under the floor looking up so the lowest surface wins; depth = (y + 1) / 5
    light.topVP = M4.mul(M4.ortho(-span, span, -span, span, 0, 5), M4.lookAt([at[0], -1, at[2]], [at[0], 1, at[2]], [0, 0, -1]));
  }

  // ── resize ──
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(r.width * dpr, r.height * dpr);
  }
  const compactLayout = matchMedia('(max-width: 860px), (max-height: 560px) and (max-width: 1000px)');
  const applyLayout = () => { document.body.classList.toggle('stacked', compactLayout.matches); resize(); };
  compactLayout.addEventListener('change', applyLayout);
  applyLayout();
  new ResizeObserver(resize).observe(canvas);

  // ── picking ──
  function rayFrom(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const m = cam.invViewProj;
    const un = (x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const a = un(nx, ny, 0), b = un(nx, ny, 1);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...d);
    return { o: a, d: d.map(v => v / l) };
  }
  let lastPickTri = -1, lastNearParticle = -1, lastPickOnRod=false;
  // screen point -> candyId of the visible body under it (triangle pick, then forgiving particle pick)
  function candyAt(clientX, clientY, touch) {
    lastPickTri = -1; lastNearParticle = -1;
    if (pick(rayFrom(clientX, clientY)) && lastPickTri >= 0) return pieces[vComp[index[lastPickTri]]]?.candyId ?? null;
    if (pickNear(clientX, clientY, touch ? 34 : 18) && lastNearParticle >= 0) return pieces[sim.comp[lastNearParticle]]?.candyId ?? null;
    return null;
  }
  function pick(ray) {
    lastPickOnRod=false;
    let best = Infinity;
    const { o, d } = ray;
    for (let t = 0; t < bodyTriEnd; t += 3) {
      const a = 6 * index[t], b = 6 * index[t + 1], c = 6 * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = o[0] - dyn[a], ty = o[1] - dyn[a + 1], tz = o[2] - dyn[a + 2];
      const uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-4 && tt < best) { best = tt; lastPickTri = t; }
    }
    if(skewerRayDistance(ray,skewerMesh)<best) {lastPickOnRod=true;return null;}
    return best < Infinity ? [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best] : null;
  }

  // forgiving fallback for grabs that land just outside the rounded silhouette
  function pickNear(clientX, clientY, maxPx) {
    if(lastPickOnRod) return null;
    const r = canvas.getBoundingClientRect(), M = cam.viewProj, x = sim.x;
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < sim.n; i++) {
      const X = x[3 * i], Y = x[3 * i + 1], Z = x[3 * i + 2];
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      const sx = r.left + ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w * 0.5 + 0.5) * r.width;
      const sy = r.top + (0.5 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w * 0.5) * r.height;
      const d = (sx - clientX) ** 2 + (sy - clientY) ** 2 - w * 1e-3; // prefer nearer particles on ties
      if (d < bd) { bd = d; best = i; }
    }
    lastNearParticle = best;
    return best < 0 ? null : [x[3 * best], x[3 * best + 1], x[3 * best + 2]];
  }

  // ── knife ──
  const knife = { ax: 0, ay: 0, bx: 0, by: 0 };
  const strokeSvg = $('#stroke'), strokeLine = $('#strokeLine');
  let strokeFade = 0;
  function drawStroke(on) {
    const r = canvas.getBoundingClientRect();
    strokeLine.setAttribute('x1', knife.ax - r.left); strokeLine.setAttribute('y1', knife.ay - r.top);
    strokeLine.setAttribute('x2', knife.bx - r.left); strokeLine.setAttribute('y2', knife.by - r.top);
    clearTimeout(strokeFade);
    strokeSvg.classList.toggle('on', on);
    if (!on) strokeSvg.classList.add('fading'), strokeFade = setTimeout(() => strokeSvg.classList.remove('fading'), 420);
    else strokeSvg.classList.remove('fading');
  }
  const toastEl = $('#toast');
  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2200);
  }
  const MAX_PIECES = 14;

  // Cut: a stroke over the bear defines a vertical blade plane. Its intersection
  // with each soft piece is carried back into that piece's rest frame.
  // Planning happens on release (so the heavy rebuild is done before the knife moves); the new
  // world is swapped in mid-stroke, at the moment the edge breaks through.
  const rayPlaneY = (ray, y) => {
    if (ray.d[1] > -1e-4) return null;
    const t = (y - ray.o[1]) / ray.d[1];
    return t > 0 ? [ray.o[0] + ray.d[0] * t, y, ray.o[2] + ray.d[2] * t] : null;
  };
  const camRightYaw = () => -state.az;          // blade direction that shows its face to the camera
  const canonicalYaw = (dx, dz) => {
    let yaw = Math.atan2(dz, dx);
    if (Math.cos(yaw - camRightYaw()) < 0) yaw += Math.PI;   // keep the handle on the left, tip on the right
    return yaw;
  };
  function planCut(ax, ay, bx, by) {
    if(stacked) return {miss:'Unstack before splitting a candy.'};
    if (Math.hypot(bx - ax, by - ay) < 24) return { miss: '' };
    const hit = new Set(); let yTop = 0, t0 = -1, t1 = -1;
    for (let k = 0; k <= 48; k++) {
      const t = k / 48;
      const p = pick(rayFrom(ax + (bx - ax) * t, ay + (by - ay) * t));
      if (p && lastPickTri >= 0) { hit.add(vComp[index[lastPickTri]]); yTop = Math.max(yTop, p[1]); if (t0 < 0) t0 = t; t1 = t; }
    }
    if (!hit.size) return { miss: 'Missed — draw across the gummy bear.' };
    if (pieces.length >= MAX_PIECES) return { miss: 'That’s plenty of candy pieces. Reset to make another bear.' };
    // the stroke as seen on the surface it was drawn over
    const at = t => rayPlaneY(rayFrom(ax + (bx - ax) * t, ay + (by - ay) * t), yTop);
    const A = at(0) || at(t0), B = at(1) || at(t1);
    const A2 = at(t0), B2 = at(t1);
    if (!A || !B || !A2 || !B2) return { miss: 'Missed — draw across the gummy bear.' };
    let dx = B[0] - A[0], dz = B[2] - A[2];
    const dl = Math.hypot(dx, dz); if (dl < 0.05) return { miss: '' };
    dx /= dl; dz /= dl;
    const n = [-dz, 0, dx];
    const o = [(A2[0] + B2[0]) / 2, yTop, (A2[2] + B2[2]) / 2];
    const next = [], sep = [];
    let thin = 0, cut = 0;
    pieces.forEach((pc, c) => {
      if (!hit.has(c)) { next.push(pc); return; }
      const F = sim.pieceFrame(c), R = F.R;
      // world plane n·x = n·o  →  rest plane nr·X = nr·pr
      const nr = [R[0] * n[0] + R[3] * n[1] + R[6] * n[2], R[1] * n[0] + R[4] * n[1] + R[7] * n[2], R[2] * n[0] + R[5] * n[1] + R[8] * n[2]];
      const d = [o[0] - F.cw[0], o[1] - F.cw[1], o[2] - F.cw[2]];
      const pr = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2] + F.cr[0], R[1] * d[0] + R[4] * d[1] + R[7] * d[2] + F.cr[1], R[2] * d[0] + R[5] * d[1] + R[8] * d[2] + F.cr[2]];
      // I and dye coordinates are canonical; the fitted rest frame is sized.
      const scale=itemScale(pc),[ox,oz]=pc.offset||[0,0];
      pr[0]=ox+(pr[0]-ox)/scale;pr[1]/=scale;pr[2]=oz+(pr[2]-oz)/scale;
      const L = Math.hypot(nr[0], nr[2]);
      if (L < 0.3) { next.push(pc); thin++; return; }   // piece lying on its side: the blade runs along its faces
      const cc = (nr[0] * pr[0] + nr[1] * pr[1] + nr[2] * pr[2] - nr[1] * SHAPE.T / 2) / L;
      const a = nr[0] / L, b = nr[2] / L;
      if (!lineCrossesPiece(pc.I, a, b, cc)) { next.push(pc); return; }
      const parts = splitPiece(pc.I, a, b, cc);
      if (!parts) { next.push(pc); thin++; return; }
      cut++;
      parts.forEach((I, side) => {
        // which way does this half lie in the world? it is nudged away from the blade on that side
        let su = 0, sw = 0; for (const p of I) { su += p[0]; sw += p[1]; } su /= I.length; sw /= I.length;
        const X = [ox+(su-ox)*scale - F.cr[0], SHAPE.T*scale / 2 - F.cr[1], oz+(sw-oz)*scale - F.cr[2]];
        const W = [R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + F.cw[0], R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + F.cw[1], R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + F.cw[2]];
        const sg = Math.sign(n[0] * (W[0] - o[0]) + n[2] * (W[2] - o[2])) || (side ? 1 : -1);
        sep.push({ piece: next.length, dir: [n[0] * sg, 0, n[2] * sg] });
        next.push({ ...pc, I, cache: null });
      });
    });
    if (!cut) return { miss: thin ? 'Too narrow to cut there.' : 'Missed — draw across the gummy bear.' };
    if (next.length > MAX_PIECES) return { miss: 'That’s plenty of candy pieces. Reset to make another bear.' };
    // do the expensive part now, while the knife is still in the air
    const w = buildWorld(next);
    const ns = new SoftBody(w.sim, { firmness: sim.firmness, damping: sim.damping });
    return { next, sep, world: w, sim: ns, M: o, yTop, yaw: canonicalYaw(dx, dz) };
  }
  // instant cut without the knife animation (kept for automated checks)
  function performCut(ax, ay, bx, by) {
    const plan = planCut(ax, ay, bx, by);
    if (plan.miss !== undefined) { if (plan.miss) toast(plan.miss); return false; }
    installWorld(plan.next, plan.sep, plan, 0.75, 0.35);
    return true;
  }

  // Rebuild the simulation and the GPU buffers for a new set of pieces, carrying the current
  // positions and velocities across by interpolation in the shared rest frame.
  function installWorld(nextPieces, sep = [], pre = null, sepSpeed = 0.75, hop = 0.35, refit = false, resetPose = false) {
    if (drag.mode === 'grab') { sim.endGrab(); drag.mode = null; }
    const old = sim;
    const w = pre ? pre.world : buildWorld(nextPieces);
    const ns = pre ? pre.sim : new SoftBody(w.sim, { firmness: old.firmness, damping: old.damping });
    ns.firmness = old.firmness; ns.damping = old.damping;
    if (old) {
      transferPieceMotion(old, ns, pieces, nextPieces);
      for (const sp of sep) for (let i = 0; i < ns.n; i++) if (ns.comp[i] === sp.piece) {
        ns.v[3 * i] += sp.dir[0] * sepSpeed; ns.v[3 * i + 1] += Math.abs(sp.dir[1]) * 0.2 * hop + hop; ns.v[3 * i + 2] += sp.dir[2] * sepSpeed;
      }
      ns.prev.set(ns.x);
    }
    pieces = nextPieces; world = w; sim = ns;
    if(stacked) {
      stackLayout=makeStack(sim);skewerMesh=buildSkewer(stackLayout.height);
      if(refit) poseStack(sim,stackLayout); else sim.skewer=stackLayout;
      state.tool='hand';
    } else {
      stackLayout=null;skewerMesh=null;sim.skewer=null;
      if(resetPose) { sim.x.set(sim.rest);sim.prev.set(sim.x);sim.v.fill(0); }
    }
    renderer.setSkewer(skewerMesh);
    sim.blade = blade;
    blade.side = new Int8Array(sim.nComp);
    for (const sp of sep) blade.side[sp.piece] = Math.sign(sp.dir[0] * blade.n[0] + sp.dir[2] * blade.n[2]) || 0;
    renderMesh = w.render; nV = renderMesh.rest.length / 3;
    skinIdx = w.skinIdx; skinW = w.skinW; index = renderMesh.index; bodyTriEnd = renderMesh.body.count; vComp = renderMesh.vComp;
    smoothSkin = buildSmoothSkin(sim, renderMesh, skinIdx, skinW);
    renderer.setMesh(renderMesh, sim.edges, sim.n);
    dyn = renderer.dyn;
    window.__gumlab.sim = sim;
    if (refit) fitScene();
    updateCollection();
    hoverDirty = true;
  }

  // ── the visible knife: hovers under the pointer, lines up over the stroke, then cuts ──
  const knifeMesh = buildKnifeMesh();
  renderer.setKnife(knifeMesh);
  const HOVER_H = 0.42;                           // edge height above the gummy while hovering
  const kp = { P: [0, SHAPE.T + HOVER_H + 1.4, 0.9], yaw: -0.62, roll: 0.16, pitch: 0.05 };
  const blade = { holdY: 0, mode: null, p: [0, 0, 0], d: [1, 0, 0], n: [0, 0, 1], a0: -KNIFE.xr, a1: KNIFE.Lb - KNIFE.xr, top: KNIFE.H * 0.95, halfGap: 0.03, side: null };
  sim.blade = blade;
  let knifeAnim = null, hoverSeen = false;
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const lerp = (a, b, s) => a + (b - a) * s;
  const lerp3 = (a, b, s) => [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s)];
  const ease = s => { s = Math.min(1, Math.max(0, s)); return s * s * (3 - 2 * s); };
  function knifeBasis(yaw, roll, pitch) {
    const d = [Math.cos(yaw), 0, Math.sin(yaw)], z = [-d[2], 0, d[0]];
    // roll about the blade (tips the face up toward the viewer), then pitch (tip down)
    const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const Y1 = [-sr * z[0], cr, -sr * z[2]], Z = [cr * z[0], sr, cr * z[2]];
    const X = [cp * d[0] - sp * Y1[0], cp * d[1] - sp * Y1[1], cp * d[2] - sp * Y1[2]];
    const Y = [sp * d[0] + cp * Y1[0], sp * d[1] + cp * Y1[1], sp * d[2] + cp * Y1[2]];
    return [X, Y, Z];
  }
  function poseKnife() {
    const [X, Y, Z] = knifeBasis(kp.yaw, kp.roll, kp.pitch);
    const out = renderer.knifeDyn, r = knifeMesh.rest, nr = knifeMesh.nrm, P = kp.P, xr = KNIFE.xr;
    for (let v = 0, o = 0; v < r.length; v += 3, o += 6) {
      const lx = r[v] - xr, ly = r[v + 1], lz = r[v + 2];
      out[o] = P[0] + X[0] * lx + Y[0] * ly + Z[0] * lz;
      out[o + 1] = P[1] + X[1] * lx + Y[1] * ly + Z[1] * lz;
      out[o + 2] = P[2] + X[2] * lx + Y[2] * ly + Z[2] * lz;
      const nx = nr[v], ny = nr[v + 1], nz = nr[v + 2];
      out[o + 3] = X[0] * nx + Y[0] * ny + Z[0] * nz;
      out[o + 4] = X[1] * nx + Y[1] * ny + Z[1] * nz;
      out[o + 5] = X[2] * nx + Y[2] * ny + Z[2] * nz;
    }
  }
  // where the knife wants to be when it is not cutting
  function hoverPose() {
    let q = hoverSeen ? rayPlaneY(rayFrom(hoverX, hoverY), SHAPE.T + HOVER_H) : null;
    if (q) { const dx = q[0] - target[0], dz = q[2] - target[2], dl = Math.hypot(dx, dz); if (dl > 3) { q[0] = target[0] + dx / dl * 3; q[2] = target[2] + dz / dl * 3; } }
    if (!q) { const c = sim.centroid(); q = [c[0] + 0.1, SHAPE.T + HOVER_H, c[2] + 0.25]; }
    return { P: q, yaw: camRightYaw(), roll: 0.16, pitch: 0.05 };
  }
  // while the stroke is being drawn: lined up over it, edge just above the jelly
  function strokePose() {
    const h = SHAPE.T + 0.1;
    const A = rayPlaneY(rayFrom(knife.ax, knife.ay), h), B = rayPlaneY(rayFrom(knife.bx, knife.by), h);
    if (!A || !B) return hoverPose();
    const dl = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const yaw = dl > 0.08 ? canonicalYaw(B[0] - A[0], B[2] - A[2]) : kp.yaw;
    return { P: [(A[0] + B[0]) / 2, h, (A[2] + B[2]) / 2], yaw, roll: 0.08, pitch: 0 };
  }
  function easeToward(pose, k) {
    kp.P = lerp3(kp.P, pose.P, k);
    kp.yaw += wrapA(pose.yaw - kp.yaw) * k;
    kp.roll = lerp(kp.roll, pose.roll, k); kp.pitch = lerp(kp.pitch, pose.pitch, k);
  }
  // the cut, as a little piece of choreography (seconds)
  const KT = { align: 0.16, press: 0.42, through: 0.6, hold: 0.7, lift: 1.08 };
  function startCut(plan) {
    knifeAnim = { t: 0, plan, from: { P: kp.P.slice(), yaw: kp.yaw, roll: kp.roll, pitch: kp.pitch }, committed: false };
  }
  function runKnifeAnim(dt) {
    const a = knifeAnim, pl = a.plan;
    a.t += dt;
    const t = a.t, d = [Math.cos(pl.yaw), 0, Math.sin(pl.yaw)], M = pl.M;
    const at = (s, y) => [M[0] + d[0] * s, y, M[2] + d[2] * s];
    const P1 = at(-0.12, pl.yTop + 0.1), P2 = at(0.0, pl.yTop - 0.13), P3 = at(0.2, 0.004);
    if (t < KT.align) {
      const s = ease(t / KT.align);
      kp.P = lerp3(a.from.P, P1, s);
      kp.yaw = a.from.yaw + wrapA(pl.yaw - a.from.yaw) * s;
      kp.roll = lerp(a.from.roll, 0, s); kp.pitch = lerp(a.from.pitch, 0, s);
      blade.mode = null;
    } else if (t < KT.press) {
      // the edge meets the jelly and pushes it down before it gives
      const s = (t - KT.align) / (KT.press - KT.align);
      kp.P = lerp3(P1, P2, s * s); kp.yaw = pl.yaw; kp.roll = 0; kp.pitch = 0;
      blade.mode = 'press';
    } else if (t < KT.hold) {
      if (!a.committed) {
        a.committed = true;
        blade.n = [-d[2], 0, d[0]];
        blade.holdY = kp.P[1];
        const tc = performance.now();
        installWorld(pl.next, pl.sep, pl, 0.22, 0);
        window.__gumlab.lastCommitMs = performance.now() - tc;
      }
      const s = 1 - Math.pow(1 - Math.min(1, (t - KT.press) / (KT.through - KT.press)), 2);
      kp.P = lerp3(P2, P3, s);
      blade.halfGap = 0.012 + 0.02 * s;
      blade.mode = 'split';
    } else if (t < KT.lift) {
      blade.mode = null;
      const s = ease((t - KT.hold) / (KT.lift - KT.hold));
      const h = state.tool === 'knife' ? hoverPose() : { P: [P3[0], P3[1] + 2.5, P3[2]], yaw: pl.yaw, roll: 0.3, pitch: 0.05 };
      kp.P = lerp3(P3, h.P, s);
      kp.yaw = pl.yaw + wrapA(h.yaw - pl.yaw) * s;
      kp.roll = lerp(0, h.roll, s); kp.pitch = lerp(0, h.pitch, s);
    } else {
      knifeAnim = null; blade.mode = null;
    }
  }
  function updateKnife(dt, animDt) {
    // Split tool: the cut happens instantly on release; no physical knife is shown or simulated.
    if (!knifeAnim) { renderer.knifeVisible = false; blade.mode = null; return; }
    if (state.tool !== 'knife' && !knifeAnim) { renderer.knifeVisible = false; blade.mode = null; return; }
    if (knifeAnim) runKnifeAnim(animDt);
    else easeToward(drag.mode === 'knife' ? strokePose() : hoverPose(), 1 - Math.exp(-dt * 16));
    blade.p = kp.P; blade.d = [Math.cos(kp.yaw), 0, Math.sin(kp.yaw)];
    if (!knifeAnim || !knifeAnim.committed) blade.n = [-blade.d[2], 0, blade.d[0]];
    poseKnife();
    renderer.knifeVisible = true;
  }

  // ── pointer interaction ──
  const drag = { mode: null, id: -1, plane: null, twist: 0, twist0: 0, second: null, pinch: null, lastX: 0, lastY: 0 };
  function rotMat(axis, ang) {
    const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }
  function dragTarget(clientX, clientY) {
    const ray = rayFrom(clientX, clientY);
    const { p, n } = drag.plane;
    const den = ray.d[0] * n[0] + ray.d[1] * n[1] + ray.d[2] * n[2];
    if (Math.abs(den) < 1e-5) return null;
    const t = ((p[0] - ray.o[0]) * n[0] + (p[1] - ray.o[1]) * n[1] + (p[2] - ray.o[2]) * n[2]) / den;
    const q = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    // keep the grab within a generous but finite reach, and above the floor
    const dx = q[0] - target[0], dz = q[2] - target[2], lim = 3.4, dl = Math.hypot(dx, dz);
    if (dl > lim) { q[0] = target[0] + dx / dl * lim; q[2] = target[2] + dz / dl * lim; }
    q[1] = Math.min(Math.max(q[1], 0.02), stacked?stackLayout.height+1:3.2);
    return q;
  }
  function applyGrab(x, y) {
    const q = dragTarget(x, y);
    if (q) sim.moveGrab(q, rotMat(cam.fwd, drag.twist));
  }
  canvas.addEventListener('pointerdown', e => {
    if (drag.mode === 'orbit' && e.pointerId !== drag.id && e.pointerType === 'touch' && !drag.pinch) {
      drag.pinch = { id: e.pointerId, x: e.clientX, y: e.clientY, d0: Math.hypot(e.clientX - drag.lastX, e.clientY - drag.lastY), z0: state.zoom };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      return;
    }
    if (drag.mode === 'grab' && e.pointerId !== drag.id && e.pointerType === 'touch') {
      // second finger twists the grabbed patch
      drag.second = { id: e.pointerId, x: e.clientX, y: e.clientY };
      drag.twist0 = drag.twist - Math.atan2(e.clientY - drag.lastY, e.clientX - drag.lastX);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      return;
    }
    if (drag.mode) return;
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
    if (state.tool === 'knife') {
      if (state.paused || knifeAnim) { e.preventDefault(); return; }
      drag.mode = 'knife'; drag.id = e.pointerId;
      if (e.pointerType !== 'mouse') { hoverX = e.clientX; hoverY = e.clientY; hoverSeen = true; }
      knife.ax = knife.bx = e.clientX; knife.ay = knife.by = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      drawStroke(true);
      e.preventDefault();
      return;
    }
    const touchPick = e.pointerType === 'touch';
    lastPickTri = -1; lastNearParticle = -1;
    const hit = pick(rayFrom(e.clientX, e.clientY)) || pickNear(e.clientX, e.clientY, touchPick ? 34 : 18);
    const hitCandy = hit ? (lastPickTri >= 0 ? pieces[vComp[index[lastPickTri]]]?.candyId : pieces[sim.comp[lastNearParticle]]?.candyId) : null;
    drag.tap = { x: e.clientX, y: e.clientY, candy: hitCandy ?? null };
    if (hitCandy != null) selectCandy(hitCandy);
    drag.id = e.pointerId; drag.lastX = e.clientX; drag.lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    if (hit && !state.paused) {
      drag.mode = 'grab'; drag.twist = 0;
      drag.plane = { p: hit, n: cam.fwd.slice() };
      sim.beginGrab(hit, 0.4);
      canvas.dataset.cursor = 'grabbing';
    } else {
      drag.mode = 'orbit';
      canvas.dataset.cursor = 'orbit';
    }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (drag.pinch && (e.pointerId === drag.pinch.id || e.pointerId === drag.id)) {
      if (e.pointerId === drag.pinch.id) { drag.pinch.x = e.clientX; drag.pinch.y = e.clientY; }
      else { drag.lastX = e.clientX; drag.lastY = e.clientY; }
      pinchZoom(state, drag.pinch.z0, drag.pinch.d0, Math.hypot(drag.pinch.x - drag.lastX, drag.pinch.y - drag.lastY));
      return;
    }
    if (drag.second && e.pointerId === drag.second.id) {
      drag.second.x = e.clientX; drag.second.y = e.clientY;
      drag.twist = drag.twist0 + Math.atan2(drag.second.y - drag.lastY, drag.second.x - drag.lastX);
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist));
      applyGrab(drag.lastX, drag.lastY);
      return;
    }
    if (e.pointerId !== drag.id || !drag.mode) { hoverX = e.clientX; hoverY = e.clientY; hoverDirty = true; hoverSeen = true; return; }
    if (drag.mode === 'knife') { knife.bx = e.clientX; knife.by = e.clientY; drawStroke(true); return; }
    const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    if (drag.mode === 'grab') applyGrab(e.clientX, e.clientY);
    else {
      orbitCamera(state, dx, dy);
      if (dx || dy) for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', 'false');
    }
  });
  const endPointer = e => {
    if (drag.second && e.pointerId === drag.second.id) { drag.second = null; return; }
    if (drag.pinch && e.pointerId === drag.pinch.id) { drag.pinch = null; return; }
    if (e.pointerId !== drag.id) return;
    if (drag.pinch) {
      // the lead finger lifted: the remaining finger keeps orbiting from where it is
      drag.id = drag.pinch.id; drag.lastX = drag.pinch.x; drag.lastY = drag.pinch.y; drag.pinch = null; return;
    }
    if (drag.mode === 'knife') {
      if (e.type === 'pointerup') {
        knife.bx = e.clientX; knife.by = e.clientY; drawStroke(true);
        const before = pieces;
        if (performCut(knife.ax, knife.ay, knife.bx, knife.by)) {
          // each new piece keeps its candy identity; keep the selection on the cut candy
          if (!candyOf(selectedCandy)) selectedCandy = pieces[0]?.candyId;
          if (before !== pieces) updateCollection();
        }
        hoverX = e.clientX; hoverY = e.clientY;
      }
      drawStroke(false);
    }
    if (drag.mode === 'grab') sim.endGrab();
    if ((drag.mode === 'grab' || drag.mode === 'orbit') && e.type === 'pointerup' && drag.tap && Math.hypot(e.clientX - drag.tap.x, e.clientY - drag.tap.y) < 6) {
      if (drag.tap.candy != null) openMenu(drag.tap.candy, e.clientX, e.clientY); else closeMenu();
    }
    drag.tap = null;
    drag.mode = null; drag.id = -1; drag.second = null; drag.pinch = null;
    canvas.dataset.cursor = state.tool === 'knife' ? 'knife' : '';
    hoverDirty = true;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  // wheel: twists the held patch (wherever the pointer is), otherwise zooms when over the stage
  window.addEventListener('wheel', e => {
    if (drag.mode === 'grab') {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist + d * 0.004));
      applyGrab(drag.lastX, drag.lastY);
    } else if (e.target === canvas) {
      e.preventDefault();
      wheelZoom(state, e.deltaY, e.deltaMode);
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', () => setView('quarter'));
  let hoverX = 0, hoverY = 0, hoverDirty = false;

  // ── UI ──
  replaceScene = (next, resetPose=false) => {
    knifeAnim = null; blade.mode = null;
    installWorld(next, [], null, 0.75, 0.35, true, resetPose);
    if(stacked) setTool('hand');
  };
  recolorScene = next => { knifeAnim = null; blade.mode = null; installWorld(next, [], null, 0, 0, false); };
  // specimen controls
  const firm = $('#firmness'), damp = $('#damping');
  const syncSliders = () => {
    sim.firmness = firm.value / 100; sim.damping = damp.value / 100;
    $('#firmnessOut').textContent = (firm.value / 100).toFixed(2);
    $('#dampingOut').textContent = (damp.value / 100).toFixed(2);
  };
  firm.value = Math.round(sim.firmness * 100); damp.value = Math.round(sim.damping * 100); syncSliders();
  firm.addEventListener('input', syncSliders); damp.addEventListener('input', syncSliders);
  $('#nudge').addEventListener('click', () => { if (!state.paused) sim.nudge(reduced.matches ? 0.45 : 1); });
  $('#slow').addEventListener('change', e => { state.slow = e.target.checked; });
  $('#mesh').addEventListener('change', e => { state.showMesh = e.target.checked; });
  const pauseBtn = $('#pause');
  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    if (state.paused && drag.mode === 'grab') { sim.endGrab(); drag.mode = null; }
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(state.paused));
    setStatus(state.paused ? 'PAUSED' : 'LIVE', state.paused ? 'paused' : 'live');
  });
  // Tools: stretch the bear or draw a cut through it.
  const hint = $('#hintText');
  function setTool(t) {
    if(stacked&&t==='knife') { toast('Unstack before splitting a candy.');return; }
    state.tool = t;
    for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    document.body.dataset.tool = t;
    canvas.dataset.cursor = t === 'knife' ? 'knife' : '';
    hint.innerHTML = t === 'knife'
      ? '<b>Split</b>Draw a line across a candy.'
      : '<b>Hand</b>Pull a candy. Tap one to colour it.';
  }
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  setTool('hand');
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, button, summary')) return;
    if (e.key === 'r' || e.key === 'R') $('#reset').click();
    if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); }
    if (e.key === 'n' || e.key === 'N') $('#nudge').click();
    if (e.key === 'k' || e.key === 'K') setTool(state.tool === 'knife' ? 'hand' : 'knife');
    if (e.key === 'h' || e.key === 'H') setTool('hand');
  });

  // expose a small hook for automated checks
  window.__gumlab = { sim, state, cam, pick, rayFrom, renderer, performCut, planCut, startCut, kp, blade, get stacked() {return stacked;}, get stackHeight() {return stackLayout?.height||0;}, get knifeAnim() { return knifeAnim; }, setHover(x, y) { hoverX = x; hoverY = y; hoverSeen = true; },
    advance(sec) { for (let t = 0; t < sec - 1e-6; t += 1 / 60) { updateKnife(1 / 60, 1 / 60); sim.step(); } },
    compStats() { const c = sim.nComp, out = []; for (let k = 0; k < c; k++) { let n = 0, x = 0, y = 0, z = 0, v = 0; for (let i = 0; i < sim.n; i++) if (sim.comp[i] === k) { n++; x += sim.x[3 * i]; y += sim.x[3 * i + 1]; z += sim.x[3 * i + 2]; v = Math.max(v, Math.hypot(sim.v[3 * i], sim.v[3 * i + 1], sim.v[3 * i + 2])); } out.push([x / n, y / n, z / n, v].map(q => +q.toFixed(3))); } return out; }, get pieces() { return pieces.length; }, get fps() { return fps; } };

  // ── loop ──
  sim.reset(reduced.matches ? 0 : 0.35);
  let last = performance.now(), fpsStart = last, acc = 0, fps = 60, frames = 0, fpsT = 0, first = true;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!state.paused) {
      acc += dt * (state.slow ? 0.25 : 1);
      let steps = 0;
      while (acc >= sim.stepDt && steps < 3) { sim.step(); acc -= sim.stepDt; steps++; }
      if (steps === 3) acc = Math.min(acc, sim.stepDt);
      state.time += dt;
    }
    // the knife may swap in a new world mid-cut, so it goes before skinning
    updateKnife(dt, state.paused ? 0 : dt * (state.slow ? 0.25 : 1));
    skin();
    updateCamera();
    updateLight();
    if (hoverDirty && !drag.mode) {
      hoverDirty = false;
      canvas.dataset.cursor = state.tool === 'knife' ? 'knife' : !state.paused && (pick(rayFrom(hoverX, hoverY)) || pickNear(hoverX, hoverY, 18)) ? 'grab' : '';
    }
    renderer.setUniforms(cam, light, PALETTES[currentPalette], {
      time: state.time, shape: [SHAPE.T, SHAPE.Ro, SHAPE.skin, SHAPE.pale],
      exposure: 1.0, meshAlpha: state.showMesh ? 0.32 : 0, bg: BG_RENDER,
    });
    renderer.uploadGeometry(sim.x, state.showMesh);
    renderer.draw(state.showMesh);
    if (first) { first = false; setStatus('LIVE', 'live'); document.body.classList.add('ready'); }
    frames++; fpsT += dt;
    if (fpsT > 0.5) { fps = frames / ((now - fpsStart) / 1000); frames = 0; fpsT = 0; fpsStart = now; }
    if (!renderer.lost) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(err => { console.error(err); showFallback('Something went wrong while starting.', String(err && err.message || err)); });
