const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUTHORS_FILE = path.join(DATA_DIR, 'authors_papers.json');
const OUT_FILE = path.join(DATA_DIR, 'authors_phd.json');

const BATCH_SIZE = 20;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function saveJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function extractOrcidId(orcidUrl) {
  if (!orcidUrl) return null;
  const match = orcidUrl.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/);
  return match ? match[1] : null;
}

const PHD_KEYWORDS = ['phd', 'ph.d', 'doctor of philosophy', 'doctoral', 'dba', 'dphil'];

function findPhdInstitution(educations) {
  if (!educations || !educations.length) return null;

  for (const edu of educations) {
    const role = (edu['role-title'] || '').toLowerCase();
    const dept = (edu['department-name'] || '').toLowerCase();
    const combined = role + ' ' + dept;

    const isPhd = PHD_KEYWORDS.some(kw => combined.includes(kw));
    if (isPhd && edu.organization) {
      return {
        institution: edu.organization.name || null,
        department: edu['department-name'] || null,
        source: 'orcid',
        confidence: 'high',
      };
    }
  }

  return null;
}

async function fetchOrcidEducation(orcidId) {
  const url = `https://pub.orcid.org/v3.0/${orcidId}/educations`;
  const { data } = await axios.get(url, {
    headers: { 'Accept': 'application/json' },
    timeout: 10000,
  });

  const groups = data['education-summary'] || data['affiliation-group'] || [];
  const educations = [];

  if (Array.isArray(groups)) {
    for (const item of groups) {
      if (item.summaries) {
        for (const s of item.summaries) {
          const summary = s['education-summary'] || s;
          educations.push(summary);
        }
      } else {
        educations.push(item);
      }
    }
  }

  return educations;
}

async function main() {
  const authorsPapers = loadJSON(AUTHORS_FILE);
  if (!authorsPapers) {
    console.error('authors_papers.json not found. Run fetch_authors.js first.');
    process.exit(1);
  }

  const uniqueAuthors = new Map();
  for (const paper of authorsPapers) {
    for (const a of paper.authors) {
      if (!uniqueAuthors.has(a.authorId)) {
        uniqueAuthors.set(a.authorId, {
          authorName: a.authorName,
          orcid: a.orcid,
        });
      }
    }
  }

  const withOrcid = [...uniqueAuthors.entries()]
    .filter(([, a]) => a.orcid)
    .map(([id, a]) => ({ authorId: id, ...a }));

  console.log(`${uniqueAuthors.size} unique authors, ${withOrcid.length} with ORCID`);

  const phdData = loadJSON(OUT_FILE) || {};
  const todo = withOrcid.filter(a => !(a.authorId in phdData));
  console.log(`${todo.length} authors to enrich (${Object.keys(phdData).length} already done)`);

  let count = 0;
  let found = 0;
  for (const author of todo) {
    const orcidId = extractOrcidId(author.orcid);
    if (!orcidId) {
      phdData[author.authorId] = { phdInstitution: null, source: 'no_valid_orcid', confidence: 'none' };
      count++;
      continue;
    }

    try {
      const educations = await fetchOrcidEducation(orcidId);
      const phd = findPhdInstitution(educations);

      if (phd) {
        phdData[author.authorId] = phd;
        found++;
      } else {
        phdData[author.authorId] = { phdInstitution: null, source: 'orcid_no_phd_found', confidence: 'none' };
      }
    } catch (err) {
      phdData[author.authorId] = { phdInstitution: null, source: 'orcid_error', confidence: 'none', error: err.message };
    }

    count++;
    if (count % 20 === 0) console.log(`  ${count}/${todo.length} enriched (${found} PhDs found so far)`);

    if (count % BATCH_SIZE === 0) {
      saveJSON(OUT_FILE, phdData);
    }

    await sleep(100);
  }

  saveJSON(OUT_FILE, phdData);
  console.log(`\nDone. ${count} authors enriched, ${found} PhD institutions found.`);
  console.log(`Total in file: ${Object.keys(phdData).length}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
