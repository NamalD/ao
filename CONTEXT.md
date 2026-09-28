# Ao

A live-coded ambient audio visualizer. You write sketches in Hydra's chaining
style, and the sound drives what they draw.

## Language

**Sketch**:
A file of live code that produces the visuals, written entirely in chained
JavaScript calls; a sketch never contains shader code of its own.

**Pattern**:
A Hydra chain: a source followed by transforms, ending in `.out()`.
_Avoid_: shader, program

**Solid**:
A 3D shape chain (`sphere`, `box`, …) that is raymarched, lit and shaded into
a source.
_Avoid_: mesh, model

**Audio source**:
A Hydra source whose pixels are the sound itself: the spectrum, the spectrum's
recent history, or the waveform.
_Avoid_: scene, visualiser

**Scene** _(retired)_:
Formerly a hand-written GLSL fragment shader loaded into a source. No longer
part of Ao; what scenes did is now done with patterns, solids and audio
sources.

## Relationships

- A **Sketch** is made of **Patterns**, which may include **Solids** and
  **Audio sources** as their sources.
- A **Solid** and an **Audio source** both render into a Hydra source, so
  any **Pattern** can use them.

## Example dialogue

> **Dev:** "Can `ridges` still draw the spectrogram now that scenes are gone?"
> **Domain expert:** "Yes — `history()` is an audio source, so it's just the
> start of a pattern."

## Flagged ambiguities

- "spectrum" is both an **Audio source** (`spectrum()`, a flat image of the
  levels) and a **Solid** method (`.spectrum()`, pushing a surface out by the
  levels). The chain it appears in decides which.
