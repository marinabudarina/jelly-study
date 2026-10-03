import { typeLayer } from './backdrop-type.js';
import { candyColor } from './candy-material.js';
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smoothstep = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const srgb = x => {
  x = clamp(x);
  return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
};

function getPaletteColor(palette, name, fallback) {
  const c = palette && palette[name];
  return c && c.length >= 3 ? [c[0], c[1], c[2]] : fallback;
}

// Nonperiodic rest-space grain avoids the visible rings produced by sine waves
// on curved surfaces. Interpolation keeps the molded texture soft.
function moldGrain(x, y, z) {
  x *= 190; y *= 190; z *= 190;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = t => t * t * (3 - 2 * t);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  let value = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    let h = Math.imul(ix + i, 374761393) ^ Math.imul(iy + j, 668265263) ^ Math.imul(iz + k, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const sample = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    value += sample * (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
  }
  return value * 2 - 1;
}

function reflectedBox(rx, ry, rz, cx, cy, cz, width, height) {
  const l = Math.hypot(cx,cy,cz); cx/=l; cy/=l; cz/=l;
  const d = rx*cx+ry*cy+rz*cz;
  if (d <= 0) return 0;
  const t = Math.hypot(cx,cy), tx=-cy/t, ty=cx/t;
  const ux=-cz*ty, uy=cz*tx, uz=cx*ty-cy*tx;
  const distance = Math.max(Math.abs((rx*tx+ry*ty)/d)-width,
    Math.abs((rx*ux+ry*uy+rz*uz)/d)-height);
  const fade = clamp((0.09-distance)/0.18);
  return fade*fade*(3-2*fade);
}

/**
 * Draw a still, software-rendered view of the existing soft-body render mesh.
 * `viewName` accepts "front", "quarter"/"three-quarter", or "side".
 *
 * Optional `camera` { az, el, zoom, safe } overrides the preset: az/el in radians,
 * zoom multiplies the fitted distance (1 = fit, smaller = closer), and `safe`
 * { left, top, right, bottom } is CSS-pixel inset kept clear of overlaid UI.
 */
export function drawOfflineBear(canvas, renderMesh, palette, viewName = 'quarter', camera = null) {
  if (viewName && typeof viewName === 'object') { camera = viewName; viewName = 'quarter'; }
  if (!canvas || !renderMesh || !renderMesh.rest || !renderMesh.index) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width || canvas.width || 1);
  const cssH = Math.max(1, rect.height || canvas.height || 1);
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const pixelScale = Math.min(Math.max(1.5, dpr), Math.sqrt(1200000 / (cssW * cssH)), 1500 / Math.max(cssW, cssH));
  const width = Math.max(1, Math.round(cssW * pixelScale));
  const height = Math.max(1, Math.round(cssH * pixelScale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const image = ctx.createImageData(width, height);
  const pixels = image.data;
  // Warm neutral studio sweep, close to the WebGPU renderer's background.
  for (let p = 0; p < pixels.length; p += 4) {
    pixels[p] = 233; pixels[p + 1] = 231; pixels[p + 2] = 225; pixels[p + 3] = 255;
  }
  // Editorial type needs a browser canvas; headless geometry checks omit it.
  if (typeof document !== 'undefined') {
    const layer = typeLayer(width, height, width / cssW);
    const ink = layer.getContext('2d').getImageData(0, 0, width, height).data;
    for (let p = 0; p < pixels.length; p += 4) {
      const a = ink[p + 3] / 255 * 0.86;
      if (a > 0) { pixels[p] += (38 - pixels[p]) * a; pixels[p + 1] += (40 - pixels[p + 1]) * a; pixels[p + 2] += (42 - pixels[p + 2]) * a; }
    }
  }

  const pos = renderMesh.rest, materialPos=renderMesh.materialRest||pos, indices = renderMesh.index;
  const nVerts = Math.floor(pos.length / 3);
  if (!nVerts) { ctx.putImageData(image, 0, 0); return; }

  // Accumulate area-weighted vertex normals from the actual indexed mesh.
  // This keeps the result smooth while respecting the mesh's sculpted surface.
  const normals = new Float32Array(pos.length);
  const ranges = [renderMesh.body, renderMesh.seeds, renderMesh.bubbles, renderMesh.props].filter(r => r && r.count > 0);
  for (const range of ranges) {
    const end = Math.min(indices.length, range.first + range.count);
    for (let t = range.first; t + 2 < end; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      if (a >= nVerts || b >= nVerts || c >= nVerts) continue;
      const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
      const ux = pos[3 * b] - ax, uy = pos[3 * b + 1] - ay, uz = pos[3 * b + 2] - az;
      const vx = pos[3 * c] - ax, vy = pos[3 * c + 1] - ay, vz = pos[3 * c + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        normals[3 * v] += nx; normals[3 * v + 1] += ny; normals[3 * v + 2] += nz;
      }
    }
  }
  for (let v = 0; v < nVerts; v++) {
    const o = 3 * v, l = Math.hypot(normals[o], normals[o + 1], normals[o + 2]);
    if (l > 1e-12) { normals[o] /= l; normals[o + 1] /= l; normals[o + 2] /= l; }
    else { normals[o] = 0; normals[o + 1] = 1; normals[o + 2] = 0; }
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  }
  const target = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];

  // The sculpted face points up along +y; the head is toward +z.
  const key = String(viewName || '').toLowerCase();
  let az = Math.PI, elevation = 1.39;
  if (key === 'side' || key === 'profile') { az = Math.PI / 2; elevation = 0.3; }
  else if (key === 'quarter' || key === 'three-quarter' || key === 'threequarter' || key === '3/4' || key === 'three_quarter') {
    az = Math.PI - 0.31; elevation = 0.95;
  }
  if (camera && Number.isFinite(camera.az)) az = camera.az;
  if (camera && Number.isFinite(camera.el)) elevation = Math.max(-1.53, Math.min(1.53, camera.el));
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  const dir = [Math.sin(az) * ce, se, Math.cos(az) * ce];
  const right = [Math.cos(az), 0, -Math.sin(az)];
  const up = [-Math.sin(az) * se, ce, -Math.cos(az) * se];
  const focal = Math.max(6.5,Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)*1.2);
  const viewVerts = new Float32Array(nVerts * 6); // screen x/y, depth, reciprocal w, normal xyz
  let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
  for (let v = 0; v < nVerts; v++) {
    const o = 3 * v, dx = pos[o] - target[0], dy = pos[o + 1] - target[1], dz = pos[o + 2] - target[2];
    const cx = dx * right[0] + dy * right[1] + dz * right[2];
    const cy = dx * up[0] + dy * up[1] + dz * up[2];
    const depth = dx * dir[0] + dy * dir[1] + dz * dir[2];
    const q = 1 / Math.max(0.25, focal - depth);
    const sx = cx * q, sy = cy * q;
    const k = v * 6;
    viewVerts[k] = sx; viewVerts[k + 1] = sy; viewVerts[k + 2] = depth; viewVerts[k + 3] = q;
    viewVerts[k + 4] = normals[o]; viewVerts[k + 5] = normals[o + 1];
    // Store normal z in a compact side array below.
    loX = Math.min(loX, sx); hiX = Math.max(hiX, sx);
    loY = Math.min(loY, sy); hiY = Math.max(hiY, sy);
  }
  const normalZ = new Float32Array(nVerts);
  for (let v = 0; v < nVerts; v++) normalZ[v] = normals[3 * v + 2];
  let scale, centerX, centerY, originX = width * 0.5, originY = height * 0.5;
  if (camera) {
    // Orbit-stable framing: fit the bounding sphere (not the silhouette) into the safe rect.
    const sf = camera.safe || {}, ps = pixelScale;
    const L = (sf.left || 0) * ps, T = (sf.top || 0) * ps, Rr = (sf.right || 0) * ps, B = (sf.bottom || 0) * ps;
    const availW = Math.max(40, width - L - Rr), availH = Math.max(40, height - T - B);
    let radius = 0.05;
    for (let i = 0; i < pos.length; i += 3) radius = Math.max(radius, Math.hypot(pos[i] - target[0], pos[i + 1] - target[1], pos[i + 2] - target[2]));
    const fit = 0.94 * Math.min(availW, availH) / (2 * radius / (focal - radius));
    const zoom = Math.max(0.05, Number.isFinite(camera.zoom) ? camera.zoom : 1);
    scale = fit / zoom;
    centerX = 0; centerY = 0;
    originX = L + availW * 0.5; originY = T + availH * 0.5;
  } else {
    const margin = 0.11 * Math.min(width, height);
    scale = Math.max(1, Math.min((width - 2 * margin) / Math.max(1e-5, hiX - loX), (height - 2 * margin) / Math.max(1e-5, hiY - loY)));
    centerX = (loX + hiX) * 0.5; centerY = (loY + hiY) * 0.5;
  }
  for (let v = 0; v < nVerts; v++) {
    const k = v * 6;
    viewVerts[k] = originX + (viewVerts[k] - centerX) * scale;
    viewVerts[k + 1] = originY - (viewVerts[k + 1] - centerY) * scale;
  }

  // A soft, low-opacity contact shadow anchors the rendered silhouette.
  const shadowY = Math.min(height - 2, originY + (centerY - loY) * scale + 4 * pixelScale);
  const shadowRx = Math.min(width * 0.32, Math.max(18, (hiX - loX) * scale * 0.34));
  const shadowRy = Math.max(5, Math.min(17, shadowRx * 0.19));
  const shadowTop = Math.max(0, Math.floor(shadowY - shadowRy * 3));
  const shadowBottom = Math.min(height - 1, Math.ceil(shadowY + shadowRy * 3));
  for (let y = shadowTop; y <= shadowBottom; y++) {
    const dy = (y + 0.5 - shadowY) / shadowRy;
    for (let x = Math.max(0, Math.floor(originX - shadowRx * 3)); x <= Math.min(width - 1, Math.ceil(originX + shadowRx * 3)); x++) {
      const dx = (x + 0.5 - originX) / shadowRx;
      const r2 = dx * dx + dy * dy;
      if (r2 >= 1) continue;
      const alpha = (0.24 * Math.exp(-r2 * 4.2)) * (1 - r2);
      const o = (y * width + x) * 4;
      pixels[o] = Math.round(pixels[o] * (1 - alpha) + 30 * alpha);
      pixels[o + 1] = Math.round(pixels[o + 1] * (1 - alpha) + 28 * alpha);
      pixels[o + 2] = Math.round(pixels[o + 2] * (1 - alpha) + 27 * alpha);
    }
  }

  // Visible-component map: which render-mesh component (renderMesh.vComp) owns each pixel.
  const hitBuf = new Int16Array(width * height).fill(-1);
  const vComp = renderMesh.vComp;
  const zbuf = new Float32Array(width * height);
  zbuf.fill(-Infinity);
  // The nearest back-facing exit pairs with the nearest front surface.
  // Using the farthest object would incorrectly absorb the air between candies.
  const backDepth = new Float32Array(width * height);
  backDepth.fill(-Infinity);
  // Props are a separate subsurface layer, never replacements for body depth
  // or ownership. Resolve their nearest geometric intersection before blending.
  const internalDepth = new Float32Array(width * height).fill(-Infinity);
  const internalColor = new Float32Array(width * height * 3);
  const internalAlpha = new Float32Array(width * height);
  const extinction = new Float32Array(width * height);
  const propDepth = renderMesh.props ? new Float32Array(width*height).fill(-Infinity) : null;
  let propBackground=null;
  let owningBackPass = false;
  const flesh = getPaletteColor(palette, 'flesh', [0.55, 0.12, 0.08]);
  const detail = getPaletteColor(palette, 'seed', [0.02, 0.02, 0.02]);
  const light = [-0.42, 0.78, 0.46];
  const ll = Math.hypot(...light); light[0] /= ll; light[1] /= ll; light[2] /= ll;
  const half = [light[0] + dir[0], light[1] + dir[1], light[2] + dir[2]];
  const hl = Math.hypot(...half) || 1; half[0] /= hl; half[1] /= hl; half[2] /= hl;

  function rasterRange(range, isDetail, backPass = false, internalPass = false) {
    if (!range || range.count <= 0) return;
    const end = Math.min(indices.length, range.first + range.count);
    for (let t = range.first; t + 2 < end; t += 3) {
      const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
      if (ia >= nVerts || ib >= nVerts || ic >= nVerts) continue;
      const a = ia * 6, b = ib * 6, c = ic * 6;
      const x0 = viewVerts[a], y0 = viewVerts[a + 1], x1 = viewVerts[b], y1 = viewVerts[b + 1], x2 = viewVerts[c], y2 = viewVerts[c + 1];
      const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      if (Math.abs(area) < 1e-7) continue;
      if (backPass && area <= 0) continue;
      if (internalPass && area >= 0) continue;
      const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxx = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
      const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxy = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minx > maxx || miny > maxy) continue;
      const invArea = 1 / area;
      const q0 = viewVerts[a + 3], q1 = viewVerts[b + 3], q2 = viewVerts[c + 3];
      const material = renderMesh.mat?.[ia] || 0;
      for (let y = miny; y <= maxy; y++) {
        const py = y + 0.5, row = y * width;
        for (let x = minx; x <= maxx; x++) {
          const px = x + 0.5;
          const w0 = ((x1 - px) * (y2 - py) - (y1 - py) * (x2 - px)) * invArea;
          const w1 = ((x2 - px) * (y0 - py) - (y2 - py) * (x0 - px)) * invArea;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.0001 || w1 < -0.0001 || w2 < -0.0001) continue;
          const q = w0 * q0 + w1 * q1 + w2 * q2;
          if (q <= 0) continue;
          const depth = (w0 * viewVerts[a + 2] * q0 + w1 * viewVerts[b + 2] * q1 + w2 * viewVerts[c + 2] * q2) / q;
          const p = row + x;
          if (backPass) {
            if (owningBackPass && hitBuf[p] !== (vComp ? vComp[ia] : 0)) continue;
            if (depth > backDepth[p]) backDepth[p] = depth;
            continue;
          }
          if (internalPass) {
            if (hitBuf[p] !== (vComp ? vComp[ia] : 0) ||
                !Number.isFinite(zbuf[p]) || !Number.isFinite(backDepth[p]) ||
                depth < backDepth[p] - 0.002 || depth <= internalDepth[p]) continue;
          } else if (depth <= zbuf[p] &&
            !(material===60 && hitBuf[p]>=0 && depth>=backDepth[p] && depth>propDepth[p])) continue;
          const nx = (w0 * viewVerts[a + 4] * q0 + w1 * viewVerts[b + 4] * q1 + w2 * viewVerts[c + 4] * q2) / q;
          const ny = (w0 * viewVerts[a + 5] * q0 + w1 * viewVerts[b + 5] * q1 + w2 * viewVerts[c + 5] * q2) / q;
          const nz = (w0 * normalZ[ia] * q0 + w1 * normalZ[ib] * q1 + w2 * normalZ[ic] * q2) / q;
          const nl = Math.hypot(nx, ny, nz) || 1, ndl = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / nl);
          const ndh = Math.max(0, (nx * half[0] + ny * half[1] + nz * half[2]) / nl);
          const ndv = Math.max(0, (nx * dir[0] + ny * dir[1] + nz * dir[2]) / nl);
          // Perspective-correct rest position: molded speckles follow the
          // sculpt rather than the screen. Finer pores break up broad lights.
          const rx = (w0 * materialPos[3 * ia] * q0 + w1 * materialPos[3 * ib] * q1 + w2 * materialPos[3 * ic] * q2) / q;
          const ry = (w0 * materialPos[3 * ia + 1] * q0 + w1 * materialPos[3 * ib + 1] * q1 + w2 * materialPos[3 * ic + 1] * q2) / q;
          const rz = (w0 * materialPos[3 * ia + 2] * q0 + w1 * materialPos[3 * ib + 2] * q1 + w2 * materialPos[3 * ic + 2] * q2) / q;
          if(material===60) {
            if(depth<=propDepth[p]) continue;
            propDepth[p]=depth;
            const grain=.9+.1*Math.sin(rx*600+Math.sin(ry*4));
            const buried=depth<zbuf[p],alpha=buried?.75*Math.exp(-(zbuf[p]-depth)*extinction[p]):1;
            for(let ch=0;ch<3;ch++) {
              const encoded=propBackground[4*p+ch]/255;
              const base=encoded<=.04045?encoded/12.92:Math.pow((encoded+.055)/1.055,2.4);
              pixels[4*p+ch]=srgb(base*(1-alpha)+[.58,.34,.13][ch]*(.4+.65*ndl)*grain*alpha);
            }
            if(!buried) {pixels[4*p+3]=255;zbuf[p]=depth;hitBuf[p]=-2;}
            continue;
          }
          const color = candyColor(material, rx, rz, isDetail ? detail : flesh, ry);
          if (internalPass) {
            const burial = Math.max(0,zbuf[p]-depth);
            // View-space travel through the actual owning surface attenuates
            // the geometry. Back-face seeds disappear through a thick slice;
            // shallow seeds retain contrast under a glossy clear flesh layer.
            const natural=material%1000;
            const strength=natural===42?.68:natural===22?.48:natural===2?.26:.94;
            const alpha=strength*Math.exp(-burial*(extinction[p]+5.0));
            internalDepth[p]=depth;
            internalAlpha[p]=alpha;
            for(let ch=0;ch<3;ch++) internalColor[3*p+ch]=color[ch]*(.48+.42*ndl)+.025*Math.pow(ndh,48);
            continue;
          }
          const grain = moldGrain(rx, ry, rz);
          const fleck = isDetail ? 0 : Math.max(0, grain - 0.2) * 0.008 * ndv;
          const thickness = isDetail || !Number.isFinite(backDepth[p]) ? 0 : Math.max(0, Math.min(2, depth - backDepth[p]));
          const absorption = Math.exp(-1.65 * thickness);
          const melon = material === 10;
          const melonDepth = 1.79 - Math.hypot(rx-Math.round(rx/3.4)*3.4, .81-(rz-Math.round(rz/3.4)*3.4));
          const skinWeight = melon ? 1-smoothstep(.067,.085,melonDepth) : 0;
          const paleWeight = melon ? (1-smoothstep(.215,.285,melonDepth))*(1-skinWeight) : 0;
          const fleshWeight = 1-skinWeight-paleWeight;
          const scatter = isDetail ? 1 : melon ? 1-Math.exp(-(1.7*fleshWeight+4.5*paleWeight+26*skinWeight)*thickness*.95-.13) : 0.12 + 0.6 * (1 - absorption);
          const diffuse = 0.25 + 0.55 * ndl;
          const edgeGlow = isDetail ? 0 : (0.055 + 0.32 * Math.pow(1 - ndv, 2)) *
            Math.exp(-1.35 * thickness) * (0.72 + 0.28 * ndl);
          const reflectedX = 2*ndv*nx/nl-dir[0], reflectedY=2*ndv*ny/nl-dir[1], reflectedZ=2*ndv*nz/nl-dir[2];
          const boxes = reflectedBox(reflectedX,reflectedY,reflectedZ,-0.42,0.86,0.23,0.58,0.12)*0.8 +
            reflectedBox(reflectedX,reflectedY,reflectedZ,0.65,0.72,-0.1,0.12,0.58)*0.58;
          const reflection = Math.pow(ndh, 32) * 0.11 + Math.pow(ndh, 140) * 0.28 + boxes;
          const rim = Math.pow(1 - ndv, 5) * 0.12;
          const sheen = (reflection * (0.98 + 0.035 * grain) + rim) * (isDetail ? 0.55 : 1);
          const out = p * 4;
          for (let ch = 0; ch < 3; ch++) {
            // Transmitted gold at thin edges, saturated deeper dye in thick
            // regions. Facial relief stays legible through the directional light.
            const sigma = -Math.log([.93,.07,.11][ch])*3.4*fleshWeight+
              (-Math.log([.8,.86,.62][ch])*2+.5)*paleWeight+
              (-Math.log([.03,.13,.035][ch])*3.5+2)*skinWeight;
            const tint = melon ? Math.exp(-sigma*thickness) : Math.pow(clamp(color[ch], 0.003, 0.995), 0.38 + thickness * 1.5);
            const behind = [0.89, 0.87, 0.79][ch] * tint * (0.82 + 0.18 * ndl);
            const core = color[ch] * (diffuse + edgeGlow);
            pixels[out + ch] = srgb(core * scatter + behind * (1 - scatter) +
              sheen + fleck * (0.35 + 0.65 * Math.sqrt(color[ch])) + (isDetail ? 0.002 : 0.006));
          }
          pixels[out + 3] = 255;
          zbuf[p] = depth;
          hitBuf[p] = vComp ? vComp[ia] : 0;
          const natural=material%1000;
          const lx=rx-Math.round(rx/3.4)*3.4,lz=rz-Math.round(rz/3.4)*3.4;
          let skin=skinWeight;
          if(natural===20 || natural===30) skin=smoothstep(1.03,1.105,Math.hypot(lx,lz));
          if(natural===40) skin=smoothstep(.89,.98,Math.hypot(lx/(.66-.27*clamp(lz/1.16,-1,1)),lz/1.16));
          extinction[p]=2.2+skin*32+(1-clamp(color[0]*.2126+color[1]*.7152+color[2]*.0722))*1.8;
        }
      }
    }
  }

  rasterRange(renderMesh.body, false, true);
  rasterRange(renderMesh.body, false);
  // Pair exits only with the visible component; an overlapping other candy
  // cannot contribute either internal detail or an incorrect exit surface.
  backDepth.fill(-Infinity);
  owningBackPass = true;
  rasterRange(renderMesh.body, false, true);
  rasterRange(renderMesh.seeds, true, false, true);
  rasterRange(renderMesh.bubbles, false, false, true);
  for(let p=0;p<internalAlpha.length;p++) {
    const alpha=internalAlpha[p];
    if(alpha<.001) continue;
    for(let ch=0;ch<3;ch++) {
      const encoded=pixels[4*p+ch]/255;
      const base=encoded<=.04045?encoded/12.92:Math.pow((encoded+.055)/1.055,2.4);
      pixels[4*p+ch]=srgb(base*(1-alpha)+internalColor[3*p+ch]*alpha);
    }
  }
  if(renderMesh.props) {propBackground=pixels.slice();rasterRange(renderMesh.props,true);}
  ctx.putImageData(image, 0, 0);
  canvas.__hitMap = { buf: hitBuf, width, height, sx: width / cssW, sy: height / cssH };
}

/**
 * Per-pixel picking against the last software render. `x`,`y` are CSS pixels relative
 * to the canvas. Returns the visible render component index (renderMesh.vComp value) or -1.
 * `radius` (CSS px) forgives taps that land just outside a silhouette; nearest hit wins.
 */
export function offlineHitTest(canvas, x, y, radius = 0) {
  return hitTestMap(canvas && canvas.__hitMap, x, y, radius);
}
export function hitTestMap(map, x, y, radius = 0) {
  if (!map) return -1;
  const cx = Math.floor(x * map.sx), cy = Math.floor(y * map.sy);
  // A visible rigid prop is not empty background: don't use near-miss
  // forgiveness to select a neighbouring fruit through the stick.
  if(cx>=0&&cy>=0&&cx<map.width&&cy<map.height&&map.buf[cy*map.width+cx]===-2) return -1;
  const r = Math.ceil(radius * map.sx);
  let best = -1, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const px = cx + dx, py = cy + dy, d = dx * dx + dy * dy;
    if (px < 0 || py < 0 || px >= map.width || py >= map.height || d > r * r || d >= bd) continue;
    const c = map.buf[py * map.width + px];
    if (c >= 0) { best = c; bd = d; }
  }
  return best;
}