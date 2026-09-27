/**
 * Evaluation scopes for sketches, so each deck's sketch sees its own Hydra.
 *
 * A sketch runs inside `with (scope)`, where `scope` is a Proxy that claims
 * exactly the names `synth` (a Hydra instance's synth object) and `extras`
 * own. Closures the sketch creates, like `() => time` or an `update`
 * function, keep resolving those names through the scope when they run at
 * frame time; assignments to them (`update = ...`, `speed = 2`) land on
 * `synth`. Every other name falls through to the real globals, so `ao`,
 * `Math` and globals shared between blocks behave as they always did.
 */
export function sketchScope(synth: Record<string, unknown>, extras: Record<string, unknown> = {}): object {
  const claims = (key: string | symbol): key is string =>
    typeof key === "string" && (Object.hasOwn(synth, key) || Object.hasOwn(extras, key));
  return new Proxy(Object.create(null) as object, {
    has: (_, key) => claims(key),
    // Symbol.unscopables among the symbols: nothing is hidden from `with`.
    get: (_, key) => typeof key !== "string" ? undefined : Object.hasOwn(extras, key) ? extras[key] : synth[key],
    set: (_, key, value) => {
      if (typeof key !== "string" || Object.hasOwn(extras, key)) return false;
      synth[key] = value;
      return true;
    },
  });
}

/**
 * Runs sketch code in `scope`. Each call gets its own function scope, so
 * re-running a block that declares `const` works, and top-level `await` is
 * allowed. The code keeps its own lines. Syntax errors reject, too.
 */
export async function evaluateInScope(code: string, scope: object): Promise<unknown> {
  // Sloppy mode, which `with` needs.
  return new Function("__aoScope", `with (__aoScope) return (async () => {\n${code}\n})()`)(scope);
}
