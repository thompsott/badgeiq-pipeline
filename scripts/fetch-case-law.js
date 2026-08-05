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

// Maps a CourtListener court identifier to a plain display name your app
// already knows how to color/categorize via getCourtStyle().
function courtDisplayName(courtId, courtName) {
  if (!courtId) return courtName || "Federal";
  if (courtId === "scotus") return "U.S. Supreme";
  if (courtId.startsWith("ca")) return `${courtId.toUpperCase()} Circuit`;
  return courtName || courtId;
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
function mapToUpdateRow(caseResult) {
  const dateFiled = caseResult.dateFiled ? new Date(caseResult.dateFiled) : new Date();
  const formattedDate = dateFiled.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return {
    id: `cl-${caseResult.id}`,
    state: "Federal",
    type: "CASE RULING",
    title: caseResult.caseName || "Untitled Opinion",
    date: formattedDate,
    summary: (caseResult.snippet || "New opinion — no summary text available from source.").slice(0, 400),
    impact:
      "Auto-imported from CourtListener — impact analysis not yet reviewed. Read the full opinion before relying on this for field guidance.",
    action:
      "Flagged for review: confirm this ruling's relevance and add specific guidance before treating as operational.",
  };
}

async function upsertToSupabase(rows) {
  if (rows.length === 0) {
    console.log("No new case law found this run.");
    return;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/updates`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates", // upsert on primary key (id)
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase upsert failed: ${response.status} ${text}`);
  }

  console.log(`Upserted ${rows.length} case law entries.`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  }
  const cases = await fetchCaseLaw();
  const rows = cases.map(mapToUpdateRow);
  await upsertToSupabase(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
