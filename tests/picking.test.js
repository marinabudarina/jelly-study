import assert from 'node:assert/strict';
import { hitTestMap, offlineHitTest } from '../src/offline-preview.js';

// 10x10 device pixels at 2x density: component 3 fills the left half, component 7 a block on the right.
const width = 10, height = 10, buf = new Int16Array(width * height).fill(-1);
for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) buf[y * width + x] = 3;
for (let y = 6; y < 9; y++) for (let x = 7; x < 9; x++) buf[y * width + x] = 7;
const map = { buf, width, height, sx: 2, sy: 2 };

assert.equal(hitTestMap(map, 1, 1), 3, 'direct hit left');
assert.equal(hitTestMap(map, 4, 3.5), 7, 'direct hit right block');
assert.equal(hitTestMap(map, 3, 1), -1, 'empty pixel misses');
assert.equal(hitTestMap(map, 3, 1, 1), 3, 'radius forgives near miss');
assert.equal(hitTestMap(map, 3.1, 3.2, 1), 7, 'nearest component wins');
assert.equal(hitTestMap(map, -5, 2), -1, 'outside canvas');
assert.equal(hitTestMap(null, 1, 1), -1);
assert.equal(offlineHitTest({ __hitMap: map }, 1, 1), 3);
assert.equal(offlineHitTest({}, 1, 1), -1, 'no render yet');
console.log('picking ok');
