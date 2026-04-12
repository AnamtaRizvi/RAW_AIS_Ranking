# AIS University Rankings

Ranks US universities by publication count across six AIS-related journals, using data from the [OpenAlex](https://openalex.org/) API. Papers are optionally classified into research categories via OpenAI.

## Journals Tracked

| Abbreviation | Full Name |
|---|---|
| AISEJ | AIS Educator Journal |
| IJAIS | International Journal of Accounting Information Systems |
| IJDAR | International Journal of Digital Accounting Research |
| ISAFM | Intelligent Systems in Accounting, Finance and Management |
| JETA | Journal of Emerging Technologies in Accounting |
| JIS | Journal of Information Systems |

## Research Categories

Each paper is classified into one of five categories:

1. Accounting & Financial AI
2. Business Intelligence & Decision Support
3. Information Systems & Applied Analytics
4. Engineering & Industrial AI
5. Core AI & Data Science Methods

## Project Structure

```
package.json
.env                          # OpenAI API key (not committed)
server.js                     # Express server with dynamic ranking API
scripts/
  fetch_papers.js             # Step 1: Fetch papers from OpenAlex
  compute_rankings.js         # Step 2: Compute top 50 US institution rankings
  categorize_papers.js        # Step 3: Classify papers (top-50 insts + top-50 authors, per scope)
data/                         # Generated at runtime
  papers.json                 # All fetched papers
  rankings.json               # Static top-50 ranking snapshot
  categorized.json            # Paper ID -> category number map
public/
  index.html                  # Frontend with filters and rankings table
```

## Setup

```bash
npm install
```

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Then add your OpenAI API key to `.env`:

```
OPENAI_API_KEY=sk-your-key-here
```

## Usage

Run the three scripts in order. Each writes a JSON file to `data/` that you can inspect.

### Step 1 -- Fetch papers from OpenAlex

```bash
npm run fetch
```

Pulls all papers (since 1970) from the six journals using cursor pagination. Converts `abstract_inverted_index` into readable text. Deduplicates by paper ID. Saves to `data/papers.json`.

### Step 2 -- Compute rankings

```bash
npm run rank
```

Counts unique US institutions per paper (+1 per paper regardless of how many co-authors share the same institution). Outputs the top 50 to `data/rankings.json`.

### Step 3 -- Categorize papers (requires OpenAI key)

```bash
npm run categorize
```

Sends each not-yet-labeled paper in scope to `gpt-4o-mini`. **Scope** is the union of: (1) every paper with a US affiliation at an institution in the **global** top 50 or that **journal’s** top 50 (by publication count), and (2) every paper that lists an author in the **global** top 50 or that **journal’s** top 50 (by count in `authors_papers.json`). Run `npm run fetch-authors` first so author coverage applies. Saves incrementally to `data/categorized.json` every 10 papers.

### Step 4 -- Recompute rankings with categories

```bash
npm run rank
```

Run the ranking script again after categorization to populate the per-category counts in `data/rankings.json`.

### Step 5 -- Start the web server

```bash
npm start
```

Opens at [http://localhost:3000](http://localhost:3000). The server loads `papers.json` and `categorized.json` into memory and computes rankings dynamically, so the web UI reflects category data without needing to re-run scripts.

## Web Interface

The frontend provides two filters:

- **Journal** -- select a specific journal or view all
- **Time Period** -- all time, last 10/20/30/40/50 years

The table displays rank, organization, country, total publication count, and per-category counts. Rankings recompute on the server each time a filter changes.

## API

```
GET /api/rankings?journal=JIS&years=10
```

| Parameter | Description | Default |
|---|---|---|
| `journal` | Filter by journal abbreviation (AISEJ, IJAIS, IJDAR, ISAFM, JETA, JIS) | All journals |
| `years` | Limit to papers from the last N years | All time |

Returns a JSON array of the top 50 US institutions sorted by publication count.

## Dependencies

- [express](https://www.npmjs.com/package/express) -- web server
- [axios](https://www.npmjs.com/package/axios) -- HTTP client for OpenAlex and OpenAI APIs
- [dotenv](https://www.npmjs.com/package/dotenv) -- loads `.env` configuration
