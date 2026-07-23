/* eslint-disable @typescript-eslint/no-require-imports */
// Drops every database this run created (worker clones + template). No-op for
// the unit run. WITH (FORCE) terminates any lingering connection first.
const { adminClient, workerDbName } = require('./integrationDb')

module.exports = async function integrationGlobalTeardown() {
    if (!process.env.INTEGRATION_DB) return

    const base = process.env.TEST_BASE_URL
    const runId = process.env.TEST_RUN_ID
    if (!base || !runId) return

    const maxWorkers = Number(process.env.TEST_MAXW || 1)
    const template = process.env.TEST_TEMPLATE_DB

    const admin = adminClient(base)
    await admin.connect()
    try {
        for (let w = 1; w <= maxWorkers; w++) {
            await admin.query(`DROP DATABASE IF EXISTS "${workerDbName(runId, w)}" WITH (FORCE)`)
        }
        if (template) await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`)
    } finally {
        await admin.end()
    }
}
