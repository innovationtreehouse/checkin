/**
 * Build the single shared Prisma runtime Lambda layer.
 *
 *     node scripts/build-prisma-layer.mjs
 *
 * Produces  layers/prisma-runtime/prisma-runtime-layer.zip  with the layout AWS
 * expects for a Node layer:  nodejs/node_modules/...  -> mounted at /opt/nodejs.
 *
 * The layer is pure JS + WASM (Prisma 7 driver-adapter mode is Rust-free), so there
 * is no native binary and no per-architecture build — the same zip works on x86_64
 * and arm64. We still strip the bundled CLI/engine cruft that the *runtime* never
 * needs, to keep the layer small.
 */
import { execFileSync } from "node:child_process";
import { rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const layerDir = resolve(root, "layers/prisma-runtime");
const nodejsDir = resolve(layerDir, "nodejs");
const zipPath = resolve(layerDir, "prisma-runtime-layer.zip");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...opts });

console.log("→ installing layer dependencies (production only)…");
rmSync(resolve(nodejsDir, "node_modules"), { recursive: true, force: true });
rmSync(zipPath, { force: true });
run("npm", ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund"], {
  cwd: nodejsDir,
});

// Trim files the Lambda runtime never loads (keeps the layer lean; safe to skip if
// any of these dirs are absent for a given Prisma version).
const PRUNE = [
  "node_modules/prisma", // the CLI is a build-time tool, not a runtime dep
  "node_modules/@prisma/engines", // legacy Rust engines — unused in driver-adapter mode
  "node_modules/@prisma/engines-version",
];
for (const rel of PRUNE) {
  const p = resolve(nodejsDir, rel);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`  pruned ${rel}`);
  }
}

// Prisma 7 ships a WASM query compiler PER database provider (~56 MB of the layer).
// Both our schemas (s-ingest-core, monitoring-db) are postgresql-only and the generated
// clients import only query_compiler_*.postgresql.*, so the other providers are dead
// weight. Drop them. (If a schema ever targets another provider, add it here.)
const KEEP_PROVIDERS = ["postgresql"];
const runtimeDir = resolve(nodejsDir, "node_modules/@prisma/client/runtime");
if (existsSync(runtimeDir)) {
  const providerFile = /^query_compiler_[a-z]+_bg\.([a-z0-9]+)\./;
  let freed = 0;
  for (const f of readdirSync(runtimeDir)) {
    const m = providerFile.exec(f);
    if (m && !KEEP_PROVIDERS.includes(m[1])) {
      const fp = resolve(runtimeDir, f);
      freed += statSync(fp).size;
      rmSync(fp, { force: true });
    }
  }
  if (freed) console.log(`  pruned non-{${KEEP_PROVIDERS.join(",")}} query compilers (~${(freed / 1024 / 1024).toFixed(0)} MB)`);
}

console.log("→ zipping layer…");
run("zip", ["-q", "-r", zipPath, "nodejs", "-x", "*.DS_Store"], { cwd: layerDir });

const sizeMB = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ built ${zipPath} (${sizeMB} MB)`);
console.log("  layout: nodejs/node_modules/... → mounted at /opt/nodejs/node_modules");
