import * as THREE from 'three';

/** Pod colours: paper hull, red trim, pale engines, ink outlines. */
const HULL = '#f2efe6';
const TRIM = '#d2452d';
const ENGINE = '#cfc8b8';
const INK = '#1d1b22';

/**
 * Your pod, nose toward −z, origin at the physics sphere's centre: a cockpit tub with a low
 * racing windshield, and two engines out front tied together by a glowing binder — podracer
 * style. Phase 2C refines the look.
 */
export function createPodModel(gradient: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });
  const hull = toon(HULL);
  const trim = toon(TRIM);
  const engine = toon(ENGINE);
  const ink = new THREE.LineBasicMaterial({ color: INK });

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, outline = true) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    if (outline) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), ink));
    return mesh;
  };

  // Cockpit tub, side rails and the cowl in front of you (paper, with a red stripe).
  add(new THREE.BoxGeometry(1.3, 0.6, 2.4), hull, 0, -0.25, 0.2);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.2, 1.9), hull, side * 0.62, 0.15, 0.1);
  add(new THREE.BoxGeometry(1.24, 0.16, 0.6), hull, 0, 0.13, -0.85);
  add(new THREE.BoxGeometry(0.22, 0.02, 0.6), trim, 0, 0.22, -0.85, false);
  const nose = add(new THREE.ConeGeometry(0.66, 1.1, 4), hull, 0, -0.25, -1.5);
  nose.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  nose.scale.set(1, 1, 0.45);

  // Windshield: a low tinted screen leaning back from the cowl; its top edge sits just below
  // eye level, so you look over it at the road and through it at the engines.
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.5),
    new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  pane.position.set(0, 0.42, -1.0);
  pane.rotation.x = -0.75;
  group.add(pane);
  const frame = new THREE.MeshBasicMaterial({ color: INK });
  const bar = (w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), frame);
    m.position.set(x, y, z);
    m.rotation.x = -0.75;
    group.add(m);
  };
  bar(1.12, 0.015, 0, 0.6, -0.84); // top edge
  for (const side of [-1, 1]) bar(0.015, 0.5, side * 0.55, 0.42, -1.0); // sides

  // Engines out front, cables back to the tub, and the binder between them.
  const glow = new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.6 });
  for (const side of [-1, 1]) {
    const x = side * 1.7;
    const body = add(new THREE.CylinderGeometry(0.42, 0.5, 2.8, 8), engine, x, 0.15, -4.4);
    body.rotation.x = Math.PI / 2;
    const intake = add(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 8), trim, x, 0.15, -5.9);
    intake.rotation.x = Math.PI / 2;
    const fin = add(new THREE.BoxGeometry(0.06, 0.55, 1.2), trim, x, 0.7, -4.2);
    fin.rotation.x = 0.15;
    const exhaust = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), glow);
    exhaust.position.set(x, 0.15, -2.99);
    group.add(exhaust);
    // Cable from the engine's back to the tub's front corner.
    const from = new THREE.Vector3(x, 0.1, -3.1);
    const to = new THREE.Vector3(side * 0.55, -0.05, -1.2);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, from.distanceTo(to), 5), new THREE.MeshBasicMaterial({ color: INK }));
    cable.position.copy(from).add(to).multiplyScalar(0.5);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    group.add(cable);
  }
  const binder = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: 0.8 }));
  binder.position.set(0, 0.15, -5.0);
  group.add(binder);

  return group;
}
