import { SHAPE, delaunay, tetVolume, embed } from './geometry.js';
import { MELON, melonOutline, buildMelonRender } from './original-watermelon.js';
import { itemScale } from './stack.js';

// A cut keeps a narrow kerf between the two new surfaces. The outline itself
// is already smoothly rounded by its sampled bear contour.
export const RC = SHAPE.rho;
export const MIN_INNER_AREA = 0.004;

const BEAR_VOLUMES = [
  // x, z, radius-x, radius-z, half-depth. Broad cheeks and a narrower waist
  // leave room for the hands and feet to project from one continuous casting.
  [0, -0.095, 0.48, 0.635, 0.315],
  [0, 0.67, 0.535, 0.535, 0.345],
  [-0.39, 1.095, 0.205, 0.225, 0.19], [0.39, 1.095, 0.205, 0.225, 0.19],
  [-0.565, -0.055, 0.285, 0.31, 0.245], [0.565, -0.055, 0.285, 0.31, 0.245],
  [-0.33, -0.725, 0.30, 0.35, 0.29], [0.33, -0.725, 0.30, 0.35, 0.29],
];

function smoothMin(a, b, k) {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function sdfBear(u, w) {
  let d = Infinity;
  for (const [x, z, rx, rz] of BEAR_VOLUMES) {
    const q = Math.hypot((u - x) / rx, (w - z) / rz);
    const next = (q - 1) * Math.min(rx, rz);
    d = d === Infinity ? next : smoothMin(d, next, 0.065);
  }
  return d;
}

const gaussian = (u, w, x, z, rx, rz) =>
  Math.exp(-2 * (((u - x) / rx) ** 2 + ((w - z) / rz) ** 2));

// A single height field molds the face, forward hands and soles into the body.
// Both the tetrahedral rest mesh and the render mesh sample this very same field;
// cuts therefore keep the original profile on their surviving faces.
export function depthAt(u, w, front = true) {
  const floor = 0.055, blend = 0.105;
  let h = 0, found = false;
  for (const [x, z, rx, rz, ry] of BEAR_VOLUMES) {
    const q2 = ((u - x) / rx) ** 2 + ((w - z) / rz) ** 2;
    if (q2 >= 1) continue;
    const v = ry * Math.sqrt(1 - q2);
    if (!found) { h = v; found = true; }
    else {
      const d = Math.abs(h - v);
      h = Math.max(h, v) + Math.max(0, blend - d) ** 2 / (4 * blend);
    }
  }
  if (front && w > 0.36 && w < 1.28 && Math.abs(u) < 0.57) {
    // A broad snout flows into two cheek pads; the nose is a separate raised
    // area of that same surface, not an intersecting sphere.
    h += 0.105 * gaussian(u, w, 0, 0.655, 0.26, 0.195);
    h += 0.027 * (gaussian(u, w, -0.115, 0.615, 0.135, 0.12) +
                  gaussian(u, w, 0.115, 0.615, 0.135, 0.12));
    h += 0.065 * gaussian(u, w, 0, 0.735, 0.11, 0.075);
    h -= 0.013 * gaussian(u, w, 0, 0.632, 0.018, 0.045);
    // Round raised eyes sit within smoothly recessed, concentric sockets.
    for (const x of [-0.19, 0.19]) {
      const r = Math.hypot((u - x) / 0.08, (w - 0.862) / 0.092);
      h += 0.061 * Math.exp(-1.9 * r * r);
      h -= 0.023 * Math.exp(-(((r - 1.03) / 0.29) ** 2));
    }
    // Soft tapered groove follows an upward curve; no abrupt ends or sharp
    // lip ridge to produce jagged specular highlights.
    const along = Math.abs(u) / 0.19;
    if (along < 1.12) {
      const smileZ = 0.485 + 0.065 * Math.min(1, along * along);
      const fade = Math.min(1, Math.max(0, (1.12 - along) / 0.24));
      const end = fade * fade * (3 - 2 * fade);
      h -= 0.039 * end * Math.exp(-(((w - smileZ) / 0.021) ** 2));
      h += 0.008 * end * Math.exp(-(((w - smileZ + 0.049) / 0.032) ** 2));
    }
    // Concave ear centers make the outer rims read as molded, not glued on.
    for (const x of [-0.39, 0.39]) h -= 0.047 * gaussian(u, w, x, 1.128, 0.115, 0.14);
  }
  if (front && w < 0.32) {
    for (const sign of [-1, 1]) {
      // In front view these remain part of the same surface, not paw props.
      h += 0.087 * gaussian(u, w, sign * 0.625, -0.105, 0.195, 0.245);
      h += 0.093 * gaussian(u, w, sign * 0.345, -0.795, 0.21, 0.225);
    }
  }
  return Math.max(floor, h);
}

const bearProfile = depthAt;

function makeBearOutline() {
  const xmin = -0.9, xmax = 0.9, zmin = -1.2, zmax = 1.38, step = 0.025;
  const nx = Math.ceil((xmax - xmin) / step), nz = Math.ceil((zmax - zmin) / step);
  const value = (i, j) => sdfBear(xmin + i * step, zmin + j * step);
  const key = p => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const segments = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = xmin + i * step, z = zmin + j * step;
    const v = [value(i, j), value(i + 1, j), value(i + 1, j + 1), value(i, j + 1)];
    const corners = [[x, z], [x + step, z], [x + step, z + step], [x, z + step]];
    const edgeCorners = [[0, 1], [1, 2], [2, 3], [3, 0]], hits = [];
    for (let e = 0; e < 4; e++) {
      const [a, b] = edgeCorners[e];
      if ((v[a] < 0) !== (v[b] < 0)) {
        const t = v[a] / (v[a] - v[b]);
        hits.push({ e, p: [corners[a][0] + (corners[b][0] - corners[a][0]) * t, corners[a][1] + (corners[b][1] - corners[a][1]) * t] });
      }
    }
    if (hits.length === 2) segments.push([hits[0].p, hits[1].p]);
    else if (hits.length === 4) {
      // Resolve checkerboard cells according to the true field at their center.
      const centerInside = sdfBear(x + step * 0.5, z + step * 0.5) < 0;
      const corner0Inside = v[0] < 0;
      const pairA = centerInside === corner0Inside ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
      for (const [a, b] of pairA) {
        const p = hits.find(h => h.e === a)?.p, q = hits.find(h => h.e === b)?.p;
        if (p && q) segments.push([p, q]);
      }
    }
  }
  const nodes = new Map(), links = [];
  const node = p => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { p, edges: [] });
    return nodes.get(k);
  };
  for (const [a, b] of segments) {
    const na = node(a), nb = node(b), id = links.length;
    links.push([na, nb]); na.edges.push(id); nb.edges.push(id);
  }
  const used = new Uint8Array(links.length), loops = [];
  for (let start = 0; start < links.length; start++) {
    if (used[start]) continue;
    const loop = [], first = links[start][0];
    let current = first, edge = start, guard = 0;
    while (edge !== undefined && !used[edge] && guard++ <= links.length + 2) {
      used[edge] = 1; loop.push(current.p);
      const pair = links[edge], next = pair[0] === current ? pair[1] : pair[0];
      if (next === first) break;
      const nextEdge = next.edges.find(e => !used[e]);
      current = next; edge = nextEdge;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  loops.sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  let outline = loops[0] || [];
  if (polyArea(outline) < 0) outline.reverse();
  outline = simplifyPolygon(outline, 0.007, 0.0015);
  return outline;
}

const BEAR_OUTLINE = makeBearOutline();
let nextCandyId = 1;
export function initialPiece(type = 'bear', offset = [0, 0], palette = 'amber') {
  if (!['bear', 'watermelon', 'orange', 'cucumber', 'pear'].includes(type)) throw new Error('Unknown candy shape');
  const outline = type === 'bear' ? BEAR_OUTLINE : fruitOutline(type);
  return { I: outline.map(p => [p[0] + offset[0], p[1] + offset[1]]), type, offset: offset.slice(), palette, candyId: nextCandyId++, cache: null };
}

function fruitOutline(type) {
  if (type === 'watermelon') return melonOutline();
  if (type === 'pear') return PEAR_OUTLINE.map(p=>p.slice());
  if (type === 'cucumber' || type === 'orange') {
    return Array.from({ length: 96 }, (_, i) => {
      const angle = i * Math.PI / 48;
      return [Math.cos(angle) * 1.16, Math.sin(angle) * 1.16];
    });
  }
  const out = [[0, 0.68]];
  const radius = type === 'orange' ? 1.25 : 1.65;
  const halfAngle = type === 'orange' ? Math.PI / 2 : 0.72;
  for (let j = 0; j <= 64; j++) {
    const a = -halfAngle + 2 * halfAngle * j / 64;
    out.push([Math.sin(a) * radius, 0.68 - Math.cos(a) * radius]);
  }
  if (polyArea(out) < 0) out.reverse();
  return simplifyPolygon(out, 0.015, 0.001);
}

const PEAR_OUTLINE = Array.from({length:128},(_,i)=>{
  const a=-i*Math.PI/64;
  return [Math.sin(a)*(.66-.27*Math.cos(a)),1.16*Math.cos(a)];
});

export function fruitDepth(type, u, w) {
  if (type === 'pear') {
    const d=Math.max(0,-sdInner(PEAR_OUTLINE,u,w)),t=Math.min(1,d/.115);
    return .145+.115*Math.sqrt(t*(2-t))+.025*Math.max(0,1-(u/.8)**2-(w/1.3)**2);
  }
  if (type === 'cucumber' || type === 'orange') {
    const r = Math.hypot(u, w);
    // The circular outline is a 96-sided polygon, not an analytic circle.
    // Normalize each radial ray to its polygon edge: otherwise chord midpoints
    // sit inside the circle and the square-root shoulder lifts them into teeth.
    const step = Math.PI / 48, angle = Math.atan2(w, u);
    const delta = angle - (Math.floor(angle / step) + 0.5) * step;
    const edgeRadius = r * Math.cos(delta) / Math.cos(step * 0.5);
    // Broad cut face, rounded shoulder; deep enough to refract through its side.
    const shoulder = Math.min(1, Math.max(0, (1.16 - edgeRadius) / 0.11));
    const crown = Math.max(0, 1 - r * r);
    const segment = type === 'orange' ? 0.012 * Math.cos(Math.atan2(u,w) * 10) * Math.min(1,r*5) * crown : 0;
    return 0.16 + 0.11 * Math.sqrt(shoulder * (2 - shoulder)) +
      0.045 * crown + segment;
  }
  const r = Math.hypot(u, w - 0.68);
  const radius = type === 'orange' ? 1.25 : 1.65;
  // Slightly domed candy; the rind is part of the same volume.
  return 0.105 + 0.12 * Math.sqrt(Math.max(0, 1 - (r / radius) ** 2));
}

export function polyArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
}

