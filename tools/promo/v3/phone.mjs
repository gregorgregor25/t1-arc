import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { roundedShape } from '../models.mjs';

function slab(w, h, r, d, material, bevel = .015) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(w, h, r), {
    depth: d, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 5, curveSegments: 48, steps: 1,
  });
  geometry.translate(0, 0, -d / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

// Original generic Android hardware. No downloaded device model or brand marks.
export function createStudioPhone(texture) {
  const group = new THREE.Group();
  const graphite = new THREE.MeshPhysicalMaterial({ color: '#454950', metalness: .92, roughness: .30, clearcoat: .18 });
  const polished = new THREE.MeshStandardMaterial({ color: '#91969e', metalness: 1, roughness: .19 });
  const black = new THREE.MeshStandardMaterial({ color: '#080a0e', metalness: .18, roughness: .27 });
  const back = new THREE.MeshPhysicalMaterial({ color: '#20252d', metalness: .38, roughness: .4, clearcoat: .3 });
  group.add(slab(3.12, 6.88, .34, .34, graphite, .03));
  const rear = slab(3.05, 6.8, .32, .018, back); rear.position.z = -.195; group.add(rear);
  const chamfer = slab(3.10, 6.86, .34, .018, polished, .01); chamfer.position.z = .187; group.add(chamfer);
  const bezelMaterial = new THREE.MeshBasicMaterial({ color: '#080a0d' });
  const bezel = slab(3.045, 6.805, .32, .02, bezelMaterial, .014); bezel.position.z = .207; group.add(bezel);
  const screenShape = new THREE.ShapeGeometry(roundedShape(2.94, 6.533333, .27), 48);
  const p = screenShape.attributes.position, uv = screenShape.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 1.47) / 2.94, (p.getY(i) + 3.2666665) / 6.533333);
  const screen = new THREE.Mesh(screenShape, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.position.z = .233; group.add(screen);

  // Glass adds depth during the reveal, then clears completely for reading.
  const glass = new THREE.Mesh(screenShape.clone(), new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: .1, roughness: .12, transparent: true,
    opacity: .11, depthWrite: false, clearcoat: 1, clearcoatRoughness: .06,
  }));
  glass.position.z = .235; glass.renderOrder = 2; group.add(glass);
  const cameraRing = new THREE.Mesh(new THREE.CircleGeometry(.052, 48), new THREE.MeshBasicMaterial({color:'#252a32'})); cameraRing.position.set(0, 3.095, .239); group.add(cameraRing);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(.046, 48), bezelMaterial); hole.position.set(0, 3.095, .24); group.add(hole);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.026, 32), new THREE.MeshBasicMaterial({ color: '#131d29' })); lens.position.set(0, 3.095, .241); group.add(lens);
  for (const [y, length] of [[1.27, .54], [.28, .94]]) {
    const button = new THREE.Mesh(new RoundedBoxGeometry(.065, length, .15, 4, .025), graphite);
    button.position.set(1.594, y, 0); group.add(button);
  }
  for (const side of [-1, 1]) for (const y of [-2.53, 2.53]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(.014, .027, .30), black); band.position.set(side * 1.595, y, 0); group.add(band);
  }
  const usb = new THREE.Mesh(new RoundedBoxGeometry(.4, .027, .09, 3, .012), black); usb.position.set(0, -3.463, 0); group.add(usb);
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .012, 16), black);
    vent.position.set(side * (.49 + .075 * i), -3.477, .02); group.add(vent);
  }
  return { group, screen, glass };
}
