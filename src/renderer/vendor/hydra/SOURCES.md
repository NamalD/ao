# Vendored Hydra extensions

These files are third-party Hydra extensions, copied byte for byte from the
pinned upstream commits below. They are not modified; keep it that way, so
each can be checked against upstream by its hash and updated by copying a
newer file over it. Ao loads them with `use(...)` in a sketch (see
`../../extensions.ts` and the README's "Hydra extensions" section).

Each file stays under its own licence, whose full text is next to it. Ao
itself is AGPL-3.0 (`LICENSE` at the top of the repository).

## Files

| File | `use` name | Upstream | Commit | Licence | Author | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `lib-noise.js` | `noise` | [extra-shaders-for-hydra](https://gitlab.com/metagrowing/extra-shaders-for-hydra/-/blob/a0a2898b2a4048ae78b671a006f1fbd64c92a9ee/lib/lib-noise.js) `lib/lib-noise.js` | `a0a2898b2a4048ae78b671a006f1fbd64c92a9ee` | AGPL-3.0 (`LICENSE.extra-shaders-for-hydra`) | Thomas Jourdan | `9da4124910ff3988747909c5aedb3f5bb733e3a925a365a3fc09c589dfc10374` |
| `lib-softpattern.js` | `softpattern` | [extra-shaders-for-hydra](https://gitlab.com/metagrowing/extra-shaders-for-hydra/-/blob/a0a2898b2a4048ae78b671a006f1fbd64c92a9ee/lib/lib-softpattern.js) `lib/lib-softpattern.js` | `a0a2898b2a4048ae78b671a006f1fbd64c92a9ee` | AGPL-3.0 (`LICENSE.extra-shaders-for-hydra`) | Thomas Jourdan | `a53546ad049d21045f843ebfc0a473227215fd711073c1dc2fd906ace0376624` |
| `hydra-fractals.js` | `fractals` | [hyper-hydra](https://github.com/geikha/hyper-hydra/blob/e48aacbe775cd6731c50cc327ed86cd7e7beab6c/hydra-fractals.js) `hydra-fractals.js` | `e48aacbe775cd6731c50cc327ed86cd7e7beab6c` | GPL-3.0 (`LICENSE.hyper-hydra`) | geikha | `88335f363d62a5ce07d17a91d491b39d67ec1dcd957139a9b28ea3f05e0a1e58` |
| `hydra-outputs.js` | `outputs` | [hyper-hydra](https://github.com/geikha/hyper-hydra/blob/e48aacbe775cd6731c50cc327ed86cd7e7beab6c/hydra-outputs.js) `hydra-outputs.js` | `e48aacbe775cd6731c50cc327ed86cd7e7beab6c` | GPL-3.0 (`LICENSE.hyper-hydra`) | geikha | `e8de8c58218d022de52d4b18977cebbf70b2bfefc3ca8284412411efae02672d` |
| `hydra-gradientmap.js` | `gradientmap` | [hyper-hydra](https://github.com/geikha/hyper-hydra/blob/e48aacbe775cd6731c50cc327ed86cd7e7beab6c/hydra-gradientmap.js) `hydra-gradientmap.js` | `e48aacbe775cd6731c50cc327ed86cd7e7beab6c` | GPL-3.0 (`LICENSE.hyper-hydra`) | geikha | `9bca1b0c3d5b78ecb7b60722ef736bc6cb62bfc933d6a1808578ec263ca841d7` |
| `hydra-arithmetics.js` | `arithmetics` | [hyper-hydra](https://github.com/geikha/hyper-hydra/blob/e48aacbe775cd6731c50cc327ed86cd7e7beab6c/hydra-arithmetics.js) `hydra-arithmetics.js` | `e48aacbe775cd6731c50cc327ed86cd7e7beab6c` | GPL-3.0 (`LICENSE.hyper-hydra`) | geikha | `8f1ed12c5a5efac2c811b0da96b795e520c4cd60ada3cc732e49c4ab5a51ad10` |

The licence texts are upstream's `LICENSE` files at the same commits:
`LICENSE.hyper-hydra` is hyper-hydra's (the GNU GPL, version 3) and
`LICENSE.extra-shaders-for-hydra` is extra-shaders-for-hydra's (the GNU
AGPL, version 3). Upstream's AGPL copy differs from gnu.org's current file
only in whitespace, the title line's indentation and the wrapping of one
line in the appendix; it is kept as upstream has it. The extra-shaders files carry their own licence and author notice in
their first lines; the hyper-hydra files carry none, and the repository's
licence applies.

Deliberately not vendored: extra-shaders-for-hydra's `register-midi.js`,
which is CC BY-NC-SA rather than a GPL-compatible licence.

## How Ao runs them (no changes to the files)

The files were written for one global Hydra: the hyper-hydra ones find it by
looking for `window.hydraSynth` (or `_hydra`, `hydra`, ...) and store it in
`window._hydra`; the extra-shaders ones call a global `setFunction`. Ao runs
two Hydra instances, one per crossfade deck, so `extensions.ts` evaluates a
file against the deck whose sketch called `use`:

- The source runs as the body of a function inside that deck's sketch scope,
  so bare `setFunction(...)` and `o0` are the deck's.
- `window`, `global`, `_hydra` and `_hydraScope` are parameters of that
  function. `window` is a stand-in whose `hydraSynth`/`_hydra` are the deck's
  Hydra and whose other reads reach the real window; writes to it (such as
  hydra-gradientmap's `window.createGradient = ...`) go on the deck's synth
  object instead, so they are per deck and visible to that deck's sketches.
- hydra-synth's classes (Output, HydraSource, GlslSource) are shared by both
  decks. Whatever a file adds to their prototypes is moved onto this deck's
  own objects and the prototypes are restored. This matters for
  hydra-outputs, which adds methods to `Output.prototype` that close over one
  deck's WebGL context.
- hydra-outputs: when a deck switches sketches, Ao calls each output's
  `resetBuffers()` so settings like `o0.setLinear()` don't carry over.
- hydra-gradientmap: each `createGradient`/`createLinearGradient` call makes
  a texture that nothing frees. Ao records them and frees them when the deck
  switches sketches.

If you update a file, check that it still only reaches Hydra through those
names, and run `npx vitest run tests/extensions.test.ts`. It checks the
hashes above and that no two extensions define the same name.
