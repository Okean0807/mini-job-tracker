/**
 * Argument policy of the official build runner (scripts/run-vite-build.mjs) - pure, no I/O.
 *
 * The runner is the single entry point of every deployable build. It pins the Vite config file and
 * the project root itself, so the only thing a caller may still choose is the Vite mode. Every other
 * argument (--config/-c, --root/-r, a positional root directory, any flag) is refused fail-closed,
 * because each of them can make Vite load a different config file than the one that carries the
 * profile gate. Rejected arguments are never echoed (they could carry values).
 */
const MODE_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * @param {readonly string[]} argv arguments after the script name
 * @returns {{ok: true, mode: string | null} | {ok: false, code: string}}
 */
export function parseBuildRunnerArgs(argv) {
  if (!Array.isArray(argv)) return { ok: false, code: "ARGS_INVALID" };
  let mode = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (typeof a !== "string") return { ok: false, code: "ARGS_INVALID" };
    let value;
    if (a === "--mode" || a === "-m") {
      if (i + 1 >= argv.length) return { ok: false, code: "MODE_VALUE_MISSING" };
      value = argv[(i += 1)];
    } else if (a.startsWith("--mode=")) {
      value = a.slice("--mode=".length);
    } else {
      return { ok: false, code: "ARGUMENT_NOT_ALLOWED" };
    }
    if (mode !== null) return { ok: false, code: "MODE_REPEATED" };
    if (typeof value !== "string" || !MODE_VALUE.test(value))
      return { ok: false, code: "MODE_VALUE_INVALID" };
    mode = value;
  }
  return { ok: true, mode };
}
