# Ao

Ao is a personal Linux/Wayland ambient audio visualizer. It captures the
current PipeWire output when it starts and turns its live analysis into scenes
made by small, hot-reloadable Racket plugins.

## Run

```sh
make run
```

For development, install [`watchexec`](https://github.com/watchexec/watchexec)
and use `make dev`. It restarts Ao automatically when host, plugin, native, or
build files change:

```sh
make dev
```

`make` builds the narrow C bridge in `native/`. A project-local Racket runtime
is used automatically when present. Ao opens windowed and restores only the
last selected visualizer from `state/last-plugin.rktd`.

Keys: `j` previous visualizer, `k` next visualizer, `f` fullscreen, `i` toggle
the FPS counter, `h` show the four-second help overlay, `r` rescan plugins,
`q` or `Esc` quit.

## Parallel development

For concurrent feature work, create an isolated checkout rather than editing
the primary checkout:

```sh
make worktree NAME=short-feature-name
cd ../ao-worktrees/short-feature-name
```

Use `make worktree-list` to see active worktrees. From the primary checkout,
`make worktree-remove NAME=short-feature-name` removes a clean worktree after
handoff; it leaves the branch intact for review or merge.

## Plugins

Drop a `.rkt` module into `plugins/`. A plugin exports `name` and `render`.
`render` receives an `audio-frame` and returns a `scene` with high-level
primitives. The compact API includes filled radial-gradient circles, linear-gradient rectangles,
thick polylines, and composable `group` layers with translation, scale,
rotation, opacity, and normal/additive blending. The Vulkan-backed renderer
adds soft bloom to circles and draws polylines as smooth triangle ribbons. See
the included plugins and `ao/dsl.rkt`.
Ao watches source timestamps, retains the last working plugin if a reload or
frame fails, and appends diagnostics to `state/ao.log`.

The rendering bridge uses SDL's GPU renderer pinned to its Vulkan driver; the
plugins never see backend concepts.
