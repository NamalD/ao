# Worktrees do not copy the ignored project-local runtime. Reuse the runtime
# from the primary checkout when this checkout is an isolated worktree.
RACKET := $(or $(wildcard .tooling/racket/bin/racket),$(wildcard ../../ao/.tooling/racket/bin/racket),racket)
BUILD := build

.PHONY: all run dev test clean worktree worktree-list worktree-remove worktree-prune

all: $(BUILD)/ao-native

$(BUILD)/ao-native: native/ao-native.c Makefile | $(BUILD)
	$(CC) -std=c11 -O2 -Wall -Wextra -o $@ $< $$(pkg-config --cflags --libs sdl3 libpipewire-0.3) -lm

$(BUILD):
	mkdir -p $(BUILD)

run: all
	$(RACKET) main.rkt

# Development mode: restart the whole app when host, plugin, native, or build
# files change. Plugin edits still reload in-process during normal `make run`.
dev:
	@command -v watchexec >/dev/null 2>&1 || (echo "make dev requires watchexec (https://github.com/watchexec/watchexec)" >&2; exit 1)
	watchexec --restart --watch main.rkt --watch ao --watch plugins --watch native --watch Makefile \
		--ignore 'ao/compiled/**' --ignore 'plugins/compiled/**' --ignore 'state/**' -- make run

test:
	$(RACKET) tests/dsl-test.rkt

clean:
	rm -rf $(BUILD)

# Create an isolated feature checkout at ../ao-worktrees/<NAME> on agent/<NAME>.
# Example: make worktree NAME=audio-smoothing
worktree:
	./scripts/agent-worktree create "$(NAME)"

worktree-list:
	./scripts/agent-worktree list

# Removes only a clean worktree. Its feature branch is retained intentionally.
# Example: make worktree-remove NAME=audio-smoothing
worktree-remove:
	./scripts/agent-worktree remove "$(NAME)"

worktree-prune:
	./scripts/agent-worktree prune
