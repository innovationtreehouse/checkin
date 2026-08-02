# Engineering conventions

How we build, as distinct from what the domain requires. Nothing here is a
statement about membership, programs, or people — those live in `docs/rules/`,
and a reviewer checking a domain change does not need this file.

A convention earns a place here the same way a rule does: a change could violate
it, and you can picture the change that does.

---

## The server decides, the client mirrors

- **Anything affecting price, access, or eligibility is computed on the server.**
  A value the client asserts about itself — a membership tier, a role, a
  discount — is an input to be re-derived, never a fact to act on.

- **Where the interface hides or disables a control, it does so on the same rule
  the server enforces.** The two are written against one source so they cannot
  drift, and the client's version is a convenience, never the gate. A control
  that is merely hidden is not protected.

The failure is a gate that exists only in the interface. It looks correct in
every screenshot and every manual test, because the button is not there — and
the endpoint behind it answers anyone who asks.

---

## We do not write addresses at domains we do not own

- **Any address the app generates uses a domain the organisation controls, or a
  reserved non-routable one.** This holds for addresses nobody will ever read —
  a tombstone on a merged record still resolves somewhere, and somewhere is
  someone else's mail server.

A domain choice is invisible in review. A plausible-looking name is registrable
by anyone, and the mistake is only visible to whoever owns it.
