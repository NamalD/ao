# Ao

Ao is a personal Linux/Wayland ambient audio visualizer. It captures the
current PipeWire output when it starts and turns its live analysis into scenes
made by small, hot-reloadable Racket plugins.

## Run

```sh
make run
```

`make` builds the narrow C bridge in `native/`. A project-local Racket runtime
is used automatically when present. Ao opens windowed and restores only the
last selected visualizer from `state/last-plugin.rktd`.

Keys: `j` previous visualizer, `k` next visualizer, `f` fullscreen, `h` show
the four-second help overlay, `r` rescan plugins, `q` or `Esc` quit.

## Plugins

Drop a `.rkt` module into `plugins/`. A plugin exports `name` and `render`.
`render` receives an `audio-frame` and returns a `scene` with high-level
primitives. See the included plugins and `ao/dsl.rkt` for the compact API.
Ao watches source timestamps, retains the last working plugin if a reload or
frame fails, and appends diagnostics to `state/ao.log`.

The rendering bridge uses SDL's GPU renderer pinned to its Vulkan driver; the
plugins never see backend concepts.
