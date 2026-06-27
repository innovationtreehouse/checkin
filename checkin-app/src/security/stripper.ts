/**
 * The bag stripper — the enforcement function that decides whether each field
 * reaches the response wire. Separated from handler.ts so it can be unit-
 * tested in isolation, without dragging in NextAuth / NextResponse / etc.
 *
 * Inputs:
 *   - modelName / value : the bag entry being walked (recursive)
 *   - tokens            : the view's permission tokens for the resolved role
 *   - callerCtx         : prefetched per-request caller context
 *
 * For each scalar field, visibility is decided by `fieldVisible(tier, tokens,
 * scopes)` where `scopes = scopesHeld(modelName, row, callerCtx)` — the
 * per-row predicate. Relations are recursed into; `_count` is preserved.
 *
 * IMPORTANT: This file is CODEOWNERS-gated.
 */
import { fieldVisible, type Tier, type Token } from './core';
import { classifications, relations } from './generated/classifications';
import { scopesHeld, type CallerContext } from './access-resolvers';

export function stripBag(
    bag: Record<string, unknown>,
    tokens: readonly Token[],
    callerCtx: CallerContext,
): Record<string, unknown> {
    const stripped: Record<string, unknown> = {};
    for (const [modelName, value] of Object.entries(bag)) {
        if (!(modelName in classifications)) {
            console.warn(`[security] bag key '${modelName}' is not a known model — dropping`);
            continue;
        }
        stripped[modelName] = stripValue(modelName, value, tokens, callerCtx);
    }
    return stripped;
}

export function stripValue(
    modelName: string,
    value: unknown,
    tokens: readonly Token[],
    callerCtx: CallerContext,
): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
        return value.map(item => stripValue(modelName, item, tokens, callerCtx));
    }
    if (typeof value !== 'object') return value;

    const obj = value as Record<string, unknown>;
    const tiers = classifications[modelName as keyof typeof classifications] as
        | Record<string, Tier>
        | undefined;
    if (!tiers) return null;

    const scopes = scopesHeld(modelName, obj, callerCtx);
    const rels = (relations[modelName as keyof typeof relations] ?? {}) as Record<
        string,
        { model: string; isList: boolean }
    >;

    const result: Record<string, unknown> = {};
    for (const [field, tier] of Object.entries(tiers)) {
        if (!(field in obj)) continue;
        if (fieldVisible(tier, tokens, scopes)) {
            result[field] = obj[field];
        }
    }

    if ('_count' in obj && typeof obj._count === 'object' && obj._count !== null) {
        result._count = obj._count;
    }

    for (const [relName, relInfo] of Object.entries(rels)) {
        if (!(relName in obj)) continue;
        result[relName] = stripValue(relInfo.model, obj[relName], tokens, callerCtx);
    }
    return result;
}
