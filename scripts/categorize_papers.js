require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAPERS_FILE = path.join(DATA_DIR, 'papers.json');
const RANKINGS_FILE = path.join(DATA_DIR, 'rankings.json');
const OUT_FILE = path.join(DATA_DIR, 'categorized.json');

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

  const rankings = loadJSON(RANKINGS_FILE);
  if (!rankings) {
    console.error('rankings.json not found. Run compute_rankings.js first to get top 50.');
    process.exit(1);
  }

  const top50Ids = new Set(rankings.map(r => r.institutionId));

  const relevantPapers = papers.filter(p =>
    p.institutions.some(inst => inst.countryCode === 'US' && top50Ids.has(inst.id))
  );
  console.log(`${relevantPapers.length} papers belong to top-50 institutions (out of ${papers.length} total)`);

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
