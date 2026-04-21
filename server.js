const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const CATEGORY_NAMES = {
  1: 'Accounting & Financial AI',
  2: 'Business Intelligence & Decision Support',
  3: 'Information Systems & Applied Analytics',
  4: 'Engineering & Industrial AI',
  5: 'Core AI & Data Science Methods',
};

function loadJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

const papers = loadJSON(path.join(__dirname, 'data', 'papers.json')) || [];
const categorized = loadJSON(path.join(__dirname, 'data', 'categorized.json')) || {};

console.log(`Loaded ${papers.length} papers, ${Object.keys(categorized).length} categorized`);

function computeRankings(journal, years) {
  const currentYear = new Date().getFullYear();
  const minYear = years ? currentYear - years : 0;

  const filtered = papers.filter(p => {
    if (journal && p.journal !== journal) return false;
    if (p.publicationYear < minYear) return false;
    return true;
  });

  const counts = {};

  for (const paper of filtered) {
    const usInstitutions = new Map();
    for (const inst of paper.institutions) {
      if (inst.countryCode === 'US' && !usInstitutions.has(inst.id)) {
        usInstitutions.set(inst.id, inst);
      }
    }

    for (const [instId, inst] of usInstitutions) {
      if (!counts[instId]) {
        counts[instId] = {
          displayName: inst.displayName,
          countryCode: inst.countryCode,
          total: 0,
          categories: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        };
      }
      counts[instId].total += 1;

      const cat = categorized[paper.id];
      if (cat && CATEGORY_NAMES[cat]) {
        counts[instId].categories[cat] += 1;
      }
    }
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1].total - a[1].total || a[1].displayName.localeCompare(b[1].displayName))
    .slice(0, 50);

  let rank = 1;
  return sorted.map(([instId, entry], i) => {
    if (i > 0 && entry.total < sorted[i - 1][1].total) rank = i + 1;
    return {
      rank,
      institutionId: instId,
      institution: entry.displayName,
      country: entry.countryCode,
      total: entry.total,
      categories: {
        [CATEGORY_NAMES[1]]: entry.categories[1],
        [CATEGORY_NAMES[2]]: entry.categories[2],
        [CATEGORY_NAMES[3]]: entry.categories[3],
        [CATEGORY_NAMES[4]]: entry.categories[4],
        [CATEGORY_NAMES[5]]: entry.categories[5],
      },
    };
  });
}

// --- Authors (public/authors.html) ---

const authorsPapers = loadJSON(path.join(__dirname, 'data', 'authors_papers.json')) || [];

function parseJournalList(queryValue) {
  if (queryValue == null || queryValue === '') return null;
  const arr = Array.isArray(queryValue) ? queryValue : [queryValue];
  const list = arr.filter(Boolean);
  return list.length ? list : null;
}

/** True if paper a is strictly newer than paper b (year, then date, then id). */
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

/** Primary affiliation = first institution on the author's most recent paper (all journals, all years). */
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
          paper,
          primaryOrganization: names[0] || null,
        };
      }
    }
  }
  return meta;
}

const authorRecentMeta = buildAuthorRecentPrimary(authorsPapers);
console.log(`Loaded ${authorsPapers.length} author-paper rows for /api/authors`);

/** Competition ranking (1,2,2,4…): tied paper counts share the same rank. */
function assignAuthorCompetitionRanks(sortedEntries) {
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

function mapAuthorEntryToRow([id, a], rank) {
  const institutionCounts = Object.entries(a.institutionCounts)
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([name, count]) => ({ institution: name, count }));
  const recent = authorRecentMeta[id];
  const fromRecent = recent?.primaryOrganization;
  const fromFiltered = institutionCounts[0]?.institution || null;
  const primaryOrganization =
    (fromRecent && String(fromRecent).trim()) || (fromFiltered && String(fromFiltered).trim()) || null;

  return {
    rank,
    authorId: id,
    authorName: a.authorName,
    paperCount: a.paperCount,
    primaryOrganization,
    orcid: a.orcid,
    mostRecentYear: recent?.paper?.publicationYear ?? null,
    mostRecentDate: recent?.paper?.publicationDate ?? null,
    mostRecentJournal: recent?.paper?.journal ?? null,
    journals: [...a.journals].sort(),
    journalCounts: a.journalCounts,
    institutionCounts,
  };
}

function computeAuthorRankings(journals, authorQuery) {
  const q = (authorQuery || '').trim().toLowerCase();

  const filtered = authorsPapers.filter(p => {
    if (journals && journals.length && !journals.includes(p.journal)) return false;
    return true;
  });

  const authorCounts = {};

  for (const paper of filtered) {
    const seen = new Set();
    for (const a of paper.authors || []) {
      if (!a.authorId || seen.has(a.authorId)) continue;
      seen.add(a.authorId);

      if (!authorCounts[a.authorId]) {
        authorCounts[a.authorId] = {
          authorName: a.authorName,
          orcid: a.orcid,
          paperCount: 0,
          journals: new Set(),
          journalCounts: {},
          institutionCounts: {},
        };
      }
      authorCounts[a.authorId].paperCount += 1;
      authorCounts[a.authorId].journals.add(paper.journal);
      authorCounts[a.authorId].journalCounts[paper.journal] =
        (authorCounts[a.authorId].journalCounts[paper.journal] || 0) + 1;

      for (const inst of a.institutions || []) {
        if (!inst.displayName) continue;
        authorCounts[a.authorId].institutionCounts[inst.displayName] =
          (authorCounts[a.authorId].institutionCounts[inst.displayName] || 0) + 1;
      }
    }
  }

  const sorted = Object.entries(authorCounts).sort((a, b) => {
    const d = b[1].paperCount - a[1].paperCount;
    if (d !== 0) return d;
    return String(a[1].authorName || '').localeCompare(String(b[1].authorName || ''));
  });

  const rankById = assignAuthorCompetitionRanks(sorted);

  const nameMatches = ([, a]) =>
    !q || String(a.authorName || '').toLowerCase().includes(q);

  const forStats = q ? sorted.filter(nameMatches) : sorted;
  const totalAuthors = forStats.length;
  const authorsWithAffiliation = forStats.filter(([, a]) =>
    Object.keys(a.institutionCounts).length > 0).length;

  let tableEntries;
  if (q) {
    tableEntries = sorted.filter(nameMatches);
  } else {
    tableEntries = sorted.slice(0, 100);
  }

  const topAuthors = tableEntries.map(entry =>
    mapAuthorEntryToRow(entry, rankById.get(entry[0]))
  );

  return {
    summary: {
      totalAuthors,
      authorsWithAffiliation,
      totalPapersConsidered: filtered.length,
    },
    topAuthors,
  };
}

app.get('/api/authors', (req, res) => {
  try {
    const journals = parseJournalList(req.query.journal);
    const q = req.query.q || '';
    res.json(computeAuthorRankings(journals, q));
  } catch (err) {
    console.error('/api/authors', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/rankings', (req, res) => {
  try {
    const journal = req.query.journal || null;
    const years = req.query.years ? parseInt(req.query.years, 10) : null;
    res.json(computeRankings(journal, years));
  } catch (err) {
    console.error('/api/rankings', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/authors', (req, res) => {
  res.redirect(302, '/authors.html');
});

app.get('/rutgers-papers', (req, res) => {
  res.redirect(302, '/rutgers-papers.html');
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
