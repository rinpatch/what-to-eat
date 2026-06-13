import { createClient } from "@supabase/supabase-js";
import deck from "@/data/deck.json";
import { rankCards, withinDistance, withUserDistance } from "@/lib/ranking";
import {
  CUISINE_TAGS,
  type ClipTags,
  type CuisineTag,
  type DeckCard,
  type DeckSource,
  type Place,
  type PriceBandTag,
  type TasteWeights,
  type UserLocation,
  type VibeTag,
} from "@/lib/types";

const source = deck as DeckSource;
const DEFAULT_POSTER =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80";
const DEFAULT_MAP_CENTER: UserLocation = { lat: 1.3521, lng: 103.8198 };
const cuisineSet = new Set<string>(CUISINE_TAGS);
const priceBands = new Set<string>(["cheap", "mid", "treat"]);
const vibes = new Set<string>([
  "comfort",
  "date-night",
  "hawker",
  "spicy",
  "supper",
  "sweet",
]);

type PlaceRow = {
  place_id: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  google_rating: number | null;
  google_review_count: number | null;
  price_level: number | null;
};

type ClipRow = {
  clip_id: string;
  reel_id: string | null;
  place_id: string | null;
  dish_name: string | null;
  price: string | null;
  video_url: string | null;
  stream_url: string | null;
  clip_start: number | null;
  clip_end: number | null;
  influencer: string | null;
  posted_at: string | null;
  caption: string | null;
  tags: Partial<ClipTags> | null;
  pull_quote: string | null;
  engagement_score: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  places: PlaceRow | PlaceRow[] | null;
};

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeTags(tags: Partial<ClipTags> | null): ClipTags {
  const cuisine = tags?.cuisine;
  const priceBand = tags?.priceBand;
  const vibe = tags?.vibe;

  return {
    cuisine:
      typeof cuisine === "string" && cuisineSet.has(cuisine)
        ? cuisine
        : "local",
    priceBand:
      typeof priceBand === "string" && priceBands.has(priceBand)
        ? (priceBand as PriceBandTag)
        : "mid",
    vibe: typeof vibe === "string" && vibes.has(vibe) ? (vibe as VibeTag) : "comfort",
  };
}

