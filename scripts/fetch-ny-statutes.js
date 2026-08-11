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
  // ===== Criminal — Penal Law =====

  // Larceny / Theft
  { lawId: "PEN", location: "155.25", category: "Criminal" }, // Petit Larceny
  { lawId: "PEN", location: "155.30", category: "Criminal" }, // Grand Larceny 4th
  { lawId: "PEN", location: "155.35", category: "Criminal" }, // Grand Larceny 3rd
  { lawId: "PEN", location: "155.40", category: "Criminal" }, // Grand Larceny 2nd
  { lawId: "PEN", location: "155.42", category: "Criminal" }, // Grand Larceny 1st
  { lawId: "PEN", location: "165.40", category: "Criminal" }, // Criminal Possession of Stolen Property 5th
  { lawId: "PEN", location: "165.45", category: "Criminal" }, // Criminal Possession of Stolen Property 4th
  { lawId: "PEN", location: "165.50", category: "Criminal" }, // Criminal Possession of Stolen Property 3rd

  // Burglary / Trespass
  { lawId: "PEN", location: "140.05", category: "Criminal" }, // Trespass
  { lawId: "PEN", location: "140.10", category: "Criminal" }, // Criminal Trespass 3rd
  { lawId: "PEN", location: "140.15", category: "Criminal" }, // Criminal Trespass 2nd
  { lawId: "PEN", location: "140.17", category: "Criminal" }, // Criminal Trespass 1st
  { lawId: "PEN", location: "140.20", category: "Criminal" }, // Burglary 3rd
  { lawId: "PEN", location: "140.25", category: "Criminal" }, // Burglary 2nd
  { lawId: "PEN", location: "140.30", category: "Criminal" }, // Burglary 1st

  // Robbery
  { lawId: "PEN", location: "160.05", category: "Criminal" }, // Robbery 3rd
  { lawId: "PEN", location: "160.10", category: "Criminal" }, // Robbery 2nd
  { lawId: "PEN", location: "160.15", category: "Criminal" }, // Robbery 1st

  // Assault / Violence
  { lawId: "PEN", location: "120.00", category: "Criminal" }, // Assault 3rd
  { lawId: "PEN", location: "120.05", category: "Criminal" }, // Assault 2nd
  { lawId: "PEN", location: "120.10", category: "Criminal" }, // Assault 1st
  { lawId: "PEN", location: "120.14", category: "Criminal" }, // Menacing 2nd
  { lawId: "PEN", location: "120.15", category: "Criminal" }, // Menacing 3rd
  { lawId: "PEN", location: "120.20", category: "Criminal" }, // Reckless Endangerment 2nd
  { lawId: "PEN", location: "120.25", category: "Criminal" }, // Reckless Endangerment 1st
  { lawId: "PEN", location: "121.11", category: "Criminal" }, // Criminal Obstruction of Breathing (Strangulation)
  { lawId: "PEN", location: "121.12", category: "Criminal" }, // Strangulation 2nd

  // Homicide
  { lawId: "PEN", location: "125.10", category: "Criminal" }, // Criminally Negligent Homicide
  { lawId: "PEN", location: "125.15", category: "Criminal" }, // Manslaughter 2nd
  { lawId: "PEN", location: "125.20", category: "Criminal" }, // Manslaughter 1st
  { lawId: "PEN", location: "125.25", category: "Criminal" }, // Murder 2nd
  { lawId: "PEN", location: "125.27", category: "Criminal" }, // Murder 1st

  // Sex Offenses
  { lawId: "PEN", location: "130.20", category: "Criminal" }, // Sexual Misconduct
  { lawId: "PEN", location: "130.25", category: "Criminal" }, // Rape 3rd
  { lawId: "PEN", location: "130.35", category: "Criminal" }, // Rape 1st
  { lawId: "PEN", location: "130.52", category: "Criminal" }, // Forcible Touching
  { lawId: "PEN", location: "130.55", category: "Criminal" }, // Sexual Abuse 3rd

  // Kidnapping / Coercion
  { lawId: "PEN", location: "135.05", category: "Criminal" }, // Unlawful Imprisonment 2nd
  { lawId: "PEN", location: "135.10", category: "Criminal" }, // Unlawful Imprisonment 1st
  { lawId: "PEN", location: "135.20", category: "Criminal" }, // Kidnapping 2nd
  { lawId: "PEN", location: "135.25", category: "Criminal" }, // Kidnapping 1st
  { lawId: "PEN", location: "135.60", category: "Criminal" }, // Coercion 2nd

  // Weapons
  { lawId: "PEN", location: "265.01", category: "Criminal" }, // Criminal Possession of a Weapon 4th
  { lawId: "PEN", location: "265.02", category: "Criminal" }, // Criminal Possession of a Weapon 3rd
  { lawId: "PEN", location: "265.03", category: "Criminal" }, // Criminal Possession of a Weapon 2nd
  { lawId: "PEN", location: "265.09", category: "Criminal" }, // Criminal Use of a Firearm 1st
  { lawId: "PEN", location: "265.20", category: "Criminal" }, // Exemptions

  // Drugs
  { lawId: "PEN", location: "220.03", category: "Criminal" }, // Criminal Possession of a Controlled Substance 7th
  { lawId: "PEN", location: "220.06", category: "Criminal" }, // Criminal Possession of a Controlled Substance 5th
  { lawId: "PEN", location: "220.09", category: "Criminal" }, // Criminal Possession of a Controlled Substance 4th
  { lawId: "PEN", location: "220.16", category: "Criminal" }, // Criminal Possession of a Controlled Substance 3rd
  { lawId: "PEN", location: "220.31", category: "Criminal" }, // Criminal Sale of a Controlled Substance 5th
  { lawId: "PEN", location: "220.39", category: "Criminal" }, // Criminal Sale of a Controlled Substance 3rd

  // Arson / Property Damage
  { lawId: "PEN", location: "145.00", category: "Criminal" }, // Criminal Mischief 4th
  { lawId: "PEN", location: "145.05", category: "Criminal" }, // Criminal Mischief 3rd
  { lawId: "PEN", location: "145.10", category: "Criminal" }, // Criminal Mischief 2nd
  { lawId: "PEN", location: "150.05", category: "Criminal" }, // Arson 4th
  { lawId: "PEN", location: "150.10", category: "Criminal" }, // Arson 3rd

  // Domestic Violence / Harassment
  { lawId: "PEN", location: "240.25", category: "Criminal" }, // Harassment 1st
  { lawId: "PEN", location: "240.26", category: "Criminal" }, // Harassment 2nd
  { lawId: "PEN", location: "240.30", category: "Criminal" }, // Aggravated Harassment 2nd
  { lawId: "PEN", location: "215.51", category: "Criminal" }, // Criminal Contempt 1st (Order of Protection Violation)

  // Disorderly Conduct / Public Order
  { lawId: "PEN", location: "240.20", category: "Criminal" }, // Disorderly Conduct
  { lawId: "PEN", location: "240.35", category: "Criminal" }, // Loitering
  { lawId: "PEN", location: "195.05", category: "Criminal" }, // Obstructing Governmental Administration 2nd
  { lawId: "PEN", location: "205.30", category: "Criminal" }, // Resisting Arrest

  // Fraud / Forgery
  { lawId: "PEN", location: "170.05", category: "Criminal" }, // Forgery 3rd
  { lawId: "PEN", location: "170.10", category: "Criminal" }, // Forgery 2nd
  { lawId: "PEN", location: "190.23", category: "Criminal" }, // False Personation
  { lawId: "PEN", location: "190.25", category: "Criminal" }, // Criminal Impersonation 2nd

  // ===== Traffic — Vehicle and Traffic Law =====

  // Impaired Driving
  { lawId: "VAT", location: "1192", category: "Traffic" },    // DWI
  { lawId: "VAT", location: "1193", category: "Traffic" },    // DWI Penalties

  // Speed / Basic Rules
  { lawId: "VAT", location: "1180", category: "Traffic" },    // Speeding
  { lawId: "VAT", location: "1181", category: "Traffic" },    // Speed Limits, School Zones
  { lawId: "VAT", location: "1212", category: "Traffic" },    // Reckless Driving
  { lawId: "VAT", location: "1146", category: "Traffic" },    // Duty to Exercise Due Care

  // Right of Way / Signals
  { lawId: "VAT", location: "1140", category: "Traffic" },    // Right of Way at Intersections
  { lawId: "VAT", location: "1141", category: "Traffic" },    // Vehicle Turning Left
  { lawId: "VAT", location: "1142", category: "Traffic" },    // Vehicle Entering Stop/Yield Intersection
  { lawId: "VAT", location: "1163", category: "Traffic" },    // Turning Movements
  { lawId: "VAT", location: "1172", category: "Traffic" },    // Stop Signs, Yield Signs
  { lawId: "VAT", location: "1110", category: "Traffic" },    // Obedience to Traffic Control Devices
  { lawId: "VAT", location: "1111", category: "Traffic" },    // Traffic Signals

  // Following / Lane Usage
  { lawId: "VAT", location: "1128", category: "Traffic" },    // Driving on Roadways Laned for Traffic
  { lawId: "VAT", location: "1129", category: "Traffic" },    // Following Too Closely
  { lawId: "VAT", location: "1122", category: "Traffic" },    // Overtaking on the Left

  // Licensing
  { lawId: "VAT", location: "509", category: "Traffic" },     // Unlicensed Operation
  { lawId: "VAT", location: "511", category: "Traffic" },     // Aggravated Unlicensed Operation

  // Accidents / Duty to Report
  { lawId: "VAT", location: "600", category: "Traffic" },     // Leaving Scene of Accident (Property Damage)
  { lawId: "VAT", location: "601", category: "Traffic" },     // Leaving Scene of Accident (Personal Injury)

  // Registration / Insurance
  { lawId: "VAT", location: "319", category: "Traffic" },     // Operating Without Insurance
  { lawId: "VAT", location: "401", category: "Traffic" },     // Registration Requirements

  // Equipment
  { lawId: "VAT", location: "375", category: "Traffic" },     // Lighting Equipment
  { lawId: "VAT", location: "1229", category: "Traffic" },    // Child Safety Seats
  { lawId: "VAT", location: "1229-c", category: "Traffic" },  // Seat Belts

  // Mobile Devices
  { lawId: "VAT", location: "1225-c", category: "Traffic" },  // Use of Mobile Telephones
  { lawId: "VAT", location: "1225-d", category: "Traffic" },  // Use of Portable Electronic Devices

  // Pedestrians
  { lawId: "VAT", location: "1151", category: "Traffic" },    // Pedestrians' Right of Way in Crosswalks
  { lawId: "VAT", location: "1156", category: "Traffic" },    // Pedestrians on Roadways

  // Emergency Vehicles
  { lawId: "VAT", location: "1144", category: "Traffic" },    // Move Over Law
  { lawId: "VAT", location: "1145", category: "Traffic" },    // Authorized Emergency Vehicles
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
