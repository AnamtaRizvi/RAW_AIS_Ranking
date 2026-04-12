require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAPERS_FILE = path.join(DATA_DIR, 'papers.json');
const AUTHORS_FILE = path.join(DATA_DIR, 'authors_papers.json');
const OUT_FILE = path.join(DATA_DIR, 'categorized.json');

const TOP_N = 50;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const BATCH_SIZE = 10;

const SYSTEM_PROMPT = `You are a research paper classifier. Classify the paper into exactly ONE category. Reply with ONLY the number (1-5).

Categories:
1 Accounting & Financial AI
2 Business Intelligence & Decision Support
3 Information Systems & Applied Analytics
4 Engineering & Industrial AI
5 Core AI & Data Science Methods`;

function loadJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function saveJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

/** One +1 per US institution per paper (dedup co-authors at same org), matching server/compute_rankings. */
function institutionTotalsForPaperSet(paperList) {
  const counts = new Map();
  for (const paper of paperList) {
    const usInstitutions = new Map();
    for (const inst of paper.institutions || []) {
      if (inst.countryCode === 'US' && !usInstitutions.has(inst.id)) {
        usInstitutions.set(inst.id, inst);
      }
    }
    for (const [instId, inst] of usInstitutions) {
      if (!counts.has(instId)) {
        counts.set(instId, {
          displayName: inst.displayName,
          countryCode: inst.countryCode,
          total: 0,
        });
      }
      counts.get(instId).total += 1;
    }
  }
  return counts;
}

function topNInstitutionIds(countsMap, n) {
  return [...countsMap.entries()]
    .sort((a, b) => {
      const diff = b[1].total - a[1].total;
      if (diff !== 0) return diff;
      return a[1].displayName.localeCompare(b[1].displayName);
    })
    .slice(0, n)
    .map(([id]) => id);
}

/**
 * US institutions: global top N (all journals) ∪ top N per journal (same rules as institution rankings).
 */
function buildInstitutionTargetIds(papers) {
  const union = new Set();
  const globalCounts = institutionTotalsForPaperSet(papers);
  for (const id of topNInstitutionIds(globalCounts, TOP_N)) {
    union.add(id);
  }

  const journals = [...new Set(papers.map(p => p.journal).filter(Boolean))];
  for (const j of journals) {
    const subset = papers.filter(p => p.journal === j);
    const counts = institutionTotalsForPaperSet(subset);
    for (const id of topNInstitutionIds(counts, TOP_N)) {
      union.add(id);
    }
  }

  return { union, journalCount: journals.length };
}

function buildAuthorPaperCounts(authorRows, journal) {
  const filtered = journal ? authorRows.filter(p => p.journal === journal) : authorRows;
  const counts = {};
  for (const paper of filtered) {
    const seen = new Set();
    for (const a of paper.authors || []) {
      if (!a.authorId || seen.has(a.authorId)) continue;
      seen.add(a.authorId);
      counts[a.authorId] = (counts[a.authorId] || 0) + 1;
    }
  }
  return counts;
}

function topNAuthorIdsByCount(counts, n) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([id]) => id);
}

/** Authors: top N overall ∪ top N per journal (by paper count in authors_papers.json). */
function buildAuthorTargetIdSet(authorRows) {
  const union = new Set();
  for (const id of topNAuthorIdsByCount(buildAuthorPaperCounts(authorRows, null), TOP_N)) {
    union.add(id);
  }
  const journals = [...new Set(authorRows.map(p => p.journal).filter(Boolean))];
  for (const j of journals) {
    for (const id of topNAuthorIdsByCount(buildAuthorPaperCounts(authorRows, j), TOP_N)) {
      union.add(id);
    }
  }
  return union;
}

function paperIdsAuthoredBy(authorRows, authorIdSet) {
  const out = new Set();
  for (const row of authorRows) {
    if ((row.authors || []).some(a => a.authorId && authorIdSet.has(a.authorId))) {
      out.add(row.paperId);
    }
  }
  return out;
}

async function classify(title, abstract) {
  const userMsg = `Title: ${title}\nAbstract: ${abstract || 'No abstract available.'}`;
  const { data } = await axios.post(OPENAI_URL, {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    temperature: 0,
    max_tokens: 5,
  }, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  const raw = data.choices[0].message.content.trim();
  const num = parseInt(raw, 10);
  return (num >= 1 && num <= 5) ? num : null;
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set. Create a .env file (see .env.example).');
    process.exit(1);
  }

  const papers = loadJSON(PAPERS_FILE);
  if (!papers) {
    console.error('papers.json not found. Run fetch_papers.js first.');
    process.exit(1);
  }

  const { union: instTargetIds, journalCount: instJn } = buildInstitutionTargetIds(papers);
  console.log(
    `Institution targets: ${instTargetIds.size} US orgs (global top ${TOP_N} ∪ per-journal top ${TOP_N}; ${instJn} journals).`
  );

  const paperIdsFromInstitutions = new Set();
  for (const p of papers) {
    if ((p.institutions || []).some(inst => inst.countryCode === 'US' && instTargetIds.has(inst.id))) {
      paperIdsFromInstitutions.add(p.id);
    }
  }

  let paperIdsFromAuthors = new Set();
  const authorRows = loadJSON(AUTHORS_FILE) || [];
  if (authorRows.length) {
    const authorTargets = buildAuthorTargetIdSet(authorRows);
    paperIdsFromAuthors = paperIdsAuthoredBy(authorRows, authorTargets);
    console.log(
      `Author targets: ${authorTargets.size} authors (global top ${TOP_N} ∪ per-journal top ${TOP_N}); ${paperIdsFromAuthors.size} papers list at least one.`
    );
  } else {
    console.warn('authors_papers.json missing or empty — run npm run fetch-authors for author-based coverage.');
  }

  const scopeIds = new Set([...paperIdsFromInstitutions, ...paperIdsFromAuthors]);
  const byId = new Map(papers.map(p => [p.id, p]));
  const relevantPapers = [...scopeIds].map(id => byId.get(id)).filter(Boolean);
  console.log(
    `${relevantPapers.length} unique papers in categorization scope (institutions ∪ authors), of ${papers.length} total in papers.json`
  );

  const categorized = loadJSON(OUT_FILE) || {};
  const todo = relevantPapers.filter(p => !(p.id in categorized));
  console.log(`${todo.length} papers to categorize (${Object.keys(categorized).length} already done)`);

  let count = 0;
  for (const paper of todo) {
    try {
      const cat = await classify(paper.title, paper.abstract);
      if (cat) {
        categorized[paper.id] = cat;
        count++;
        if (count % 20 === 0) console.log(`  ${count}/${todo.length} ...`);
      } else {
        console.warn(`  Could not parse category for: ${paper.title}`);
      }
    } catch (err) {
      console.error(`  Error classifying "${paper.title}": ${err.message}`);
    }

    if (count % BATCH_SIZE === 0) {
      saveJSON(OUT_FILE, categorized);
    }
  }

  saveJSON(OUT_FILE, categorized);
  console.log(`Done. ${count} new papers categorized. Total: ${Object.keys(categorized).length}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
