#!/usr/bin/env python3
"""
Generate data/visits_history.json: ~3 months of facility visits for the baseline
dev personas (seed-helpers.ts). Grouped by persona because /api/attendance/manual
records only for the logged-in user; the loader re-logs-in per group.

Run:  python3 gen_visits.py   ->  writes data/visits_history.json
"""
import json
import os
import random
from datetime import date, datetime, timedelta

random.seed(42)  # reproducible

# (email, avg visits/week) — baseline personas from seed-helpers.ts.
PERSONAS = [
    ("boardmember@example.com", 3),
    ("parent.family@example.com", 2),
    ("parent2.family@example.com", 2),
    ("child.family@example.com", 2),
    ("parent.family2@example.com", 1),
    ("keyholder1@example.com", 4),
    ("keyholder2@example.com", 3),
    ("certified.adult@example.com", 2),
    ("tool.certifier@example.com", 2),
    ("bg.reviewer@example.com", 1),
]

END = date(2026, 7, 1)            # today (exclusive)
START = END - timedelta(days=91)  # ~3 months back


def week_starts():
    d = START - timedelta(days=START.weekday())  # Monday on/before START
    while d < END:
        yield d
        d += timedelta(days=7)


def visits_for(per_week):
    out = []
    for wk in week_starts():
        n = max(0, round(random.gauss(per_week, 1)))
        for dow in random.sample(range(7), min(n, 7)):
            day = wk + timedelta(days=dow)
            if not (START <= day < END):
                continue
            arr_h = random.randint(8, 17)
            arr_m = random.choice([0, 15, 30, 45])
            dur_min = random.randint(60, 240)
            arr = datetime(day.year, day.month, day.day, arr_h, arr_m)
            dep = arr + timedelta(minutes=dur_min)
            out.append({"arrivedAt": arr.isoformat(timespec="seconds"),
                        "departedAt": dep.isoformat(timespec="seconds")})
    out.sort(key=lambda v: v["arrivedAt"])
    return out


def build():
    groups = []
    for email, rate in PERSONAS:
        groups.append({"personaEmail": email, "visits": visits_for(rate)})
    return {"type": "visits", "byPersona": groups}


def check(doc):
    for g in doc["byPersona"]:
        assert g["visits"], f'{g["personaEmail"]}: no visits'
        for v in g["visits"]:
            a = datetime.fromisoformat(v["arrivedAt"])
            d = datetime.fromisoformat(v["departedAt"])
            assert d > a, f"departed !> arrived: {v}"
            assert START <= a.date() < END, f"out of window: {v}"
    total = sum(len(g["visits"]) for g in doc["byPersona"])
    print("check ok:", ", ".join(f'{g["personaEmail"].split("@")[0]}={len(g["visits"])}'
                                  for g in doc["byPersona"]), f"| total {total}")


if __name__ == "__main__":
    doc = build()
    check(doc)
    out = os.path.join(os.path.dirname(__file__), "data", "visits_history.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print("wrote", out)
