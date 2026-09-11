RACKET := $(if $(wildcard .tooling/racket/bin/racket),.tooling/racket/bin/racket,racket)
BUILD := build

.PHONY: all run test clean

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
