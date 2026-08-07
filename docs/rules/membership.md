# Membership

Application, background-check review, activation, dues, and renewal.

---

## Policy

### What membership is

- Membership belongs to a family, not an individual: everyone gains membership
  by being part of a member family, and the fee is per family per membership
  year. — *Membership Policy, Art. III §III.1*

- A member family is one household containing no more than two adults, with all
  youth being their children or dependents. — *Definitions Policy, Art. III,
  "Member Family"*

- The membership year runs 1 September to 31 August. One boundary applies to the
  whole organisation — membership is not a per-household anniversary running
  twelve months from the day a family joined. — *Definitions Policy, Art. III,
  "Membership Year"*

- A payment for a membership year may therefore buy less than twelve months, as
  when a family joins partway through one. — *Membership Policy, Art. XI*

- A family agrees in writing to the current membership agreement, separately for
  each membership year — a prior signature never carries over. Participation is
  not open to a family that has not. — *Membership Policy, Art. III §III.1*

- Members are responsible for keeping their information current within a
  membership year, including family composition, contact details, insurance, and
  emergency contacts. — *Membership Policy, Art. III §III.1*

- Nobody who has been dismissed from membership, or whose background check comes
  back without clear recognition of the individual, may be a member.
  — *Membership Policy, Art. IX*

### Deciding a matter you have an interest in

- A conflict of interest exists whenever someone is in a position to approve or
  influence an action that could benefit or harm themselves, their family by
  kinship — spouse, parents, guardians, children, siblings, grandparents,
  grandchildren, in-laws — or even a close friend. The appearance of one counts
  as much as the fact. — *Ethics Policy, Art. III §III.2*

- Someone with a conflict in a matter refrains from participating in any decision
  on that matter. A board member abstains from the vote; any other leader stays
  out of the decision entirely. There is no exception for seniority or for
  holding a privileged role. — *Ethics Policy, Art. III §III.5*

- A conflict is disclosed to the board in writing, before the person discharges
  any duty touching the matter. — *Ethics Policy, Art. III §III.3*

- The board may void any action taken by someone who participated despite a
  conflict. — *Ethics Policy, Art. III §III.5*

- The same person does not authorise, execute, and monitor a transaction.
  — *Financial Policy, Art. III*

### Background checks

- At least one adult in each family is checked; so is any other family member 18
  or over who will be present regularly. Third-party checks are not accepted.
  — *Membership Policy, Art. VI §VI.1*

- Every volunteer 18 or older is checked. The obligation attaches to the role,
  not only to the household. — *Volunteer Policy, Art. IV*

- No entry to a location, event, or program until the check completes. A family
  mid-application may still attend as a hosted visitor. — *Membership Policy,
  Art. VI §VI.1*

- A check is valid for 29 months, after which a new one is performed at the next
  renewal. The board may check more often, or shift the timing to line up with
  membership years. — *Membership Policy, Art. VI §VI.1*

- Reports are ordered, reviewed, and processed by at least two individuals who
  are independent of one another — not related — who have signed the key
  volunteer agreement and either serve on the board or are authorised in writing
  by it. — *Membership Policy, Art. VI §VI.2*

- Two clearances therefore means two distinct people. One reviewer cannot supply
  both, so the same person may not review an application twice, and a second
  reviewer related to the first does not count either. — *Membership Policy,
  Art. VI §VI.2*

- Every reviewer has signed the key volunteer agreement. — *Membership Policy,
  Art. VI §VI.2*

- The check itself and any criminal-history detail stay between the person
  checked, the authorised reviewers, and the board. — *Membership Policy,
  Art. VI §VI.2*

- A check may result in approval, a restriction on how the person may volunteer,
  or denial. — *Membership Policy, Art. VI §VI.2*

- Where the board treats an offence as disqualifying, objective supporting
  documentation is gathered, consistent with the obligation to document a
  denial. — *Membership Policy, Art. IX*

- A disqualified applicant receives the rights summary, a letter of
  disqualification, and a copy of the results, and may appeal in writing to a
  three-person committee kept as independent as possible from the original
  reviewers. — *Membership Policy, Art. VI §§VI.3–VI.4*

### Dues, refunds, and plans

- The board sets the cost of all memberships. The fee is a fee, not a charitable
  donation. — *Membership Policy, Art. XI*

- The board may discount the fee for financial need, college students, partner
  organisations, participants solely in service programs, and volunteers with no
  youth participating in any sponsored program. — *Membership Policy, Art. XI*

- The fee is refunded if the family is denied membership. An accepted offset for
  the cost of the background check is not refunded even then. Otherwise no
  refund is provided once membership is approved, absent an extreme circumstance
  approved by the board. — *Membership Policy, Art. XII*