export function pointInPoly(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const cross = (x - a[0]) * dy - (y - a[1]) * dx;
    if (Math.abs(cross) < 1e-8 && (x - a[0]) * (x - b[0]) + (y - a[1]) * (y - b[1]) <= 1e-8) return true;
    if (((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function cleanLoop(P) {
  const out = [];
  for (const p of P) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.005) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.005) out.pop();
  return simplifyPolygon(out, 0.005, 0.001);
}

// Marching-squares contours can contain almost coincident edge crossings and
// many near-collinear samples. Remove those before triangulation to avoid
// microscopic surface triangles that invert under ordinary stretching.
function simplifyPolygon(P, minEdge, tolerance) {
  let out = P.map(p => p.slice()), changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const p = out[(i + out.length - 1) % out.length], q = out[i], r = out[(i + 1) % out.length];
      const dx = r[0] - p[0], dz = r[1] - p[1], l2 = dx * dx + dz * dz;
      const dist = Math.abs(dx * (p[1] - q[1]) - (p[0] - q[0]) * dz) / (Math.sqrt(l2) || 1);
      const dot = (q[0] - p[0]) * (q[0] - r[0]) + (q[1] - p[1]) * (q[1] - r[1]);
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < minEdge || dist < tolerance && dot <= 0) {
        out.splice(i, 1); changed = true; i--;
      }
    }
  }
  return out;
}

