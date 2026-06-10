// Unit tests for assets/scoring.js. Run with: node scripts/test_scoring.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { computePool } from "../assets/scoring.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pool = JSON.parse(readFileSync(join(root, "data", "pool.json"), "utf-8"));

// ---- Synthetic mini-scenario with hand-computed expectations ----------------
// Group A: Portugal beats Turkey 2-0, Portugal draws Jordan 1-1, Turkey beats
// Jordan 3-1 (alias "Türkiye" used to verify canonicalization), plus the
// remaining fixtures vs USA so the group completes.
const mini = {
  updated: "2026-06-20T00:00:00Z",
  matches: [
    { id: 1, stage: "GROUP", group: "A", status: "FINISHED", home: "Portugal", away: "Türkiye", homeGoals: 2, awayGoals: 0, winner: "HOME" },
    { id: 2, stage: "GROUP", group: "A", status: "FINISHED", home: "Portugal", away: "Jordan", homeGoals: 1, awayGoals: 1, winner: "DRAW" },
    { id: 3, stage: "GROUP", group: "A", status: "FINISHED", home: "Türkiye", away: "Jordan", homeGoals: 3, awayGoals: 1, winner: "HOME" },
    { id: 4, stage: "GROUP", group: "A", status: "FINISHED", home: "Portugal", away: "United States", homeGoals: 1, awayGoals: 0, winner: "HOME" },
    { id: 5, stage: "GROUP", group: "A", status: "FINISHED", home: "Türkiye", away: "United States", homeGoals: 0, awayGoals: 2, winner: "AWAY" },
    { id: 6, stage: "GROUP", group: "A", status: "FINISHED", home: "Jordan", away: "United States", homeGoals: 0, awayGoals: 4, winner: "AWAY" },
    // Knockouts: Portugal reaches R32 and R16; USA reaches R32.
    { id: 7, stage: "R32", group: null, status: "FINISHED", home: "Portugal", away: "USA", homeGoals: 1, awayGoals: 0, winner: "HOME" },
    { id: 8, stage: "R16", group: null, status: "SCHEDULED", home: "Portugal", away: "France", homeGoals: null, awayGoals: null, winner: null },
  ],
};

{
  const r = computePool(pool, mini);
  const t = r.teams;

  // Portugal: 2W 1D = 7 match pts, won group (+5), R32 (+5), R16 (+5) = 22.
  assert.equal(t["Portugal"].matchPts, 7, "Portugal group match points");
  assert.equal(t["Portugal"].groupWinner, true, "Portugal wins group A");
  assert.equal(t["Portugal"].points, 7 + 5 + 5 + 5, "Portugal total");

  // Turkey (via Türkiye alias): 1W 2L = 3 pts.
  assert.equal(t["Turkey"].matchPts, 3, "Turkey match points via alias");
  assert.equal(t["Turkey"].points, 3, "Turkey total");

  // Jordan: 1D = 1 pt; eliminated once group done with no knockout appearance.
  assert.equal(t["Jordan"].matchPts, 1, "Jordan match points");
  assert.equal(t["Jordan"].eliminated, true, "Jordan eliminated");

  // USA: 2W = 6 pts + R32 appearance = 11. Appearance counts even though it lost.
  assert.equal(t["USA"].points, 6 + 5, "USA total");

  // France gets R16 appearance from a merely-scheduled match (bracket slotted).
  assert.equal(t["France"].points, 5, "France R16 appearance");

  // Sammy = Portugal 22 + Turkey 3 + Jordan 1 = 26 and leads.
  const sammy = r.players.find((p) => p.name === "Sammy");
  assert.equal(sammy.total, 26, "Sammy total");
  assert.equal(r.players[0].name, "Sammy", "Sammy leads");
  // Sammy combined GD: Portugal +4 (group) +1 (R32) ... Portugal group 4-1,
  // R32 1-0 => +4; Turkey 3-5 => -2; Jordan 2-8 => -6. Total -4.
  assert.equal(sammy.gd, -4, "Sammy combined GD");

  // Wooden spoon: worst is a team with 0 pts. Among never-seen teams matchPts=0,
  // but Jordan has 1 pt so it is safe. Spoon must have 0 match points.
  assert.equal(r.woodenSpoon.team.matchPts, 0, "spoon has 0 pts");
  assert.equal(r.woodenSpoon.provisional, true, "spoon provisional until all groups done");
}