- A membership payment plan does not extend beyond the membership year it
  covers. Late payment under a plan can lead to dismissal from membership.
  — *Membership Policy, Art. XIII*

### Member data

- Member information is shared on a need-to-know basis and is not sold.
  — *Records Policy, Art. IV; Art. V §V.1*

- A member may ask for inaccurate information to be corrected. — *Records
  Policy, Art. V §V.3*

- A member may ask for personal information to be deleted, except where it is
  legally required, needed for member safety, or a condition of the membership
  or program participation they wish to keep. — *Records Policy, Art. V §V.4*

---

## Assumptions

Things the app takes as true because they are handled outside it. They sit
between the two tiers because the Policy rules above rest on them and the
Procedure below is built on them.

- Every board member has signed the key volunteer agreement and is a designated
  background-check reviewer. Board membership alone therefore qualifies someone
  wherever a reviewer is required — the queue, the attestation, and the sensitive
  fields that go with it.

- A non-board reviewer was authorised in writing by the board before the reviewer
  role was granted. Granting the role is what represents that authorisation, so
  the assumption holds as long as granting it stays a deliberate act.

- Payment-plan terms are agreed within the limits policy sets. The app records
  that a plan was certified, not its schedule.

- Refunds are handled outside the app, including the one owed on denial of
  membership.

- A background check is cleared within days of being performed, so dating the
  clearance rather than the check itself is immaterial against a window measured
  in months. Board and sysadmin can correct the date on the rare occasion it is
  not.

- The background-check vendor has no API. A check is started through a hosted
  consent link and its result comes back by hand. That is the arrangement, not a
  stopgap waiting to be automated.

- Declining a scholarship or payment-plan request is a conversation between two
  people. The app has no deny route and needs none.

- Adult children in a member household are handled by hand. Nothing in the app
  gates on their status.

---

## Procedure

### Application and review

- An intake note holds the application at review so reviewers read it before
  dues are settled. A household already holding a still-valid clearance goes
  straight to payment regardless.
  (`checkin-app/src/lib/membership/external.ts`)  [Decision]

- Applicants are told about the hold where they write the note, not after
  submitting.  [Decision]

- An application in background-check review is the reviewers' work, not the
  board's. Board queues count blocked applications only.  [Decision]

- A single rejection blocks the application; approvals do not outweigh it.  [Decision]

- The background-check result is never stored. The record is that reviewers saw
  it and what they judged — stricter than the policy, which permits the board to
  hold it.  [Decision — *Policy: Membership Policy, Art. VI §VI.2*]

- A clearance is dated when the second reviewer clears it, and the validity
  window runs from that date.  [Decision]

- Every background-check decision and every payment certification records a
  written reason — wider than the policy, which requires documentation only for a
  disqualifying offence.  [Decision — *Policy: Membership Policy, Art. IX*]

- An abandoned application is archived, never destroyed, and restores to the
  status it held before.  [Decision — *Principle: decisions are reversible*]

- Pre-designating a household volunteer-only sets what it owes and nothing else
  — it does not skip review or open payment. The policy grants only the
  discounting power; the limit is ours.  [Decision — *Policy: Membership Policy, Art. XI*]

### Approving your own family

- Shared household is the app's test for a conflict — a workable proxy for the
  kinship, friendship and appearance tests policy states. Passing it is not a
  finding that no conflict exists.  [Decision — deliberate limit]

- No role is exempt from the bar, however senior. A case whose only eligible
  deciders are all in the subject's household cannot be decided until the board
  finds someone who is not.  [Decision — *Policy: Ethics Policy, Art. III §III.5*]

### Activation

- Nothing advances toward payment until the agreement is signed and the
  background check is handled — either a still-valid prior clearance or fresh
  consent on file.  [Decision — *Policy: Membership Policy, Art. III §III.1; Art. VI §VI.1*]

- From there payment and review run in parallel, and membership activates on
  whichever finishes last. Neither alone activates.  [Decision]

- Granting the coming year completes the payment step on a renewal already under
  way. It stamps no other gate.  [Decision]

- A denied household holds no authority anywhere in the app.  [Decision — *Principle: identity is not authorisation*]

- Denial locks every member of the household out of sign-in. Revocation does not
  — a former member keeps app access and loses facility privileges. Because the
  lockout reaches the whole household, denial is confirmed before it executes.  [Decision — *Principle: accountability*]

- A household containing a board member cannot be denied. Removing the board role
  first is a separate act, as it is outside the app.  [Decision — deliberate limit]

