const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAPERS_FILE = path.join(DATA_DIR, 'papers.json');
const CATEGORIZED_FILE = path.join(DATA_DIR, 'categorized.json');
const OUT_FILE = path.join(DATA_DIR, 'rankings.json');

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

function main() {
  const papers = loadJSON(PAPERS_FILE);
  if (!papers) {
    console.error('papers.json not found. Run fetch_papers.js first.');
    process.exit(1);
  }

  const categorized = loadJSON(CATEGORIZED_FILE) || {};

  // { institutionId: { displayName, countryCode, total, categories: {1:0,2:0,...} } }
  const counts = {};

  for (const paper of papers) {
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

  const ranked = Object.entries(counts)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 50)
    .map(([instId, entry], i) => ({
      rank: i + 1,
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
    }));

  fs.writeFileSync(OUT_FILE, JSON.stringify(ranked, null, 2));
  console.log(`Done. Top ${ranked.length} US institutions saved to ${OUT_FILE}`);
}

main();
