// Pulls recent law-enforcement-relevant opinions from CourtListener's free,
// public API (no scraping — this is a real structured API) and upserts
// them into the Supabase `updates` table as CASE RULING entries. Runs on
// a schedule via GitHub Actions — see .github/workflows/update-case-law.yml.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Search terms tuned toward law-enforcement-relevant Fourth/Fifth Amendment
// topics. CourtListener's search API treats this as a full-text query
// across opinion text — adjust freely as you learn what's noisy vs useful.
const SEARCH_QUERY = "fourth amendment search seizure OR fifth amendment miranda OR qualified immunity";
const COURT_LISTENER_URL = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(
  SEARCH_QUERY
)}&type=o&order_by=dateFiled+desc&filed_after=${getDateDaysAgo(14)}`;

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// Maps CourtListener's court_id prefixes to the exact state names your app
// uses (matching US_STATES in App.js). Covers each state's supreme court
// and main courts of appeals — the most common sources for the kind of
// case law this pipeline searches for. Anything unmapped (federal courts,
// unusual court codes, etc.) correctly falls through to "Federal" rather
// than guessing at a state — an unmapped result staying Federal is the
// safe failure mode; a mis-mapped one showing under the wrong state isn't.
const STATE_COURT_PREFIXES = {
  ala: "Alabama", alacrimapp: "Alabama", alacivapp: "Alabama",
  alaska: "Alaska", alaskactapp: "Alaska",
  ariz: "Arizona", arizctapp: "Arizona",
  ark: "Arkansas", arkctapp: "Arkansas",
  cal: "California", calctapp: "California",
  colo: "Colorado", coloctapp: "Colorado",
  conn: "Connecticut", connctapp: "Connecticut", connsuperct: "Connecticut",
  del: "Delaware", delsuperct: "Delaware",
  fla: "Florida", fladistctapp: "Florida",
  ga: "Georgia", gactapp: "Georgia",
  haw: "Hawaii", hawapp: "Hawaii",
  idaho: "Idaho", idahoctapp: "Idaho",
  ill: "Illinois", illappct: "Illinois",
  ind: "Indiana", indctapp: "Indiana",
  iowa: "Iowa", iowactapp: "Iowa",
  kan: "Kansas", kanctapp: "Kansas",
  ky: "Kentucky", kyctapp: "Kentucky",
  la: "Louisiana", lactapp: "Louisiana",
  me: "Maine",
  md: "Maryland", mdctspecapp: "Maryland",
  mass: "Massachusetts", massappct: "Massachusetts",
  mich: "Michigan", michctapp: "Michigan",
  minn: "Minnesota", minnctapp: "Minnesota",
  miss: "Mississippi", missctapp: "Mississippi",
  mo: "Missouri", moctapp: "Missouri",
  mont: "Montana",
  neb: "Nebraska", nebctapp: "Nebraska",
  nev: "Nevada",
  nh: "New Hampshire",
  nj: "New Jersey", njsuperctappdiv: "New Jersey",
  nm: "New Mexico", nmctapp: "New Mexico",
  ny: "New York", nyappdiv: "New York", nyappterm: "New York", nysupct: "New York",
  nc: "North Carolina", ncctapp: "North Carolina",
  nd: "North Dakota",
  ohio: "Ohio", ohioctapp: "Ohio",
  okla: "Oklahoma", oklacivapp: "Oklahoma", oklacrimapp: "Oklahoma",
  or: "Oregon", orctapp: "Oregon",
  pa: "Pennsylvania", pasuperct: "Pennsylvania", pacommwct: "Pennsylvania",
  ri: "Rhode Island",
  sc: "South Carolina", scctapp: "South Carolina",
  sd: "South Dakota",
  tenn: "Tennessee", tennctapp: "Tennessee", tenncrimapp: "Tennessee",
  tex: "Texas", texapp: "Texas", texcrimapp: "Texas",
  utah: "Utah", utahctapp: "Utah",
  vt: "Vermont",
  va: "Virginia", vactapp: "Virginia",
  wash: "Washington", washctapp: "Washington",
  wva: "West Virginia",
  wis: "Wisconsin", wisctapp: "Wisconsin",
  wyo: "Wyoming",
};

function resolveState(caseResult) {
  const courtId = caseResult.court_id;
  if (!courtId) return "Federal";
  return STATE_COURT_PREFIXES[courtId] || "Federal";
}

async function fetchCaseLaw() {
  const response = await fetch(COURT_LISTENER_URL, {
    headers: { "User-Agent": "BadgeIQ-Pipeline/1.0" },
  });
  if (!response.ok) {
    throw new Error(`CourtListener request failed: ${response.status}`);
  }
  const data = await response.json();
  return data.results || [];
}

// CourtListener results aren't state-specific by default (most are
// federal), so these land in a nationwide bucket rather than a specific
// state — mirroring how your bundled U.S. Supreme cases already work
// (shown regardless of selected state). Adjust `state` here if you later
// want to route specific circuits to specific states.
// Confirmed via a live run: CourtListener's v4 search API has no plain
// "id" field on opinion cluster results — the real identifier is
// `cluster_id`. Falls back to a name+date slug on the rare chance a
// result is missing it, and returns null (rather than a broken
// "cl-undefined" id) so the caller can skip that row entirely instead of
// silently overwriting every other row sharing the same bad id.
function extractCaseId(caseResult) {
  if (caseResult.cluster_id !== undefined && caseResult.cluster_id !== null) {
    return `cl-${caseResult.cluster_id}`;
  }

  if (caseResult.caseName && caseResult.dateFiled) {
    const slug = caseResult.caseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return `cl-${slug}-${caseResult.dateFiled}`;
  }

  return null;
}

function mapToUpdateRow(caseResult) {
  const dateFiled = caseResult.dateFiled ? new Date(caseResult.dateFiled) : new Date();
  const formattedDate = dateFiled.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const id = extractCaseId(caseResult);
  if (!id) return null; // caller filters these out

  return {
    id,
    state: resolveState(caseResult),
    type: "CASE RULING",
    title: caseResult.caseName || "Untitled Opinion",
    date: formattedDate,
    summary: (
      caseResult.snippet ||
      caseResult.syllabus ||
      caseResult.procedural_history ||
      "New opinion — no summary text available from source."
    ).slice(0, 400),
    impact:
      // Facts (title, date, court, summary) are safe to auto-publish as-is.
    // "What this means for you" is legal interpretation, not a fact — left
    // honest and unfabricated here rather than auto-generated, so the
    // content stays defensible for a buyer's legal review rather than
    // quietly presenting invented guidance as reviewed advice.
    impact: "Not yet interpreted for field impact. Read the full opinion linked above for details.",
    action: "No agency-specific guidance yet — informational only.",
  };
}

async function upsertToSupabase(rows) {
  if (rows.length === 0) {
    console.log("No new case law found this run.");
    return;
  }

  // Inserting one row per request (instead of one batch request for all
  // rows) trades a bit of speed for reliability: a single command with
  // multiple rows sharing a conflict key fails entirely, whereas one-at-a-
  // time upserts let every other row succeed even if one is malformed or
  // duplicated, and the per-row error tells us exactly which id failed.
  let successCount = 0;
  for (const row of rows) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/updates`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Failed to upsert row "${row.id}": ${response.status} ${text}`);
      continue;
    }
    successCount++;
  }

  console.log(`Upserted ${successCount} of ${rows.length} case law entries.`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  }
  const cases = await fetchCaseLaw();
  const mappedRows = cases.map(mapToUpdateRow).filter((row) => row !== null);

  // CourtListener can return the same opinion more than once in a single
  // search response — Supabase's upsert fails if a batch contains two rows
  // with the same primary key, so dedupe by id before sending, keeping
  // the first occurrence of each.
  const seenIds = new Set();
  const rows = mappedRows.filter((row) => {
    if (seenIds.has(row.id)) return false;
    seenIds.add(row.id);
    return true;
  });

  await upsertToSupabase(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
