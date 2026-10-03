// Azimuth stays continuous so an orbit can cross every preset and make full turns.
// Elevation stops just short of the poles, where lookAt's up vector is undefined.
export const VIEWS = {
  front: { az: Math.PI, el: 1.39 },
  quarter: { az: Math.PI - 0.31, el: 0.95 },
  side: { az: Math.PI / 2, el: 0.3 },
};

// Zoom multiplies the fitted framing distance: small = close, large = far.
export const ZOOM = { min: 0.12, max: 3, initial: 0.62 };

export function orbitCamera(camera, dx, dy) {
  camera.az -= dx * 0.006;
  camera.el = Math.max(-Math.PI / 2 + 0.04, Math.min(Math.PI / 2 - 0.04, camera.el + dy * 0.005));
}

export const clampZoom = z => Math.max(ZOOM.min, Math.min(ZOOM.max, z));

// wheel: deltaY > 0 moves away. Line-mode deltas are converted to pixels.
export function wheelZoom(camera, deltaY, deltaMode = 0) {
  const d = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  camera.zoom = clampZoom(camera.zoom * Math.exp(Math.max(-120, Math.min(120, d)) * 0.0015));
  return camera.zoom;
}

// pinch: fingers apart (dist grows) moves closer.
export function pinchZoom(camera, startZoom, startDist, dist) {
  if (!(startDist > 0) || !(dist > 0)) return camera.zoom;
  camera.zoom = clampZoom(startZoom * startDist / dist);
  return camera.zoom;
}
