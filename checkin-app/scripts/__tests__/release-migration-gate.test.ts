/**
 * Scratch-repo tests for scripts/release-migration-gate.sh — the job that
 * gates every prod release. Each case builds a real git repo in a temp dir,
 * shapes its migration history, and asserts the gate's exit code + message.
 */
import { execFileSync, execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const GATE = path.resolve(__dirname, "..", "release-migration-gate.sh");
const MIG = "checkin-app/prisma/migrations";

let repo: string;

function git(args: string): void {
    execSync(`git ${args}`, { cwd: repo, stdio: "pipe" });
}

function addMigration(name: string): void {
    mkdirSync(path.join(repo, MIG, name), { recursive: true });
    writeFileSync(path.join(repo, MIG, name, "migration.sql"), `-- ${name}\n`);
    git("add -A");
    git(`commit -q -m "migration: ${name}"`);
}

function coalesce(baseline: string, sweep: string[]): void {
    for (const d of sweep) rmSync(path.join(repo, MIG, d), { recursive: true });
    mkdirSync(path.join(repo, MIG, baseline), { recursive: true });
    writeFileSync(path.join(repo, MIG, baseline, "migration.sql"), "-- baseline\n");
    writeFileSync(path.join(repo, MIG, baseline, "reconcile.sql"), "-- reconcile\n");
    git("add -A");
    git(`commit -q -m "coalesce -> ${baseline}"`);
}

/** Run the gate at a tag; returns { code, out }. */
function gate(tag: string): { code: number; out: string } {
    git(`checkout -q ${tag}`);
    try {
        const out = execFileSync("bash", [GATE, tag], { cwd: repo, encoding: "utf8" });
        return { code: 0, out };
    } catch (e) {
        const err = e as { status: number; stdout: Buffer };
        return { code: err.status, out: String(err.stdout) };
    } finally {
        git("checkout -q main");
    }
}

beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "gate-test-"));
    execSync("git init -q -b main", { cwd: repo });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: repo });
    execSync("git config user.email t@t && git config user.name t", { cwd: repo });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

it("first release: nothing to gate against, passes", () => {
    addMigration("0001_a");
    git("tag v1.0.0");
    const r = gate("v1.0.0");
    expect(r.code).toBe(0);
    expect(r.out).toContain("First v* release");
});

it("one new migration between tags: passes", () => {
    addMigration("0001_a");
    git("tag v1.0.0");
    addMigration("0002_b");
    git("tag v1.1.0");
    const r = gate("v1.1.0");
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");
});

it("RULE 1: two new migrations between tags: blocked", () => {
    addMigration("0001_a");
    git("tag v1.0.0");
    addMigration("0002_b");
    addMigration("0003_c");
    git("tag v1.1.0");
    const r = gate("v1.1.0");
    expect(r.code).toBe(1);
    expect(r.out).toContain("at most ONE");
});

it("coalesce sweeping only RELEASED migrations: passes (rules 1 and 2)", () => {
    addMigration("0001_a");
    addMigration("0002_b");
    git("tag v1.0.0");
    coalesce("0003_baseline", ["0001_a", "0002_b"]);
    git("tag v1.1.0");
    const r = gate("v1.1.0");
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");
});

it("RULE 2: coalesce (reconcile-bearing) sweeping an UNRELEASED migration: blocked", () => {
    addMigration("0001_a");
    git("tag v1.0.0");
    addMigration("0002_b"); // merged after the release...
    coalesce("0003_baseline", ["0001_a", "0002_b"]); // ...then swept before the next
    git("tag v1.1.0");
    const r = gate("v1.1.0");
    expect(r.code).toBe(1);
    expect(r.out).toContain("reconcile.sql");
    expect(r.out).toContain("0002_b");
});

// ── Dev freedom between tags: the contract is at-tag equivalence only. ──────

it("a plain REVERT of an unreleased migration (no reconcile) is dev's business: passes", () => {
    addMigration("0001_a");
    git("tag v1.0.0");
    addMigration("0002_b");
    rmSync(path.join(repo, MIG, "0002_b"), { recursive: true });
    git("add -A");
    git('commit -q -m "revert: 0002_b was wrong"');
    addMigration("0002_b2"); // the rework that replaced it
    git("tag v1.1.0");
    const r = gate("v1.1.0");
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");
});

it("consolidating two UNRELEASED migrations into one (no reconcile.sql) passes", () => {
    addMigration("0001_a");
    git("tag v1.0.0");
    addMigration("0002_b");
    addMigration("0003_c");
    // rework: replace both with a single combined migration — NOT a coalesce
    // (no reconcile.sql), so prod just applies the one combined dir at the tag.
    for (const d of ["0002_b", "0003_c"]) rmSync(path.join(repo, MIG, d), { recursive: true });
    mkdirSync(path.join(repo, MIG, "0004_bc"), { recursive: true });
    writeFileSync(path.join(repo, MIG, "0004_bc", "migration.sql"), "-- b+c\n");
    git("add -A");
    git('commit -q -m "rework: consolidate b+c"');
    git("tag v1.1.0");
    const r = gate("v1.1.0");
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");
});

it("version-sorted tag order: v1.2.10 gates against v1.2.9, not lexically", () => {
    addMigration("0001_a");
    git("tag v1.2.9");
    addMigration("0002_b");
    git("tag v1.2.10");
    const r = gate("v1.2.10");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Gating v1.2.9..v1.2.10");
});
