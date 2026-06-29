/* eslint-disable @typescript-eslint/no-require-imports */
// Shared helpers for the integration-tier per-worker database machinery (A+B).
const { Client } = require('pg')

/** Return `base` with its database name swapped for `db`. */
function withDb(base, db) {
    const u = new URL(base)
    u.pathname = `/${db}`
    return u.toString()
}

/** A client on the maintenance DB, where CREATE/DROP DATABASE is legal. */
function adminClient(base) {
    return new Client({ connectionString: withDb(base, 'postgres') })
}

/** Per-run DB name: namespaced by run id (B) AND worker id (A) so neither
 *  parallel workers nor concurrent jest invocations (worktrees, CI shards,
 *  multiple Bash calls) ever collide on the same database. */
function workerDbName(runId, workerId) {
    return `checkin_test_${runId}_${workerId}`
}

module.exports = { withDb, adminClient, workerDbName }
