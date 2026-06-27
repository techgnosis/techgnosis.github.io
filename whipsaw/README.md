# WHIPSAW

A lean, browser-based high-speed time trial. One track, one ship. You
versus momentum.


## Play

Serve the folder over HTTP (ES modules won't load from `file://`) and open it:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

| Key | |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` | brake |
| `A` `D` / `←` `→` | steer |
| `R` | restart this track |
| `N` | new random track |
| `M` | mute |


Add `?seed=12345` to the URL to replay an exact track; drop it for a new one.

## Under the hood

Plain JavaScript and [Three.js](https://threejs.org/) from a CDN. No build step,
no bundler, no assets — the track, the ship, and every engine sound are generated
procedurally at runtime. Just `index.html` and a handful of `.js` files.
