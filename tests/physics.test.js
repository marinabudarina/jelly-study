// Headless sanity checks for camera controls, geometry, cutting and XPBD solver (no GPU needed).
// Run: npm test
import assert from 'node:assert/strict';
import { SHAPE, tetVolume } from '../src/geometry.js';
import { initialPiece, buildWorld, splitPiece, pointInPoly, polyArea, depthAt, transferPieceMotion, pieceSamples } from '../src/pieces.js';
import { candyColor } from '../src/candy-material.js';
import { drawOfflineBear } from '../src/offline-preview.js';
import { PALETTES } from '../src/palettes.js';
import { SoftBody } from '../src/physics.js';
import { VIEWS, orbitCamera } from '../src/camera-controls.js';

const t0 = performance.now();
for (const [name, view] of Object.entries(VIEWS)) {
  const camera = { ...view };
  orbitCamera(camera, 0, 0);
  assert.deepEqual(camera, view, `${name} must not jump on the first pointer move`);
}
const frontOrbit = { ...VIEWS.front };
orbitCamera(frontOrbit, 25, 15);
assert.ok(Math.abs(frontOrbit.az - (VIEWS.front.az - 0.15)) < 1e-10, 'front must move smoothly from the preset');
assert.ok(Math.abs(frontOrbit.el - (VIEWS.front.el + 0.075)) < 1e-10, 'front must not snap down to the old elevation limit');
const quarterOrbit = { ...VIEWS.quarter };
orbitCamera(quarterOrbit, 600, 0);
assert.ok(quarterOrbit.az < 0, 'turning one way must pass the former horizontal stop');
orbitCamera(quarterOrbit, -1300, 0);
assert.ok(quarterOrbit.az > Math.PI * 2, 'turning back must pass front and complete a full turn');
const sideOrbit = { ...VIEWS.side };
orbitCamera(sideOrbit, -100, 0);
assert.ok(sideOrbit.az > VIEWS.side.az, 'side view must orbit in the other direction too');
orbitCamera(sideOrbit, 0, -1000);
assert.ok(sideOrbit.el < 0, 'the camera can orbit below the bear');
orbitCamera(sideOrbit, 0, 2000);
assert.ok(sideOrbit.el < Math.PI / 2, 'the camera stays clear of the upper pole');

