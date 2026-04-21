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
server.js                     # Express: /api/rankings, /api/authors, static public/
scripts/
  fetch_papers.js             # Pull works per journal source (papers.json)
  fetch_authors.js            # Same works, authorships for author rankings (authors_papers.json)
  compute_rankings.js         # Snapshot top 50 institutions → rankings.json
  categorize_papers.js        # GPT labels → categorized.json (scoped institutions + authors)
  build_rutgers_papers.js     # Rutgers slice → rutgers_papers.json (+ public/data, docs/data)
  export_top_publishers_ijais_jis.js   # Optional CSV exports
data/                         # Generated; not all committed in every clone
  papers.json                 # Works: title, abstract, institutions, doi, landingPageUrl, journal, …
  authors_papers.json         # One row per work: author list + institutions
  categorized.json            # Paper ID → category 1–5
  rankings.json               # Static top-50 snapshot (optional; app also computes live)
  rutgers_papers.json         # Rutgers-affiliated subset for the Research Papers page
public/
  index.html                  # Institution rankings
  authors.html                # Author rankings (uses /api/authors)
  rutgers-papers.html         # Rutgers paper list (loads public/data/rutgers_papers.json)
docs/                         # GitHub Pages: static copies of HTML + data/
```

## Architecture & data flow

**Source of truth.** Everything is derived from [OpenAlex](https://openalex.org/): journals are identified by **source ids**; works are fetched with cursor pagination. No manual spreadsheets.

**Two complementary pulls.**

- **`npm run fetch`** (`fetch_papers.js`) selects metadata needed for **institution rankings** and the Rutgers builder: title, abstract, publication year/date, authorships (to extract **institutions** on the work), plus **doi** and **primary_location.landing_page_url** when present.
- **`npm run fetch-authors`** (`fetch_authors.js`) pulls the same corpus with emphasis on **authorships** so each work has an ordered **author list** and per-author institutions. That file powers **`/api/authors`**, author-based categorization scope, and **author names on the Rutgers page** (joined by OpenAlex work `id`).

**Institution rankings.** For each filtered paper, every **distinct US institution** listed on the work gets +1 toward that school’s count (co-authors at the same org deduplicated). Results are sorted and the top 50 returned (live in `server.js` from `papers.json` + `categorized.json`; `compute_rankings.js` can write a static `rankings.json` snapshot).

**Author rankings.** Built from `authors_papers.json`: count papers per OpenAlex author id, competition-style ranks for ties, primary affiliation from the **most recent** paper in the dataset. Search filters the table but does **not** renumber ranks (rank is computed on the full filtered-by-journal leaderboard first).

**GPT categorization.** `categorize_papers.js` only sends papers in scope to OpenAI: institutions in the global top 50 ∪ per-journal top 50, plus every paper that includes an author in the global top 50 ∪ per-journal top 50 (from `authors_papers.json`). Labels are stored in `categorized.json` by work id.

**Rutgers Research Papers page.** `build_rutgers_papers.js` keeps works in `papers.json` that have at least one **US Rutgers-related** affiliation (OpenAlex institution id and name heuristics). It merges **author names** from `authors_papers.json` when the work id matches. **Note:** author strings on that page are exactly what the author fetch captured; authorship rows **without** an OpenAlex `author.id` are skipped in `fetch_authors.js`, so the list can differ slightly from a publisher PDF. Run **`npm run build-rutgers-page`** after fetches; outputs are copied to `data/`, `public/data/`, and `docs/data/` for static hosting.

**Running the UI.**

- **`npm start`** — Express serves `public/` and APIs at [http://localhost:3000](http://localhost:3000). Rankings and authors load live JSON from `data/`.
- **GitHub Pages** — Build the `docs/` site (HTML + `docs/data/*.json`). There is **no** `/api` on Pages; use the same JSON files. From the repo root: `npx serve docs` to preview locally.

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

Typical workflow: fetch papers → (optional) fetch authors → rank → categorize → rank again → start the server. Each step writes JSON under `data/` you can inspect.

### Step 1 -- Fetch papers from OpenAlex

```bash
npm run fetch
```

Pulls all papers from the six journals using cursor pagination. Converts `abstract_inverted_index` into readable text. Stores **doi** and **landing page URL** (`primary_location`) when OpenAlex provides them. Deduplicates by paper ID. Saves to `data/papers.json`.

**Authors file (for author rankings, categorization scope, Rutgers author names):**

```bash
npm run fetch-authors
```

Writes `data/authors_papers.json` (one record per work with full authorship list). Run after or alongside `npm run fetch` when you need fresh author names.

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

**Rutgers paper list (static JSON consumed by the browser):**

```bash
npm run build-rutgers-page
```

**Optional — CSV of top authors in IJAIS / JIS:**

```bash
npm run export-publishers
```

## Web Interface

- **Institutions** (`/`) — Filters: journal, time period (last N years or all time), search. Table: rank, organization, US publication totals, GPT theme columns.
- **Authors** (`/authors.html`) — Multi-select journals, search by name; competition ranks; primary affiliation from most recent paper in the corpus.
- **Rutgers papers** (`/rutgers-papers.html`) — All Rutgers-affiliated works in the six journals (from `rutgers_papers.json`), year dropdown, search by author / journal / title, publisher or DOI link when present. Regenerate JSON after `npm run fetch` + `npm run fetch-authors` + `npm run build-rutgers-page`.

## API

```
GET /api/rankings?journal=JIS&years=10
```

| Parameter | Description | Default |
|---|---|---|
| `journal` | Filter by journal abbreviation (AISEJ, IJAIS, IJDAR, ISAFM, JETA, JIS) | All journals |
| `years` | Limit to papers from the last N years | All time |

Returns a JSON array of the top 50 US institutions sorted by publication count.

```
GET /api/authors?journal=JIS&journal=JETA&q=smith
```

| Parameter | Description |
|---|---|
| `journal` | Repeat for each selected journal; omit for all journals |
| `q` | Optional substring filter on author name |

Returns ranked authors, affiliation metadata, and per-journal counts.

## Dependencies

- [express](https://www.npmjs.com/package/express) -- web server
- [axios](https://www.npmjs.com/package/axios) -- HTTP client for OpenAlex and OpenAI APIs
- [dotenv](https://www.npmjs.com/package/dotenv) -- loads `.env` configuration
