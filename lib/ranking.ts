import type {
  Clip,
  DeckCard,
  Place,
  SwipeAction,
  TasteTag,
  TasteWeights,
  UserLocation,
} from "@/lib/types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const EARTH_RADIUS_KM = 6371;

export function clipTags(clip: Clip): TasteTag[] {
  return [clip.tags.cuisine, clip.tags.priceBand, clip.tags.vibe];
}

export function velocityScore(clip: Clip, now = new Date()): number {
  const ageDays = Math.max(
    0.25,
    (now.getTime() - new Date(clip.postedAt).getTime()) / DAY_IN_MS,
  );

  return Math.round((clip.engagement / Math.pow(ageDays + 1, 1.18)) / 100) / 10;
}

export function personalizationWeight(seenCount: number): number {
  return Math.min(1, Math.max(0, seenCount / 5));
}

export function personalScore(clip: Clip, weights: TasteWeights): number {
  return clipTags(clip).reduce((score, tag) => score + (weights[tag] ?? 0), 0);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceKmBetween(
  from: UserLocation,
  to: Pick<Place, "lat" | "lng">,
): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function withUserDistance(
  place: Place,
  userLocation?: UserLocation | null,
): Place {
  if (!userLocation) {
    return place;
  }

  const distanceKm = distanceKmBetween(userLocation, place);

  return {
    ...place,
    distanceKm,
    distanceMinutes: Math.max(1, Math.round((distanceKm / 18) * 60)),
  };
}

export function reviewScore(place: Place): number {
  if (!place.googleRating) {
    return 0.42;
  }

  const ratingScore = clamp01((place.googleRating - 3.4) / 1.6);
  const confidenceScore = place.googleReviewCount
    ? clamp01(Math.log10(place.googleReviewCount + 1) / 4)
    : 0.35;

  return ratingScore * 0.72 + confidenceScore * 0.28;
}

export function distanceScore(place: Place, maxDistanceKm: number): number {
  return clamp01(1 - place.distanceKm / Math.max(1, maxDistanceKm));
}

export function updateTasteWeights(
  weights: TasteWeights,
  clip: Clip,
  action: SwipeAction,
): TasteWeights {
  const delta = action === "right" ? 1 : -1;
  const nextWeights = { ...weights };

  for (const tag of clipTags(clip)) {
    nextWeights[tag] = (nextWeights[tag] ?? 0) + delta;
  }

  return nextWeights;
}

export function rankCards(
  cards: DeckCard[],
  weights: TasteWeights = {},
  seenCount = 0,
  maxDistanceKm = 10,
): DeckCard[] {
  const ramp = personalizationWeight(seenCount);

  return cards
    .map((card) => {
      const velocity = velocityScore(card.clip);
      const google = reviewScore(card.place);
      const nearby = distanceScore(card.place, maxDistanceKm);
      const personal = personalScore(card.clip, weights);
      return {
        ...card,
        velocityScore: velocity,
        score:
          velocity * 0.5 +
          google * 4.2 +
          nearby * 3.4 +
          ramp * personal * 1.15,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function withinDistance(place: Place, maxDistanceKm: number): boolean {
  return place.distanceKm <= maxDistanceKm;
}
