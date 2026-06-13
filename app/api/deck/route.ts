import { NextResponse } from "next/server";
import { getDeckCards } from "@/lib/deck";
import { CUISINE_TAGS, type CuisineTag } from "@/lib/types";

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

export function GET(request: Request) {
  const url = new URL(request.url);
  const maxDistanceKm = parseDistance(url.searchParams.get("maxDistanceKm"));
  const cuisines = parseCuisines(url.searchParams.get("cuisines"));

  return NextResponse.json({
    cards: getDeckCards(maxDistanceKm, {}, [], cuisines),
    cuisines,
    maxDistanceKm,
  });
}
