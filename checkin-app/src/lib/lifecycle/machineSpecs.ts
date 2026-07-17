/**
 * Registry of the lifecycle machines whose review artifacts are generated and
 * drift-checked. Each entry pairs a machine's exported `TRANSITIONS` with the
 * state metadata the renderers need (`allStates`, `initials`, `accepting`,
 * `origins`). Consumed by both the generator CLI (generate.ts) and the drift
 * test (artifactsDrift.test.ts), so the two can never disagree on what a machine
 * looks like.
 *
 * Adding a machine here (with its checked-in `<name>.md`) is all it takes to put
 * it under the artifact drift guard.
 */
import type { MachineSpec } from './artifacts';
import { TRANSITIONS as ENROLLMENT_TRANSITIONS } from '../programs/enrollmentState';
import {
    TRANSITIONS as MEMBERSHIP_TRANSITIONS,
    ALL_STATUSES as MEMBERSHIP_ALL_STATUSES,
    INITIAL_STATES as MEMBERSHIP_INITIAL_STATES,
} from '../membership/lifecycle';

/**
 * ProgramParticipant enrollment (PROGRAM_ENROLLMENT_STATE_MACHINE.md). `UNENROLLED`
 * is the ∅/no-row state — both an entry and the withdrawal target — so it renders
 * as mermaid `[*]`. `ACTIVE` is the one non-∅ terminal.
 */
const ENROLLMENT: MachineSpec = {
    name: 'enrollment',
    title: 'ProgramParticipant enrollment',
    transitions: ENROLLMENT_TRANSITIONS,
    allStates: [
        'UNENROLLED',
        'PENDING_UNPAID',
        'PENDING_HOLD_FAILED',
        'PENDING_HELD',
        'PENDING_HELD_DENIED',
        'ACTIVE',
    ],
    initials: ['UNENROLLED'],
    accepting: ['ACTIVE'],
    origins: ['UNENROLLED'],
};

/**
 * OrgMembershipProcess (ORG_MEMBERSHIP_STATE_MACHINE.md). `∅` is the origin
 * pseudo-state. `ACTIVE`/`ARCHIVED` are the accepting terminals; the legacy
 * `RENEWAL_PENDING_BG` (doc §4.6) is expected to show up as unreachable — the
 * report is where that dead-but-guarded status is meant to surface.
 */
const MEMBERSHIP: MachineSpec = {
    name: 'membership',
    title: 'OrgMembershipProcess',
    transitions: MEMBERSHIP_TRANSITIONS,
    allStates: MEMBERSHIP_ALL_STATUSES,
    initials: MEMBERSHIP_INITIAL_STATES,
    accepting: ['ACTIVE', 'ARCHIVED'],
    origins: ['∅'],
};

export const MACHINES: readonly MachineSpec[] = [ENROLLMENT, MEMBERSHIP];
