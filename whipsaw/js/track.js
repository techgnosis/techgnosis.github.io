import * as THREE from "three";
import { makeRng } from "./rng.js";

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Build an open, point-to-point sprint course from a seed. Tuned for speed:
// long flowing swoops, the occasional big satisfying sweeper, and steep
// downhill sections — not tight technical corners. Returns a Group to add to
// the scene plus a `sampleAt(t)` the ship/camera use to ride the surface.
export function createTrack(seed, opts = {}) {
  const rng = makeRng(seed);

  const halfWidth = opts.halfWidth ?? 14;
  const samples = opts.samples ?? 1700;
  const wallHeight = opts.wallHeight ?? 3;

  const curve = buildPath(rng);
  const frames = buildFrames(curve, samples);

  const group = new THREE.Group();
  group.add(buildRoadMesh(frames, halfWidth));
  group.add(buildEdge(frames, halfWidth, 0x19d3ff));   // left rail
  group.add(buildEdge(frames, -halfWidth, 0xff2ea6));  // right rail
  group.add(buildWalls(frames, halfWidth, wallHeight));
  group.add(buildCentreDashes(frames));                                 // speed cue
  group.add(buildGate(frames[0], halfWidth, 0xffffff));                 // start line
  group.add(buildGate(frames[frames.length - 1], halfWidth, 0x4dff8f)); // finish line

  // Interpolated lookup at t in [0,1]. Clamped (open course, not a loop).
  function sampleAt(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    const f = t * (samples - 1);
    const i = Math.min(samples - 2, Math.floor(f));
    const a = f - i;
    const A = frames[i], B = frames[i + 1];
    return {
      pos: new THREE.Vector3().lerpVectors(A.pos, B.pos, a),
      forward: new THREE.Vector3().lerpVectors(A.forward, B.forward, a).normalize(),
      side: new THREE.Vector3().lerpVectors(A.side, B.side, a).normalize(),
      up: new THREE.Vector3().lerpVectors(A.up, B.up, a).normalize(),
      bank: A.bank + (B.bank - A.bank) * a,
    };
  }

  return { group, sampleAt, halfWidth, length: curve.getLength(), seed };
}

// --- Path construction -----------------------------------------------------
// March forward with momentum on both heading and slope, so turns flow into
// long swoops rather than jittering. Retry until the course doesn't fold over
// itself (overpasses with vertical clearance are allowed — distance is 3D).
function buildPath(rng) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const segments = rng.int(30, 42);
    const pts = [];
    const pos = new THREE.Vector3(0, 0, 0);
    let heading = rng.range(-0.3, 0.3); // mostly facing +Z
    let turnVel = 0;
    let slope = 0;
    pts.push(pos.clone());

    for (let i = 0; i < segments; i++) {
      // Calm launch and calm run-in to the finish; full freedom in the middle.
      const ease = Math.min(1, i / 3, (segments - i) / 3);

      // Heading momentum -> flowing turns, with an occasional bigger sweeper.
      const kick = rng.range(-0.32, 0.32) + (rng.next() < 0.15 ? rng.range(-0.45, 0.45) : 0);
      turnVel = THREE.MathUtils.clamp(turnVel * 0.55 + kick, -0.55, 0.55);
      heading += turnVel * ease;

      // Slope momentum -> long climbs and steep, fast descents (biased downhill).
      slope = THREE.MathUtils.clamp(slope * 0.6 + rng.range(-0.22, 0.16), -0.34, 0.26);

      const step = rng.range(320, 480);
      pos.x += Math.sin(heading) * step;
      pos.z += Math.cos(heading) * step;
      pos.y += slope * step * ease;
      pts.push(pos.clone());
    }

    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
    if (pathIsSane(curve)) return curve;
  }

  // Fallback: a gentle downhill S that always passes the sanity check.
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    pts.push(new THREE.Vector3(Math.sin(i * 0.5) * 200, i * -8, i * 380));
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

// Reject courses that pass too close to an earlier, non-adjacent part.
function pathIsSane(curve) {
  const pts = curve.getSpacedPoints(240);
  const M = pts.length;
  const minGap = 75;
  for (let i = 0; i < M; i++) {
    for (let j = i + 6; j < M; j++) {
      if (pts[i].distanceTo(pts[j]) < minGap) return false;
    }
  }
  return true;
}

