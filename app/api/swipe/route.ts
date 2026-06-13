import { NextResponse } from "next/server";
import { findClip, getDeckCards } from "@/lib/deck";
import { updateTasteWeights } from "@/lib/ranking";
import { CUISINE_TAGS, type CuisineTag, type SwipeRequest } from "@/lib/types";

const cuisineSet = new Set<string>(CUISINE_TAGS);

function parseDistance(value: unknown): number {
  const distance = Number(value);
  if (!Number.isFinite(distance)) {
    return 10;
  }

  return Math.min(15, Math.max(1, distance));
}

function normalizeSeenClipIds(value: unknown, clipId: string): string[] {
  const seen = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

  return Array.from(new Set([...seen, clipId]));
}

function normalizeCuisines(value: unknown): CuisineTag[] {
  const rawItems =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : [];

  return Array.from(
    new Set(
      rawItems
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is CuisineTag => cuisineSet.has(item)),
    ),
  );
}

export async function POST(request: Request) {
  let body: SwipeRequest;

  try {
    body = (await request.json()) as SwipeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action !== "left" && body.action !== "right") {
    return NextResponse.json(
      { error: "Swipe action must be left or right." },
      { status: 400 },
    );
  }

  const clip = findClip(body.clipId);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  const weights = updateTasteWeights(body.weights ?? {}, clip, body.action);
  const seenClipIds = normalizeSeenClipIds(body.seenClipIds, clip.clipId);
  const maxDistanceKm = parseDistance(body.maxDistanceKm);
  const cuisines = normalizeCuisines(body.cuisines);

  return NextResponse.json({
    weights,
    cards: getDeckCards(maxDistanceKm, weights, seenClipIds, cuisines),
  });
}
