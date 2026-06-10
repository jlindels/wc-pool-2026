// Pure scoring logic for the World Cup pool.
// Used by the browser dashboard (index.html) and by scripts/test_scoring.mjs.
//
// Match format (data/matches.json):
//   { id, stage, group, utcDate, status, home, away, homeGoals, awayGoals, winner }
//   stage:  GROUP | R32 | R16 | QF | SF | THIRD | FINAL
//   status: FINISHED | LIVE | SCHEDULED
//   winner: HOME | AWAY | DRAW | null  (after extra time, before penalties the
//           API still reports the shootout winner here)

export const KNOCKOUT_STAGES = ["R32", "R16", "QF", "SF", "FINAL"];

export const STAGE_LABELS = {
  GROUP: "Group stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  THIRD: "Third-place match",
  FINAL: "Final",
};

export function canonicalTeam(name, aliases) {
  if (!name) return null;
  return aliases[name] || name;
}

function newTeamRecord(name, owner) {
  return {
    name,
    owner,
    group: null,
    // group-stage record
    gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0,
    matchPts: 0,          // 3/1/0 points from group matches
    groupWinner: false,
    groupDone: false,
    eliminated: false,
    stages: {},            // e.g. { R32: true, R16: true }
    champion: false,
    // all-tournament goals (for player tiebreakers)
    totalGf: 0, totalGa: 0, totalGd: 0,
    points: 0,
    breakdown: [],
  };
}

// FIFA-style group sort: points, goal difference, goals for, then name as a
// stable fallback (real edge cases can be settled via overrides.groupWinners).
function groupSort(a, b) {
  return (
    b.matchPts - a.matchPts ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.name.localeCompare(b.name)
  );
}

