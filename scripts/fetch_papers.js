const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'papers.json');

const JOURNALS = {
  AISEJ:  ['S4210208962'],
  IJAIS:  ['S38901890'],
  IJDAR:  ['S90108747'],
  ISAFM:  ['S67471091', 'S4394735491'],
  JETA:   ['S116843975'],
  JIS:    ['S82262387'],
};

const BASE_URL = 'https://api.openalex.org/works';
const PER_PAGE = 200;

function invertAbstract(invertedIndex) {
  if (!invertedIndex) return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.join(' ');
}

function extractInstitutions(authorships) {
  const seen = new Set();
  const institutions = [];
  for (const a of authorships || []) {
    for (const inst of a.institutions || []) {
      if (!inst.id || seen.has(inst.id)) continue;
      seen.add(inst.id);
      institutions.push({
        id: inst.id,
        displayName: inst.display_name || '',
        countryCode: inst.country_code || '',
      });
    }
  }
  return institutions;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJournal(abbrev, sourceId) {
  let cursor = '*';
  const papers = [];
  const filter = `primary_location.source.id:${sourceId},from_publication_date:1970-01-01`;
  const select = 'id,title,abstract_inverted_index,authorships,publication_year';

  console.log(`  Fetching source ${sourceId} ...`);

  while (cursor) {
    const url = `${BASE_URL}?filter=${filter}&select=${select}&per_page=${PER_PAGE}&cursor=${cursor}`;
    const { data } = await axios.get(url);

    for (const work of data.results) {
      papers.push({
        id: work.id,
        title: work.title || '',
        abstract: invertAbstract(work.abstract_inverted_index),
        journal: abbrev,
        publicationYear: work.publication_year,
        institutions: extractInstitutions(work.authorships),
      });
    }

    cursor = data.meta.next_cursor || null;
    if (cursor) await sleep(100);
  }

  return papers;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const allPapers = [];
  const seenIds = new Set();

  for (const [abbrev, sourceIds] of Object.entries(JOURNALS)) {
    console.log(`\n[${abbrev}]`);
    for (const sid of sourceIds) {
      const papers = await fetchJournal(abbrev, sid);
      for (const p of papers) {
        if (seenIds.has(p.id)) continue;
        seenIds.add(p.id);
        allPapers.push(p);
      }
      console.log(`    ${papers.length} papers fetched (${allPapers.length} total unique)`);
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(allPapers, null, 2));
  console.log(`\nDone. ${allPapers.length} papers saved to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
