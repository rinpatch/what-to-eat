import { NextResponse } from "next/server";
import { getDeckCards } from "@/lib/deck";
import {
  CUISINE_TAGS,
  type CuisineTag,
  type TasteWeights,
  type UserLocation,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const cuisineSet = new Set<string>(CUISINE_TAGS);

function parseDistance(value: string | null): number {
  const distance = Number(value);
  if (!Number.isFinite(distance)) {
    return 10;
  }

  return Math.min(15, Math.max(1, distance));
}

function parseCuisines(value: string | null): CuisineTag[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is CuisineTag => cuisineSet.has(item)),
    ),
  );
}

function parseLocation(url: URL): UserLocation | null {
  if (!url.searchParams.has("lat") || !url.searchParams.has("lng")) {
    return null;
  }

  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return { lat, lng };
}

function parseSeenClipIds(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function parseWeights(value: string | null): TasteWeights {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, weight]) => [key, Number(weight)] as const)
        .filter(([, weight]) => Number.isFinite(weight)),
    );
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const maxDistanceKm = parseDistance(url.searchParams.get("maxDistanceKm"));
  const cuisines = parseCuisines(url.searchParams.get("cuisines"));
  const seenClipIds = parseSeenClipIds(url.searchParams.get("seenClipIds"));
  const weights = parseWeights(url.searchParams.get("weights"));
  const userLocation = parseLocation(url);

  return NextResponse.json({
    cards: await getDeckCards(
      maxDistanceKm,
      weights,
      seenClipIds,
      cuisines,
      userLocation,
    ),
    cuisines,
    maxDistanceKm,
    locationRanked: Boolean(userLocation),
  });
}
