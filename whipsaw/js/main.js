import * as THREE from "three";
import { createShip } from "./ship.js";
import { createTrack } from "./track.js";
import { createEngineAudio } from "./audio.js";

// --- Seed: from ?seed= for replays, otherwise random each load. ------------
const params = new URLSearchParams(location.search);
const seed = params.has("seed")
  ? (parseInt(params.get("seed"), 10) >>> 0)
  : (Math.random() * 0xffffffff) >>> 0;

// --- Renderer / scene / camera ---------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = makeSkyGradient();
// Fog tinted to the horizon colour so distant track fades into the sky.
scene.fog = new THREE.Fog(0x4a6f9c, 500, 2200);

const BASE_FOV = 70;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.5, 6000);

// Lights.
scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x4a5a78, 1.6));
scene.add(new THREE.AmbientLight(0x6a7a98, 0.5));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.6);
sun.position.set(200, 400, 100);
scene.add(sun);

// Dusk gradient backdrop with a wash of nebula colour up high (lean — painted
// into a canvas texture, no skybox mesh). Subtle: mood and depth, not garish.
function makeSkyGradient() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#0d1538"); // zenith — deep indigo
  grad.addColorStop(0.45, "#243f72");
  grad.addColorStop(0.75, "#42679a");
  grad.addColorStop(1.0, "#7fb0d4"); // horizon — bright
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Starfield backdrop — follows the camera so it surrounds you the whole run.
let starMat; // set by makeStarfield, animated each frame for the twinkle
const stars = makeStarfield();
scene.add(stars);

// --- Track + ship ----------------------------------------------------------
const track = createTrack(seed);
scene.add(track.group);

const ship = createShip();
scene.add(ship);

// --- Ghost: a translucent replay of the best run on this seed --------------
let recording = [];            // samples of the live run: [timeMs, t, lateral]
let ghost = loadGhost();       // best run's samples (or null), persisted per seed
let ghostCursor = 0;           // playback cursor into `ghost`
let ghostMat;                  // shared ghost material (faded by proximity)
// Ghost presence: full and visible as a target out ahead, but it melts away as
// it closes on you — a joy to chase, never a distraction overlapping your view.
const GHOST_OPACITY = 0.3;      // opacity when comfortably far away (a target to chase)
const GHOST_OPACITY_NEAR = 0.09; // faint-but-present floor when right on top of you
const GHOST_FADE_NEAR = 7;      // at/under this distance it sits at the near floor
const GHOST_FADE_FAR = 28;      // beyond this it's at full opacity
const ghostShip = createGhostShip();
ghostShip.visible = false;
scene.add(ghostShip);

// --- Game / physics state --------------------------------------------------
const MAX_SPEED = 760;      // units / sec
const ACCEL = 520;
const BRAKE = 600;
const DRAG = 80;
const HOVER = 2.6;
const SHIP_HALF = 3.0;      // keep nose off the walls
const STEER_ATTACK = 5.0;    // how fast steering ramps toward full lock (per sec)
const STEER_RELEASE = 8.0;   // how fast it springs back to centre on release
const STEER_ACCEL = 120;     // sideways push from steering (units/sec^2) at full lock
const GRIP = 3.0;            // sideways friction (per sec); higher = more planted
const CENTRIFUGAL = 0.27;    // how hard corners fling you outward (0 = on rails)

// Camera follow vectors (declared before placeAtStart, which writes to them).
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();

const state = {
  t: 0,            // progress from start (0) to finish (1)
  speed: 0,
  steerInput: 0,   // smoothed analog steering, -1..1
  lateral: 0,      // offset from centreline, along the (banked) side vector
  latVel: 0,       // lateral velocity (units/sec across the road)
  gForce: 0,       // signed sideways gravity (centrifugal) you're fighting
  wallSide: 0,     // -1 left wall, +1 right wall, 0 not touching
  started: false,  // run timer running (starts on first throttle)
  finished: false,
  startTime: 0,
  runTime: 0,      // frozen elapsed time once finished
  times: loadTimes(), // top-3 fastest runs on this seed, ascending
};

placeAtStart();

// --- Input -----------------------------------------------------------------
const engine = createEngineAudio();
const keys = new Set();
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  engine.start();                                                // unlock audio on first gesture
  if (k === "n") { location.href = location.pathname; }          // new random track
  if (k === "r") { placeAtStart(); el("flash").style.opacity = 0; flashTimer = 0; renderTimes(); } // restart
  if (k === "m") { engine.toggleMute(); }                        // mute / unmute
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("resize", onResize);

