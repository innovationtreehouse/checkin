/**
 * Tiny argv flag reader shared by the CLI (extracted so it can be unit-tested in
 * isolation). Accepts both `--flag=value` and `--flag value` forms; the `=` form
 * takes precedence when both appear. Returns undefined when the flag is absent, or
 * when its space-form value is missing / looks like the next flag (starts with `--`).
 */
export function flag(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return undefined;
}
