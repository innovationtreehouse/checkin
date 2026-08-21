# Attendance and check-in

Opening and closing a facility, supervision, the kiosk, and the visit record.

---

## Policy

### Two deep

- **Two deep means two non-student adult volunteers who are unrelated and do not
  share a household.** Adult presence alone does not satisfy it. — *Definitions
  Policy, Art. III, "Two Deep"*

- Any event or location must meet the two-deep principle. — *Event, Location and
  Keyholder Policy, Art. III*

- A facility must be two deep **and** have a keyholder to be open and
  operational. — *Event, Location and Keyholder Policy, Art. VI*

- A group containing a student that is out of sight and earshot of another group
  must be a tripod, and must be observable and interruptible. Behind a locked
  door it must be two deep. Where someone is both a student and a volunteer, the
  more appropriate role governs. — *Event, Location and Keyholder Policy,
  Art. III*

- A tripod is three members, each at least 9 years old, in a place that is
  observable and interruptible. A closed, locked door does not qualify.
  — *Definitions Policy, Art. III, "Tripod"*

### Keyholders

- Keyholders are volunteers, appointed in writing by the board, and the board may
  revoke the status at any time in writing. — *Event, Location and Keyholder
  Policy, Art. VII*

- Nobody opens or closes a facility without being an active keyholder, so nobody
  else can be in it while no keyholder is present. — *Event, Location and
  Keyholder Policy, Arts. VI–VII*

- There is one primary keyholder for a facility at a time. A primary keyholder
  leaving must either transfer the role, with the other keyholder's consent, or
  close the facility — they cannot simply leave while the building is occupied.
  — *Event, Location and Keyholder Policy, Art. VIII, §VIII.3*

- The primary keyholder present at closing is responsible for securing the
  facility, and must ensure appropriate adult and youth presence while closing —
  **two adults on site with a last youth.** — *Event, Location and Keyholder
  Policy, §§VIII.4*

---

## Assumptions

Things the app takes as true because they are handled outside it.

- A keyholder was appointed in writing by the board, and the board revokes that
  status in writing when it ends. The keyholder flag is what represents the
  appointment.

- The tripod rule is kept in the room — its composition, the
  observable-and-interruptible condition, and whether a student group is within
  range of another are judged by the people present, not tracked here. Nothing
  here controls the shop doors or the tools, so a record of tripod state would
  drive no action; it is left out because it would buy nothing, not because it
  was overlooked.

- Check-in happens at the one facility. Other locations exist and are temporary,
  and checking in at them is out of scope.

---

## Procedure

### Opening and closing

- Closing takes a second deliberate badge within a few seconds, which checks
  everyone out. A single stray badge does neither.  [Decision]

### Supervision

- The two-deep check counts supervising adults, not adults present. A supervising
  adult is an adult whose background clearance is still valid and who is not
  themselves a participant on a program running at that moment. Two people of one
  household count as one, so a couple is not two deep.  [Decision — *Policy: Definitions Policy, Art. III, "Two Deep"*]

- Being a participant on a program in session is what disqualifies someone from
  supervising it, not being at school: a member of eighteen or nineteen enrolled
  in a program does not count while that program runs, and counts again as a
  volunteer on another. School enrollment is not recorded at all, so the part of
  policy that turns on it cannot be tested here.  [Short of policy — *Policy: Definitions Policy, Art. III, "Two Deep"*]

- A clearance that is not recorded is not a clearance: someone with no background
  check on file, or one older than the board's recheck interval, is not one of the
  supervising adults.  [Decision — *Principle: fail closed*]

- Someone whose age is unknown counts as a youth in the supervision check: not
  one of the supervising adults, and one of the people needing cover.  [Decision — *Principle: fail closed*]

- Two deep is shown as a warning. It does not stop anyone entering or checking
  in — surfacing the shortfall to the people in the room is the whole of what the
  app does about it. A youth arriving into a room short of supervision is warned
  about, never turned away: whether to open the door is the keyholder's call.  [Decision — deliberate limit]

- Keyholders reach every household's emergency contacts, not only those of the
  people currently in the building.  [Decision]

- Every departure that takes a supervising adult out of the building is
  interrupted, whoever is leaving. Dropping to two is a warning and nothing more.
  Dropping below two stops the departure until the person badges again within
  fifteen seconds — but only while a youth is in the building. With no youth
  there, that departure is warned about and goes through: two deep is owed
  whenever a youth is present, so an adult-only room locking up has nothing to
  confirm, and an interrupt raised where nothing is at stake teaches people to
  badge through the one that matters. The keyholder close-guard is a separate
  interrupt and both can be waiting on one person at once.  [Decision — *Policy: Event, Location and Keyholder Policy, §VIII.4*]

- The interrupt is on the badge scanner. Checking someone out from the web does
  not raise it.  [Decision — deliberate limit]

### The kiosk