// --- Main loop -------------------------------------------------------------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp big stalls
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function update(dt) {
  const throttle = keys.has("w") || keys.has("arrowup");
  const braking = keys.has("s") || keys.has("arrowdown");
  const steerKey = (keys.has("d") || keys.has("arrowright") ? 1 : 0)
                 - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);

  // Smooth the digital key into an analog steering value: ramp toward the
  // pressed direction, spring back to centre on release. This is what turns
  // twitchy on/off keyboard input into something you can hold a clean arc with.
  const ramp = (steerKey !== 0 ? STEER_ATTACK : STEER_RELEASE) * dt;
  state.steerInput += THREE.MathUtils.clamp(steerKey - state.steerInput, -ramp, ramp);

  // The clock starts the moment you first hit the throttle off the line.
  if (!state.started && !state.finished && throttle) {
    state.started = true;
    state.startTime = performance.now();
  }

  // Longitudinal. Thrust tapers as you approach the top (like drag building
  // up), so the last stretch to MAX is hard-won — top speed is an achievement,
  // not a default. A small floor keeps it reachable on a long enough straight.
  const frac = state.speed / MAX_SPEED;
  if (state.finished) state.speed -= (state.speed * 0.9 + DRAG) * dt; // spool the drive down past the line
  else if (throttle) state.speed += ACCEL * Math.max(0.05, 1 - frac * frac) * dt;
  else if (braking) state.speed -= BRAKE * dt;
  else state.speed -= DRAG * dt;
  state.speed = THREE.MathUtils.clamp(state.speed, 0, MAX_SPEED);

  const speedFrac = state.speed / MAX_SPEED;

  // Advance from start toward finish. Reaching the end stops the clock.
  state.t += (state.speed * dt) / track.length;
  if (state.t >= 1) {
    state.t = 1;
    if (state.started && !state.finished) finishRun();
  }

  // --- Lateral dynamics (the part that makes it feel like a vehicle) --------
  // We model an offset from the centreline with its own velocity, driven by:
  //   * steering      — a sideways push you control
  //   * centrifugal   — speed flings you to the OUTSIDE of corners
  //   * grip          — friction that damps sideways sliding so it settles
  // Grip is what kills the "vacuum": let go and the slide bleeds off instead of
  // running you into the wall. Centrifugal is what stops you auto-piloting a
  // corner — you must steer in or slow down to hold the line.
  const here = track.sampleAt(state.t);
  const ahead = track.sampleAt(state.t + 0.002);
  let dH = Math.atan2(ahead.forward.x, ahead.forward.z)
         - Math.atan2(here.forward.x, here.forward.z);
  dH = Math.atan2(Math.sin(dH), Math.cos(dH));
  const curvature = dH / (0.002 * track.length); // signed, rad per unit length

  const centrifugal = curvature * state.speed * state.speed * CENTRIFUGAL;
  state.gForce = centrifugal; // signed sideways gravity you're fighting (for audio/feel)
  const steerPush = state.steerInput * STEER_ACCEL * (0.4 + 0.6 * speedFrac);
  state.latVel += (centrifugal + steerPush) * dt;
  state.latVel -= state.latVel * GRIP * dt;      // grip damping
  state.lateral += state.latVel * dt;

  // Wall: solid stop, kill the into-wall velocity (no sticking), scrape penalty.
  const limit = track.halfWidth - SHIP_HALF;
  if (state.lateral > limit) { state.lateral = limit; if (state.latVel > 0) state.latVel *= -0.2; state.speed *= 0.97; }
  if (state.lateral < -limit) { state.lateral = -limit; if (state.latVel < 0) state.latVel *= -0.2; state.speed *= 0.97; }
  // Which wall (if any) we're riding — drives the screen-edge glow.
  // +lateral is the right (cyan) side, -lateral the left (magenta) side.
  state.wallSide = state.lateral >= limit - 0.01 ? 1 : (state.lateral <= -limit + 0.01 ? -1 : 0);

  // Glue the ship to the road surface at our resolved position.
  const fr = track.sampleAt(state.t);
  const pos = new THREE.Vector3()
    .copy(fr.pos)
    .addScaledVector(fr.side, state.lateral)
    .addScaledVector(fr.up, HOVER);
  ship.position.copy(pos);

  // Orient along actual travel (forward + sideways drift) for a natural lean,
  // plus a cosmetic roll into the turn.
  const headingDir = new THREE.Vector3()
    .copy(fr.forward).multiplyScalar(Math.max(state.speed, 40))
    .addScaledVector(fr.side, state.latVel)
    .normalize();
  const q = basisQuat(headingDir, fr.up);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -state.steerInput * 0.4));
  ship.quaternion.copy(q);

  // Slight hover bob.
  ship.position.addScaledVector(fr.up, Math.sin(performance.now() * 0.004) * 0.25);

  // Record the live run (~30 Hz) so a new best can become the next ghost.
  if (state.started && !state.finished) {
    const elapsed = performance.now() - state.startTime;
    if (recording.length === 0 || elapsed - recording[recording.length - 1][0] >= 33) {
      recording.push([elapsed, state.t, state.lateral]);
    }
  }
  updateGhost();

  updateCamera(fr, speedFrac, dt);
  stars.position.copy(camera.position); // keep the starfield centred on us
  if (starMat) starMat.uniforms.uTime.value = performance.now() / 1000; // twinkle
  // Drive the engine's lateral voice off the sideways GRAVITY you're fighting
  // (centrifugal force through fast corners), not how fast you're sliding — so
  // as the g-load whips through the bends, the sound whips with it.
  engine.update(speedFrac, THREE.MathUtils.clamp(state.gForce / 180, -1, 1));
  // Once we've crossed the line and the drive has spun down, cut the engine so a
  // forgotten tab goes silent. Idempotent + self-healing if a keypress revives it.
  if (state.finished && state.speed < 2) engine.stop();
  updateHud(speedFrac);
}

