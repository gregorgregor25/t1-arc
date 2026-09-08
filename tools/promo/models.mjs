import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original generic device geometry. No device scans, trademarks or purchased models.
export function roundedShape(width, height, radius) {
  const x = -width / 2, y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function roundedSlab(width, height, radius, depth, material, bevel = 0.03) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(width, height, radius), {
    depth, bevelEnabled: true, bevelSegments: 4, steps: 1,
    bevelSize: bevel, bevelThickness: bevel, curveSegments: 24,
  });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function screenPlane(width, height, radius, texture) {
  const geometry = new THREE.ShapeGeometry(roundedShape(width, height, radius), 32);
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    uvs.setXY(i, THREE.MathUtils.clamp((positions.getX(i) + width / 2) / width, 0, 1),
      THREE.MathUtils.clamp((positions.getY(i) + height / 2) / height, 0, 1));
  }
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  return new THREE.Mesh(geometry, material);
}

export function createPhone(texture) {
  const group = new THREE.Group();
  const titanium = new THREE.MeshStandardMaterial({ color: '#727f91', metalness: .96, roughness: .25 });
  const rim = new THREE.MeshStandardMaterial({ color: '#141b24', metalness: .65, roughness: .18 });
  group.add(roundedSlab(3.12, 6.88, .34, .24, titanium, .035));
  const front = roundedSlab(3.04, 6.80, .32, .035, rim, .015);
  front.position.z = .15;
  group.add(front);
  const screen = screenPlane(2.94, 6.533333, .265, texture);
  screen.position.z = .187;
  group.add(screen);
  // A second screen layer provides a genuine texture crossfade, not a jump cut.
  const nextScreen = screenPlane(2.94, 6.533333, .265, texture);
  nextScreen.material.transparent = true;
  nextScreen.material.depthWrite = false;
  nextScreen.material.opacity = 0;
  nextScreen.position.z = .188;
  nextScreen.renderOrder = 2;
  group.add(nextScreen);
  for (const [side, y, length] of [[1, .75, .62], [-1, 1.06, .78], [-1, .1, .38]]) {
    const button = new THREE.Mesh(new RoundedBoxGeometry(.055, length, .11, 3, .025), titanium);
    button.position.set(side * 1.586, y, -.018);
    group.add(button);
  }
  const port = new THREE.Mesh(new RoundedBoxGeometry(.38, .028, .07, 3, .01), rim);
  port.position.set(0, -3.455, -.015);
  group.add(port);
  return { group, screen, nextScreen };
}

export function createWatch(texture, { metal = '#718091', strap = '#17202c' } = {}) {
  const group = new THREE.Group();
  const caseMaterial = new THREE.MeshStandardMaterial({ color: metal, metalness: .87, roughness: .37 });
  const strapMaterial = new THREE.MeshStandardMaterial({ color: strap, metalness: .02, roughness: .92 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#090e15', metalness: .2, roughness: .38 });
  for (const sign of [-1, 1]) {
    const band = roundedSlab(1.23, 1.55, .18, .12, strapMaterial, .025);
    // A gentle taper and bend give the silicone strap a wearable silhouette.
    const points = band.geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const along = (points.getY(i) * sign + .8) / 1.6;
      points.setXYZ(i, points.getX(i) * (1 - along * .13), points.getY(i),
        points.getZ(i) - along * along * .19);
    }
    band.geometry.computeVertexNormals();
    band.position.set(0, sign * 1.57, -.10);
    group.add(band);
    for (const side of [-1, 1]) {
      const lug = new THREE.Mesh(new RoundedBoxGeometry(.24, .55, .26, 3, .07), caseMaterial);
      lug.position.set(side * .69, sign * 1.20, -.015);
      group.add(lug);
    }
    for (let i = 0; i < 7; i++) {
      const distance = 1.51 + i * .096;
      const along = (distance - 1.57 + .8) / 1.6;
      const ridge = new THREE.Mesh(new RoundedBoxGeometry(1.12 * (1 - along * .13), .015, .009, 2, .004), strapMaterial);
      ridge.position.set(0, sign * distance, -.031 - along * along * .19);
      group.add(ridge);
    }
  }
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(1.24, 1.19, .37, 128), caseMaterial);
  cylinder.rotation.x = Math.PI / 2;
  cylinder.castShadow = true;
  group.add(cylinder);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(1.169, .064, 12, 128), caseMaterial);
  bezel.position.z = .208;
  group.add(bezel);
  const gasket = new THREE.Mesh(new THREE.RingGeometry(1.087, 1.146, 128), darkMaterial);
  gasket.position.z = .238;
  group.add(gasket);
  const screen = new THREE.Mesh(new THREE.CircleGeometry(1.091, 128),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.position.z = .246;
  group.add(screen);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(.125, .125, .16, 32), caseMaterial);
  crown.rotation.z = Math.PI / 2;
  crown.position.set(1.27, .12, -.015);
  group.add(crown);
  return { group, screen };
}
