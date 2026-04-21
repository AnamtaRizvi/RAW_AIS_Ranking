/**
 * Writes exports/rutgers_papers.csv (UTF-8 BOM; opens in Excel).
 * Reads data/rutgers_papers.json — run npm run build-rutgers-page first.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(__dirname, '..', 'exports');
const RUTGERS_FILE = path.join(DATA_DIR, 'rutgers_papers.json');

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToLine(cols) {
  return cols.map(csvEscape).join(',');
}

function main() {
  if (!fs.existsSync(RUTGERS_FILE)) {
    console.error(`Missing ${RUTGERS_FILE}. Run: npm run build-rutgers-page`);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(RUTGERS_FILE, 'utf8'));
  const papers = payload.papers || [];

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const header = [
    'PublicationYear',
    'PublicationDate',
    'Journal',
    'Title',
    'Authors',
    'DOI',
    'LandingPageUrl',
    'OpenAlexWorkId',
  ];

  const lines = [rowToLine(header)];
  for (const p of papers) {
    const authors = (p.authors || []).join('; ');
    lines.push(
      rowToLine([
        p.publicationYear ?? '',
        p.publicationDate ?? '',
        p.journal ?? '',
        p.title ?? '',
        authors,
        p.doi ?? '',
        p.landingPageUrl ?? '',
        p.id ?? '',
      ])
    );
  }

  const outPath = path.join(OUT_DIR, 'rutgers_papers.csv');
  fs.writeFileSync(outPath, '\ufeff' + lines.join('\n'), 'utf8');
  console.log(`Wrote ${papers.length} rows → ${outPath}`);
}

main();
