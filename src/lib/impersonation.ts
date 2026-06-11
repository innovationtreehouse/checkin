import { ORG_DOMAIN, type CheckinEnv } from './config';

/**
 * Impersonation = mint the session AS the persona (see DEV_INSTANCE_DESIGN.md §5).
 *
 * This module holds the pure policy that decides whether a persona-mint is allowed and what
 * provenance to stamp on the resulting session. It reads no I/O so it can be unit-tested
 * exhaustively; the next-auth provider wires it to getToken + the participant lookup.
 *
 * The cardinal rule: the minted JWT carries an INERT `impersonatedBy` claim for display/audit
 * only — no authorization path (including the middleware gate) ever reads it. So that the dev
 * middleware still passes for an impersonating org member, minted dev sessions instead carry the
 * normal org gate claims (`hd` / `email_verified`), which is what `carryGateClaims` signals.
 */
export type MintMode = 'impersonate' | 'return';

/** The caller's *current* session claims (decoded JWT), or null if not signed in. */
export interface CallerClaims {
    email?: string | null;
    hd?: string | null;
    emailVerified?: boolean;
    impersonatedBy?: string | null;
}

export type MintDecision =
    | { allowed: false }
    | {
          allowed: true;
          /**
           * 'return' → the real email to become (impersonatedBy is cleared).
           * 'impersonate' → null; the target persona is chosen by the caller (personaId).
           */
          targetEmail: string | null;
          /** Inert provenance to stamp. null = a plain, non-impersonated login. */
          impersonatedBy: string | null;
          /** Stamp org gate claims (hd/email_verified) so the dev middleware still passes. */
          carryGateClaims: boolean;
      };

export function evaluateMint(params: {
    checkinEnv: CheckinEnv;
    mode: MintMode;
    caller: CallerClaims | null;
}): MintDecision {
    const { checkinEnv, mode, caller } = params;

    // Minting can forge any session — dead in production by construction.
    if (checkinEnv === 'prod') return { allowed: false };

    const callerIsVerifiedOrg =
        !!caller && caller.hd === ORG_DOMAIN && caller.emailVerified === true;

    if (mode === 'return') {
        // Only meaningful while impersonating; go back to the real identity.
        const realEmail = caller?.impersonatedBy;
        if (!realEmail) return { allowed: false };
        return {
            allowed: true,
            targetEmail: realEmail,
            impersonatedBy: null,
            carryGateClaims: checkinEnv === 'dev',
        };
    }

    // mode === 'impersonate'
    // On the publicly-reachable cloud dev instance, only a verified org member may mint.
    // (On local there is no Google identity, so this is relaxed — any session, or none, may mint.)
    if (checkinEnv === 'dev' && !callerIsVerifiedOrg) return { allowed: false };

    // The real identity behind the impersonation: preserve the original if the caller is already
    // impersonating (so nested "become X then become Y" still credits the real human), else the
    // caller's own email, else null (local first-login = a plain login, not an impersonation).
    const realIdentity = caller ? caller.impersonatedBy ?? caller.email ?? null : null;

    return {
        allowed: true,
        targetEmail: null,
        impersonatedBy: realIdentity,
        carryGateClaims: checkinEnv === 'dev',
    };
}
