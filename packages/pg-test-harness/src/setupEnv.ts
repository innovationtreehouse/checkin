/**
 * Worker-side bridge: take the container URL the globalSetup `provide`d and publish it to
 * `process.env[envVar]` — but only if the var is not already set.
 *
 * Why a setup file and not globalSetup itself: globalSetup runs in the main process, vitest
 * tests run in separate worker processes, and `process.env` does not cross that boundary.
 * `provide`/`inject` is the supported channel; this runs IN the worker (before any test
 * module evaluates) so the existing `describeDb`/`runIfDb` gates and `singleConnClient()`
 * helpers — which read `process.env` — see the container URL with zero per-test edits.
 *
 * The `||=` means an explicitly-exported URL (a developer pointing at their own Postgres)
 * always wins over the container, so the harness never hijacks a deliberate target.
 */
import { inject } from "vitest";

export interface SetupEnvOptions {
  envVar: string;
  provideKey: string;
}

export function applyHarnessEnv({ envVar, provideKey }: SetupEnvOptions): void {
  // `inject` is typed against a per-project ProvidedContext we don't augment; cast through.
  const url = (inject as (key: string) => unknown)(provideKey) as string | undefined;
  if (url && !process.env[envVar]) {
    process.env[envVar] = url;
  }
}
