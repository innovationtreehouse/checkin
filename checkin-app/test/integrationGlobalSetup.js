/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Integration-tier global setup (A + B).
 *
 * Runs ONCE in the main jest process, before any worker forks. It:
 *   1. migrates a fresh template database (committed migrations, once), and
 *   2. clones one database per worker from that template (file-level copy —
 *      milliseconds), so every parallel worker gets an isolated DB.
 *
 * The run id (main-process PID) namespaces every database, so two concurrent
 * jest invocations — worktrees, CI shards, or several Bash calls — never share
 * a database even though both have a "worker 1".
 *
 * No-op unless INTEGRATION_DB is set, so the unit run (`test:ci`) never touches
 * Postgres. Env vars set here are inherited by the workers when they fork.
 */
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { dirname, resolve } = require('node:path')
const { adminClient, withDb, workerDbName } = require('./integrationDb')

/** Resolve the Prisma CLI entrypoint as seen from checkin-app (handles hoisting). */
function resolvePrismaBin(cwd) {
    const requireFrom = createRequire(resolve(cwd, 'package.json'))
    const pkgJsonPath = requireFrom.resolve('prisma/package.json')
    const pkg = requireFrom('prisma/package.json')
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
    return resolve(dirname(pkgJsonPath), binRel)
}

module.exports = async function integrationGlobalSetup(globalConfig) {
    if (!process.env.INTEGRATION_DB) return

    const base = process.env.DATABASE_URL
    if (!base) {
        throw new Error(
            'INTEGRATION_DB is set but DATABASE_URL is empty. Point it at a running Postgres ' +
            '(e.g. the throwaway docker instance) before `npm run test:integration`.'
        )
    }

    const appDir = resolve(__dirname, '..')
    const runId = String(process.pid)
    const maxWorkers = Math.max(1, globalConfig.maxWorkers || 1)
    const template = `checkin_test_tmpl_${runId}`

    // Publish for the workers (inherited at fork) and for teardown (same process).
    process.env.TEST_RUN_ID = runId
    process.env.TEST_BASE_URL = base
    process.env.TEST_MAXW = String(maxWorkers)
    process.env.TEST_TEMPLATE_DB = template

    const admin = adminClient(base)
    await admin.connect()
    try {
        // Fresh template, migrated once via `migrate deploy` (not db push) so the
        // test schema is byte-for-byte what production migrations produce.
        await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`)
        await admin.query(`CREATE DATABASE "${template}"`)

        const bin = resolvePrismaBin(appDir)
        execFileSync(process.execPath, [bin, 'migrate', 'deploy'], {
            cwd: appDir,
            env: { ...process.env, DATABASE_URL: withDb(base, template) },
            stdio: 'inherit',
        })

        // One DB per worker, cloned from the template.
        for (let w = 1; w <= maxWorkers; w++) {
            const db = workerDbName(runId, w)
            await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`)
            await admin.query(`CREATE DATABASE "${db}" TEMPLATE "${template}"`)
        }
        // eslint-disable-next-line no-console
        console.log(`[integration] ${maxWorkers} worker DB(s) ready (run ${runId})`)
    } finally {
        await admin.end()
    }
}