- The denied landing page says only that access is denied. No reason, no contact,
  no mention of membership, no way to sign out.  [Decision — deliberate limit; *Principle: no existence oracle*]

- A household may have no membership. Facts only a membership carries are then
  absent, not zero.  [Decision — *Principle: fail closed*]

### Dues

- Dues have two rates, standard and volunteer household. The designation changes
  what a household pays and nothing about its review.  [Decision]

- A volunteer designation matches on canonical email, so address variants cannot
  change what a family owes.  [Decision]

- The board can activate a household with no payment by certifying a payment
  plan.  [Decision — *Policy: Membership Policy, Art. XIII*]

- A household that has settled its dues but is still waiting on its background
  check is a member for program pricing and for reaching members-only programs,
  and for nothing else. Mailing audiences, outreach, the store's member list,
  people search and payment-plan eligibility all continue to ask whether the
  membership is active. The narrowness is the rule: widening the shared question
  would hand every other benefit to a household that has not cleared.  [Decision]

- A background check that is later rejected does not unwind a program place
  already bought at the member price. The money is taken and the place is held;
  the board settles it with the family.  [Decision — *Principle: people decide about people*]

### Renewal

- A renewal needs a new background check unless a lead's is still valid at the
  boundary. Where the validity length is unset, no clearance counts as fresh and
  the compliance view reports nothing stale.  [Decision — *Policy: Membership Policy, Art. VI §VI.1*; *Principle: fail closed*]

- A membership stays active while its renewal is in progress.  [Decision]

- A household is never told its background check has gone stale, because nothing
  acts on staleness between renewals. It is read inside a renewal, where it
  decides whether that renewal needs a fresh one.  [Decision — *Policy: Membership Policy, Art. VI §VI.1*]

- Membership intake requires a complete mailing address. Program registration
  deliberately does not.  [Decision]

- Treehouse accounts are not program families: no self-service member add, no
  membership grant. Only the member add is enforced server-side.  [Decision]

- An intake note is readable by the household's leads and the reviewers, not by
  its other members.  [Decision — *Policy: Membership Policy, Art. VI §VI.2; Records Policy, Art. IV*]

### Compliance

- Nobody is removed for falling out of compliance. The view reports and sends
  nothing, so a violation waits until a person looks.  [Decision — deliberate limit; *Principle: people decide about people*]

### Background checks for program-attached adults

- Activating a membership opens a background-check obligation for that
  household's program-attached adults. It is surfaced for follow-up and gates
  nothing — chasing it is a conversation, not a refusal at the door.  [Decision — deliberate limit; *Policy: Volunteer Policy, Art. IV*]

- Age is judged as of the membership-year boundary, which counts as inside it.
  Turning 18 afterwards waits for the next boundary rather than firing on the
  birthday.  [Decision — deliberate limit]

- Under 18 is never checked, a minor being ineligible for one. This covers the
  young adult mentors, who volunteer without one.  [Decision — *Policy: Volunteer Policy, Art. IV*]

- No date of birth and no over-25 declaration means the age is unknown. Such a
  person is neither checked nor counted as covered; they are set aside for
  someone to resolve.  [Decision — *Principle: fail closed*]

- A check covers the adult who took it. One person's clearance never satisfies
  another's.  [Decision]

- An adult child who needs a background check needs their own sign-in, and the
  lead supplies an email address for them.  [Decision]

---

## Policy requirements not yet enforced here

- **A household that loses its only checked adult mid-year keeps its membership.**
  Removing or demoting that person leaves the household active with youth still
  enrolled, and nothing responds. Whether the answer is a block, a grace period,
  or a warning is undecided.

- **The sysadmin role decides membership matters policy reserves to the board,
  and has no policy existence at all.** The policy corpus enumerates board
  members, officers, Treehouse leaders, program leaders, tool certifiers,
  keyholders, and shop stewards. There is no sysadmin. Yet someone holding only
  that flag can override a blocked application, certify a payment plan, and
  grant a membership outright — while policy requires reviewers to be board
  members or authorised in writing by the board, and makes the remedy for a
  contested check an independent three-person appeals committee.

  Compounding it: a sysadmin who is not a board member can **grant board
  membership**, including to themselves. They cannot remove a sitting board
  member, board membership can never be revoked to zero, and every action is
  audit-logged with a required reason — so the board keeps the power to revoke
  the flag. But who sits on the board can be changed by someone the policy does
  not recognise.

  **This needs a board decision, not a code change chosen by whoever touches it
  next.** Narrowing which surfaces accept the flag, or making it easier to
  obtain, belongs to the board.
