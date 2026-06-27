// Tiny seeded PRNG so every track is reproducible from a single integer seed.
// mulberry32: fast, good enough for level generation.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience helpers built on a 0..1 generator.
export function makeRng(seed) {
  const r = mulberry32(seed);
  return {
    next: r,
    range: (lo, hi) => lo + (hi - lo) * r(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * r()),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
  };
}
