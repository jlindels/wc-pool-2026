#!/usr/bin/env python3
"""Fetch FIFA World Cup 2026 match results from football-data.org and write
them to data/matches.json in the normalized format the dashboard expects.

Requires the FOOTBALL_DATA_TOKEN environment variable (free tier at
https://www.football-data.org/client/register includes the World Cup).
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://api.football-data.org/v4/competitions/WC/matches"
OUT = Path(__file__).resolve().parent.parent / "data" / "matches.json"

STAGE_MAP = {
    "GROUP_STAGE": "GROUP",
    "LAST_32": "R32",
    "ROUND_OF_32": "R32",
    "PLAYOFF_ROUND": "R32",
    "LAST_16": "R16",
    "ROUND_OF_16": "R16",
    "QUARTER_FINALS": "QF",
    "QUARTER_FINAL": "QF",
    "SEMI_FINALS": "SF",
    "SEMI_FINAL": "SF",
    "THIRD_PLACE": "THIRD",
    "PLAY_OFF_FOR_THIRD_PLACE": "THIRD",
    "FINAL": "FINAL",
}

STATUS_MAP = {
    "FINISHED": "FINISHED",
    "AWARDED": "FINISHED",
    "IN_PLAY": "LIVE",
    "PAUSED": "LIVE",
    "LIVE": "LIVE",
}

WINNER_MAP = {"HOME_TEAM": "HOME", "AWAY_TEAM": "AWAY", "DRAW": "DRAW"}


def normalize(m: dict) -> dict:
    score = m.get("score") or {}
    full = score.get("fullTime") or {}
    pens = score.get("penalties") or {}
    group = m.get("group") or ""
    out = {
        "id": m.get("id"),
        "stage": STAGE_MAP.get(m.get("stage"), m.get("stage")),
        "group": group.replace("Group ", "") if group else None,
        "utcDate": m.get("utcDate"),
        "status": STATUS_MAP.get(m.get("status"), "SCHEDULED"),
        "home": (m.get("homeTeam") or {}).get("name"),
        "away": (m.get("awayTeam") or {}).get("name"),
        "homeGoals": full.get("home"),
        "awayGoals": full.get("away"),
        "winner": WINNER_MAP.get(score.get("winner")),
    }
    if pens.get("home") is not None:
        out["penalties"] = f"{pens['home']}-{pens['away']}"
    return out


def main() -> int:
    token = os.environ.get("FOOTBALL_DATA_TOKEN")
    if not token:
        print("ERROR: FOOTBALL_DATA_TOKEN is not set", file=sys.stderr)
        return 1

    req = urllib.request.Request(API_URL, headers={"X-Auth-Token": token})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)

    matches = [normalize(m) for m in payload.get("matches", [])]
    matches.sort(key=lambda m: (m.get("utcDate") or "", m.get("id") or 0))

    unknown = sorted({m["stage"] for m in matches} - {"GROUP", "R32", "R16", "QF", "SF", "THIRD", "FINAL"})
    if unknown:
        print(f"WARNING: unmapped stage names from API: {unknown}", file=sys.stderr)

    data = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "football-data.org",
        "matches": matches,
    }
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    finished = sum(1 for m in matches if m["status"] == "FINISHED")
    print(f"Wrote {len(matches)} matches ({finished} finished) to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