// --- Camera ----------------------------------------------------------------
const CHASE_BACK = 24;  // arc-distance behind the ship along the track
const CHASE_UP = 8.5;
function updateCamera(fr, speedFrac, dt) {
  // Anchor a fixed distance *behind* the ship on the track, so framing is
  // identical at any speed (no smoothing lag letting the ship outrun us).
  // Pull in closer and lower as you speed up — amplifies the sense of rush.
  const backDist = CHASE_BACK - speedFrac * 5;
  const backT = state.t - backDist / track.length;
  const back = track.sampleAt(backT);
  camPos
    .copy(back.pos)
    .addScaledVector(back.up, CHASE_UP - speedFrac * 2.5)
    .addScaledVector(back.side, state.lateral * 0.35);
  // Before the start line there's no track to sample, so extrapolate straight
  // back along the opening direction (keeps framing clean at launch).
  if (backT < 0) camPos.addScaledVector(back.forward, backT * track.length);
  camera.position.copy(camPos);

  camTarget.copy(ship.position).addScaledVector(fr.forward, 28).addScaledVector(fr.up, 3);
  camera.up.copy(back.up);
  camera.lookAt(camTarget);

  // FOV widens with speed for a sense of rush.
  camera.fov = BASE_FOV + speedFrac * 34;
  camera.updateProjectionMatrix();
}

