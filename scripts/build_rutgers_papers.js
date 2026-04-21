/**
 * Lists papers in the six AIS journals where at least one listed affiliation
 * is Rutgers (The State University of New Jersey, OpenAlex I102322142, or other US Rutgers campuses).
 * Writes JSON consumed by public/rutgers-papers.html. Requires data/papers.json and data/authors_papers.json.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

const PAPERS_FILE = path.join(DATA_DIR, 'papers.json');
const AUTHORS_FILE = path.join(DATA_DIR, 'authors_papers.json');
const OUT_NAME = 'rutgers_papers.json';

/** Primary Rutgers in OpenAlex (New Brunswick / system). */
const RUTGERS_MAIN_ID = 'https://openalex.org/I102322142';

function isRutgersAffiliation(inst) {
  if (!inst || inst.countryCode !== 'US') return false;
  if (inst.id === RUTGERS_MAIN_ID) return true;
  const n = (inst.displayName || '').toLowerCase();
  if (!n.includes('rutgers')) return false;
  if (n.includes('sexual and reproductive')) return false;
  return (
    n.includes('state university of new jersey') ||
    n.includes('rutgers university') ||
    n.includes('rutgers business') ||
    /rutgers.{0,40}(camden|newark|new brunswick)/i.test(inst.displayName || '')
  );
}

function paperHasRutgers(paper) {
  return (paper.institutions || []).some(isRutgersAffiliation);
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildAuthorsByPaperId(authorRows) {
  const map = new Map();
  for (const row of authorRows) {
    const names = [];
    const seenIds = new Set();
    for (const a of row.authors || []) {
      const aid = a.authorId;
      if (aid && seenIds.has(aid)) continue;
      if (aid) seenIds.add(aid);
      const nm = (a.authorName || '').trim();
      if (!nm) continue;
      names.push(nm);
    }
    map.set(row.paperId, names);
  }
  return map;
}

function main() {
  if (!fs.existsSync(PAPERS_FILE)) {
    console.error('Missing data/papers.json — run npm run fetch');
    process.exit(1);
  }

  const papers = loadJSON(PAPERS_FILE);
  const authorRows = fs.existsSync(AUTHORS_FILE) ? loadJSON(AUTHORS_FILE) : [];
  const authorsByPaper = buildAuthorsByPaperId(authorRows);

  const out = [];
  for (const p of papers) {
    if (!paperHasRutgers(p)) continue;
    const authors = authorsByPaper.get(p.id) || [];
    out.push({
      id: p.id,
      title: p.title || '',
      journal: p.journal,
      publicationYear: p.publicationYear,
      publicationDate: p.publicationDate || null,
      doi: p.doi || null,
      landingPageUrl: p.landingPageUrl || null,
      authors,
    });
  }

  out.sort((a, b) => {
    const ya = Number(a.publicationYear) || 0;
    const yb = Number(b.publicationYear) || 0;
    if (yb !== ya) return yb - ya;
    const da = a.publicationDate || '';
    const db = b.publicationDate || '';
    if (db !== da) return db.localeCompare(da);
    return (a.title || '').localeCompare(b.title || '');
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    description:
      'AIS journal papers with at least one US Rutgers-related institution on the work (OpenAlex authorships).',
    count: out.length,
    papers: out,
  };

  const json = JSON.stringify(payload, null, 2);

  fs.writeFileSync(path.join(DATA_DIR, OUT_NAME), json);
  const pubData = path.join(PUBLIC_DIR, 'data');
  if (!fs.existsSync(pubData)) fs.mkdirSync(pubData, { recursive: true });
  fs.writeFileSync(path.join(pubData, OUT_NAME), json);

  const docsData = path.join(DOCS_DIR, 'data');
  if (fs.existsSync(DOCS_DIR)) {
    if (!fs.existsSync(docsData)) fs.mkdirSync(docsData, { recursive: true });
    fs.writeFileSync(path.join(docsData, OUT_NAME), json);
  }

  console.log(`Wrote ${out.length} Rutgers-affiliated papers to data/${OUT_NAME}, public/data/, and docs/data/ (if present).`);
}

main();