export function computePool(pool, matchData, overrides = {}) {
  const aliases = pool.aliases || {};
  const S = pool.scoring;
  const canon = (n) => canonicalTeam(n, aliases);
  const warnings = [];

  const excluded = new Set(overrides.excludeMatchIds || []);
  const matches = (matchData.matches || [])
    .concat(overrides.extraMatches || [])
    .filter((m) => !excluded.has(m.id));

  // One record per pool team (the pool covers all 48 qualified teams).
  const teams = {};
  for (const p of pool.players) {
    for (const t of p.teams) teams[t] = newTeamRecord(t, p.name);
  }

  const groups = {}; // letter -> Set of team names
  const seen = new Set();

  for (const m of matches) {
    const home = canon(m.home);
    const away = canon(m.away);
    for (const t of [home, away]) if (t) seen.add(t);

    if (m.stage === "GROUP" && m.group) {
      groups[m.group] = groups[m.group] || new Set();
      for (const t of [home, away]) {
        if (!t) continue;
        groups[m.group].add(t);
        if (teams[t]) teams[t].group = m.group;
      }
    }

    if (m.status !== "FINISHED" || m.homeGoals == null || m.awayGoals == null) {
      continue;
    }

    // All-tournament goal tallies (used for player tiebreakers).
    if (teams[home]) {
      teams[home].totalGf += m.homeGoals;
      teams[home].totalGa += m.awayGoals;
    }
    if (teams[away]) {
      teams[away].totalGf += m.awayGoals;
      teams[away].totalGa += m.homeGoals;
    }

    if (m.stage === "GROUP") {
      for (const [t, gf, ga] of [[home, m.homeGoals, m.awayGoals], [away, m.awayGoals, m.homeGoals]]) {
        const r = teams[t];
        if (!r) continue;
        r.gp += 1;
        r.gf += gf;
        r.ga += ga;
        if (gf > ga) { r.w += 1; r.matchPts += S.groupWin; }
        else if (gf === ga) { r.d += 1; r.matchPts += S.groupDraw; }
        else { r.l += 1; }
      }
    }

    if (m.stage === "FINAL" && m.winner && m.winner !== "DRAW") {
      const champ = m.winner === "HOME" ? home : away;
      if (teams[champ]) teams[champ].champion = true;
    }
  }

  for (const t of Object.values(teams)) t.gd = t.gf - t.ga, (t.totalGd = t.totalGf - t.totalGa);

  // Knockout appearances: a team earns the stage bonus as soon as it is slotted
  // into a match of that stage (qualification is what scores, not the result).
  for (const m of matches) {
    if (!KNOCKOUT_STAGES.includes(m.stage)) continue;
    for (const t of [canon(m.home), canon(m.away)]) {
      if (t && teams[t]) teams[t].stages[m.stage] = true;
    }
  }

  // Group standings + winner bonus (awarded once all group matches are played,
  // or immediately if set in overrides.groupWinners).
  const groupTables = {};
  const groupWinners = {};
  const winnerOverrides = overrides.groupWinners || {};
  for (const [letter, set] of Object.entries(groups).sort()) {
    const members = [...set];
    const rows = members.map((t) => teams[t] || newTeamRecord(t, null));
    rows.sort(groupSort);
    groupTables[letter] = rows;

    const expected = (members.length * (members.length - 1)) / 2;
    const played = matches.filter(
      (m) => m.stage === "GROUP" && m.group === letter && m.status === "FINISHED"
    ).length;
    const done = members.length >= 2 && played >= expected;
    for (const r of rows) if (teams[r.name]) teams[r.name].groupDone = done;

    let winner = null;
    if (winnerOverrides[letter]) {
      winner = canon(winnerOverrides[letter]);
    } else if (done && rows.length) {
      const [a, b] = rows;
      if (b && a.matchPts === b.matchPts && a.gd === b.gd && a.gf === b.gf) {
        // Dead tie on the main criteria: try head-to-head result.
        const h2h = matches.find(
          (m) =>
            m.stage === "GROUP" && m.status === "FINISHED" &&
            new Set([canon(m.home), canon(m.away)]).size === 2 &&
            [canon(m.home), canon(m.away)].every((t) => t === a.name || t === b.name)
        );
        if (h2h && h2h.winner === "HOME") winner = canon(h2h.home);
        else if (h2h && h2h.winner === "AWAY") winner = canon(h2h.away);
        else {
          warnings.push(
            `Group ${letter}: ${a.name} and ${b.name} are dead level - set the winner manually in data/overrides.json (groupWinners).`
          );
        }
      } else {
        winner = a.name;
      }
    }
    groupWinners[letter] = winner;
    if (winner && teams[winner]) teams[winner].groupWinner = true;
  }

  const allGroupsDone =
    Object.keys(groupTables).length >= 12 &&
    Object.values(teams).every((t) => t.groupDone);

  // Eliminated = group is done and the team has no knockout appearance, or it
  // lost a knockout match whose next round it never appears in. Kept simple:
  // a team is marked eliminated when its group finished and it isn't in the
  // latest stage that any match data has reached.
  for (const t of Object.values(teams)) {
    if (t.groupDone && Object.keys(t.stages).length === 0) t.eliminated = true;
  }

  // Per-team points + breakdown.
  for (const t of Object.values(teams)) {
    let pts = t.matchPts;
    t.breakdown = [];
    if (t.matchPts) {
      t.breakdown.push(
        `${t.matchPts} group pts (${t.w}W ${t.d}D ${t.l}L)`
      );
    }
    if (t.groupWinner) {
      pts += S.groupWinnerBonus;
      t.breakdown.push(`+${S.groupWinnerBonus} won Group ${t.group}`);
    }
    for (const st of KNOCKOUT_STAGES) {
      if (t.stages[st]) {
        pts += S.knockoutAppearance;
        t.breakdown.push(`+${S.knockoutAppearance} ${STAGE_LABELS[st]}`);
      }
    }
    if (t.champion && S.championBonus) {
      pts += S.championBonus;
      t.breakdown.push(`+${S.championBonus} champions`);
    }
    t.points = pts;
  }

  // Player standings: total points, tiebreak combined GD then combined GF.
  const players = pool.players.map((p) => {
    const recs = p.teams.map((t) => teams[t]);
    return {
      name: p.name,
      teams: recs,
      total: recs.reduce((s, r) => s + r.points, 0),
      gd: recs.reduce((s, r) => s + r.totalGd, 0),
      gf: recs.reduce((s, r) => s + r.totalGf, 0),
    };
  });
  players.sort(
    (a, b) => b.total - a.total || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name)
  );
  let rank = 0, prev = null;
  players.forEach((p, i) => {
    const key = `${p.total}|${p.gd}|${p.gf}`;
    if (key !== prev) { rank = i + 1; prev = key; }
    p.rank = rank;
  });

  // Wooden spoon: single worst team by group-stage points, then worst goal
  // difference, then most goals against (group-stage numbers).
  const spoonOrder = Object.values(teams).slice().sort(
    (a, b) =>
      a.matchPts - b.matchPts ||
      a.gd - b.gd ||
      b.ga - a.ga ||
      a.name.localeCompare(b.name)
  );
  const spoonTeam = spoonOrder[0] || null;
  if (
    spoonTeam && spoonOrder[1] &&
    spoonTeam.matchPts === spoonOrder[1].matchPts &&
    spoonTeam.gd === spoonOrder[1].gd &&
    spoonTeam.ga === spoonOrder[1].ga &&
    allGroupsDone
  ) {
    warnings.push(
      `Wooden spoon is tied between ${spoonTeam.name} and ${spoonOrder[1].name} on every tiebreaker.`
    );
  }

  // Warn about pool teams that never show up in match data (alias problems).
  if (matches.length) {
    for (const t of Object.keys(teams)) {
      if (!seen.has(t)) {
        warnings.push(`"${t}" not found in match data yet - if matches have been played, check aliases in data/pool.json.`);
      }
    }
  }

  return {
    teams,
    players,
    groups: groupTables,
    groupWinners,
    allGroupsDone,
    woodenSpoon: spoonTeam
      ? { team: spoonTeam, provisional: !allGroupsDone }
      : null,
    warnings,
  };
}