// --- Helpers ---------------------------------------------------------------
function basisQuat(forward, up) {
  const z = forward.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function placeAtStart() {
  state.t = 0;
  state.lateral = 0;
  state.latVel = 0;
  state.speed = 0;
  state.steerInput = 0;
  state.started = false;
  state.finished = false;
  state.startTime = 0;
  state.runTime = 0;
  recording = [];
  ghostCursor = 0;
  ghostShip.visible = false;
  const fr = track.sampleAt(0);
  camPos.copy(fr.pos).addScaledVector(fr.forward, -26).addScaledVector(fr.up, 9);
}

function finishRun() {
  state.finished = true;
  state.runTime = performance.now() - state.startTime;

  // A new outright best becomes the ghost to chase next time. Check before we
  // fold the run into the board (which would make it the new times[0]).
  const isBest = state.times.length === 0 || state.runTime < state.times[0];

  // Fold the run into the top-3 fastest board.
  state.times.push(state.runTime);
  state.times.sort((a, b) => a - b);
  state.times = state.times.slice(0, 3);
  saveTimes(state.times);
  renderTimes(state.runTime); // highlight the run we just set

  let msg = `FINISH  ${fmt(state.runTime)}`;
  if (isBest) {
    ghost = recording.slice();
    saveGhost(ghost);
    msg = `NEW BEST  ${fmt(state.runTime)}`;
  } else {
    const rank = state.times.indexOf(state.runTime) + 1; // 0 if it didn't place
    if (rank >= 2) msg = `FINISH  ${fmt(state.runTime)}   ·   #${rank} FASTEST`;
  }
  flash(msg + "   —   R to restart");
}

// Translucent "hologram" clone of the ship for ghost playback.
function createGhostShip() {
  const g = createShip();
  ghostMat = new THREE.MeshBasicMaterial({
    color: 0x7fd4ff, transparent: true, opacity: GHOST_OPACITY, depthWrite: false,
  });
  g.traverse((o) => {
    if (o.isMesh) o.material = ghostMat;
    if (o.isLight) o.visible = false; // ghost shouldn't cast light
  });
  return g;
}

// Interpolate the ghost recording at a given elapsed time (ms). Uses a forward
// cursor since playback time only advances. Returns null before/after the run.
function sampleGhost(ms) {
  if (!ghost || ghost.length < 2) return null;
  if (ms <= ghost[0][0]) return { t: ghost[0][1], lateral: ghost[0][2], speed: 0, latVel: 0 };
  const lastSample = ghost[ghost.length - 1];
  if (ms >= lastSample[0]) return { t: lastSample[1], lateral: lastSample[2], speed: 0, latVel: 0, ended: true };
  while (ghostCursor < ghost.length - 2 && ghost[ghostCursor + 1][0] < ms) ghostCursor++;
  while (ghostCursor > 0 && ghost[ghostCursor][0] > ms) ghostCursor--;
  const A = ghost[ghostCursor], B = ghost[ghostCursor + 1];
  const span = (B[0] - A[0]) / 1000 || 1e-3;
  const a = (ms - A[0]) / (B[0] - A[0]);
  return {
    t: A[1] + (B[1] - A[1]) * a,
    lateral: A[2] + (B[2] - A[2]) * a,
    speed: ((B[1] - A[1]) * track.length) / span, // along-track units/sec
    latVel: (B[2] - A[2]) / span,
  };
}

function updateGhost() {
  if (!ghost || !state.started) { ghostShip.visible = false; return; }
  // Use real elapsed time (even after we finish) so the ghost completes its run.
  const s = sampleGhost(performance.now() - state.startTime);
  if (!s) { ghostShip.visible = false; return; }

  const fr = track.sampleAt(s.t);
  ghostShip.position
    .copy(fr.pos)
    .addScaledVector(fr.side, s.lateral)
    .addScaledVector(fr.up, HOVER);

  const headingDir = new THREE.Vector3()
    .copy(fr.forward).multiplyScalar(Math.max(s.speed, 40))
    .addScaledVector(fr.side, s.latVel)
    .normalize();
  ghostShip.quaternion.copy(basisQuat(headingDir, fr.up));

  // Go faint (but never invisible) as it nears you so it doesn't crowd your
  // view; full when it's a distant target to chase. smoothstep keeps it gentle.
  const dist = ghostShip.position.distanceTo(ship.position);
  const k = THREE.MathUtils.smoothstep(dist, GHOST_FADE_NEAR, GHOST_FADE_FAR);
  ghostMat.opacity = GHOST_OPACITY_NEAR + (GHOST_OPACITY - GHOST_OPACITY_NEAR) * k;
  ghostShip.visible = true;
}

// A gas-giant on the horizon: a softly-lit sphere with a faint tilted ring.
// fog:false so it isn't eaten by the distance haze, lit by the scene sun for a
// gentle terminator (a shadowed limb) that anchors it as a real body.
// Deep-space starfield: many stars with varied size, colour (blue/white/warm/
// violet) and brightness, each twinkling on its own phase. A small custom point
// shader keeps it cheap while giving size + per-star shimmer a flat material can't.
function makeStarfield() {
  const N = 5000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const siz = new Float32Array(N), pha = new Float32Array(N);
  const palette = [
    [0.70, 0.84, 1.00], [0.86, 0.93, 1.00], [1.00, 1.00, 1.00],
    [1.00, 0.93, 0.82], [0.88, 0.78, 1.00], // warm + violet for variety
  ];
  // A tilted "galactic plane": just over half the stars crowd into a faint band
  // — a Milky-Way streak of countless dim stars arcing right across the sky. It
  // gives the surround structure and a direction, instead of a uniform sprinkle.
  const bandNormal = new THREE.Vector3(0.34, 1.0, 0.28).normalize();
  for (let i = 0; i < N; i++) {
    const inBand = Math.random() < 0.55;
    const v = new THREE.Vector3().randomDirection();
    if (inBand) {
      // flatten the direction toward the plane so it crowds the galactic band
      const along = v.dot(bandNormal);
      v.addScaledVector(bandNormal, -along * (0.80 + Math.random() * 0.17)).normalize();
    }
    v.multiplyScalar(2000 + Math.random() * 2800);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; // full sphere — stars in every direction
    const c = palette[(Math.random() * palette.length) | 0];
    // band stars are dimmer and smaller — a hazy multitude; field stars brighter.
    const b = inBand ? 0.22 + Math.random() * 0.30 : 0.45 + Math.random() * 0.55;
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
    const hero = !inBand && Math.random() < 0.05; // a few bright stars stand out of the field
    siz[i] = hero ? 5 + Math.random() * 4 : (inBand ? 1.0 + Math.random() * 1.3 : 1.5 + Math.random() * 2.2);
    pha[i] = Math.random() * 6.283;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(pha, 1));
  starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime; varying vec3 vColor; varying float vTw;
      void main() {
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + aPhase); // per-star twinkle
        vTw = tw; vColor = aColor;
        gl_PointSize = aSize * (0.7 + 0.3 * tw);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vTw;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = dot(d, d);
        if (r > 0.25) discard;                 // round points
        gl_FragColor = vec4(vColor * vTw, smoothstep(0.25, 0.0, r));
      }`,
  });
  return new THREE.Points(geo, starMat);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// --- HUD -------------------------------------------------------------------
const el = (id) => document.getElementById(id);
el("seed").textContent = seed;
renderTimes(); // paint the fastest board from saved times (or dashes)
let flashTimer = 0;
function updateHud(speedFrac) {
  const elapsed = state.finished ? state.runTime
                : state.started ? performance.now() - state.startTime : 0;
  el("curTime").textContent = fmt(elapsed);
  el("kph").textContent = Math.round(speedFrac * 1500); // cosmetic speed units
  el("title").style.opacity = state.started ? 0 : 1; // wordmark until you launch
  el("wallL").style.opacity = state.wallSide < 0 ? 1 : 0;
  el("wallR").style.opacity = state.wallSide > 0 ? 1 : 0;
  if (flashTimer > 0) {
    flashTimer -= 16;
    if (flashTimer <= 0) el("flash").style.opacity = 0;
  }
}
function flash(text) {
  const f = el("flash");
  f.textContent = text;
  f.style.opacity = 1;
  flashTimer = 2200;
}
function fmt(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(mm).padStart(3, "0")}`;
}