// ---- Tiebreaker: group winner decided by GD, then dead-tie warning ----------
{
  const data = {
    matches: [
      { id: 1, stage: "GROUP", group: "B", status: "FINISHED", home: "Brazil", away: "Egypt", homeGoals: 3, awayGoals: 0, winner: "HOME" },
      { id: 2, stage: "GROUP", group: "B", status: "FINISHED", home: "Scotland", away: "Egypt", homeGoals: 1, awayGoals: 0, winner: "HOME" },
      { id: 3, stage: "GROUP", group: "B", status: "FINISHED", home: "Brazil", away: "Scotland", homeGoals: 0, awayGoals: 0, winner: "DRAW" },
    ],
  };
  const r = computePool(pool, data);
  // Brazil 4 pts GD +3, Scotland 4 pts GD +1 -> Brazil wins group on GD.
  assert.equal(r.groupWinners["B"], "Brazil", "group winner by GD");
}

// ---- Manual override forces group winner ------------------------------------
{
  const data = {
    matches: [
      { id: 1, stage: "GROUP", group: "C", status: "FINISHED", home: "Spain", away: "Morocco", homeGoals: 1, awayGoals: 1, winner: "DRAW" },
    ],
  };
  const r = computePool(pool, data, { groupWinners: { C: "Morocco" } });
  assert.equal(r.groupWinners["C"], "Morocco", "override group winner");
  assert.equal(r.teams["Morocco"].points, 1 + 5, "Morocco gets bonus via override");
}

// ---- Full demo tournament sanity checks --------------------------------------
{
  const demo = JSON.parse(readFileSync(join(root, "data", "matches.demo.json"), "utf-8"));
  const r = computePool(pool, demo);

  assert.equal(r.warnings.length, 0, `no warnings on demo data: ${r.warnings.join("; ")}`);
  assert.equal(r.allGroupsDone, true, "demo groups all complete");
  assert.equal(Object.keys(r.groups).length, 12, "12 groups");
  assert.equal(Object.values(r.groupWinners).filter(Boolean).length, 12, "12 group winners");

  const stageCounts = {};
  for (const t of Object.values(r.teams)) {
    for (const s of Object.keys(t.stages)) stageCounts[s] = (stageCounts[s] || 0) + 1;
  }
  assert.deepEqual(
    stageCounts,
    { R32: 32, R16: 16, QF: 8, SF: 4, FINAL: 2 },
    "knockout appearance counts"
  );

  // Every team's points must equal its breakdown-implied total.
  for (const t of Object.values(r.teams)) {
    const expected =
      t.matchPts +
      (t.groupWinner ? 5 : 0) +
      Object.keys(t.stages).length * 5;
    assert.equal(t.points, expected, `${t.name} points reconcile`);
  }

  // Players sorted by total desc, then GD, then GF.
  for (let i = 1; i < r.players.length; i++) {
    const a = r.players[i - 1], b = r.players[i];
    assert.ok(
      a.total > b.total ||
        (a.total === b.total && (a.gd > b.gd || (a.gd === b.gd && a.gf >= b.gf))),
      "leaderboard ordering"
    );
  }

  assert.ok(r.woodenSpoon && !r.woodenSpoon.provisional, "spoon is final after group stage");
  console.log("Demo champion points leader:", r.players[0].name, r.players[0].total);
  console.log("Demo wooden spoon:", r.woodenSpoon.team.name, `(${r.woodenSpoon.team.owner})`);
}

console.log("All scoring tests passed ✔");