const whole = initialPiece();
const outline = whole.I;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const [x, z] of outline) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
assert.ok(outline.length > 100, 'bear outline should be a smooth sampled contour');
assert.ok(minX < -0.75 && maxX > 0.75 && minZ < -1.0 && maxZ > 1.15, 'bear outline bounds should include ears, arms and feet');
assert.ok(minZ > -1.10, 'paws should remain compact rather than stretching into long oval legs');
assert.ok(pointInPoly(outline, 0, 0.75), 'head should be filled');
assert.ok(pointInPoly(outline, 0.55, 0), 'arm/shoulder should be filled');
assert.ok(pointInPoly(outline, -0.3, -0.85) && pointInPoly(outline, 0.3, -0.85), 'both legs should be present');
assert.ok(!pointInPoly(outline, 0, -0.95), 'the two lower legs should have a concave gap');
assert.ok(polyArea(outline) > 1, 'bear contour should have positive area');
const depths = {
  head: depthAt(0, 0.66),
  headShoulder: depthAt(0.34, 0.43),
  torso: depthAt(0, -0.055),
  arm: depthAt(-0.565, 0.005),
  leg: depthAt(0.33, -0.755),
  outline: depthAt(-0.33, 1.31),
};
assert.ok(depths.head > depths.headShoulder + 0.08, 'head should round into the shoulders');
assert.ok(depthAt(-0.625, -0.105) > depthAt(-0.625, -0.105, false) + 0.07, 'hands should project forward from the surface');
assert.ok(depthAt(0.345, -0.86) > depthAt(0.345, -0.86, false) + 0.07, 'feet should project forward from the surface');
assert.ok(depths.leg > depths.outline + 0.08, 'feet should round down to a thin but nonzero perimeter');
assert.ok(depths.outline >= 0.05 && depths.outline < 0.09, 'outline should retain a small rounded edge thickness');
assert.ok(SHAPE.T > depths.head + depthAt(0, 0.66, false) - 0.02 && SHAPE.T < 0.91, 'T should bound front and back without inflating the body');
assert.ok(depthAt(0, 0.65) > depthAt(0.29, 0.65) + 0.08, 'muzzle must rise smoothly from the cheeks');
assert.ok(depthAt(0, 0.722) > depthAt(0, 0.722, false) + 0.08, 'nose must be molded into the muzzle');
assert.ok(depthAt(0, 0.735) > depthAt(0.125, 0.735) + 0.075, 'nose should have a legible rounded crest');
assert.ok(depthAt(-0.19, 0.862) > depthAt(-0.26, 0.862) + 0.05, 'molded eyes must stand above their sockets');
assert.ok(depthAt(0, 0.49) < depthAt(0, 0.457) - 0.01, 'smile must be recessed above a raised lower lip');
assert.ok(depthAt(-0.1, 0.503) < depthAt(-0.1, 0.465) - 0.015, 'smile groove should follow its curve through the cheeks');
assert.ok(depthAt(-0.39, 1.128) < depthAt(-0.49, 1.128), 'ears should have inset centers');
assert.ok(depthAt(0, 0.49, false) > depthAt(0, 0.49), 'facial grooves should not appear on the back');
const world = buildWorld([whole]);
const sim = new SoftBody(world.sim, { firmness: 0.4, damping: 0.45 });
console.log(`mesh: ${sim.n} particles, ${sim.nT} tets, ${sim.nE} edges, ${world.render.rest.length / 3} render verts (${(performance.now() - t0).toFixed(0)} ms)`);
assert.ok(sim.n > 100 && sim.nT > 100, 'sim mesh too small');
let smallestRestTet = Infinity;
for (let t = 0; t < sim.nT; t++) {
  assert.ok(sim.restVol[t] > 0, `tet ${t} has non-positive rest volume`);
  smallestRestTet = Math.min(smallestRestTet, sim.restVol[t]);
}
assert.ok(smallestRestTet > 1e-6, 'rest mesh contains near-degenerate tetrahedra');
assert.equal(world.render.seeds.count, 0, 'face and paws must not be detached props');
assert.ok(world.render.mat.every(m => m === world.render.mat[0]), 'entire gummy bear must share one material');
assert.ok(world.render.rest.length / 3 > sim.n * 2, 'render surface should resolve molded features without increasing sim count');
for (const v of world.render.rest) assert.ok(Number.isFinite(v), 'render mesh contains a non-finite coordinate');
let renderMinY = Infinity, renderMaxY = -Infinity;
for (let i = 1; i < world.render.rest.length; i += 3) {
  renderMinY = Math.min(renderMinY, world.render.rest[i]);
  renderMaxY = Math.max(renderMaxY, world.render.rest[i]);
}
assert.ok(renderMaxY - renderMinY > 0.65, 'render body should have substantial 3D depth');
const perimeter = pieceSamples(whole.I, 0.026);
for (let k = 0; k < perimeter.length; k++) {
  const s = perimeter[k], v = 3 * (8 * perimeter.length + k);
  const outward = (world.render.rest[v] - s.q[0]) * s.n[0] + (world.render.rest[v + 2] - s.q[1]) * s.n[1];
  assert.ok(outward > 0 && outward < 0.02, 'sidewall must round outward without a wide translucent skirt');
}

// drop from 0.35 and settle for 4 s
sim.reset(0.35);
for (let i = 0; i < 240; i++) sim.step();
const vol = sim.volumeRatio(), minY = sim.minY(), ke = sim.kineticEnergy();
console.log(`after 4 s: volume ${(vol * 100).toFixed(2)} %, minY ${minY.toFixed(4)}, KE ${ke.toExponential(2)}`);
assert.ok(Math.abs(vol - 1) < 0.03, 'volume drifted more than 3 %');
assert.ok(minY > -0.02, 'slice sank through the floor');
assert.ok(ke < 1e-2, 'slice did not settle');

