import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function roundedShape(w: number, h: number, r: number) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function slab(w: number, h: number, r: number, d: number, material: THREE.Material, bevel = .015) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(w, h, r), {
    depth: d, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 4, curveSegments: 32, steps: 1,
  });
  geometry.translate(0, 0, -d / 2);
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true;
  return mesh;
}

// Original generic Android design, ported from our V3 model. No borrowed model
// or manufacturer assets. Its display preserves the captured phone's aspect.
export function createPhone(texture: THREE.Texture) {
  const group = new THREE.Group();
  const graphite = new THREE.MeshPhysicalMaterial({ color: '#454950', metalness: .86, roughness: .28, clearcoat: .2 });
  const polished = new THREE.MeshStandardMaterial({ color: '#989ca5', metalness: 1, roughness: .2 });
  const black = new THREE.MeshStandardMaterial({ color: '#080a0e', metalness: .18, roughness: .27 });
  const back = new THREE.MeshPhysicalMaterial({ color: '#20252d', metalness: .38, roughness: .4, clearcoat: .3 });
  group.add(slab(3.12, 6.88, .34, .34, graphite, .03));
  const rear = slab(3.05, 6.8, .32, .018, back); rear.position.z = -.195; group.add(rear);
  const chamfer = slab(3.10, 6.86, .34, .018, polished, .01); chamfer.position.z = .187; group.add(chamfer);
  const bezelMaterial = new THREE.MeshBasicMaterial({ color: '#080a0d' });
  const bezel = slab(3.045, 6.805, .32, .02, bezelMaterial, .014); bezel.position.z = .207; group.add(bezel);
  const screenHeight = 2.94 * 2404 / 1080;
  const shape = new THREE.ShapeGeometry(roundedShape(2.94, screenHeight, .25), 40);
  const p = shape.attributes.position, uv = shape.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 1.47) / 2.94, (p.getY(i) + screenHeight / 2) / screenHeight);
  const display = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  display.position.z = .233; group.add(display);
  const glass = new THREE.Mesh(shape.clone(), new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: .1, roughness: .12, transparent: true,
    opacity: .04, depthWrite: false, clearcoat: 1, clearcoatRoughness: .06,
  }));
  glass.position.z = .235; glass.renderOrder = 2; group.add(glass);
  for (const [y, length] of [[1.27, .54], [.28, .94]]) {
    const button = new THREE.Mesh(new RoundedBoxGeometry(.065, length, .15, 4, .025), graphite);
    button.position.set(1.594, y, 0); group.add(button);
  }
  for (const side of [-1, 1]) for (const y of [-2.53, 2.53]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(.014, .027, .30), black);
    band.position.set(side * 1.595, y, 0); group.add(band);
  }
  const usb = new THREE.Mesh(new RoundedBoxGeometry(.4, .027, .09, 3, .012), black);
  usb.position.set(0, -3.463, 0); group.add(usb);
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .012, 16), black);
    vent.position.set(side * (.49 + .075 * i), -3.477, .02); group.add(vent);
  }
  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
  };
  return { group, glass, dispose };
}
