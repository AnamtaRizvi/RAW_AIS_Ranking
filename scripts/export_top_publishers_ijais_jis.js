/**
 * Writes CSV files (open in Excel) of top authors in IJAIS and JIS with affiliations.
 * Uses data/authors_papers.json — run npm run fetch-authors first if missing.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUTHORS_FILE = path.join(DATA_DIR, 'authors_papers.json');
const OUT_DIR = path.join(__dirname, '..', 'exports');

const JOURNALS = ['IJAIS', 'JIS'];
const TOP_N = 100;

function loadJSON(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function isPaperNewer(a, b) {
  if (!b) return true;
  const y1 = Number(a.publicationYear);
  const y2 = Number(b.publicationYear);
  const ny1 = Number.isFinite(y1) ? y1 : -9999;
  const ny2 = Number.isFinite(y2) ? y2 : -9999;
  if (ny1 !== ny2) return ny1 > ny2;
  const d1 = a.publicationDate || '';
  const d2 = b.publicationDate || '';
  if (d1 !== d2) return d1 > d2;
  return (a.paperId || '') > (b.paperId || '');
}

/** Primary affiliation = first institution on the author's most recent paper (all journals). */
function buildAuthorRecentPrimary(rows) {
  const meta = {};
  for (const paper of rows) {
    const seen = new Set();
    for (const a of paper.authors || []) {
      if (!a.authorId || seen.has(a.authorId)) continue;
      seen.add(a.authorId);
      const prev = meta[a.authorId];
      if (!prev || isPaperNewer(paper, prev.paper)) {
        const names = (a.institutions || []).map(i => i.displayName).filter(Boolean);
        meta[a.authorId] = {
          primaryOrganization: names[0] || null,
        };
      }
    }
  }
  return meta;
}

function assignCompetitionRanks(sortedEntries) {
  const rankById = new Map();
  let currentRank = 1;
  for (let i = 0; i < sortedEntries.length; i++) {
    const [id, a] = sortedEntries[i];
    if (i > 0 && a.paperCount < sortedEntries[i - 1][1].paperCount) {
      currentRank = i + 1;
    }
    rankById.set(id, currentRank);
  }
  return rankById;
}

function aggregateJournal(rows, journal) {
  const filtered = rows.filter(p => p.journal === journal);
  const counts = {};
  for (const paper of filtered) {
    const seen = new Set();
    for (const au of paper.authors || []) {
      if (!au.authorId || seen.has(au.authorId)) continue;
      seen.add(au.authorId);
      if (!counts[au.authorId]) {
        counts[au.authorId] = {
          authorName: au.authorName,
          orcid: au.orcid || '',
          paperCount: 0,
          instCounts: {},
        };
      }
      const c = counts[au.authorId];
      c.paperCount += 1;
      for (const inst of au.institutions || []) {
        if (!inst.displayName) continue;
        c.instCounts[inst.displayName] = (c.instCounts[inst.displayName] || 0) + 1;
      }
    }
  }
  return counts;
}

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToLine(cols) {
  return cols.map(csvEscape).join(',');
}

function main() {
  if (!fs.existsSync(AUTHORS_FILE)) {
    console.error(`Missing ${AUTHORS_FILE}. Run: npm run fetch-authors`);
    process.exit(1);
  }

  const rows = loadJSON(AUTHORS_FILE);
  const recentPrimary = buildAuthorRecentPrimary(rows);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const header = [
    'Journal',
    'Rank',
    'Author',
    'PapersInJournal',
    'PrimaryAffiliation',
    'TopAffiliationsInJournal',
    'ORCID',
    'OpenAlexAuthorId',
  ];

  for (const journal of JOURNALS) {
    const counts = aggregateJournal(rows, journal);
    const sorted = Object.entries(counts).sort((a, b) => {
      const d = b[1].paperCount - a[1].paperCount;
      if (d !== 0) return d;
      return String(a[1].authorName || '').localeCompare(String(b[1].authorName || ''));
    });
    const rankById = assignCompetitionRanks(sorted);
    const top = sorted.slice(0, TOP_N);

    const lines = [rowToLine(header)];
    for (const [id, a] of top) {
      const topInst = Object.entries(a.instCounts)
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, 8)
        .map(([name, n]) => `${name} (${n})`)
        .join('; ');
      lines.push(
        rowToLine([
          journal,
          rankById.get(id),
          a.authorName,
          a.paperCount,
          recentPrimary[id]?.primaryOrganization || '',
          topInst,
          a.orcid,
          id,
        ])
      );
    }

    const outPath = path.join(OUT_DIR, `top_publishers_${journal}.csv`);
    fs.writeFileSync(outPath, '\ufeff' + lines.join('\n'), 'utf8');
    console.log(`Wrote ${top.length} rows → ${outPath}`);
  }

  const combined = [rowToLine(header)];
  for (const journal of JOURNALS) {
    const counts = aggregateJournal(rows, journal);
    const sorted = Object.entries(counts).sort((a, b) => {
      const d = b[1].paperCount - a[1].paperCount;
      if (d !== 0) return d;
      return String(a[1].authorName || '').localeCompare(String(b[1].authorName || ''));
    });
    const rankById = assignCompetitionRanks(sorted);
    for (const [id, a] of sorted.slice(0, TOP_N)) {
      const topInst = Object.entries(a.instCounts)
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, 8)
        .map(([name, n]) => `${name} (${n})`)
        .join('; ');
      combined.push(
        rowToLine([
          journal,
          rankById.get(id),
          a.authorName,
          a.paperCount,
          recentPrimary[id]?.primaryOrganization || '',
          topInst,
          a.orcid,
          id,
        ])
      );
    }
  }
  const combinedPath = path.join(OUT_DIR, 'top_publishers_IJAIS_and_JIS.csv');
  fs.writeFileSync(combinedPath, '\ufeff' + combined.join('\n'), 'utf8');
  console.log(`Wrote combined → ${combinedPath}`);
}

main();
