import assert from 'node:assert/strict';
import { initialPiece, buildPieceRender, pieceSamples, depthAt, buildWorld, splitPiece, ensureCache, fruitDepth, sdInner } from '../src/pieces.js';
import { SHAPE } from '../src/geometry.js';
import { candyColor } from '../src/candy-material.js';
import { MELON } from '../src/original-watermelon.js';

const outline = initialPiece().I;
const samples = pieceSamples(outline, 0.026);
const mesh = buildPieceRender(outline);
for (let ring = 0; ring <= 16; ring++) {
  const t = Math.sin(-Math.PI / 2 + Math.PI * ring / 16);
  for (let k = 0; k < samples.length; k++) {
    const [x, z] = samples[k].q;
    const at = 3 * (ring * samples.length + k);
    // Offset rings must follow a smooth collar, never sample the clamped
    // exterior depth field (which made the bevel buckle into noisy strips).
    const front = depthAt(x, z), back = depthAt(x, z, false);
    const expectedY = SHAPE.T * 0.5 + (front - back) * 0.5 + t * (front + back) * 0.5;
    assert.ok(Math.abs(mesh.rest[at + 1] - expectedY) < 1e-6);
    const distance = Math.hypot(mesh.rest[at] - x, mesh.rest[at + 2] - z);
    assert.ok(distance <= 0.018001, 'rounding must not create a detached skirt');
  }
}
// At the cap join the wall should continue inward/upward, not turn back out
// with a horizontal tangent like an attached elliptical flange.
for (let k = 0; k < samples.length; k++) {
  const top = 3 * (16 * samples.length + k), below = 3 * (15 * samples.length + k);
  const dy = mesh.rest[top + 1] - mesh.rest[below + 1];
  const dr = Math.hypot(mesh.rest[top] - mesh.rest[below], mesh.rest[top + 2] - mesh.rest[below + 2]);
  assert.ok(dy / dr > 1, 'cap collar must have a steep continuous join, not a horizontal lip');
}
console.log('smooth perimeter surface checks passed');
for (const type of ['cucumber', 'orange']) {
  const piece = initialPiece(type), rim = pieceSamples(piece.I,0.022);
  const { ren } = ensureCache(piece);
  let low = Infinity, high = -Infinity;
  for (let k=0;k<rim.length;k++) {
    // First 17 rows are the collar. Its cap join includes both original
    // polygon vertices and interpolated chord samples (not seed geometry).
    const y=ren.rest[3*(16*rim.length+k)+1];
    low=Math.min(low,y); high=Math.max(high,y);
  }
  assert.ok(high-low<1e-6, `${type} polygon rim must have constant shoulder height, including chord midpoints`);
  assert.ok(Math.abs(high-(SHAPE.T*0.5+0.16))<1e-6);
}
const cucumber = initialPiece('cucumber', [3.4,0]);
const cucumberWorld = buildWorld([cucumber]);
assert.ok(cucumberWorld.render.seeds.count > 0, 'cucumber needs actual volumetric seed inclusions');
assert.ok(cucumberWorld.render.mat.includes(30) && cucumberWorld.render.mat.includes(31));
const cucumberCuts = splitPiece(cucumber.I, 1,0,3.4);
assert.ok(cucumberCuts.length >= 2);
const cutWorld = buildWorld(cucumberCuts.map(I=>({...cucumber,I,cache:null})));
assert.ok(cutWorld.render.rest.every(Number.isFinite));
assert.ok(cutWorld.render.seeds.count > 0, 'seeds retained on surviving cut fragments');
assert.ok(cutWorld.render.mat.every(m=>m===30 || m===31));
for (const world of [cucumberWorld, cutWorld]) {
  const edges = new Map();
  for (let i=0;i<world.render.body.count;i+=3) for (let k=0;k<3;k++) {
    const a=world.render.index[i+k],b=world.render.index[i+(k+1)%3];
    const key=a<b?`${a},${b}`:`${b},${a}`;
    edges.set(key,(edges.get(key)||0)+1);
  }
  assert.ok([...edges.values()].every(n=>n===2),'dense shoulder rows must preserve watertight fruit and cuts');
}
const centerColor=candyColor(30,0,0,[]);
for (let i=0;i<16;i++) {
  const angle=i*Math.PI/8;
  const color=candyColor(30,Math.sin(angle)*0.0001,Math.cos(angle)*0.0001,[]);
  assert.ok(color.every((c,k)=>Math.abs(c-centerColor[k])<0.002),'organic chambers must not have angular spoke discontinuities at the center');
}
const melon=initialPiece('watermelon');
const originalInclusions=ensureCache(melon).ren;
assert.equal(originalInclusions.seeds.length,40*10*12*6,'original seeded front/back rows and two internal seeds');
assert.equal(originalInclusions.bubbles.length,11*8*12*6,'original eleven suspended bubbles');
assert.equal(MELON.T,0.58);
assert.equal(MELON.rho,0.17);
assert.equal(MELON.Ri,1.62);
assert.ok(Math.abs(Math.max(...melon.I.map(p=>p[1]))-0.98)<0.001,'original rounded apex');
assert.ok(Math.abs(Math.min(...melon.I.map(p=>p[1]))+0.98)<0.001,'original rind radius and centered span');
for(const I of [melon.I,...splitPiece(melon.I,1,0,0),...splitPiece(melon.I,0,1,-0.2)]) {
  const {ren,sim}=ensureCache({...melon,I,cache:null});
  const ys=Array.from(ren.rest).filter((_,i)=>i%3===1);
  assert.ok(Math.abs(Math.min(...ys))<1e-6 && Math.abs(Math.max(...ys)-.58)<1e-6,'flat original extrusion, not a generic dome or bear thickness');
  assert.ok(ren.seeds.length>0 && ren.bubbles.length>0,'authentic deterministic inclusions survive cuts');
  if(I===melon.I) assert.ok(sim.region.includes(0) && sim.region.includes(1) && sim.region.includes(2),'layered tissue labels retained');
  const edges=new Map();
  for(let i=0;i<ren.body.length;i+=3) for(let k=0;k<3;k++) {
    const a=ren.body[i+k],b=ren.body[i+(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;
    edges.set(key,(edges.get(key)||0)+1);
  }
  assert.ok([...edges.values()].every(n=>n===2),'original rounded watermelon and cut caps must be watertight');
}
assert.deepEqual(candyColor(10,0,0,[]),[.93,.07,.11],'original crimson flesh, no painted sine fibers');
assert.deepEqual(candyColor(10,3.4,3.4,[]),candyColor(10,0,0,[]),'material follows collection offset');
const pith=candyColor(10,0,-.8,[]);
assert.ok(pith[0]>.6 && pith[1]>.6 && pith[2]>.4,'broad original pale pith layer');
for(const type of ['pear','orange','cucumber']) {
  const piece=initialPiece(type),naturalTag={pear:40,orange:20,cucumber:30}[type];
  const complete=ensureCache(piece);
  assert.ok(complete.ren.seeds.length>0,`${type} needs actual internal volumes`);
  for(const I of [piece.I,...splitPiece(piece.I,1,0,0),...splitPiece(piece.I,0,1,-.15)]) {
    const {ren,sim}=ensureCache({...piece,I,cache:null});
    assert.ok(sim.rest.every(Number.isFinite) && ren.rest.every(Number.isFinite));
    const edges=new Map();
    for(let i=0;i<ren.body.length;i+=3) for(let k=0;k<3;k++) {
      const a=ren.body[i+k],b=ren.body[i+(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;
      edges.set(key,(edges.get(key)||0)+1);
    }
    assert.ok([...edges.values()].every(n=>n===2),`${type} and cuts must remain watertight`);
    for(const v of new Set(ren.seeds)) {
      const x=ren.rest[3*v],y=ren.rest[3*v+1],z=ren.rest[3*v+2];
      assert.ok(sdInner(I,x,z)<-.004,`${type} inclusions may not intersect cut walls`);
      assert.ok(Math.abs(y-SHAPE.T*.5)<fruitDepth(type,x,z)-.007,`${type} inclusions must lie below both cut faces, not glued above the surface`);
    }
  }
  piece.tintPalette='lavender';
  const tinted=ensureCache(piece);
  assert.ok(tinted.ren.mat.includes(6000+naturalTag));
  assert.ok(tinted.ren.mat.every(m=>m===6000+naturalTag || m<1000),'seeds retain natural material');
  assert.notDeepEqual(candyColor(6000+naturalTag,.1,.2,[]),candyColor(naturalTag,.1,.2,[]),'contextual tint must change fruit dye');
  assert.deepEqual(tinted.sim.rest,complete.sim.rest,'recolor must not change shape or physics');
  piece.tintPalette=undefined;
  assert.ok(ensureCache(piece).ren.mat.includes(naturalTag),'clearing tint restores natural material');
}
const pearShape=initialPiece('pear').I;
const upperWidth=Math.max(...pearShape.filter(p=>p[1]>.5).map(p=>Math.abs(p[0])));
const lowerWidth=Math.max(...pearShape.filter(p=>p[1]<0).map(p=>Math.abs(p[0])));
assert.ok(lowerWidth>upperWidth*1.45,'pear needs distinctive narrow shoulder and full lower body');