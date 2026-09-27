/**
 * Smooths a changing value over time, so a jump such as a new tempo fades in
 * instead of snapping. Pure apart from the clock it is given, so it can be
 * tested.
 */

/** Time constants a glide takes to settle: after four, it is within 2%. */
const SETTLE = 4;

/**
 * A function that follows `read()`, easing towards each new value so it has
 * nearly arrived (within 2%) `seconds` after a change. It steps by the real
 * time since its previous call (`now()`, in milliseconds), so it glides at
 * the same pace at any frame rate and can be called any number of times a
 * frame. `seconds <= 0` follows `read()` exactly.
 */
export function glide(read: () => number, seconds: number, now: () => number): () => number {
  let value = read();
  let last = now();
  return () => {
    const target = read();
    const time = now();
    const elapsed = Math.max(0, time - last) / 1000;
    last = time;
    if (!(seconds > 0) || !Number.isFinite(value)) value = target;
    else value += (target - value) * (1 - Math.exp((-SETTLE * elapsed) / seconds));
    return value;
  };
}
