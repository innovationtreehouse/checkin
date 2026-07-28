import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/**
 * Shared root-or-tx client types. The prisma singleton has `$transaction`; a
 * transaction client does not (it's in the ITX deny list) — that's how
 * {@link isRootClient} tells them apart at runtime.
 */
export type TxClient = Prisma.TransactionClient;
export type DbClient = PrismaClient | TxClient;

export function isRootClient(db: DbClient): db is PrismaClient {
    return "$transaction" in db;
}

/**
 * Run `fn` under `db`: opens a new transaction if `db` is the root client, or
 * joins the caller's transaction (just calls `fn` directly) if `db` is
 * already a tx client. Lets a function be called standalone (owns its own
 * atomicity) or nested inside a caller's `$transaction` (joins it) without
 * double-wrapping.
 */
export function withTx<T>(db: DbClient, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return isRootClient(db) ? db.$transaction(fn) : fn(db);
}
