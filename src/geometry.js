// Shared geometric constants and numeric utilities for the soft gummy bear.
// Rest-plane coordinates are (u,w) = (x,z); y is the bear's depth.
export const SHAPE = {
  T: 0.88, // nominal full depth; the sculpted muzzle extends slightly forward
  bevel: 0.065,
  rho: 0.055, // kerf/clearance used for newly cut faces
  Ro: 1.42,  // maximum in-plane extent (head/feet)
  skin: 0.075,
  pale: 0.25,
};

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bowyer–Watson Delaunay triangulation. Callers clip its convex hull to their
// polygon; keeping the triangulator unconstrained is much faster for these meshes.
export function delaunay(pts) {
  const n = pts.length / 2;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pts[2 * i]); maxX = Math.max(maxX, pts[2 * i]);
    minY = Math.min(minY, pts[2 * i + 1]); maxY = Math.max(maxY, pts[2 * i + 1]);
  }
  const d = Math.max(maxX - minX, maxY - minY, 1) * 20;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const P = Array.from(pts);
  P.push(mx - d, my - d, mx + d, my - d, mx, my + d);
  let tris = [];
  const mk = (a, b, c) => {
    const ax = P[2 * a], ay = P[2 * a + 1], bx = P[2 * b], by = P[2 * b + 1], cx = P[2 * c], cy = P[2 * c + 1];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-18) return null;
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
    return { a, b, c, x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  tris.push(mk(n, n + 1, n + 2));
  for (let i = 0; i < n; i++) {
    const px = P[2 * i], py = P[2 * i + 1];
    const bad = [], keep = [];
    for (const t of tris) ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r2 * (1 + 1e-10) ? bad : keep).push(t);
    const edges = new Map();
    for (const t of bad) for (const [e0, e1] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
      const k = e0 < e1 ? e0 * (n + 3) + e1 : e1 * (n + 3) + e0;
      const ex = edges.get(k);
      if (ex) ex.count++; else edges.set(k, { e0, e1, count: 1 });
    }
    tris = keep;
    for (const e of edges.values()) if (e.count === 1) {
      const t = mk(e.e0, e.e1, i);
      if (t) tris.push(t);
    }
  }
  const res = [];
  for (const t of tris) {
    if (!t || t.a >= n || t.b >= n || t.c >= n) continue;
    const ax = P[2 * t.a], ay = P[2 * t.a + 1];
    const cr = (P[2 * t.b] - ax) * (P[2 * t.c + 1] - ay) - (P[2 * t.b + 1] - ay) * (P[2 * t.c] - ax);
    if (Math.abs(cr) < 1e-12) continue;
    if (cr > 0) res.push(t.a, t.b, t.c); else res.push(t.a, t.c, t.b);
  }
  return res;
}

export function tetVolume(p, a, b, c, d) {
  const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
  const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
  const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
  const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
  return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
}

// Barycentric embedding of every rendered vertex into its containing sim tet.
export function embed(simRest, tets, verts) {
  const nT = tets.length / 4, nV = verts.length / 3, cell = 0.2;
  const grid = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  const inv = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]];
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const v of id) for (let c = 0; c < 3; c++) {
      mn[c] = Math.min(mn[c], simRest[3 * v + c]); mx[c] = Math.max(mx[c], simRest[3 * v + c]);
    }
    for (let i = Math.floor(mn[0] / cell); i <= Math.floor(mx[0] / cell); i++)
      for (let j = Math.floor(mn[1] / cell); j <= Math.floor(mx[1] / cell); j++)
        for (let k = Math.floor(mn[2] / cell); k <= Math.floor(mx[2] / cell); k++) {
          const K = key(i, j, k); let l = grid.get(K); if (!l) grid.set(K, l = []); l.push(t);
        }
    const a = id[0], m = [];
    for (let c = 1; c < 4; c++) for (let r = 0; r < 3; r++) m.push(simRest[3 * id[c] + r] - simRest[3 * a + r]);
    const M = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    const id2 = 1 / det, o = 9 * t;
    inv[o] = (M[4] * M[8] - M[5] * M[7]) * id2; inv[o + 1] = (M[2] * M[7] - M[1] * M[8]) * id2; inv[o + 2] = (M[1] * M[5] - M[2] * M[4]) * id2;
    inv[o + 3] = (M[5] * M[6] - M[3] * M[8]) * id2; inv[o + 4] = (M[0] * M[8] - M[2] * M[6]) * id2; inv[o + 5] = (M[2] * M[3] - M[0] * M[5]) * id2;
    inv[o + 6] = (M[3] * M[7] - M[4] * M[6]) * id2; inv[o + 7] = (M[1] * M[6] - M[0] * M[7]) * id2; inv[o + 8] = (M[0] * M[4] - M[1] * M[3]) * id2;
  }
  const bary = (t, x, y, z) => {
    const a = tets[4 * t], dx = x - simRest[3 * a], dy = y - simRest[3 * a + 1], dz = z - simRest[3 * a + 2], I = 9 * t;
    const b1 = inv[I] * dx + inv[I + 1] * dy + inv[I + 2] * dz;
    const b2 = inv[I + 3] * dx + inv[I + 4] * dy + inv[I + 5] * dz;
    const b3 = inv[I + 6] * dx + inv[I + 7] * dy + inv[I + 8] * dz;
    return [1 - b1 - b2 - b3, b1, b2, b3];
  };
  const tetOf = new Uint32Array(nV), w = new Float32Array(nV * 4);
  for (let v = 0; v < nV; v++) {
    const x = verts[3 * v], y = verts[3 * v + 1], z = verts[3 * v + 2];
    let best = -1, bestScore = -Infinity, bestB = null;
    const tryT = t => {
      const bb = bary(t, x, y, z), s = Math.min(bb[0], bb[1], bb[2], bb[3]);
      if (s > bestScore) { bestScore = s; best = t; bestB = bb; }
    };
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let r = 0; r <= 3 && bestScore < -1e-4; r++)
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
        const l = grid.get(key(i, j, k)); if (l) for (const t of l) tryT(t);
      }
    if (best < 0) for (let t = 0; t < nT; t++) tryT(t);
    tetOf[v] = Math.max(0, best); if (bestB) w.set(bestB, 4 * v);
  }
  return { tetOf, w };
}