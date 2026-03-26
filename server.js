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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/rankings', (req, res) => {
  const journal = req.query.journal || null;
  const years = req.query.years ? parseInt(req.query.years, 10) : null;
  res.json(computeRankings(journal, years));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