- The kiosk shows only what an unattended public screen may — no dates of birth,
  phone numbers, emergency contacts or email addresses. Where a person has no
  name recorded, what shows is the part of their address before the @, never the
  address itself.  [Decision — *Policy: Records Policy, Art. IV*]

### The visit record

- A member inserts their own past visit, backdated as far as they need — there is
  no limit on how far, and the audit trail stands in for one.  [Decision]

- A member corrects or removes a visit of their own once it is in. The correction
  always applies: the only bars are validity — the times parse, departure follows
  arrival, the visit runs no longer than 24 hours, and a closed one is never
  reopened — and whose record it is. Integrity is after the fact rather than a
  gate: every change is audited, and a significant one is flagged to the board.  [Decision — *Principle: self-scope and repair*]

- An audited change to a visit records two people: who made the change, and whose
  attendance it was. The second is always the person, never the event they
  attended. Telling a correction of one's own record from one person editing
  another's is the comparison of those two, so an audit that records anything
  else as its subject makes every review of who changed whose record answer
  wrongly, and silently.  [Decision]

- A household lead corrects a recorded visit for anyone in their household —
  inserting a past one, changing its times, or removing it — on the same terms as
  correcting their own. Only the lead, not every household member: the lead is the
  responsible adult, and for someone too young to correct their own record it is
  the only way one gets fixed.  [Decision]

- There are no separately recorded hours to correct. Hours are counted from
  visits, so correcting somebody's hours is correcting the visit underneath them.  [Decision]

- Correcting a time replaces where that time came from: a badge-measured arrival
  a member edits is their own report afterwards, not a measurement. Correcting
  the same time twice is weighed the second time as overwriting a self-report.  [Decision]

- Removing a visit marks it removed rather than erasing it: it stops counting
  wherever visits are listed, counted or totalled, and it can be put back.  [Decision — *Principle: decisions are reversible*]

- Significance is the size of a change weighted by how authoritative the value it
  overwrote was. A measured badge outweighs somebody else's observation of a
  member, which outweighs the member's own earlier report. Every removal shows
  on the review screen whatever it overwrote, because erasing a record is
  notable at any size.  [Decision]

- Every correction or removal is weighed on the same terms whoever made it — the
  member, their household lead, a program's leader, the board — and stays on the
  record to be reviewed. Showing on that screen and the board being emailed at
  the time are separate: only a member's change to their own visit, or their
  household lead's on their behalf, emails the board as it happens. Marking who
  did not turn up and clearing duplicate visits are a leader's routine week, and
  on the board's own corrections the board would be telling itself.  [Decision — deliberate limit]

- A departure that the building closing or the overnight sweep stamped is a
  placeholder the member is meant to fix, so correcting one adds nothing to the
  score however large the correction. The suppression keys on where the value
  came from, not on its size: the sweep stamps at its own run time, so the least
  trustworthy guess is exactly the one producing the largest correction.  [Decision]

- A visit cannot run longer than 24 hours.  [Decision]

- The board and sysadmins edit or delete any visit, and record one for someone
  else at any past time — the walk-in nobody badged in.  [Decision]

- Operations reach attendance in aggregate only — the trends, and printing the ID
  badges. One person's record sits outside that reach: operations do not record,
  correct or remove a visit, do not read the raw badge events behind one, and do
  not review other people's corrections. Running the facility works off the shape
  of attendance, not off who was there when.  [Decision — *Principle: least privilege*]

- A visit recorded for someone else is always a closed one: it says they came and
  left. Putting someone on the list of who is in the building now follows from a
  badge at the kiosk, never from staff saying so.  [Decision — deliberate limit]

- Staff-asserted presence is not facility hours: a visit recorded for somebody
  else, or a roster mark, states the window it was asserted for rather than a
  measured stay, so the trends leave it out. A walk-in that a roster mark adopts
  keeps its badged times and still counts.  [Decision]

- Facility hours split by program enrollment, not age: anyone present and not
  enrolled counts on the volunteer side.  [Decision]

### Marking an event's roster

Distinct from a visit, which is presence at the facility and belongs to no
program. This is a record of who was at one session of one program.

- Only people enrolled in or volunteering on that program can be marked present.
  Someone else in the list is refused by name rather than dropped from it, and
  having been in the building at the time proves nothing — a walk-in who is not
  enrolled needs enrolling first.  [Decision — *Principle: identity is not authorisation*]

- Who attended is for the people running it — the program's leader, its core
  volunteers, the board and sysadmins. Anyone else is refused outright rather than
  handed a trimmed version, because the names are the part that matters and they
  survive any trimming.  [Decision — *Principle: least privilege*]

- A finished session whose roster is unmarked chases someone by email: the
  program's leader, or a core volunteer where the program has no leader. An in-app
  list of the same sessions is additive and never a replacement — it reaches the
  leader only, so a program with no leader has the email and nothing else.  [Decision]