// Clip a simple concave polygon to a half plane. Boundary fragments plus
// interior intervals on the clipping line form one or more closed components.
function clipComponents(P, a, b, c) {
  const boundary = [], crossings = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    const pin = dp <= 1e-9, qin = dq <= 1e-9;
    let ip = null;
    if ((dp < -1e-9 && dq > 1e-9) || (dp > 1e-9 && dq < -1e-9)) {
      const t = dp / (dp - dq);
      ip = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      crossings.push(ip);
    } else {
      if (Math.abs(dp) <= 1e-9) crossings.push(p);
      if (Math.abs(dq) <= 1e-9) crossings.push(q);
    }
    if (pin && qin) boundary.push([p, q]);
    else if (pin && !qin && ip) boundary.push([p, ip]);
    else if (!pin && qin && ip) boundary.push([ip, q]);
  }
  const uniq = new Map();
  for (const p of crossings) uniq.set(`${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`, p);
  const xs = [...uniq.values()].sort((p, q) => p[0] * -b + p[1] * a - (q[0] * -b + q[1] * a));
  for (let i = 0; i < xs.length - 1; i++) {
    const p = xs[i], q = xs[i + 1], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if (pointInPoly(P, mx, my)) boundary.push([p, q]);
  }
  const nodes = new Map(), links = [];
  const get = p => {
    const k = `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;
    if (!nodes.has(k)) nodes.set(k, { p, edges: [] });
    return nodes.get(k);
  };
  const seen = new Set();
  for (const [p, q] of boundary) {
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-8) continue;
    const kp = `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`, kq = `${Math.round(q[0] * 1e7)},${Math.round(q[1] * 1e7)}`;
    const ek = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
    if (seen.has(ek)) continue;
    seen.add(ek);
    const np = get(p), nq = get(q), id = links.length;
    links.push([np, nq]); np.edges.push(id); nq.edges.push(id);
  }
  const used = new Uint8Array(links.length), result = [];
  for (let start = 0; start < links.length; start++) {
    if (used[start]) continue;
    let current = links[start][0], edge = start, guard = 0;
    const loop = [];
    while (edge !== undefined && !used[edge] && guard++ < links.length + 3) {
      used[edge] = 1; loop.push(current.p);
      const [p, q] = links[edge], next = p === current ? q : p;
      if (next === links[start][0]) break;
      current = next; edge = next.edges.find(e => !used[e]);
    }
    const clean = cleanLoop(loop);
    if (clean.length >= 3 && Math.abs(polyArea(clean)) > MIN_INNER_AREA) {
      if (polyArea(clean) < 0) clean.reverse();
      result.push(clean);
    }
  }
  return result;
}

// Retained for callers that use the old single-loop clipping helper.
export function clipHalf(P, a, b, c) { return clipComponents(P, a, b, c).sort((x, y) => Math.abs(polyArea(y)) - Math.abs(polyArea(x)))[0] || []; }

// splitPiece keeps its established return value: a flat array of polygons.
// Concave clipping can return 3+ components, e.g. a horizontal cut below the
// torso leaves the two legs as separate pieces.
export function splitPiece(I, a, b, c) {
  const A = clipComponents(I, a, b, c - RC), B = clipComponents(I, -a, -b, -(c + RC));
  const parts = A.concat(B);
  return parts.length >= 2 ? parts : null;
}

export function lineCrossesPiece(I, a, b, c) {
  let lo = Infinity, hi = -Infinity;
  for (const p of I) { const d = a * p[0] + b * p[1]; lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return c > lo - RC * 0.6 && c < hi + RC * 0.6;
}

export function sdInner(I, u, w) {
  let d2 = Infinity;
  for (let i = 0; i < I.length; i++) {
    const p = I[i], q = I[(i + 1) % I.length], dx = q[0] - p[0], dz = q[1] - p[1];
    const t = Math.max(0, Math.min(1, ((u - p[0]) * dx + (w - p[1]) * dz) / (dx * dx + dz * dz || 1)));
    d2 = Math.min(d2, (u - p[0] - t * dx) ** 2 + (w - p[1] - t * dz) ** 2);
  }
  return (pointInPoly(I, u, w) ? -1 : 1) * Math.sqrt(d2);
}
export function sdPiece(I, u, w, inset = 0) { return sdInner(I, u, w) - RC + inset; }

export function pieceSamples(I, spacing) {
  const out = [];
  for (let i = 0; i < I.length; i++) {
    const p = I[i], q = I[(i + 1) % I.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(l / spacing)), normal = [dz / (l || 1), -dx / (l || 1)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ q: [p[0] + dx * t, p[1] + dz * t], n: normal });
    }
  }
  return out;
}

export function bboxLattice(I, pad, spacing, keep) {
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const p of I) { u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); w0 = Math.min(w0, p[1]); w1 = Math.max(w1, p[1]); }
  u0 -= pad; u1 += pad; w0 -= pad; w1 += pad;
  const pts = [], dy = spacing * Math.sqrt(3) / 2;
  let row = 0;
  for (let w = w0; w <= w1; w += dy, row++) for (let u = u0 + (row % 2) * spacing / 2; u <= u1; u += spacing) if (keep(u, w)) pts.push(u, w);
  return pts;
}

function triangleInside(P, all, a, b, c) {
  const ax = all[2 * a], az = all[2 * a + 1], bx = all[2 * b], bz = all[2 * b + 1], cx = all[2 * c], cz = all[2 * c + 1];
  if (!pointInPoly(P, (ax + bx + cx) / 3, (az + bz + cz) / 3)) return false;
  for (const [x0, z0, x1, z1] of [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]]) {
    for (let k = 1; k <= 3; k++) if (!pointInPoly(P, x0 + (x1 - x0) * k / 4, z0 + (z1 - z0) * k / 4)) return false;
  }
  return true;
}

function triangulatePolygon(I, spacing, pad = 0, boundarySpacing = Math.max(spacing * 0.55, 0.012), faceDetail = false, rimDetail = false) {
  const boundary = pieceSamples(I, boundarySpacing);
  const pts = [];
  for (const s of boundary) pts.push(s.q[0], s.q[1]);
  const lattice = bboxLattice(I, pad, spacing, (u, w) => pointInPoly(I, u, w) && (!rimDetail || sdInner(I,u,w) < -0.155));
  if (rimDetail) {
    // Contour-aligned rows resolve shoulder curvature without an irregular
    // fan of large cap triangles producing a zigzag in glossy reflections.
    for (const inset of [0.012,0.026,0.045,0.069,0.097,0.129,0.16]) {
      for (let k=0;k<boundary.length;k++) {
        const prev=boundary[(k+boundary.length-1)%boundary.length].q;
        const next=boundary[(k+1)%boundary.length].q;
        const dx=next[0]-prev[0], dz=next[1]-prev[1], len=Math.hypot(dx,dz);
        const x=boundary[k].q[0]-dz/len*inset, z=boundary[k].q[1]+dx/len*inset;
        if (pointInPoly(I,x,z)) lattice.push(x,z);
      }
    }
  }
  if (faceDetail) {
    // Refine only the facial height field, not the simulation tetrahedra.
    // The same samples are used by all fragments after a cut.
    const fine = 0.019;
    for (let w = 0.415; w <= 1.17; w += fine * Math.sqrt(3) / 2) {
      const row = Math.round((w - 0.415) / (fine * Math.sqrt(3) / 2));
      for (let u = -0.35 + row % 2 * fine / 2; u <= 0.35; u += fine)
        if (pointInPoly(I, u, w)) {
          let near = false;
          for (let i = 0; i < lattice.length; i += 2)
            if ((lattice[i] - u) ** 2 + (lattice[i + 1] - w) ** 2 < 0.010 ** 2) { near = true; break; }
          if (!near) lattice.push(u, w);
        }
    }
  }
  // Avoid duplicate samples where a lattice point lands directly on the edge.
  for (let i = 0; i < lattice.length; i += 2) {
    let near = false;
    const minDistance = faceDetail || rimDetail ? 0.006 : spacing * 0.3;
    for (let j = 0; j < pts.length; j += 2) if ((pts[j] - lattice[i]) ** 2 + (pts[j + 1] - lattice[i + 1]) ** 2 < minDistance * minDistance) { near = true; break; }
    if (!near) pts.push(lattice[i], lattice[i + 1]);
  }
  const raw = delaunay(pts), tris = [];
  for (let i = 0; i < raw.length; i += 3) if (triangleInside(I, pts, raw[i], raw[i + 1], raw[i + 2])) tris.push(raw[i], raw[i + 1], raw[i + 2]);
  const used = new Int32Array(pts.length / 2).fill(-1), vertices = [];
  for (const v of tris) if (used[v] < 0) { used[v] = vertices.length / 2; vertices.push(pts[2 * v], pts[2 * v + 1]); }
  return { vertices, triangles: tris.map(v => used[v]) };
}

export function buildPieceSim(I, h = 0.14, layers = 3, profile = depthAt) {
  const { T } = SHAPE, { vertices: v2, triangles: tris } = triangulatePolygon(I, h);
  const n2 = v2.length / 2, nL = layers + 1, rest = new Float32Array(n2 * nL * 3);
  for (let l = 0; l < nL; l++) for (let i = 0; i < n2; i++) {
    const u = v2[2 * i], w = v2[2 * i + 1];
    const back = profile(u, w, false), front = profile(u, w);
    const k = (l * n2 + i) * 3;
    rest[k] = u; rest[k + 1] = T * 0.5 - back + (back + front) * l / layers; rest[k + 2] = w;
  }
  const tets = [];
  for (let l = 0; l < layers; l++) for (let i = 0; i < tris.length; i += 3) {
    const s = [tris[i], tris[i + 1], tris[i + 2]].sort((x, y) => x - y);
    const a = l * n2 + s[0], b = l * n2 + s[1], c = l * n2 + s[2];
    tets.push(a, b, c, a + n2, b, c, a + n2, b + n2, c, a + n2, b + n2, c + n2);
  }
  for (let t = 0; t < tets.length; t += 4) if (tetVolume(rest, tets[t], tets[t + 1], tets[t + 2], tets[t + 3]) < 0) [tets[t + 2], tets[t + 3]] = [tets[t + 3], tets[t + 2]];
  const region = new Uint8Array(n2 * nL); // uniform gummy material; no rind or pith bands
  return { rest, tets: new Uint32Array(tets), region };
}

function correctWinding(pos, nrm, idx) {
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const e1x = pos[3 * b] - pos[3 * a], e1y = pos[3 * b + 1] - pos[3 * a + 1], e1z = pos[3 * b + 2] - pos[3 * a + 2];
    const e2x = pos[3 * c] - pos[3 * a], e2y = pos[3 * c + 1] - pos[3 * a + 1], e2z = pos[3 * c + 2] - pos[3 * a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const d = fx * (nrm[3 * a] + nrm[3 * b] + nrm[3 * c]) + fy * (nrm[3 * a + 1] + nrm[3 * b + 1] + nrm[3 * c + 1]) + fz * (nrm[3 * a + 2] + nrm[3 * b + 2] + nrm[3 * c + 2]);
    if (d < 0) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
}

export function buildPieceRender(I, depthAt = bearProfile, faceDetail = true) {
  const { T } = SHAPE, b = 0.018, pos = [], nrm = [], mat = [], body = [], seeds = [], bubbles = [];
  const add = (x, y, z, m, nx, ny, nz) => { pos.push(x, y, z); nrm.push(nx, ny, nz); mat.push(m); return pos.length / 3 - 1; };
  const boundarySpacing = faceDetail ? 0.026 : 0.022;
  const samples = pieceSamples(I, boundarySpacing), N = samples.length;
  // Offset with a bisector, not each polygon edge's own normal. Otherwise
  // adjacent strips fan apart at every contour corner like a glued fringe.
  const contourNormals = samples.map((s, k) => {
    const prev = samples[(k + N - 1) % N].q, next = samples[(k + 1) % N].q;
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const inv = 1 / Math.hypot(dx, dz);
    return [dz * inv, -dx * inv];
  });
  const collars = samples.map((s, k) => {
    const [nx, nz] = contourNormals[k], [x, z] = s.q;
    const front = depthAt(x, z), back = depthAt(x, z, false);
    const span = (front + back) * 0.5;
    // Match the cap's inward secant slope, rather than terminating an ellipse
    // horizontally against a steep cap. That tangent reversal formed the
    // bright "glued-on sole" outline around paws.
    const inset = 0.03;
    const frontSlope = Math.max(0.1, (depthAt(x - nx * inset, z - nz * inset) - front) / inset);
    const backSlope = Math.max(0.1, (depthAt(x - nx * inset, z - nz * inset, false) - back) / inset);
    return { span, center: (front - back) * 0.5,
      frontWidth: Math.min(b, span / (2 * frontSlope)),
      backWidth: Math.min(b, span / (2 * backSlope)) };
  });
  const rings = [];
  for (let j = 0; j <= 16; j++) {
    const angle = -Math.PI / 2 + Math.PI * j / 16;
    const t = Math.sin(angle);
    // Bow OUTWARD. An inward sidewall folds under the front/back caps, leaving
    // overlapping surfaces which show up as a detached translucent skirt.
    rings.push({ t, ny: t, nr: Math.cos(angle) });
  }
  const ringStart = [];
  for (const r of rings) {
    ringStart.push(pos.length / 3);
    for (let k = 0; k < N; k++) {
      const s = samples[k], normal = contourNormals[k], collar = collars[k];
      const width = collar.backWidth + (collar.frontWidth - collar.backWidth) * (r.t + 1) * 0.5;
      const d = width * (1 - r.t * r.t);
      const x = s.q[0] + normal[0] * d, z = s.q[1] + normal[1] * d;
      // Sample the original boundary, not the offset outside the candy.
      // Outside samples hit the profile floor and buckle intermediate rings.
      const y = T * 0.5 + collar.center + r.t * collar.span;
      add(x, y, z, 0, normal[0] * r.nr, r.ny, normal[1] * r.nr);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < N; k++) {
    const a = ringStart[j] + k, bb = ringStart[j] + (k + 1) % N, c = ringStart[j + 1] + k, d = ringStart[j + 1] + (k + 1) % N;
    body.push(a, c, bb, bb, c, d);
  }
  const cap = triangulatePolygon(I, faceDetail ? 0.082 : 0.055, 0, boundarySpacing, faceDetail, !faceDetail);
  const topMap = [], botMap = [];
  const boundaryMap = new Map();
  for (let i = 0; i < N; i++) boundaryMap.set(`${Math.round(samples[i].q[0] * 1e7)},${Math.round(samples[i].q[1] * 1e7)}`, i);
  for (let i = 0; i < cap.vertices.length / 2; i++) {
    const x = cap.vertices[2 * i], z = cap.vertices[2 * i + 1];
    const edge = boundaryMap.get(`${Math.round(x * 1e7)},${Math.round(z * 1e7)}`);
    if (edge !== undefined) { topMap.push(ringStart[rings.length - 1] + edge); botMap.push(ringStart[0] + edge); }
    else {
      const depth = depthAt(x, z), back = depthAt(x, z, false);
      const e = 0.004, dx = (depthAt(x + e, z) - depthAt(x - e, z)) / (2 * e);
      const dz = (depthAt(x, z + e) - depthAt(x, z - e)) / (2 * e);
      const bdx = (depthAt(x + e, z, false) - depthAt(x - e, z, false)) / (2 * e);
      const bdz = (depthAt(x, z + e, false) - depthAt(x, z - e, false)) / (2 * e);
      const inv = 1 / Math.hypot(dx, 1, dz);
      const binv = 1 / Math.hypot(bdx, 1, bdz);
      topMap.push(add(x, T * 0.5 + depth, z, 0, -dx * inv, inv, -dz * inv));
      botMap.push(add(x, T * 0.5 - back, z, 0, -bdx * binv, -binv, -bdz * binv));
    }
  }
  for (let i = 0; i < cap.triangles.length; i += 3) {
    const a = cap.triangles[i], c = cap.triangles[i + 1], d = cap.triangles[i + 2];
    body.push(topMap[a], topMap[d], topMap[c], botMap[a], botMap[c], botMap[d]);
  }
  correctWinding(pos, nrm, body);
  return { rest: new Float32Array(pos), mat: new Float32Array(mat), body, seeds, bubbles };
}

export function ensureCache(piece) {
  if (piece.cache && piece.cache.tintPalette === piece.tintPalette) return piece.cache;
  const [ox, oz] = piece.offset || [0, 0], type = piece.type || 'bear';
  const I = piece.I.map(p => [p[0] - ox, p[1] - oz]);
  const profile = type === 'bear' ? depthAt : type === 'watermelon' ? () => MELON.T / 2 : (u, w) => fruitDepth(type, u, w);
  const sim = buildPieceSim(I, 0.14, 3, profile);
  const originalMelon = type === 'watermelon' ? buildMelonRender(I, pointInPoly, sdInner, bboxLattice) : null;
  const ren = originalMelon || buildPieceRender(I, profile, type === 'bear');
  if (type === 'watermelon') {
    // Simulation and render occupy the original 0..0.58 extrusion, not bear T.
    for (let i=1;i<sim.rest.length;i+=3) sim.rest[i] -= (SHAPE.T-MELON.T)*0.5;
    if (!originalMelon) for (let i=1;i<ren.rest.length;i+=3) ren.rest[i] -= (SHAPE.T-MELON.T)*0.5;
    for (let i=0;i<sim.region.length;i++) {
      const d=MELON.Ro-Math.hypot(sim.rest[3*i], MELON.center-sim.rest[3*i+2]);
      sim.region[i]=d<MELON.skin+0.03?2:d<MELON.pale?1:0;
    }
  }
  const paletteIndex = ['obsidian', 'pearl', 'berry', 'citrus', 'amber', 'lavender'].indexOf(piece.palette || 'amber');
  if (!originalMelon) ren.mat.fill(type === 'watermelon' ? 10 : type === 'orange' ? 20 : type === 'cucumber' ? 30 : type === 'pear' ? 40 : 100 + Math.max(0, paletteIndex));
  if (['cucumber','orange','pear'].includes(type)) addFruitSeeds(ren, I, type, profile);
  if (piece.tintPalette !== undefined && type !== 'bear') {
    const tintIndex=['obsidian','pearl','berry','citrus','amber','lavender'].indexOf(piece.tintPalette);
    if(tintIndex<0) throw new Error('Unknown fruit tint palette');
    // Encode body only; natural seeds and juice inclusions retain their identity.
    for(let i=0;i<ren.mat.length;i++) if([10,20,30,40].includes(ren.mat[i])) ren.mat[i]+=1000*(tintIndex+1);
  }
  for (const positions of [sim.rest, ren.rest]) for (let i = 0; i < positions.length; i += 3) {
    positions[i] += ox; positions[i + 2] += oz;
  }
  const emb = embed(sim.rest, sim.tets, ren.rest);
  piece.cache = { sim, ren, emb, tintPalette: piece.tintPalette };
  return piece.cache;
}

function addFruitSeeds(mesh, outline, type, profile) {
  addPremiumInclusions(mesh,outline,type,profile);
}

function addPremiumInclusions(mesh, outline, type, profile) {
  const pos=Array.from(mesh.rest),mat=Array.from(mesh.mat);
  const add=(x,z,rx,rz,angle,material,face=1,depth=.06,ry=.02)=>{
    if(sdInner(outline,x,z)>-Math.max(rx,rz)-.025) return;
    const y=SHAPE.T*.5+face*(profile(x,z)-depth);
    const cs=Math.cos(angle),sn=Math.sin(angle),points=[];
    for(let j=0;j<=8;j++) for(let k=0;k<12;k++) {
      const a=Math.PI*j/8,b=2*Math.PI*k/12;
      // Taper gives seeds a pointed tip, rather than detached spherical props.
      const taper=material===41 || material===21 ? .72+.28*Math.cos(a) : 1;
      const u=rx*Math.sin(a)*Math.cos(b)*taper,v=rz*Math.cos(a);
      const p=[x+u*cs+v*sn,y+ry*Math.sin(a)*Math.sin(b),z-u*sn+v*cs];
      if(sdInner(outline,p[0],p[2])>-.005 || Math.abs(p[1]-SHAPE.T*.5)>profile(p[0],p[2])-.008) return;
      points.push(...p);
    }
    const start=mat.length;pos.push(...points);mat.push(...Array(points.length/3).fill(material));
    for(let j=0;j<8;j++) for(let k=0;k<12;k++) {
      const a=start+j*12+k,b=start+j*12+(k+1)%12,c=a+12,d=b+12;
      mesh.seeds.push(a,c,b,b,c,d);
    }
  };
  if(type==='orange') {
    for(const face of [1,-1]) for(let sector=0;sector<10;sector++) {
      const a=(sector+.5)*Math.PI/5;
      for(let k=0;k<9;k++) {
        const r=.26+(k%3)*.25,th=a+(Math.floor(k/3)-1)*.105;
        add(Math.sin(th)*r,Math.cos(th)*r,.027,.105,th,22,face,.047+(k%2)*.022,.014);
      }
      if(sector===1 || sector===5 || sector===8) add(Math.sin(a)*.43,Math.cos(a)*.43,.032,.074,a,21,face,.046,.019);
    }
  } else if(type==='pear') {
    for(const face of [1,-1]) for(const sign of [-1,1]) {
      add(sign*.145,-.27,.105,.26,sign*.18,42,face,.08,.026);
      for(let k=0;k<3;k++) add(sign*(.13+.025*(k%2)),-.12-k*.135,.027,.068,sign*.28,41,face,.034,.016);
    }
  } else {
    for(const face of [1,-1]) for(let k=0;k<12;k++) {
      const a=Math.floor(k/4)*Math.PI*2/3+(k%2?.17:-.17),r=.31+Math.floor(k%4/2)*.25;
      add(Math.sin(a)*r,Math.cos(a)*r,.03,.086,a,31,face,.048,.018);
    }
  }
  mesh.rest=new Float32Array(pos);mesh.mat=new Float32Array(mat);
}

export function buildWorld(pieces) {
  let nP = 0, nT = 0, nV = 0, nB = 0, nS = 0, nU = 0;
  for (const p of pieces) {
    const c = ensureCache(p);
    nP += c.sim.rest.length / 3; nT += c.sim.tets.length / 4; nV += c.ren.rest.length / 3;
    nB += c.ren.body.length; nS += c.ren.seeds.length; nU += c.ren.bubbles.length;
  }
  const rest = new Float32Array(nP * 3), tets = new Uint32Array(nT * 4), region = new Uint8Array(nP), comp = new Uint16Array(nP);
  const rRest = new Float32Array(nV * 3), materialRest = new Float32Array(nV * 3), rMat = new Float32Array(nV), vComp = new Uint16Array(nV);
  const index = new Uint32Array(nB + nS + nU), skinIdx = new Uint32Array(nV * 4), skinW = new Float32Array(nV * 4);
  let po = 0, to = 0, vo = 0, bo = 0, so = nB, uo = nB + nS;
  pieces.forEach((p, k) => {
    const { sim, ren, emb } = p.cache, np = sim.rest.length / 3, nt = sim.tets.length / 4, nv = ren.rest.length / 3;
    rest.set(sim.rest, po * 3); region.set(sim.region, po); comp.fill(k, po, po + np);
    for (let i = 0; i < nt * 4; i++) tets[to * 4 + i] = sim.tets[i] + po;
    rRest.set(ren.rest, vo * 3); rMat.set(ren.mat, vo); vComp.fill(k, vo, vo + nv);
    materialRest.set(ren.rest, vo * 3);
    const scale=itemScale(p), [ox,oz]=p.offset||[0,0];
    for(const [positions,start,count] of [[rest,po,np],[rRest,vo,nv]]) for(let j=start;j<start+count;j++) {
      positions[3*j]=ox+(positions[3*j]-ox)*scale;
      positions[3*j+1]*=scale;
      positions[3*j+2]=oz+(positions[3*j+2]-oz)*scale;
    }
    for (let v = 0; v < nv; v++) for (let j = 0; j < 4; j++) {
      skinIdx[(vo + v) * 4 + j] = sim.tets[4 * emb.tetOf[v] + j] + po;
      skinW[(vo + v) * 4 + j] = emb.w[4 * v + j];
    }
    for (const i of ren.body) index[bo++] = i + vo;
    for (const i of ren.seeds) index[so++] = i + vo;
    for (const i of ren.bubbles) index[uo++] = i + vo;
    po += np; to += nt; vo += nv;
  });
  return {
    sim: { rest, tets, region, comp, nComp: pieces.length },
    render: { rest: rRest, materialRest, mat: rMat, index, vComp, body: { first: 0, count: nB }, seeds: { first: nB, count: nS }, bubbles: { first: nB + nS, count: nU } },
    skinIdx, skinW,
  };
}

// Transfer only existing candy identities. New objects must never inherit
// extrapolated coordinates/velocity from whichever old tetrahedron is nearest.
export function transferPieceMotion(old, next, oldPieces, nextPieces) {
  const oldIds = new Set(oldPieces.map(p => p.candyId));
  const e = embed(old.rest, old.tets, next.rest);
  for (let i = 0; i < next.n; i++) {
    if (!oldIds.has(nextPieces[next.comp[i]].candyId)) continue;
    for (let k = 0; k < 3; k++) {
      let position = 0, velocity = 0;
      for (let j = 0; j < 4; j++) {
        const q = old.tets[4 * e.tetOf[i] + j], w = e.w[4 * i + j];
        position += old.x[3 * q + k] * w;
        velocity += old.v[3 * q + k] * w;
      }
      next.x[3 * i + k] = k === 1 ? Math.max(0, position) : position;
      next.v[3 * i + k] = velocity;
    }
  }
  next.prev.set(next.x);
}