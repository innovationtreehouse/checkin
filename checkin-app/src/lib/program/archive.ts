import type { Prisma } from "@/generated/prisma/client";
import { apiError } from "@/lib/api-response";

/**
 * Soft-archive helpers for programs. Archiving is a board/sysadmin
 * visibility/activity decision, orthogonal to Program.phase: an archived
 * program is hidden from default lists/pickers/dashboards, frozen for new
 * activity, and skipped by crons. See docs/designs/PROGRAM_ARCHIVE.md.
 */

/**
 * Shared where-fragment: only non-archived programs. Applied to the list /
 * picker / dashboard / cron query sites so the "hide archived" filter lives in
 * ONE place and can't drift (e.g. an `{ archived: null }` typo). Works both at
 * the top level (`prisma.program.findMany({ where: NOT_ARCHIVED })`) and as a
 * nested relation filter (`where: { program: NOT_ARCHIVED }`).
 */
export const NOT_ARCHIVED: Prisma.ProgramWhereInput = { archivedAt: null };

/**
 * Guard for the seat-consuming / seat-mutating routes (enroll, payment-plan,
 * volunteer signup). Returns a 409 (state conflict — NOT an over-ridable soft
 * limit) when the program is archived, else null. Call it BEFORE any Shopify
 * inventory hold/decrement so a blocked action can never leak inventory.
 */
export function programArchivedError(program: { archivedAt: Date | null }) {
    return program.archivedAt
        ? apiError("This program is archived and is not accepting new activity.", 409)
        : null;
}
