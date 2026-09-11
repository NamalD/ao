# Ao contributor notes

Ao is a personal Linux/Wayland ambient audio visualizer. Keep the Racket host
and plugin DSL separate from the narrow C bridge in `native/`.

Commit completed, coherent work without asking for permission. At the end of
the task, merge the completed branch into `master` from the primary checkout
without waiting for approval. Do not commit generated binaries, the
project-local Racket runtime, or anything in `state/`. Run the relevant build
and test checks before each commit. Keep plugin files small, readable examples
of the public DSL.

## Concurrent-agent workflow

The primary checkout is coordination-only while agents are active. Do feature
work in an isolated Git worktree, never by sharing edits in this checkout.

```sh
make worktree-create NAME=<short-feature-name>
cd .worktrees/<short-feature-name>
```

This creates branch `agent/<short-feature-name>` from the current `HEAD`.
Use a distinct, lowercase hyphenated name for each task. Before finishing,
commit the coherent change on that branch, return to the primary checkout, and
merge it into `master`:

```sh
cd /home/namal/code/ao
git merge --no-ff agent/<short-feature-name>
```

Do not rebase, force-push, or delete another agent's branch. If the merge has
conflicts, stop and report the conflict rather than resolving another agent's
work by guesswork.

Once a branch has been merged or is no longer needed, remove its clean
checkout from the primary checkout:

```sh
make worktree-remove NAME=<short-feature-name>
make worktree-prune
```

Removal deliberately retains the branch; delete it only after confirming it
has been merged. If removal refuses because of uncommitted changes, return to
that worktree and commit or otherwise resolve them first.

Every bug fix must include a focused regression test when the failing behavior
can be tested locally. For output capture specifically, retain a test that
the `parec` command uses an absolute executable path: Racket's
`subprocess` does not search `PATH` for a bare program name.
