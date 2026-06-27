import * as THREE from "three";

// The ship is procedural and always identical — no external model needed.
// Built from a few low-poly primitives, flat-shaded, with emissive accents.
// Local convention: nose points toward +Z, "up" is +Y.
export function createShip() {
  const ship = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x6e7689, metalness: 0.6, roughness: 0.35, flatShading: true,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c10, metalness: 0.8, roughness: 0.4, flatShading: true,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x19d3ff, emissive: 0x19d3ff, emissiveIntensity: 2.2, roughness: 0.4,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x081018, metalness: 0.3, roughness: 0.1,
    emissive: 0x0a2230, emissiveIntensity: 0.6,
  });

  // Main fuselage — a stretched, tapered wedge.
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6, 4), hullMat);
  body.rotation.x = Math.PI / 2;   // cone axis +Y -> +Z (nose forward)
  body.rotation.z = Math.PI / 4;   // square cross-section flat side down
  body.scale.set(1.0, 0.45, 1.0);  // flatten vertically
  ship.add(body);

  // Rear deck behind the cone for a chunkier tail.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 2.4), hullMat);
  deck.position.set(0, 0.05, -2.0);
  ship.add(deck);

  // Side pods / nacelles.
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 3.4), trimMat);
    pod.position.set(sx * 2.0, -0.1, -0.6);
    ship.add(pod);

    // Engine glow at the back of each pod.
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.4, 12), glowMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(sx * 2.0, -0.1, -2.4);
    ship.add(engine);

    // Thin emissive strip along the top of each pod.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 2.8), glowMat);
    strip.position.set(sx * 2.0, 0.28, -0.6);
    ship.add(strip);
  }

  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), canopyMat);
  canopy.scale.set(1.0, 0.7, 1.5);
  canopy.position.set(0, 0.45, 0.4);
  ship.add(canopy);

  // Tail fin.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 1.4), hullMat);
  fin.position.set(0, 0.6, -2.2);
  ship.add(fin);

  // Soft engine light that travels with the ship.
  const light = new THREE.PointLight(0x19d3ff, 8, 14, 2);
  light.position.set(0, 0, -2.6);
  ship.add(light);

  ship.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return ship;
}
