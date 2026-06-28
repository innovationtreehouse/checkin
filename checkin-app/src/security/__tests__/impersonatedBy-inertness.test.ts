/**
 * @jest-environment node
 */
/**
 * Cardinal rule (impersonation.ts:11): the minted JWT's `impersonatedBy` claim is INERT —
 * display/audit only. No authorization path may ever read it, or impersonation would EXCEED the
 * target persona's rights (a persona could escalate by being impersonated). evaluateMint is
 * exhaustively unit-tested; this guards the OTHER half of the rule: that the authz resolvers stay
 * blind to the claim.
 *
 * Static guard (approach 2a): scan the security-critical resolver files and assert none of them
 * so much as name `impersonatedBy`. A behavioral test (resolve scopes with/without the claim) would
 * also work, but a source scan can't be fooled by a resolver that reads the claim down a branch the
 * fixture didn't exercise — it fails the moment the identifier appears anywhere in these files.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Resolvers + auth entry points that compute a caller's rights. If `impersonatedBy` ever leaks
// into one of these, an impersonated session could be granted more than the target persona has.
const GUARDED_FILES = [
    'src/security/access-resolvers.ts',
    'src/lib/auth.ts',
    'src/security/core.ts',
];

describe('impersonatedBy inertness', () => {
    // __dirname = checkin-app/src/security/__tests__ → repo app root is three up.
    const APP_ROOT = join(__dirname, '..', '..', '..');
    it.each(GUARDED_FILES)('%s never references impersonatedBy', (relPath) => {
        const source = readFileSync(join(APP_ROOT, relPath), 'utf8');
        // Match the bare identifier; if it ever appears here, an authz path is reading the inert
        // claim — a live escalation bug.
        expect(source).not.toMatch(/impersonatedBy/);
    });
});
