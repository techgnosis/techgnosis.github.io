// Procedurally synthesized engine sound — no audio files, all Web Audio.
// A heavy, dangerous anti-grav drive: deep sub-bass weight, a low growling
// body run through soft-clip saturation for grit (pushed harder the faster you
// go), a brooding mid partial, and a low rumble of thrust air. Stays dark even
// at speed. Browsers require a user gesture before audio plays, so call start()
// from a keypress.
export function createEngineAudio() {
  let ctx, master, loadFilter, wobble, wobbleDepth, drive, shaper, oscFilter;
  let oscSub, oscA, oscB, oscC, gainSub, gainA, gainB, gainC;
  let oscOverA, oscOverB, gainOver, overFilter;
  let ringCarrier, ringMod, ringDepth, ringGain;
  let noiseFilter, noiseGain;
  let started = false, muted = false, stopped = false;

  function build() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    // Load filter: a plain (non-resonant) lowpass across the whole engine bus,
    // sitting after the saturation where harmonics exist. Wide open when you're
    // straight, it CLOSES as g-load builds — the engine's own brightness rolls
    // off so it darkens and bogs down, like the drive is loading up against the
    // gravity. Broadband colour change, not a tone laid on top.
    loadFilter = ctx.createBiquadFilter();
    loadFilter.type = "lowpass";
    loadFilter.frequency.value = 6000; // open / transparent at rest
    loadFilter.Q.value = 0.7;          // no resonant peak, so it doesn't "ring"
    master.connect(loadFilter);

    // Tremolo "wobble": a fast amplitude pulse whose depth rises with g-load,
    // so the drive sounds like it's straining under the gravity. This reads
    // clearly even on a low, tonal engine (unlike a filter sweep, which a
    // near-sine source has no high harmonics to reveal).
    wobble = ctx.createGain(); wobble.gain.value = 1;
    loadFilter.connect(wobble).connect(ctx.destination);
    const wobbleLfo = ctx.createOscillator(); wobbleLfo.type = "sine"; wobbleLfo.frequency.value = 8;
    wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 0; // 0 straight -> swung by slide
    wobbleLfo.connect(wobbleDepth).connect(wobble.gain);
    wobbleLfo.start();

    // Soft-clip saturation = grit/growl. `drive` pushes the oscillator bus
    // harder into the curve as speed rises, so it gets meaner flat-out.
    shaper = ctx.createWaveShaper();
    shaper.curve = makeSoftClip(2.6);
    shaper.oversample = "2x";
    shaper.connect(master);

    drive = ctx.createGain(); drive.gain.value = 1;
    drive.connect(shaper);

    // Dark lowpass that opens only a little with speed — keeps it heavy.
    oscFilter = ctx.createBiquadFilter();
    oscFilter.type = "lowpass";
    oscFilter.frequency.value = 320;
    oscFilter.Q.value = 0.9;
    oscFilter.connect(drive);

    // Sub-bass weight, an octave below the body.
    oscSub = ctx.createOscillator(); oscSub.type = "sine"; oscSub.frequency.value = 23;
    gainSub = ctx.createGain(); gainSub.gain.value = 0.26;
    oscSub.connect(gainSub).connect(oscFilter);

    // Growling body: triangle + a sine detuned a few cents so they beat.
    oscA = ctx.createOscillator(); oscA.type = "triangle"; oscA.frequency.value = 46;
    gainA = ctx.createGain(); gainA.gain.value = 0.18;
    oscA.connect(gainA).connect(oscFilter);

    oscB = ctx.createOscillator(); oscB.type = "sine"; oscB.frequency.value = 46;
    oscB.detune.value = 14;
    gainB = ctx.createGain(); gainB.gain.value = 0.14;
    oscB.connect(gainB).connect(oscFilter);

    // Brooding mid partial — a low growl that swells with speed (not a whine).
    oscC = ctx.createOscillator(); oscC.type = "sine"; oscC.frequency.value = 70;
    gainC = ctx.createGain(); gainC.gain.value = 0;
    oscC.connect(gainC).connect(oscFilter);

    // REDLINE OVERDRIVE: a thick, low ROAR that only blooms in when you're
    // pinned at the very top of the speed range — the reward for holding max
    // speed. Two sawtooths detuned against each other for a fat, aggressive
    // chorus; silent until `over` opens the gate. Its own lowpass keeps it a
    // low-mid roar rather than a high scream. Through the main bus, so corners
    // still darken it.
    oscOverA = ctx.createOscillator(); oscOverA.type = "sawtooth"; oscOverA.frequency.value = 138;
    oscOverB = ctx.createOscillator(); oscOverB.type = "sawtooth"; oscOverB.frequency.value = 138; oscOverB.detune.value = -18;
    gainOver = ctx.createGain(); gainOver.gain.value = 0;
    overFilter = ctx.createBiquadFilter();
    overFilter.type = "lowpass";
    overFilter.frequency.value = 700; // roll the screaming harmonics off — keep the roar
    overFilter.Q.value = 0.7;
    oscOverA.connect(gainOver); oscOverB.connect(gainOver);
    gainOver.connect(overFilter).connect(oscFilter);

    // Magnetic shimmer: ring modulation (carrier * bipolar modulator) makes
    // inharmonic metallic sidebands — reads as an energized field, not a fan.
    // Routed straight to master so the metallic edge survives the dark filter.
    ringCarrier = ctx.createOscillator(); ringCarrier.type = "sine"; ringCarrier.frequency.value = 120;
    ringMod = ctx.createGain(); ringMod.gain.value = 0;   // swung -1..+1 by ringDepth
    ringDepth = ctx.createOscillator(); ringDepth.type = "sine"; ringDepth.frequency.value = 52;
    ringDepth.connect(ringMod.gain);
    ringCarrier.connect(ringMod);
    ringGain = ctx.createGain(); ringGain.gain.value = 0;
    ringMod.connect(ringGain).connect(master);
    ringCarrier.start(); ringDepth.start();

    // Slow, ominous warble on all oscillators.
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 3.2;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 10; // cents
    lfo.connect(lfoDepth);
    lfoDepth.connect(oscA.detune);
    lfoDepth.connect(oscB.detune);
    lfoDepth.connect(oscC.detune);
    lfoDepth.connect(oscOverA.detune);

    // A thin resonant breath of thrust — a narrow bandpass, kept quiet, so it
    // adds presence without sounding like a fan.
    const src = ctx.createBufferSource();
    src.buffer = makeNoise(ctx);
    src.loop = true;
    noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 320;
    noiseFilter.Q.value = 2.5;
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
    src.connect(noiseFilter).connect(noiseGain).connect(master);

    oscSub.start(); oscA.start(); oscB.start(); oscC.start(); lfo.start(); src.start();
    oscOverA.start(); oscOverB.start();
  }

  function start() {
    build();
    if (ctx.state === "suspended") ctx.resume();
    started = true;
    stopped = false; // a fresh gesture revives an engine cut after a finished run
  }

  // End the engine: fade to silence, then suspend the context so a finished run
  // left in a background tab doesn't idle forever. Idempotent; start() revives.
  function stop() {
    if (!ctx || stopped) return;
    stopped = true;
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.12); // smooth fade, no click
    setTimeout(() => { if (stopped && ctx.state === "running") ctx.suspend(); }, 700);
  }

  // speedFrac in 0..1. gLoad is signed sideways gravity, -1..1; we only use its
  // magnitude so left and right corners sound the same. setTargetAtTime smooths.
  function update(speedFrac, gLoad = 0) {
    if (!ctx || !started || stopped) return;
    const t = ctx.currentTime;
    const set = (param, v, tau = 0.06) => param.setTargetAtTime(v, t, tau);

    // g-load magnitude reshapes the engine instead of adding a new voice. Small
    // deadzone so idle jitter stays neutral, then a sqrt curve so even moderate
    // gravity is clearly audible — the effect ramps in fast and low.
    const lin = Math.max(0, Math.min(1, Math.abs(gLoad)) - 0.03) / 0.97;
    const mag = Math.sqrt(lin);

    // Redline reward: blooms in only over the top of the speed range (nothing
    // below ~0.9, full at max), so pinning max speed punches into a meaner,
    // screaming tier instead of just being "a little more".
    const over = smoothstep(0.9, 1.0, speedFrac);

    // Under load the drive bogs: pitch droops a touch, like a motor lugging.
    const baseF = (46 + speedFrac * 54) * (1 - mag * 0.06); // low: 46 -> 100 Hz, sags under g
    set(oscSub.frequency, baseF * 0.5);
    set(oscA.frequency, baseF);
    set(oscB.frequency, baseF);
    set(oscC.frequency, baseF * (1.5 + speedFrac * 1.0)); // low growl, swells modestly
    set(gainC.gain, 0.03 + speedFrac * 0.09 + mag * 0.12); // low growl swells (dark, not bright)
    set(drive.gain, 1 + speedFrac * 1.8 + over * 0.8);     // redline saturates a bit harder
    // Close the pre-saturation tone under load too, so the shaper generates
    // FEWER harmonics — a deeper darkening than just filtering afterwards.
    set(oscFilter.frequency, (300 + speedFrac * 1500) * (1 - mag * 0.6));

    // Low roar an octave-and-a-bit down from before — the heart of the redline
    // reward, kept fat and dark by its own lowpass rather than a high scream.
    set(oscOverA.frequency, baseF * 1.5);
    set(oscOverB.frequency, baseF * 1.5);
    set(gainOver.gain, over * 0.16);

    // Magnetic ring-mod: inharmonic carrier/modulator ratios = metallic sidebands.
    // Left at its speed level under load (boosting it would fight the darkening),
    // but at redline the metallic edge surges forward for extra aggression.
    set(ringCarrier.frequency, baseF * 2.6);
    set(ringDepth.frequency, baseF * 1.1);
    set(ringGain.gain, 0.012 + speedFrac * 0.06 + over * 0.05);

    set(noiseFilter.frequency, 260 + speedFrac * 500);
    set(noiseGain.gain, 0.008 + speedFrac * 0.022);

    // The audible core, all driven by g-load magnitude so a left and a right
    // corner sound identical: strain the drive (tremolo wobble) and push it a
    // little louder as it fights the gravity.
    set(wobbleDepth.gain, mag * 0.45, 0.05);
    set(master.gain, muted ? 0 : (0.55 + mag * 0.12), 0.08);

    // The engine darkens under load: the bus lowpass closes from wide-open down
    // toward ~600 Hz as the g-load builds, rolling its own brightness off so it
    // sounds stressed and bogged-down — the same shape whichever way you turn.
    set(loadFilter.frequency, 6000 * Math.pow(0.06, mag), 0.05); // 6000 Hz -> ~360 Hz
  }

  function toggleMute() {
    muted = !muted;
    return !muted;
  }

  return { start, update, stop, toggleMute };
}

// Smooth 0..1 ramp between edges a and b (Hermite), flat outside.
function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// tanh soft-clip curve — gentle saturation that adds growl without harsh edges.
function makeSoftClip(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x);
  }
  return curve;
}

function makeNoise(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
