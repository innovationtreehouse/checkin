/* eslint-disable @typescript-eslint/no-require-imports */
// Custom jest reporter: splits failures into "assertion" (a real expect()
// mismatch — the code under test misbehaved) vs "thrown" (the test crashed in
// setup/route before its assertions ran — renamed Prisma fields, incomplete
// mocks, FK violations). Thrown failures mean the invariant the test guards is
// now UNPROTECTED, so we reprint just those, loudly, at the end of the run.
// Does not change exit code — jest already fails on any failure.

// A message is an assertion failure if it carries jest's matcher fingerprint.
function isAssertion(msg) {
    if (!msg) return false
    return (
        msg.includes('expect(') ||
        (msg.includes('Expected') && msg.includes('Received'))
    )
}

function firstErrorLine(msg) {
    if (!msg) return '(no message)'
    const line = msg.split('\n').find((l) => l.trim().length > 0)
    return (line || '(no message)').trim()
}

class FailureClassifierReporter {
    onRunComplete(_contexts, results) {
        const thrown = []

        for (const suite of results.testResults || []) {
            const suitePath = suite.testFilePath

            // Suite-level crash (beforeAll/beforeEach/import error, no individual
            // test ran) — almost always the rot class.
            if (suite.testExecError) {
                thrown.push({
                    suitePath,
                    testName: '(suite setup / load)',
                    line: firstErrorLine(
                        suite.testExecError.message || String(suite.testExecError),
                    ),
                })
            }

            for (const t of suite.testResults || []) {
                if (t.status !== 'failed') continue
                const msgs = t.failureMessages || []
                // matcherResult present on any detail => jest matcher failure.
                const hasMatcher = (t.failureDetails || []).some(
                    (d) => d && d.matcherResult,
                )
                const looksAssertion =
                    hasMatcher || msgs.some(isAssertion)
                if (looksAssertion) continue // jest reports these well already

                thrown.push({
                    suitePath,
                    testName: [...(t.ancestorTitles || []), t.title]
                        .filter(Boolean)
                        .join(' › '),
                    line: firstErrorLine(msgs[0]),
                })
            }
        }

        if (thrown.length === 0) return

        const bar = '─'.repeat(72)
        const out = ['', bar]
        out.push(
            '⚠ Tests that FAILED BY THROWING (possible schema/mock rot, not an assertion):',
        )
        out.push(bar)
        for (const f of thrown) {
            out.push(`  ${f.suitePath}`)
            out.push(`    ${f.testName}`)
            out.push(`      ${f.line}`)
        }
        out.push(bar)
        out.push(
            `  ${thrown.length} thrown failure(s). These crashed before their assertions — the invariant they guard may be unprotected.`,
        )
        out.push(bar, '')
        // eslint-disable-next-line no-console
        console.log(out.join('\n'))
    }
}

module.exports = FailureClassifierReporter
