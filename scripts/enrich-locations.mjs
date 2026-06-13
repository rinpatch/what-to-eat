/**
 * Enriches raw_reels with location data:
 *   1. Extracts place name from caption + transcript via TokenRouter
 *   2. Normalises to a canonical place via Google Places API
 *   3. Upserts into places; stamps raw_reel with place_id + raw_place_name
 *
 * Usage:
 *   node scripts/enrich-locations.mjs [--limit <n>] [--dry-run]
 */

import { loadDotEnv } from "./pipeline/config.mjs";
import { extractLocationName, lookupGooglePlace } from "./pipeline/locations.mjs";
import {
  fetchUnenrichedReels,
  upsertPlace,
  updateReelLocation,
} from "./pipeline/supabase.mjs";

loadDotEnv();

const limit = (() => {
  const idx = process.argv.indexOf("--limit");
  if (idx !== -1) return Number(process.argv[idx + 1]) || 50;
  return 50;
})();
const dryRun = process.argv.includes("--dry-run");

if (dryRun) console.log("[dry-run] no writes will be performed");

const reels = await fetchUnenrichedReels(limit);
console.log(`Fetched ${reels.length} unenriched reel(s) (limit ${limit})`);

let enriched = 0;
let noPlace = 0;
let failed = 0;

for (const reel of reels) {
  const id = reel.reel_id;
  try {
    const placeName = await extractLocationName(reel.caption, reel.transcript);
    if (!placeName) {
      console.log(`  [${id}] no location found in text`);
      noPlace++;
      if (!dryRun) {
        // Mark so we don't retry on every run; use a sentinel value
        await updateReelLocation(id, { rawPlaceName: null, processingError: "no_location" });
      }
      continue;
    }

    console.log(`  [${id}] extracted: "${placeName}"`);
    const place = await lookupGooglePlace(placeName);

    if (!place) {
      console.log(`  [${id}] Google Places returned no result for "${placeName}"`);
      noPlace++;
      if (!dryRun) {
        await updateReelLocation(id, {
          rawPlaceName: placeName,
          processingError: "place_not_found",
        });
      }
      continue;
    }

    console.log(
      `  [${id}] resolved: ${place.name} (${place.place_id}) ` +
        `rating=${place.google_rating ?? "–"} ` +
        `reviews=${place.google_review_count ?? "–"} ` +
        `price=${place.price_level ?? "–"}`,
    );

    if (!dryRun) {
      await upsertPlace(place);
      await updateReelLocation(id, {
        rawPlaceName: placeName,
        placeId: place.place_id,
      });
    }

    enriched++;
  } catch (err) {
    console.error(`  [${id}] error: ${err.message}`);
    failed++;
    if (!dryRun) {
      await updateReelLocation(id, {
        processingError: err.message.slice(0, 500),
      }).catch(() => {});
    }
  }
}

console.log(`\nDone. enriched=${enriched} no_place=${noPlace} failed=${failed}`);