// Render the top-3 fastest board; pass the just-set time to highlight its row.
function renderTimes(highlightMs) {
  let html = "";
  for (let i = 0; i < 3; i++) {
    const ms = state.times[i];
    const fresh = ms != null && ms === highlightMs ? " fresh" : "";
    const tt = ms == null ? "--:--.---" : fmt(ms);
    html += `<div class="row${fresh}"><span class="rk">${i + 1}</span><span class="tt">${tt}</span></div>`;
  }
  el("board").innerHTML = html;
}

// --- Top-3 times + ghost persistence (per seed) ----------------------------
function timesKey() { return `whipsaw_times_${seed}`; }
function loadTimes() {
  try {
    const v = JSON.parse(localStorage.getItem(timesKey()));
    if (!Array.isArray(v)) return [];
    return v.filter((n) => typeof n === "number").sort((a, b) => a - b).slice(0, 3);
  } catch { return []; }
}
function saveTimes(arr) {
  try { localStorage.setItem(timesKey(), JSON.stringify(arr)); } catch { /* quota */ }
}

function ghostKey() { return `whipsaw_ghost_${seed}`; }
function loadGhost() {
  try {
    const v = localStorage.getItem(ghostKey());
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
function saveGhost(samples) {
  try { localStorage.setItem(ghostKey(), JSON.stringify(samples)); } catch { /* quota */ }
}

// Debug handle — inspect live state from the console, e.g. `__tt.speed`.
window.__tt = state;
window.__track = track;

frame();
