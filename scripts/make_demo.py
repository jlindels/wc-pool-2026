#!/usr/bin/env python3
"""Generate data/matches.demo.json - a fully simulated 48-team tournament so
the dashboard scoring can be previewed (open the page with ?demo=1).

Groups here are random, NOT the real 2026 draw; real groups come from the API.
"""

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "matches.demo.json"

rng = random.Random(2026)

pool = json.loads((ROOT / "data" / "pool.json").read_text(encoding="utf-8"))
teams = [t for p in pool["players"] for t in p["teams"]]
assert len(teams) == 48, len(teams)
rng.shuffle(teams)

letters = "ABCDEFGHIJKL"
groups = {letters[i]: teams[i * 4:(i + 1) * 4] for i in range(12)}

matches = []
mid = 1000


def add(stage, home, away, group=None, allow_draw=True, day=0):
    global mid
    mid += 1
    h = rng.choice([0, 0, 1, 1, 1, 2, 2, 3])
    a = rng.choice([0, 0, 1, 1, 1, 2, 2, 3])
    m = {
        "id": mid,
        "stage": stage,
        "group": group,
        "utcDate": f"2026-06-{11 + day:02d}T18:00:00Z",
        "status": "FINISHED",
        "home": home,
        "away": away,
        "homeGoals": h,
        "awayGoals": a,
        "winner": "HOME" if h > a else "AWAY" if a > h else "DRAW",
    }
    if not allow_draw and h == a:
        m["winner"] = rng.choice(["HOME", "AWAY"])
        m["penalties"] = "4-3" if m["winner"] == "HOME" else "3-4"
    matches.append(m)
    return m


def winner_of(m):
    return m["home"] if m["winner"] == "HOME" else m["away"]


def loser_of(m):
    return m["away"] if m["winner"] == "HOME" else m["home"]


# Group stage: round robin in each group.
for g, members in groups.items():
    for i in range(4):
        for j in range(i + 1, 4):
            add("GROUP", members[i], members[j], group=g, day=rng.randrange(0, 15))

# Standings per group (pts, gd, gf).
def table(g):
    stats = {t: [0, 0, 0] for t in groups[g]}
    for m in matches:
        if m["stage"] != "GROUP" or m["group"] != g:
            continue
        h, a = m["home"], m["away"]
        hg, ag = m["homeGoals"], m["awayGoals"]
        stats[h][1] += hg - ag; stats[h][2] += hg
        stats[a][1] += ag - hg; stats[a][2] += ag
        if hg > ag: stats[h][0] += 3
        elif ag > hg: stats[a][0] += 3
        else: stats[h][0] += 1; stats[a][0] += 1
    return sorted(groups[g], key=lambda t: stats[t], reverse=True), stats


firsts, seconds, thirds = [], [], []
for g in groups:
    order, stats = table(g)
    firsts.append(order[0])
    seconds.append(order[1])
    thirds.append((stats[order[2]], order[2]))

thirds.sort(reverse=True)
best_thirds = [t for _, t in thirds[:8]]

r32_teams = firsts + seconds + best_thirds
rng.shuffle(r32_teams)


def knockout_round(stage, entrants, day):
    games = []
    for i in range(0, len(entrants), 2):
        games.append(add(stage, entrants[i], entrants[i + 1], allow_draw=False, day=day))
    return games


r32 = knockout_round("R32", r32_teams, 18)
r16 = knockout_round("R16", [winner_of(m) for m in r32], 22)
qf = knockout_round("QF", [winner_of(m) for m in r16], 26)
sf = knockout_round("SF", [winner_of(m) for m in qf], 30)
add("THIRD", loser_of(sf[0]), loser_of(sf[1]), allow_draw=False, day=33)
final = knockout_round("FINAL", [winner_of(m) for m in sf], 34)

OUT.write_text(
    json.dumps(
        {"updated": "2026-07-19T23:00:00Z", "source": "DEMO (simulated)", "matches": matches},
        indent=1,
        ensure_ascii=False,
    )
    + "\n",
    encoding="utf-8",
)
print(f"Wrote {len(matches)} demo matches to {OUT}; champion: {winner_of(final[0])}")
