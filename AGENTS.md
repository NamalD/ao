# Ao contributor notes

Ao is a personal Linux/Wayland ambient audio visualizer. Keep the Racket host
and plugin DSL separate from the narrow C bridge in `native/`.

Commit completed, coherent work without asking for permission. Do not commit
generated binaries, the project-local Racket runtime, or anything in `state/`.
Run the relevant build and test checks before each commit. Keep plugin files
small, readable examples of the public DSL.

Every bug fix must include a focused regression test when the failing behavior
can be tested locally. For output capture specifically, retain a test that
the `parec` command uses an absolute executable path: Racket's
`subprocess` does not search `PATH` for a bare program name.