// --- Frames (position + banked basis at each sample) -----------------------
function buildFrames(curve, samples) {
  const pts = [];
  for (let i = 0; i < samples; i++) pts.push(curve.getPoint(i / (samples - 1)));
  const last = samples - 1;

  // One-sided differences at the ends, central in between.
  const forward = [];
  for (let i = 0; i < samples; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(last, i + 1)];
    forward.push(new THREE.Vector3().subVectors(b, a).normalize());
  }

  // Bank into corners, proportional to heading change, then smoothed.
  const headings = forward.map((f) => Math.atan2(f.x, f.z));
  const rawBank = new Array(samples);
  for (let i = 0; i < samples; i++) {
    let d = headings[Math.min(last, i + 1)] - headings[i];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    rawBank[i] = THREE.MathUtils.clamp(-d * 14, -0.6, 0.6);
  }
  const bank = smooth(rawBank, 12);

  const frames = [];
  for (let i = 0; i < samples; i++) {
    const fwd = forward[i];
    const flatSide = new THREE.Vector3().crossVectors(fwd, WORLD_UP).normalize();
    const side = flatSide.clone().applyAxisAngle(fwd, bank[i]);
    const up = new THREE.Vector3().crossVectors(side, fwd).normalize();
    frames.push({ pos: pts[i], forward: fwd, side, up, bank: bank[i] });
  }
  return frames;
}

function smooth(arr, radius) {
  const n = arr.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= n) continue;
      s += arr[idx]; c++;
    }
    out[i] = s / c;
  }
  return out;
}

// --- Mesh builders (open ribbon — no wrap) ---------------------------------
function buildRoadMesh(frames, halfWidth) {
  const n = frames.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);

  for (let i = 0; i < n; i++) {
    const fr = frames[i];
    const L = new THREE.Vector3().copy(fr.pos).addScaledVector(fr.side, halfWidth);
    const R = new THREE.Vector3().copy(fr.pos).addScaledVector(fr.side, -halfWidth);
    const o = i * 6;
    positions[o] = L.x; positions[o + 1] = L.y; positions[o + 2] = L.z;
    positions[o + 3] = R.x; positions[o + 4] = R.y; positions[o + 5] = R.z;
    normals[o] = fr.up.x; normals[o + 1] = fr.up.y; normals[o + 2] = fr.up.z;
    normals[o + 3] = fr.up.x; normals[o + 4] = fr.up.y; normals[o + 5] = fr.up.z;
    uvs[i * 4] = 0; uvs[i * 4 + 1] = i;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = i;
  }

  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x8492bc, emissive: 0x3a4566, metalness: 0.1, roughness: 0.7,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function buildEdge(frames, offset, color) {
  const pts = [];
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i];
    pts.push(new THREE.Vector3()
      .copy(fr.pos)
      .addScaledVector(fr.side, offset)
      .addScaledVector(fr.up, 0.15));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

function buildWalls(frames, halfWidth, height) {
  const n = frames.length;
  const positions = [];
  const indices = [];
  let vi = 0;
  for (const sign of [1, -1]) {
    const start = vi;
    for (let i = 0; i < n; i++) {
      const fr = frames[i];
      const base = new THREE.Vector3().copy(fr.pos).addScaledVector(fr.side, sign * halfWidth);
      const top = new THREE.Vector3().copy(base).addScaledVector(fr.up, height);
      positions.push(base.x, base.y, base.z, top.x, top.y, top.z);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = start + i * 2, b = start + i * 2 + 1;
      const c = start + (i + 1) * 2, d = start + (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    vi += n * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0c2c3a, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

// Dashed centre line. Static geometry you blow past — at speed the dashes
// blur into a stream, which is the strongest cue that you're moving fast.
function buildCentreDashes(frames) {
  const n = frames.length;
  const w = 1.3;        // half-width of each dash
  const period = 6;     // samples between dash starts
  const dashLen = 2;    // samples each dash spans
  const positions = [];
  const indices = [];
  let v = 0;
  for (let i = 0; i + dashLen < n; i += period) {
    for (let k = 0; k <= dashLen; k++) {
      const fr = frames[i + k];
      const L = new THREE.Vector3().copy(fr.pos).addScaledVector(fr.side, w).addScaledVector(fr.up, 0.12);
      const R = new THREE.Vector3().copy(fr.pos).addScaledVector(fr.side, -w).addScaledVector(fr.up, 0.12);
      positions.push(L.x, L.y, L.z, R.x, R.y, R.z);
    }
    for (let k = 0; k < dashLen; k++) {
      const a = v + k * 2, b = v + k * 2 + 1, c = v + (k + 1) * 2, d = v + (k + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    v += (dashLen + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcdeeff, side: THREE.DoubleSide }));
}

function buildGate(fr, halfWidth, color) {
  const L = new THREE.Vector3().copy(fr.pos).addScaledVector(fr.side, halfWidth).addScaledVector(fr.up, 0.05);
  const R = new THREE.Vector3().copy(fr.pos).addScaledVector(fr.side, -halfWidth).addScaledVector(fr.up, 0.05);
  const L2 = new THREE.Vector3().copy(L).addScaledVector(fr.forward, 5);
  const R2 = new THREE.Vector3().copy(R).addScaledVector(fr.forward, 5);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([
    L.x, L.y, L.z, R.x, R.y, R.z, L2.x, L2.y, L2.z,
    R.x, R.y, R.z, R2.x, R2.y, R2.z, L2.x, L2.y, L2.z,
  ], 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}
