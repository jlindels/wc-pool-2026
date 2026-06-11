import { computePool, KNOCKOUT_STAGES, STAGE_LABELS, canonicalTeam } from "./scoring.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const demo = new URLSearchParams(location.search).has("demo");

async function loadJSON(path, optional = false) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`Failed to load ${path} (${res.status})`);
  }
  return res.json();
}

function medal(rank) {
  return { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" }[rank] || rank;
}

function teamChip(t, spoonName) {
  const cls = ["chip"];
  if (t.eliminated) cls.push("out");
  if (t.champion) cls.push("champ");
  const spoon = t.name === spoonName ? " \u{1F944}" : "";
  const tip = t.breakdown.length ? t.breakdown.join("\n") : "No points yet";
  return `<span class="${cls.join(" ")}" title="${esc(tip)}">${esc(t.name)}${spoon} <b>${t.points}</b></span>`;
}

function renderLeaderboard(result) {
  const spoonName = result.woodenSpoon?.team?.name;
  const rows = result.players
    .map(
      (p) => `
      <tr>
        <td class="rank">${medal(p.rank)}</td>
        <td class="player">${esc(p.name)}</td>
        <td class="teams">${p.teams.map((t) => teamChip(t, spoonName)).join(" ")}</td>
        <td class="num total">${p.total}</td>
        <td class="num muted">${p.gd > 0 ? "+" : ""}${p.gd}</td>
        <td class="num muted">${p.gf}</td>
      </tr>`
    )
    .join("");
  $("#leaderboard").innerHTML = `
    <table>
      <thead><tr><th></th><th>Player</th><th>Teams (hover a team for its point breakdown)</th><th class="num">Pts</th><th class="num">GD</th><th class="num">GF</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSpoon(result) {
  if (!result.woodenSpoon) {
    $("#spoon").innerHTML = `<p class="muted">No matches played yet.</p>`;
    return;
  }
  const t = result.woodenSpoon.team;
  const tag = result.woodenSpoon.provisional
    ? `<span class="tag">provisional &mdash; group stage in progress</span>`
    : `<span class="tag final">final</span>`;
  $("#spoon").innerHTML = `
    <div class="spoon-card">
      <div class="spoon-team">\u{1F944} ${esc(t.name)} <span class="muted">(${esc(t.owner)})</span> ${tag}</div>
      <div class="muted">${t.matchPts} group pts &middot; GD ${t.gd > 0 ? "+" : ""}${t.gd} &middot; ${t.ga} goals against</div>
    </div>`;
}

function renderKnockout(result) {
  const stages = KNOCKOUT_STAGES.filter((st) =>
    Object.values(result.teams).some((t) => t.stages[st])
  );
  if (!stages.length) return;
  $("#knockout-section").classList.remove("hidden");
  $("#knockout").innerHTML = stages
    .map((st) => {
      const qualified = Object.values(result.teams)
        .filter((t) => t.stages[st])
        .sort((a, b) => a.name.localeCompare(b.name));
      return `
        <div class="ko-stage">
          <h3>${STAGE_LABELS[st]} <span class="muted">(+5 each, ${qualified.length} teams)</span></h3>
          <div>${qualified
            .map((t) => `<span class="chip">${esc(t.name)} <span class="muted">${esc(t.owner)}</span></span>`)
            .join(" ")}</div>
        </div>`;
    })
    .join("");
}

function renderGroups(result) {
  const letters = Object.keys(result.groups).sort();
  if (!letters.length) {
    $("#groups").innerHTML = `<p class="muted">Group tables appear once match data is loaded.</p>`;
    return;
  }
  $("#groups").innerHTML = letters
    .map((g) => {
      const rows = result.groups[g]
        .map((t, i) => {
          const winner = result.groupWinners[g] === t.name;
          return `
          <tr class="${winner ? "winner" : ""}">
            <td>${i + 1}</td>
            <td>${esc(t.name)}${winner ? " ⭐" : ""}<div class="owner muted">${esc(t.owner || "")}</div></td>
            <td class="num">${t.gp}</td>
            <td class="num">${t.gd > 0 ? "+" : ""}${t.gd}</td>
            <td class="num"><b>${t.matchPts}</b></td>
          </tr>`;
        })
        .join("");
      return `
        <div class="group-card">
          <h3>Group ${esc(g)}</h3>
          <table>
            <thead><tr><th></th><th>Team</th><th class="num">P</th><th class="num">GD</th><th class="num">Pts</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    })
    .join("");
}

function renderResults(matchData, aliases) {
  const matches = (matchData.matches || []).slice();
  const finished = matches.filter((m) => m.status === "FINISHED");
  const live = matches.filter((m) => m.status === "LIVE");
  const upcoming = matches
    .filter((m) => m.status === "SCHEDULED" && m.home && m.away)
    .sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""))
    .slice(0, 6);
  finished.sort((a, b) => (b.utcDate || "").localeCompare(a.utcDate || ""));

  const line = (m, score) => {
    const stage = m.stage === "GROUP" ? `Group ${m.group || "?"}` : STAGE_LABELS[m.stage] || m.stage;
    const date = m.utcDate ? new Date(m.utcDate).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return `<tr>
      <td class="muted">${esc(stage)}</td>
      <td class="match">${esc(canonicalTeam(m.home, aliases) || "TBD")} <b>${score}</b> ${esc(canonicalTeam(m.away, aliases) || "TBD")}${m.penalties ? ` <span class="muted">(${esc(m.penalties)} pens)</span>` : ""}</td>
      <td class="muted num">${esc(date)}</td>
    </tr>`;
  };

  let html = "";
  if (live.length) {
    html += `<h3 class="live-h">\u{1F534} Live</h3><table><tbody>${live
      .map((m) => line(m, `${m.homeGoals ?? 0} - ${m.awayGoals ?? 0}`))
      .join("")}</tbody></table>`;
  }
  if (finished.length) {
    html += `<table><tbody>${finished.slice(0, 12).map((m) => line(m, `${m.homeGoals ?? "?"} - ${m.awayGoals ?? "?"}`)).join("")}</tbody></table>`;
  }
  if (!live.length && !finished.length) {
    html += `<p class="muted">No results yet.</p>`;
  }
  if (upcoming.length) {
    html += `<h3>Up next</h3><table><tbody>${upcoming.map((m) => line(m, "vs")).join("")}</tbody></table>`;
  }
  $("#results").innerHTML = html;
}

async function main() {
  try {
    const [pool, matchData, overrides] = await Promise.all([
      loadJSON("data/pool.json"),
      loadJSON(demo ? "data/matches.demo.json" : "data/matches.json"),
      loadJSON("data/overrides.json", true),
    ]);
    if (demo) $("#demo-banner").classList.remove("hidden");

    const result = computePool(pool, matchData, overrides || {});

    $("#updated").textContent = matchData.updated
      ? `Last updated ${new Date(matchData.updated).toLocaleString()}`
      : "Waiting for the first score update - the tournament starts June 11!";

    renderLeaderboard(result);
    renderSpoon(result);
    renderKnockout(result);
    renderGroups(result);
    renderResults(matchData, pool.aliases || {});

    if (result.warnings.length) {
      const w = $("#warnings");
      w.innerHTML = result.warnings.map((x) => `<div>⚠️ ${esc(x)}</div>`).join("");
      w.classList.remove("hidden");
    }
  } catch (e) {
    const el = $("#error");
    el.textContent = `Could not load data: ${e.message}. If you opened this file directly, serve it instead (e.g. python3 -m http.server).`;
    el.classList.remove("hidden");
  }
}

main();
