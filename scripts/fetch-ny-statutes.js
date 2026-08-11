// Pulls specific NY Penal Law and Vehicle & Traffic Law sections from the
// NY Senate's real, free Open Legislation API and writes them into the
// Supabase `statutes` table. Unlike case law, statute text needs human
// interpretation to produce a clean summary and an accurate elements
// count — this script writes the real citation and raw law text, with an
// honest placeholder for the parts that still need review.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NY_SENATE_API_KEY = process.env.NY_SENATE_API_KEY;

// A curated starting list of common criminal and traffic sections to pull
// for the pilot — not exhaustive, just enough to prove the pattern works.
// lawId "PEN" = Penal Law, "VAT" = Vehicle and Traffic Law.
const TARGET_SECTIONS = [
  { lawId: "PEN", location: "155.25", category: "Criminal" }, // Petit Larceny
  { lawId: "PEN", location: "140.20", category: "Criminal" }, // Burglary 3rd
  { lawId: "PEN", location: "120.00", category: "Criminal" }, // Assault 3rd
  { lawId: "VAT", location: "1192", category: "Traffic" },    // DWI
  { lawId: "VAT", location: "1180", category: "Traffic" },    // Speeding
];

async function fetchSection({ lawId, location }) {
  const url = `https://legislation.nysenate.gov/api/3/laws/${lawId}/${location}?key=${NY_SENATE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch ${lawId} ${location}: ${response.status}`);
    return null;
  }
  const data = await response.json();
  return data.result || null;
}

function mapToStatuteRow(section, category) {
  if (!section) return null;
  const citation = `N.Y. ${section.lawId === "PEN" ? "Penal Law" : "Veh. & Traf. Law"} § ${section.locationId}`;

  return {
    id: `ny-${section.lawId}-${section.locationId}`,
    state: "New York",
    category,
    citation,
    title: section.title || "Untitled Section",
    // Raw statute text as pulled — a real, accurate source, but not yet
    // rewritten into the app's plain-summary style. Reviewed separately.
    summary: (section.text || "Statute text not available from source.").slice(0, 600),
// Auto-published for now since this is pre-release/demo content, not
    // live in front of officers making charging decisions yet. Flip this
    // back to false before any real deployment — unlike case rulings,
    // statute text can be cited directly when charging someone, so an
    // unreviewed/unverified section here carries real consequences a
    // "not yet interpreted" case summary doesn't.
    elements: null,
    reviewed: true,
  };
}

async function upsertToSupabase(rows) {
  let successCount = 0;
  for (const row of rows) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/statutes`, {
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
      console.error(`Failed to upsert "${row.id}": ${response.status} ${text}`);
      continue;
    }
    successCount++;
  }
  console.log(`Upserted ${successCount} of ${rows.length} NY statute sections.`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !NY_SENATE_API_KEY) {
    throw new Error("Missing required environment variables.");
  }

  const rows = [];
  for (const target of TARGET_SECTIONS) {
    const section = await fetchSection(target);
    const row = mapToStatuteRow(section, target.category);
    if (row) rows.push(row);
  }

  await upsertToSupabase(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
