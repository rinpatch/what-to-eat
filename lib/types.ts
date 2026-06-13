export type SwipeAction = "left" | "right";

export type CuisineTag =
  | "chinese"
  | "japanese"
  | "korean"
  | "local"
  | "malay"
  | "thai"
  | "western";

export type PriceBandTag = "cheap" | "mid" | "treat";

export type VibeTag =
  | "comfort"
  | "date-night"
  | "hawker"
  | "spicy"
  | "supper"
  | "sweet";

export type TasteTag = CuisineTag | PriceBandTag | VibeTag;

export type ClipTags = {
  cuisine: CuisineTag;
  priceBand: PriceBandTag;
  vibe: VibeTag;
};

export type Place = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  googleRating: number | null;
  priceLevel: number | null;
  distanceMinutes: number;
  distanceKm: number;
  mapUrl: string;
};

export type Clip = {
  clipId: string;
  placeId: string;
  dishName: string;
  price: string | null;
  videoUrl: string | null;
  posterUrl: string;
  clipStart: number;
  clipEnd: number;
  influencer: string;
  postedAt: string;
  caption: string;
  tags: ClipTags;
  pullQuote: string | null;
  engagement: number;
};

export type DeckSource = {
  places: Place[];
  clips: Clip[];
};

export type CreatorMention = {
  clipId: string;
  influencer: string;
  postedAt: string;
  pullQuote: string | null;
};

export type DeckCard = {
  clip: Clip;
  place: Place;
  creators: CreatorMention[];
  velocityScore: number;
  score: number;
};

export type TasteWeights = Partial<Record<TasteTag, number>>;

export type SwipeRequest = {
  clipId: string;
  action: SwipeAction;
  weights?: TasteWeights;
  seenClipIds?: string[];
  maxDistanceMin?: number;
};
