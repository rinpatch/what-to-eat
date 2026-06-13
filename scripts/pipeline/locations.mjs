import { pipelineConfig } from "./config.mjs";
import { fetchJson } from "./http.mjs";

const PLACES_API_BASE = "https://places.googleapis.com/v1";

// Maps Google's PRICE_LEVEL_* enum values to our 1-4 schema range
const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: null,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/**
 * Calls TokenRouter (OpenAI-compatible) to extract the food place name
 * from a reel's caption and transcript. Returns null if none found.
 */
export async function extractLocationName(caption, transcript) {
  const config = pipelineConfig();
  if (!config.tokenRouter.apiKey) throw new Error("Missing TOKEN_ROUTER_API_KEY");

  const content = [
    caption ? `Caption: ${caption}` : null,
    transcript ? `Transcript: ${transcript}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!content.trim()) return null;

  const response = await fetchJson(`${config.tokenRouter.baseUrl}/chat/completions`, {
    headers: {
      Authorization: `Bearer ${config.tokenRouter.apiKey}`,
      "HTTP-Referer": "https://github.com/rinpatch/what-to-eat-ah",
    },
    body: {
      model: config.tokenRouter.model,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content:
            "Extract the name of the food establishment (restaurant, hawker stall, café, etc.) featured in this Singapore food influencer video. " +
            "Reply with ONLY the establishment name as it would appear on Google Maps. " +
            "If multiple places are mentioned, return the primary one. " +
            'If no specific place is identifiable, reply with the single word "null".\n\n' +
            content,
        },
      ],
    },
  });

  const raw = response?.choices?.[0]?.message?.content?.trim();
  if (!raw || raw.toLowerCase() === "null" || raw.length < 2) return null;
  return raw;
}

/**
 * Looks up a place by name using Google Places Text Search (new API).
 * Returns a normalized place object ready to upsert into the places table,
 * or null if no result found.
 */
export async function lookupGooglePlace(placeName, opts = {}) {
  const config = pipelineConfig();
  if (!config.maps.apiKey) throw new Error("Missing GOOGLE_PLACES_API_KEY");

  // Bias search toward Singapore
  const textQuery = placeName.includes("Singapore") ? placeName : `${placeName} Singapore`;

  const fields = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.priceLevel",
  ].join(",");

  const body = {
    textQuery,
    languageCode: "en",
    maxResultCount: 1,
  };

  if (opts.lat != null && opts.lng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: opts.lat, longitude: opts.lng },
        radius: 50000,
      },
    };
  }

  const response = await fetchJson(`${PLACES_API_BASE}/places:searchText`, {
    headers: {
      "X-Goog-Api-Key": config.maps.apiKey,
      "X-Goog-FieldMask": fields,
    },
    body,
  });

  const place = response?.places?.[0];
  if (!place) return null;

  const priceLevel = PRICE_LEVEL_MAP[place.priceLevel] ?? null;

  return {
    place_id: place.id,
    name: place.displayName?.text || placeName,
    address: place.formattedAddress || "",
    lat: place.location?.latitude ?? 0,
    lng: place.location?.longitude ?? 0,
    google_rating: place.rating ?? null,
    google_review_count: place.userRatingCount ?? null,
    price_level: priceLevel,
  };
}