// grab a corner, pull it up, release
const hit = [sim.x[0], sim.x[1], sim.x[2]];
sim.beginGrab(hit, 0.4);
assert.ok(sim.grabN > 0, 'grab should attach to a finite patch of the volumetric body');
const grabStart = Float32Array.from(sim.x), grabbed = sim.grabIdx[0];
for (let i = 0; i < 60; i++) { sim.moveGrab([hit[0], hit[1] + 1.2 * (i / 60), hit[2]]); sim.step(); }
assert.ok(Math.hypot(sim.x[3 * grabbed] - grabStart[3 * grabbed], sim.x[3 * grabbed + 1] - grabStart[3 * grabbed + 1], sim.x[3 * grabbed + 2] - grabStart[3 * grabbed + 2]) > 0.25, 'grab should produce a visible stretch');
sim.endGrab();
for (let i = 0; i < 240; i++) sim.step();
assert.ok(Math.abs(sim.volumeRatio() - 1) < 0.03, 'volume lost after a stretch');
assert.ok(sim.minVolumeRatio() > 0, 'inverted tetrahedra left after a stretch');

// cut the slice down the middle (rest-plane line u = 0) and simulate the two pieces
const parts = splitPiece(whole.I, 1, 0, 0);
assert.ok(parts, 'split failed');
assert.equal(parts.length, 2, 'vertical torso cut should make two connected pieces');
assert.ok(parts.every(I => Math.abs(polyArea(I)) > 0.01), 'body cut should produce valid polygons');
const w2 = buildWorld(parts.map(I => ({ I, cache: null })));
const s2 = new SoftBody(w2.sim, { firmness: 0.4, damping: 0.45 });
assert.equal(s2.nComp, 2);
for (let c = 0; c < s2.nComp; c++) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s2.n; i++) if (s2.comp[i] === c) { lo = Math.min(lo, s2.rest[3 * i + 1]); hi = Math.max(hi, s2.rest[3 * i + 1]); }
  assert.ok(hi - lo > 0.45, `body-cut component ${c} should retain a 3D profile`);
}
for (const x of [-0.19, 0.19]) {
  const component = x < 0 ? 0 : 1;
  const face = SHAPE.T * 0.5 + depthAt(x, 0.862);
  let closest = Infinity;
  for (let v = 0; v < w2.render.rest.length / 3; v++) if (w2.render.vComp[v] === component) {
    const rx = w2.render.rest[3 * v], ry = w2.render.rest[3 * v + 1], rz = w2.render.rest[3 * v + 2];
    closest = Math.min(closest, Math.hypot(rx - x, rz - 0.862, (ry - face) * 0.3));
  }
  assert.ok(closest < 0.03, `cut fragment ${component} must retain its sculpted eye profile`);
}
for (let t = 0; t < s2.nT; t++) assert.ok(s2.restVol[t] > 1e-6, `body-cut tet ${t} should have meaningful volume`);
s2.reset(0.2);
for (let i = 0; i < 180; i++) s2.step();
console.log(`two pieces: volume ${(s2.volumeRatio() * 100).toFixed(2)} %, T = ${SHAPE.T}`);
assert.ok(Math.abs(s2.volumeRatio() - 1) < 0.03);

