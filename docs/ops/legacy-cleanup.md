# Legacy load and cleanup

States that exist because of how data arrived, not because the domain wants
them. They are expected to trend to zero. **None of this is a rule** — it is not
read while changing behaviour, and it does not belong in `docs/rules/`.

Every entry names how it is surfaced, what "done" looks like, and whether code
still has to tolerate it. **When an entry's count reaches zero, delete the entry.
When the file is empty, delete the file.**

The exit condition is the point. Without one, "temporary" becomes permanent and
this file becomes a second register nobody prunes. If an entry has sat here
through a release or two with no movement, it is not cleanup — it is a gap
wearing a cleanup label, and it should be raised as one.

> **Counts are live data.** This file cannot tell you whether any of these is
> actually shrinking. Check the surfaces named below.

---

## Households nobody has claimed

People imported with an email address who have never signed in. Some of these
will never be claimed — a family that has left, an address that was wrong — so
zero may not be the honest target.

- **Surfaced:** Membership Audit → unclaimed households, with a nav count.
- **Exit:** either claimed, or written off deliberately. Decide which before
  treating a non-zero count as failure.
- **Code must tolerate it:** yes. A person may exist with no sign-in ever.

## Payments that predate the mirror, and imported memberships

The reconciler classifies orders it cannot match against app state. Two of its
buckets are load artifacts rather than problems: orders placed before the
mirror began, and memberships imported from a spreadsheet with no order behind
them.

- **Surfaced:** Finance Ops → match audit, as their own categories.
- **Exit:** these age out as the mirror's coverage window moves past the
  cutover; imported memberships persist until those memberships lapse.
- **Code must tolerate it:** yes. An activation with no order is legitimate and
  must not be reported as a missing payment.

## The dead fee tables

`Fee` and `FeePayment` were designed as the payment store and never received a
production write. Payment truth is the store plus enrollment status.

- **Surfaced:** nowhere — it is schema, not data.
- **Exit:** references removed from the merge route, the security scope
  bindings, and the generated classifications, then the tables dropped a
  release later.
- **Code must tolerate it:** the models still exist and are still referenced.
  The removal design has merged; the deletion has not. Do not read this as
  progress — the tables are live in the schema today.
