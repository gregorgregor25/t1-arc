import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPhone, createWatch, roundedShape } from '../models.mjs';

test('rounded phone shape has the intended bounds', () => {
  const points = roundedShape(3, 6, .25).getPoints(32);
  const box = new THREE.Box2().setFromPoints(points);
  assert.equal(box.min.x, -1.5);
  assert.equal(box.max.x, 1.5);
  assert.equal(box.min.y, -3);
  assert.equal(box.max.y, 3);
});

test('device geometry and normals are finite', () => {
  for (const model of [createPhone(new THREE.Texture()), createWatch(new THREE.Texture())]) {
    let meshCount = 0;
    model.group.traverse(child => {
      if (!child.isMesh) return;
      meshCount++;
      for (const name of ['position', 'normal']) {
        for (const value of child.geometry.attributes[name].array) assert.ok(Number.isFinite(value));
      }
    });
    assert.ok(meshCount >= 7);
    const box = new THREE.Box3().setFromObject(model.group);
    assert.ok(box.max.z > box.min.z, 'real depth, not a flat screenshot');
  }
});

test('real screenshots retain their full texture coordinates and brightness', () => {
  const texture = new THREE.Texture();
  const phone = createPhone(texture);
  assert.equal(phone.screen.material.map, texture);
  assert.equal(phone.screen.material.toneMapped, false);
  for (const value of phone.screen.geometry.attributes.uv.array) assert.ok(value >= 0 && value <= 1);
  assert.equal(phone.nextScreen.material.transparent, true);
  assert.equal(phone.nextScreen.material.depthWrite, false);
  assert.ok(phone.nextScreen.position.z > phone.screen.position.z);
  const watch = createWatch(texture);
  assert.equal(watch.screen.material.map, texture);
  assert.equal(watch.screen.material.toneMapped, false);
});
