import assert from 'node:assert/strict';
import { SoftBody } from '../src/physics.js';
import { initialPiece, buildPieceSim, buildWorld, splitPiece } from '../src/pieces.js';

const bear = initialPiece();
const mesh = buildPieceSim(bear.I);
const sim = new SoftBody(mesh);
assert.equal(sim.firmness, 0.5);
assert.equal(sim.damping, 0.4);
assert.ok(Math.abs(sim.shapeCompliance() - Math.sqrt(3 * 0.05)) < 1e-12,
  'retain the original shear stiffness, not the rejected 3x watery compliance');
sim.reset(0.35);
for (let i = 0; i < 300; i++) sim.step();
const restingStrain = sim.meanStrain();
assert.ok(restingStrain < 0.03, 'resting candy must retain its mold, not sag into a pancake');
assert.ok(Math.abs(sim.volumeRatio() - 1) < 0.03);
assert.ok(sim.minY() >= -1e-6 && sim.minVolumeRatio() > 0);

// Isolate elastic propagation/ringdown from floor impacts and whole-body flight.
// Edge-relative longitudinal velocity excludes rigid translation and rotation.
function vibration(s) {
  let energy = 0;
  for (let e = 0; e < s.nE; e++) {
    const a = s.edges[2 * e] * 3, b = s.edges[2 * e + 1] * 3;
    const d = [s.x[b] - s.x[a], s.x[b + 1] - s.x[a + 1], s.x[b + 2] - s.x[a + 2]];
    const speed = d.reduce((sum, v, k) => sum + v * (s.v[b + k] - s.v[a + k]), 0) / Math.hypot(...d);
    energy += speed * speed;
  }
  return energy / s.nE;
}
const wave = new SoftBody(mesh);
wave.gravity = 0; wave.floorY = -10;
let tip = 0;
for (let i = 1; i < wave.n; i++) if (wave.rest[3 * i + 2] > wave.rest[3 * tip + 2]) tip = i;
const hit = Array.from(wave.x.slice(3 * tip, 3 * tip + 3));
const far = [];
for (let i = 0; i < wave.n; i++) if (wave.rest[3 * i + 2] < -0.5) far.push(i);
const farDisplacement = () => far.reduce((sum, i) => sum + Math.abs(wave.x[3 * i] - wave.rest[3 * i]), 0) / far.length;
wave.beginGrab(hit, 0.3);
wave.moveGrab([hit[0] + 0.35, hit[1] + 0.15, hit[2]]);
wave.step();
const nearFirst = Math.abs(wave.x[3 * tip] - wave.rest[3 * tip]), farFirst = farDisplacement();
for (let i = 0; i < 17; i++) wave.step();
const farLater = farDisplacement();
assert.ok(nearFirst > 0.02 && farFirst < nearFirst * 0.25, 'pinch must act locally first, not move the whole candy as a rigid prop');
assert.ok(farLater > Math.max(0.005, farFirst * 3), 'the far end should follow with measurable delay');
wave.endGrab();
const vibrationTrace = [], strainTrace = [];
for (let i = 0; i < 240; i++) {
  wave.step();
  vibrationTrace.push(vibration(wave)); strainTrace.push(wave.meanStrain());
}
const mean = (a, from, to) => a.slice(from, to).reduce((s, x) => s + x, 0) / (to - from);
const early = mean(vibrationTrace, 0, 30), middle = mean(vibrationTrace, 60, 120), late = mean(vibrationTrace, 180, 240);
// Smooth three frames before detecting turns, so numerical micro-jitter cannot
// pass as secondary wobble. Multiple strain peaks distinguish an elastic
// ringdown from a monotonic damped return.
const smoothStrain = strainTrace.map((_, i) => mean(strainTrace, Math.max(0, i - 1), Math.min(strainTrace.length, i + 2)));
let peaks = 0;
for (let i = 5; i < 179; i++) if (smoothStrain[i] > 0.004 &&
  smoothStrain[i] > smoothStrain[i - 1] && smoothStrain[i] > smoothStrain[i + 1]) peaks++;
console.log({ restingStrain, nearFirst, farFirst, farLater, early, middle, late, peaks, finalStrain: wave.meanStrain() });
assert.ok(peaks >= 2, 'release should produce secondary elastic wobble, not just a monotonic return');
assert.ok(middle > 1e-7, 'secondary motion must remain measurable after one second');
assert.ok(late < early * 0.1 && late < middle, 'ringdown must decay rather than gain energy');
assert.ok(wave.meanStrain() < 0.01, 'released candy must return toward its molded shape');
assert.ok(wave.x.every(Number.isFinite) && wave.v.every(Number.isFinite));
assert.ok(Math.abs(wave.volumeRatio() - 1) < 0.03 && wave.minVolumeRatio() > 0);

const fragments = splitPiece(bear.I, 1, 0, 0).map(I => ({ ...bear, I, cache: null }));
const cut = new SoftBody(buildWorld(fragments).sim);
cut.reset(0.2);
for (let i = 0; i < 180; i++) cut.step();
assert.ok(Math.abs(cut.volumeRatio() - 1) < 0.03, 'cut fragments remain plump');
assert.ok(cut.x.every(Number.isFinite) && cut.minY() >= -1e-6);
assert.ok(cut.minVolumeRatio() > 0, 'cut fragment tets stay oriented');
console.log('elastic shape retention, delayed response, ringdown and fragment checks passed');