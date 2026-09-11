RACKET := $(if $(wildcard .tooling/racket/bin/racket),.tooling/racket/bin/racket,racket)
BUILD := build

.PHONY: all run test clean worktree worktree-list worktree-remove worktree-prune

all: $(BUILD)/ao-native

$(BUILD)/ao-native: native/ao-native.c | $(BUILD)
	$(CC) -std=c11 -O2 -Wall -Wextra -o $@ $< $$(pkg-config --cflags --libs sdl3 libpipewire-0.3) -lm

$(BUILD):
	mkdir -p $(BUILD)

run: all
	$(RACKET) main.rkt

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
