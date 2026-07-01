#!/usr/bin/env python3
"""
Past-event attendance generator. Emits three data files:

  data/past_programs.json      type=programs      -> load first (creates the programs+sessions)
  data/enrollments.json        type=enrollments   -> enrolls the rosters
  data/attendance_visits.json  type=visits        -> pseudo-accurate badge data per attendee

Each program below has a roster of enrolled attendees. For every past session,
each attendee gets a manual visit timed to that session (arrive a bit before,
leave a bit after) with realistic jitter: some no-shows, some late arrivals /
early departures. Visits are grouped byPersona so the loader records each under
its own session (manual attendance is self-only).

Association to events is NOT set here (the loader posts plain manual visits);
enrollment is done separately via /api/programs/[id]/participants.

Run:  python3 gen_attendance.py
"""
import json
import os
import random
from datetime import date, datetime, timedelta

import gen_programs as gp

random.seed(11)
Y = 2026
TODAY = date(Y, 7, 1)

MON, TUE, WED, THU, FRI, SAT = gp.MON, gp.TUE, gp.WED, gp.THU, gp.FRI, gp.SAT

# Past programs (all before TODAY). Tuple matches gp.program_entry args, plus a
# trailing roster of enrolled-attendee emails (baseline seed personas).
# (title, mentor, plan, startTime, endTime, minAge, maxAge, memberPrice, nonMemberPrice, roster)
PAST = [
    ("Spring Woodworking", "Board Member", gp.weekly(date(Y, 4, 7), [TUE], 8),
     "16:00", "18:00", 13, 18, "25.00", "40.00",
     ["child.family@example.com", "parent.family@example.com", "certified.adult@example.com"]),
    ("April Robotics", "Keyholder One", gp.weekly(date(Y, 4, 6), [MON, WED], 6),
     "16:00", "18:00", 11, 17, None, None,
     ["child.family@example.com", "parent2.family@example.com", "keyholder2@example.com"]),
    ("May Electronics", "Certified Adult", gp.weekly(date(Y, 5, 5), [TUE], 5),
     "17:00", "19:00", 12, 18, None, None,
     ["child.family@example.com", "tool.certifier@example.com", "bg.reviewer@example.com"]),
    ("June Ceramics", "Tool Certifier", gp.weekly(date(Y, 6, 4), [THU], 4),
     "18:00", "20:00", 12, 18, "28.00", "42.00",
     ["parent.family2@example.com", "parent.family@example.com"]),
]

NO_SHOW_RATE = 0.12  # skip a session entirely
LATE_RATE = 0.25     # arrive after start
EARLY_RATE = 0.20    # leave before end


def _hm(t):
    h, m = t.split(":")
    return int(h), int(m)


def session_windows(plan, st, et):
    """Yield (start_dt, end_dt) for each PAST session of a plan."""
    sh, sm = _hm(st)
    eh, em = _hm(et)
    for d in plan["dates"]:
        if d >= TODAY:
            continue  # only past events
        start = datetime(d.year, d.month, d.day, sh, sm)
        end = datetime(d.year, d.month, d.day, eh, em)
        yield start, end


def make_visit(start, end):
    """One badge visit around a session, or None for a no-show."""
    if random.random() < NO_SHOW_RATE:
        return None
    arr = start - timedelta(minutes=random.randint(3, 12))          # usually early
    if random.random() < LATE_RATE:
        arr = start + timedelta(minutes=random.randint(5, 30))      # tardy
    dep = end + timedelta(minutes=random.randint(0, 12))            # linger a bit
    if random.random() < EARLY_RATE:
        dep = end - timedelta(minutes=random.randint(5, 25))        # slip out early
    if dep <= arr:                                                  # degenerate -> min stay
        dep = arr + timedelta(minutes=30)
    return {"arrivedAt": arr.isoformat(timespec="seconds"),
            "departedAt": dep.isoformat(timespec="seconds")}


def build():
    programs = [gp.program_entry(*spec[:9]) for spec in PAST]      # first 9 args
    enrollments = [{"programName": spec[0], "attendees": spec[9]} for spec in PAST]

    per_person = {}  # email -> [visits]
    for spec in PAST:
        st, et, roster = spec[3], spec[4], spec[9]
        windows = list(session_windows(spec[2], st, et))
        for email in roster:
            for start, end in windows:
                v = make_visit(start, end)
                if v:
                    per_person.setdefault(email, []).append(v)

    for visits in per_person.values():
        visits.sort(key=lambda v: v["arrivedAt"])

    by_persona = [{"personaEmail": e, "visits": v} for e, v in per_person.items()]
    return (
        {"type": "programs", "programs": programs},
        {"type": "enrollments", "enrollments": enrollments},
        {"type": "visits", "byPersona": by_persona},
    )


def check(progs, enrolls, visits):
    for p in progs["programs"]:
        assert p["program"]["phase"] == "FINISHED", "past program should be FINISHED"
    total = sum(len(g["visits"]) for g in visits["byPersona"])
    for g in visits["byPersona"]:
        for v in g["visits"]:
            a = datetime.fromisoformat(v["arrivedAt"])
            d = datetime.fromisoformat(v["departedAt"])
            assert d > a and a.date() < TODAY, f"bad visit {v}"
    print(f"check ok: {len(progs['programs'])} past programs, "
          f"{sum(len(e['attendees']) for e in enrolls['enrollments'])} enrollments, "
          f"{total} attendance visits across {len(visits['byPersona'])} people")


def _write(doc, name):
    out = os.path.join(os.path.dirname(__file__), "data", name)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print("wrote", out)


if __name__ == "__main__":
    progs, enrolls, visits = build()
    check(progs, enrolls, visits)
    _write(progs, "past_programs.json")
    _write(enrolls, "enrollments.json")
    _write(visits, "attendance_visits.json")
