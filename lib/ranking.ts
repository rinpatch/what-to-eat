import type {
  Clip,
  DeckCard,
  Place,
  SwipeAction,
  TasteTag,
  TasteWeights,
} from "@/lib/types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

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
): DeckCard[] {
  const ramp = personalizationWeight(seenCount);

  return cards
    .map((card) => {
      const velocity = velocityScore(card.clip);
      return {
        ...card,
        velocityScore: velocity,
        score: velocity + ramp * personalScore(card.clip, weights),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function withinDistance(place: Place, maxDistanceKm: number): boolean {
  return place.distanceKm <= maxDistanceKm;
}
