import { normalizeDump, compareDumps } from "../lib/schema-dump-compare";

describe("normalizeDump", () => {
    it("strips comments, SET lines, and restrict tokens", () => {
        const raw = [
            "--",
            "-- PostgreSQL database dump",
            "--",
            "\\restrict abc123",
            "SET statement_timeout = 0;",
            "SELECT pg_catalog.set_config('search_path', '', false);",
            'CREATE TABLE public."Foo" (',
            '    "id" integer NOT NULL',
            ");",
            "\\unrestrict abc123",
        ].join("\n");
        expect(normalizeDump(raw)).toEqual([");", 'CREATE TABLE public."Foo" (', '"id" integer NOT NULL'].sort());
    });

    it("normalizes *_id_seq names so a rename-carried sequence name isn't a false diff", () => {
        const a = normalizeDump('ALTER SEQUENCE public."Participant_id_seq" OWNED BY public."Person".id;');
        const b = normalizeDump('ALTER SEQUENCE public."Person_id_seq" OWNED BY public."Person".id;');
        expect(a).toEqual(b);
    });
});

describe("compareDumps", () => {
    it("is identical when only column order differs (order-insensitive)", () => {
        const a = ['CREATE TABLE public."Foo" (', '    "id" integer NOT NULL,', '    "name" text', ");"].join("\n");
        const b = ['CREATE TABLE public."Foo" (', '    "name" text,', '    "id" integer NOT NULL', ");"].join("\n");
        expect(compareDumps(a, b).identical).toBe(true);
    });

    it("is identical when only the \\restrict token / comments differ", () => {
        const a = ["\\restrict aaa", 'CREATE TABLE public."Foo" ("id" integer);', "\\unrestrict aaa"].join("\n");
        const b = ["\\restrict zzz", 'CREATE TABLE public."Foo" ("id" integer);', "\\unrestrict zzz"].join("\n");
        expect(compareDumps(a, b).identical).toBe(true);
    });

    it("flags a genuine schema difference", () => {
        const a = ['CREATE TABLE public."Foo" (', '    "id" integer NOT NULL', ");"].join("\n");
        const b = ['CREATE TABLE public."Foo" (', '    "id" integer NOT NULL,', '    "extra" text', ");"].join("\n");
        const diff = compareDumps(a, b);
        expect(diff.identical).toBe(false);
        expect(diff.onlyInB).toContain('"extra" text');
    });
});
