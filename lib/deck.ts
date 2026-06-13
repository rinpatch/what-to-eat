import deck from "@/data/deck.json";
import { rankCards, withinDistance } from "@/lib/ranking";
import type { DeckCard, DeckSource, TasteWeights } from "@/lib/types";

const source = deck as DeckSource;

export function getDeckCards(
  maxDistanceMin = 30,
  weights: TasteWeights = {},
  seenClipIds: string[] = [],
): DeckCard[] {
  const seen = new Set(seenClipIds);
  const placesById = new Map(
    source.places.map((place) => [place.placeId, place]),
  );

  const cards = source.clips
    .filter((clip) => !seen.has(clip.clipId))
    .map((clip) => {
      const place = placesById.get(clip.placeId);
      if (!place || !withinDistance(place, maxDistanceMin)) {
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

  return rankCards(cards, weights, seenClipIds.length);
}

export function findClip(clipId: string) {
  return source.clips.find((clip) => clip.clipId === clipId) ?? null;
}
