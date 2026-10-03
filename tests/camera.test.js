import assert from 'node:assert/strict';
import { VIEWS, ZOOM, orbitCamera, wheelZoom, pinchZoom, clampZoom } from '../src/camera-controls.js';

const cam = { az: VIEWS.quarter.az, el: VIEWS.quarter.el, zoom: ZOOM.initial };
const az0 = cam.az;
for (let i = 0; i < 2000; i++) orbitCamera(cam, 10, 0);
assert.ok(az0 - cam.az > Math.PI * 4, 'horizontal orbit is unlimited');
for (let i = 0; i < 500; i++) orbitCamera(cam, 0, 40);
assert.ok(cam.el < Math.PI / 2 && cam.el > 1.4, 'elevation clamps below pole');
for (let i = 0; i < 500; i++) orbitCamera(cam, 0, -40);
assert.ok(cam.el > -Math.PI / 2);

cam.zoom = 1;
for (let i = 0; i < 400; i++) wheelZoom(cam, -100);
assert.equal(cam.zoom, ZOOM.min);
for (let i = 0; i < 400; i++) wheelZoom(cam, 3, 1);
assert.equal(cam.zoom, ZOOM.max);
assert.ok(ZOOM.min <= 0.12 && ZOOM.max >= 3);
assert.ok(ZOOM.initial < 1, 'starts closer than fit');

cam.zoom = 1;
pinchZoom(cam, 1, 100, 200);
assert.equal(cam.zoom, 0.5, 'spreading fingers zooms in');
pinchZoom(cam, 1, 100, 0);
assert.equal(cam.zoom, 0.5, 'degenerate pinch ignored');
assert.equal(clampZoom(10), ZOOM.max);
console.log('camera ok');
