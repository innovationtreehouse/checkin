/* eslint-disable @typescript-eslint/no-require-imports */
// Self-check for the name/URL logic — runs in the unit tier, needs no DB.
const { withDb, workerDbName } = require('./integrationDb')

describe('integrationDb name logic', () => {
    it('swaps only the database name, keeps host/port/creds', () => {
        expect(withDb('postgres://u:p@host:5432/base', 'checkin_test_42_3'))
            .toBe('postgres://u:p@host:5432/checkin_test_42_3')
    })

    it('namespaces by run id and worker id (A+B)', () => {
        // Two workers in one run differ; same worker across two runs differ.
        expect(workerDbName('111', '1')).toBe('checkin_test_111_1')
        expect(workerDbName('111', '2')).not.toBe(workerDbName('111', '1'))
        expect(workerDbName('222', '1')).not.toBe(workerDbName('111', '1'))
    })
})