// A cross-cut below the torso intersects both legs but not the gap between them.
const legParts = splitPiece(whole.I, 0, 1, -0.70);
assert.ok(legParts && legParts.length >= 3, 'lower-leg cut should preserve disconnected leg components');
assert.ok(legParts.every(I => I.length >= 3 && Math.abs(polyArea(I)) > 0.004), 'lower-leg cut should return valid component polygons');
const lowerWorld = buildWorld(legParts.map(I => ({ I, cache: null })));
for (let t = 0; t < lowerWorld.sim.tets.length; t += 4) {
  const ids = lowerWorld.sim.tets;
  assert.ok(tetVolume(lowerWorld.sim.rest, ids[t], ids[t + 1], ids[t + 2], ids[t + 3]) > 1e-6, `cut tet ${t / 4} has microscopic or invalid volume`);
}
// A collection is separate deformable volumes, not copies of a flat image.
const melon = initialPiece('watermelon', [3.4, 0]);
const orange = initialPiece('orange', [-3.4, 0]);
const collection = [whole, melon, orange];
const mixed = buildWorld(collection);
assert.equal(mixed.sim.nComp, 3);
assert.deepEqual([...new Set(mixed.render.mat)].sort((a,b) => a-b), [2, 10, 11, 20, 21, 22, 104]);
const mixedSim = new SoftBody(mixed.sim);
const original = new SoftBody(world.sim);
for (let i = 0; i < original.n; i++) {
  original.x[3*i] += 0.24;
  original.v[3*i] = 0.3;
}
transferPieceMotion(original, mixedSim, [whole], collection);
for (let i = 0; i < mixedSim.n; i++) {
  const isOld = mixedSim.comp[i] === 0;
  assert.ok(Math.abs(mixedSim.x[3*i] - mixedSim.rest[3*i] - (isOld ? 0.24 : 0)) < 1e-5, 'adding must retain existing motion without moving new candy');
  assert.ok(Math.abs(mixedSim.v[3*i] - (isOld ? 0.3 : 0)) < 1e-5);
}
for (const pc of [melon, orange]) {
  const fragments = splitPiece(pc.I, 1, 0, pc.offset[0]);
  assert.ok(fragments?.length >= 2, 'fruit must be sliceable');
  const cutFruit = buildWorld(fragments.map(I => ({ ...pc, I, cache: null })));
  assert.ok(cutFruit.render.mat.every(m => pc.type === 'orange' ? [20,21,22].includes(m) : m === 10 || m === 11 || m === 2));
  for (let t = 0; t < cutFruit.sim.tets.length; t += 4)
    assert.ok(tetVolume(cutFruit.sim.rest, ...cutFruit.sim.tets.slice(t,t+4)) > 0);
}
// A closed sidewall must meet its cap twice on every undirected mesh edge.
const edges = new Map();
for (let t = 0; t < mixed.render.body.count; t += 3) for (let j = 0; j < 3; j++) {
  const a = mixed.render.index[t+j], b = mixed.render.index[t+(j+1)%3];
  const key = a < b ? `${a},${b}` : `${b},${a}`;
  edges.set(key, (edges.get(key) || 0) + 1);
}
assert.ok([...edges.values()].every(n => n === 2), 'sidewalls must be watertight without loose flaps');
const rindColor = candyColor(10, 3.4, -0.98, []);
assert.ok(rindColor[1] > rindColor[0]*2 && rindColor[1] > rindColor[2]*2, 'original striped dark-green rind');
assert.deepEqual(candyColor(104, 0, 0, []), PALETTES.amber.flesh);
let image;
const context = { createImageData: (w,h) => ({data:new Uint8ClampedArray(w*h*4)}), putImageData: im => { image=im; } };
const canvas = { width:0, height:0, getContext:() => context, getBoundingClientRect:() => ({width:500,height:260}) };
drawOfflineBear(canvas, mixed.render, PALETTES.amber, 'front');
let red=0, green=0, gold=0;
for (let i=0;i<image.data.length;i+=4) {
  const [r,g,b] = image.data.slice(i,i+3);
  if (r>g*1.7 && r>b*1.5) red++;
  if (g>r*1.25 && g>b*1.2) green++;
  if (r>g*1.1 && g>b*1.4) gold++;
}
assert.ok(red>40 && green>20 && gold>100, 'CPU collection must display fruit colors alongside the bear');
console.log('all checks passed');
