const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'authors_papers.json');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractAuthors(authorships) {
  const seen = new Set();
  const authors = [];
  for (const a of authorships || []) {
    const author = a.author || {};
    const id = author.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    authors.push({
      authorId: id,
      authorName: author.display_name || '',
      orcid: author.orcid || null,
    });
  }
  return authors;
}

async function fetchJournal(abbrev, sourceId) {
  let cursor = '*';
  const records = [];
  const filter = `primary_location.source.id:${sourceId},from_publication_date:1970-01-01`;
  const select = 'id,authorships,publication_year';

  console.log(`  Fetching source ${sourceId} ...`);

  while (cursor) {
    const url = `${BASE_URL}?filter=${filter}&select=${select}&per_page=${PER_PAGE}&cursor=${cursor}`;
    const { data } = await axios.get(url);

    for (const work of data.results) {
      records.push({
        paperId: work.id,
        journal: abbrev,
        publicationYear: work.publication_year,
        authors: extractAuthors(work.authorships),
      });
    }

    cursor = data.meta.next_cursor || null;
    if (cursor) await sleep(100);
  }

  return records;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const all = [];
  const seenPapers = new Set();

  for (const [abbrev, sourceIds] of Object.entries(JOURNALS)) {
    console.log(`\n[${abbrev}]`);
    for (const sid of sourceIds) {
      const records = await fetchJournal(abbrev, sid);
      for (const r of records) {
        if (seenPapers.has(r.paperId)) continue;
        seenPapers.add(r.paperId);
        all.push(r);
      }
      console.log(`    ${records.length} papers (${all.length} total unique)`);
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2));
  console.log(`\nDone. ${all.length} paper-author records saved to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
