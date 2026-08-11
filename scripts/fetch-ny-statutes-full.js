// Pulls EVERY section of NY Penal Law and Vehicle & Traffic Law by first
// fetching each law's full document tree (every chapter/article/section,
// nested), walking it to collect every section-level location ID, then
// fetching each section's actual text. This is the "genuinely everything"
// version — unlike fetch-ny-statutes.js's curated list, nothing here is
// hand-picked, so it will include administrative/irrelevant sections
// alongside real offenses. Runs weekly (see the matching workflow file)
// since this is a much larger, slower pull than the curated one.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NY_SENATE_API_KEY = process.env.NY_SENATE_API_KEY;

const TARGET_LAWS = [
  { lawId: "PEN", category: "Criminal" },
  { lawId: "VAT", category: "Traffic" },
];

// Small delay between requests to avoid hammering NY Senate's API — this
// script makes hundreds of sequential requests, so pacing matters more
// here than it did for the curated pull.
const REQUEST_DELAY_MS = 200;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLawTree(lawId) {
  const url = `https://legislation.nysenate.gov/api/3/laws/${lawId}?key=${NY_SENATE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch law tree for ${lawId}: ${response.status}`);
  }
  const data = await response.json();
  return data.result || null;
}

// Recursively walks the nested "documents" structure and collects every
// node whose docType looks like an actual section (as opposed to a
// CHAPTER/ARTICLE/TITLE grouping node, which has no citable text of its
// own). The exact docType value for a leaf section isn't confirmed yet —
// logging unique docType values seen on the first run so we can verify
// and tighten this filter if "SECTION" isn't quite right.
const seenDocTypes = new Set();

function collectSections(node, results) {
  if (!node) return;
  if (node.docType) seenDocTypes.add(node.docType);

  const isLeafSection =
    node.docType === "SECTION" && node.locationId && !hasChildDocuments(node);

  if (isLeafSection) {
    results.push({ locationId: node.locationId, title: node.title || null });
  }

  const children = getChildDocuments(node);
  children.forEach((child) => collectSections(child, results));
}

// The tree's nested-children field name isn't confirmed from docs alone —
// trying the most likely candidates defensively rather than assuming one.
function getChildDocuments(node) {
  if (Array.isArray(node.documents)) return node.documents;
  if (node.documents && Array.isArray(node.documents.items)) return node.documents.items;
  if (Array.isArray(node.items)) return node.items;
  return [];
}
function hasChildDocuments(node) {
  return getChildDocuments(node).length > 0;
}

async function fetchSectionText(lawId, locationId) {
  const url = `https://legislation.nysenate.gov/api/3/laws/${lawId}/${locationId}?key=${NY_SENATE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch ${lawId} ${locationId}: ${response.status}`);
    return null;
  }
  const data = await response.json();
  return data.result || null;
}

function mapToStatuteRow(section, lawId, category) {
  if (!section) return null;
  const citation = `N.Y. ${lawId === "PEN" ? "Penal Law" : "Veh. & Traf. Law"} § ${section.locationId}`;
  return {
    id: `ny-${lawId}-${section.locationId}`,
    state: "New York",
    category,
    citation,
    title: section.title || "Untitled Section",
    summary: (section.text || "Statute text not available from source.").slice(0, 600),
    elements: null,
    reviewed: true, // matches the earlier decision for pre-release/demo content
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
    if (successCount % 50 === 0) console.log(`...${successCount} upserted so far`);
  }
  console.log(`Upserted ${successCount} of ${rows.length} rows.`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !NY_SENATE_API_KEY) {
    throw new Error("Missing required environment variables.");
  }

  const allRows = [];

  for (const { lawId, category } of TARGET_LAWS) {
    console.log(`Fetching tree for ${lawId}...`);
    const tree = await fetchLawTree(lawId);
    if (!tree) {
      console.error(`No tree returned for ${lawId}, skipping.`);
      continue;
    }

    const sectionRefs = [];
    collectSections(tree.documents, sectionRefs);
    console.log(`Found ${sectionRefs.length} section-level docs in ${lawId}.`);
    console.log(`docType values seen so far:`, Array.from(seenDocTypes));

    if (sectionRefs.length === 0) {
      console.error(
        `No sections collected for ${lawId} — the docType filter or child-document field name likely needs adjusting. See docType values logged above.`
      );
      continue;
    }

    for (const ref of sectionRefs) {
      const section = await fetchSectionText(lawId, ref.locationId);
      const row = mapToStatuteRow(section, lawId, category);
      if (row) allRows.push(row);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`Total rows collected: ${allRows.length}`);
  await upsertToSupabase(allRows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