function mapUrl(place: Pick<Place, "name" | "lat" | "lng">): string {
  const query = encodeURIComponent(`${place.name} ${place.lat},${place.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function normalizePlace(row: PlaceRow, userLocation?: UserLocation | null): Place {
  const place: Place = {
    placeId: row.place_id,
    name: row.name || "Unknown spot",
    address: row.address || "Singapore",
    lat: row.lat ?? DEFAULT_MAP_CENTER.lat,
    lng: row.lng ?? DEFAULT_MAP_CENTER.lng,
    googleRating: row.google_rating,
    googleReviewCount: row.google_review_count,
    priceLevel: row.price_level,
    distanceMinutes: 0,
    distanceKm: 0,
    mapUrl: "",
  };

  const withDistance = withUserDistance(
    {
      ...place,
      distanceKm: 0,
      distanceMinutes: 0,
    },
    userLocation ?? DEFAULT_MAP_CENTER,
  );

  return {
    ...withDistance,
    mapUrl: mapUrl(withDistance),
  };
}

function firstPlace(row: ClipRow): PlaceRow | null {
  if (Array.isArray(row.places)) {
    return row.places[0] ?? null;
  }

  return row.places;
}

function engagement(row: ClipRow): number {
  if (row.engagement_score && Number.isFinite(row.engagement_score)) {
    return Math.round(row.engagement_score * 100);
  }

  return (row.likes ?? 0) + (row.comments ?? 0) * 2 + (row.shares ?? 0) * 3;
}

async function getBackendDeckCards(
  userLocation?: UserLocation | null,
): Promise<DeckCard[]> {
  const client = supabaseClient();

  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("clips")
    .select(
      "clip_id,reel_id,place_id,dish_name,price,video_url,stream_url,clip_start,clip_end,influencer,posted_at,caption,tags,pull_quote,engagement_score,likes,comments,shares,views,places(place_id,name,address,lat,lng,google_rating,google_review_count,price_level)",
    )
    .not("place_id", "is", null)
    .order("posted_at", { ascending: false })
    .limit(160);

  if (error) {
    console.error("Failed to fetch backend deck:", error.message);
    return [];
  }

  const rows = (data ?? []) as ClipRow[];
  const placeById = new Map<string, Place>();
  const cards: DeckCard[] = rows
    .flatMap((row): DeckCard[] => {
      const placeRow = firstPlace(row);
      if (!placeRow) {
        return [];
      }

      const place = normalizePlace(placeRow, userLocation);
      placeById.set(place.placeId, place);

      return [{
        clip: {
          clipId: row.clip_id,
          placeId: place.placeId,
          dishName: row.dish_name || "Something good",
          price: row.price,
          videoUrl: row.stream_url || row.video_url,
          posterUrl: DEFAULT_POSTER,
          clipStart: row.clip_start ?? 0,
          clipEnd: row.clip_end ?? 18,
          influencer: row.influencer || "@creator",
          postedAt: row.posted_at || new Date().toISOString(),
          caption: row.caption || "",
          tags: normalizeTags(row.tags),
          pullQuote: row.pull_quote,
          engagement: engagement(row),
        },
        place,
        creators: [],
        velocityScore: 0,
        score: 0,
      }];
    });

  const creatorsByPlaceId = new Map<string, DeckCard["creators"]>();
  for (const card of cards) {
    creatorsByPlaceId.set(card.place.placeId, [
      ...(creatorsByPlaceId.get(card.place.placeId) ?? []),
      {
        clipId: card.clip.clipId,
        influencer: card.clip.influencer,
        postedAt: card.clip.postedAt,
        pullQuote: card.clip.pullQuote,
      },
    ]);
  }

  return cards.map((card) => ({
    ...card,
    place: placeById.get(card.place.placeId) ?? card.place,
    creators: creatorsByPlaceId.get(card.place.placeId) ?? [],
  }));
}

function getStaticDeckCards(
  maxDistanceKm = 10,
  weights: TasteWeights = {},
  seenClipIds: string[] = [],
  cuisines: CuisineTag[] = [],
  userLocation?: UserLocation | null,
): DeckCard[] {
  const seen = new Set(seenClipIds);
  const cuisineFilter = new Set(cuisines);
  const placesById = new Map(
    source.places.map((place) => [
      place.placeId,
      {
        ...place,
        googleReviewCount: place.googleReviewCount ?? null,
      },
    ]),
  );

  const cards = source.clips
    .filter((clip) => !seen.has(clip.clipId))
    .filter((clip) => !cuisineFilter.size || cuisineFilter.has(clip.tags.cuisine))
    .map((clip) => {
      const staticPlace = placesById.get(clip.placeId);
      const place = staticPlace
        ? withUserDistance(staticPlace, userLocation)
        : null;
      if (!place || !withinDistance(place, maxDistanceKm)) {
        return null;
      }

      const creators = source.clips
        .filter((mention) => mention.placeId === clip.placeId)
        .map((mention) => ({
          clipId: mention.clipId,
          influencer: mention.influencer,
          postedAt: mention.postedAt,
          pullQuote: mention.pullQuote,
        }));

      return {
        clip,
        place,
        creators,
        velocityScore: 0,
        score: 0,
      };
    })
    .filter((card): card is DeckCard => Boolean(card));

  return rankCards(cards, weights, seenClipIds.length, maxDistanceKm);
}

export async function getDeckCards(
  maxDistanceKm = 10,
  weights: TasteWeights = {},
  seenClipIds: string[] = [],
  cuisines: CuisineTag[] = [],
  userLocation?: UserLocation | null,
): Promise<DeckCard[]> {
  const seen = new Set(seenClipIds);
  const cuisineFilter = new Set(cuisines);
  const backendCards = await getBackendDeckCards(userLocation);
  const sourceCards = backendCards.length
    ? backendCards
    : getStaticDeckCards(maxDistanceKm, {}, [], [], userLocation);

  const filteredCards = sourceCards
    .filter((card) => !seen.has(card.clip.clipId))
    .filter(
      (card) =>
        !cuisineFilter.size || cuisineFilter.has(card.clip.tags.cuisine),
    )
    .filter((card) => withinDistance(card.place, maxDistanceKm));

  return rankCards(filteredCards, weights, seenClipIds.length, maxDistanceKm);
}

export async function findClip(clipId: string) {
  const client = supabaseClient();

  if (client) {
    const { data, error } = await client
      .from("clips")
      .select(
        "clip_id,place_id,dish_name,price,video_url,stream_url,clip_start,clip_end,influencer,posted_at,caption,tags,pull_quote,engagement_score,likes,comments,shares,views",
      )
      .eq("clip_id", clipId)
      .maybeSingle();

    if (!error && data) {
      const row = data as Omit<ClipRow, "places" | "reel_id">;
      return {
        clipId: row.clip_id,
        placeId: row.place_id ?? "",
        dishName: row.dish_name || "Something good",
        price: row.price,
        videoUrl: row.stream_url || row.video_url,
        posterUrl: DEFAULT_POSTER,
        clipStart: row.clip_start ?? 0,
        clipEnd: row.clip_end ?? 18,
        influencer: row.influencer || "@creator",
        postedAt: row.posted_at || new Date().toISOString(),
        caption: row.caption || "",
        tags: normalizeTags(row.tags),
        pullQuote: row.pull_quote,
        engagement: engagement({ ...row, reel_id: null, places: null }),
      };
    }
  }

  return source.clips.find((clip) => clip.clipId === clipId) ?? null;
}
