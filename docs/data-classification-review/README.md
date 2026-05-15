# Data Classification Review

One file per Prisma model. Use these to walk through every `/// @sensitivity:<tier>` annotation in `prisma/schema.prisma` and confirm the tier is right.

## How to review

For each field, ask: **if a route's view grants `<scope>:<tier>` for this tier, is it OK for that scope to read this field?**

Fill the **OK?** column with `✓` (tier is correct), `↑` (should be tightened — bump to a stricter tier), `↓` (should be loosened — bump to a more permissive tier), or `?` (unsure / needs discussion). Use the **Notes** column for the proposed new tier and reasoning.

When done, the changes are made by editing the `/// @sensitivity:` line in `prisma/schema.prisma` and re-running `npx prisma generate`.

## Tier legend (from [SECURITY-POLICY.md](../SECURITY-POLICY.md))

| Tier | Meaning | Examples |
|---|---|---|
| `public` | Anyone can see it | name, public roles, program prices |
| `pii` | Personally identifying | email, phone, dob, googleId |
| `personal` | Private but not identifying | home address, emergency contacts |
| `internal` | Role / audit metadata | sysadmin flag, background check date, audit rows |
| `secret` | Cryptographic — never returned | OAuth tokens, session token |

**Tightening (`↑`)** means moving toward `secret`; **loosening (`↓`)** means moving toward `public`.

## Models

People & access:
- [Participant](Participant.md)
- [Household](Household.md)
- [HouseholdLead](HouseholdLead.md)
- [Membership](Membership.md)
- [Corporation](Corporation.md)
- [CorporationLead](CorporationLead.md)
- [CorporationMember](CorporationMember.md)

Tools & certifications:
- [Tool](Tool.md)
- [ToolStatus](ToolStatus.md)

Programs:
- [Program](Program.md)
- [ProgramVolunteer](ProgramVolunteer.md)
- [ProgramParticipant](ProgramParticipant.md)
- [Fee](Fee.md)
- [FeePayment](FeePayment.md)

Events & attendance:
- [Event](Event.md)
- [RSVP](RSVP.md)
- [RawBadgeEvent](RawBadgeEvent.md)
- [Visit](Visit.md)

Auth (NextAuth):
- [Account](Account.md)
- [Session](Session.md)
- [VerificationToken](VerificationToken.md)

Operational / observability:
- [AuditLog](AuditLog.md)
- [ErrorLog](ErrorLog.md)
- [SystemMetric](SystemMetric.md)
