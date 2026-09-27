.PHONY: all run dev test screenshot thumbnails clean worktree worktree-create worktree-list worktree-remove worktree-prune

all: node_modules
	npm run build

# Worktrees do not share node_modules; the first build in one installs them.
node_modules: package.json package-lock.json
	npm install
	@touch node_modules

run: node_modules
	npm start

# Development mode: Vite hot-reloads the renderer and Electron restarts when
# main-process code changes. Sketches reload themselves without either.
dev: node_modules
	npm run dev

test: node_modules
	npm run typecheck
	npm test
	npm run build

# Render a sketch offscreen with synthetic audio: make screenshot SKETCH=dunes
screenshot: all
	npx electron . --sketch=$(SKETCH) --hide-editor --screenshot=state/$(SKETCH).png

# Render missing sketch thumbnails offscreen into state/thumbnails/.
# make thumbnails FORCE=1 re-renders them all; SKETCH=a,b limits the run.
thumbnails: all
	npx electron . $(if $(SKETCH),--thumbnails=$(SKETCH),--thumbnails) $(if $(FORCE),--force)

clean:
	rm -rf dist

# Create an isolated feature checkout at .worktrees/<NAME> on agent/<NAME>.
# Example: make worktree-create NAME=audio-smoothing
worktree: worktree-create

worktree-create:
	./scripts/agent-worktree create "$(NAME)"

worktree-list:
	./scripts/agent-worktree list

# Removes only a clean worktree. Its feature branch is retained intentionally.
# Example: make worktree-remove NAME=audio-smoothing
worktree-remove:
	./scripts/agent-worktree remove "$(NAME)"

worktree-prune:
	./scripts/agent-worktree prune
