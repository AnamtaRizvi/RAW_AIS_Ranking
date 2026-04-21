const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'authors_papers.json');

const JOURNALS = {
  AISEJ: ['S4210208962'],
  IJAIS: ['S38901890'],
  IJDAR: ['S90108747'],
  ISAFM: ['S67471091', 'S4394735491'],
  JETA: ['S116843975'],
  JIS: ['S82262387'],
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
    const displayFromAuthor = (author.display_name || '').trim();
    const rawName = (a.raw_author_name || '').trim();
    const name = displayFromAuthor || rawName;

    const institutions = (a.institutions || []).map(inst => ({
      id: inst.id,
      displayName: inst.display_name || '',
      countryCode: inst.country_code || '',
    }));

    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
      authors.push({
        authorId: id,
        authorName: displayFromAuthor || rawName || '',
        orcid: author.orcid || null,
        institutions,
      });
    } else if (name) {
      authors.push({
        authorId: null,
        authorName: name,
        orcid: null,
        institutions,
      });
    }
  }
  return authors;
}

async function fetchJournal(abbrev, sourceId) {
  let cursor = '*';
  const records = [];
  // All publication years for this source (no from_publication_date filter).
  const filter = `primary_location.source.id:${sourceId}`;
  const select = 'id,authorships,publication_year,publication_date';

  console.log(`  Fetching source ${sourceId} ...`);

  while (cursor) {
    const url = `${BASE_URL}?filter=${filter}&select=${select}&per_page=${PER_PAGE}&cursor=${cursor}`;
    const { data } = await axios.get(url);

    for (const work of data.results) {
      records.push({
        paperId: work.id,
        journal: abbrev,
        publicationYear: work.publication_year,
        publicationDate: work.publication_date || null,
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
      const rows = await fetchJournal(abbrev, sid);
      for (const r of rows) {
        if (seenPapers.has(r.paperId)) continue;
        seenPapers.add(r.paperId);
        all.push(r);
      }
      console.log(`    ${rows.length} rows (${all.length} unique papers total)`);
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2));
  console.log(`\nDone. ${all.length} author-paper records saved to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
