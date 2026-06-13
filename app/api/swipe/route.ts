import { NextResponse } from "next/server";
import { findClip, getDeckCards } from "@/lib/deck";
import { updateTasteWeights } from "@/lib/ranking";
import type { SwipeRequest } from "@/lib/types";

function parseDistance(value: unknown): number {
  const distance = Number(value);
  if (!Number.isFinite(distance)) {
    return 30;
  }

  return Math.min(45, Math.max(5, distance));
}

function normalizeSeenClipIds(value: unknown, clipId: string): string[] {
  const seen = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

  return Array.from(new Set([...seen, clipId]));
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
  const maxDistanceMin = parseDistance(body.maxDistanceMin);

  return NextResponse.json({
    weights,
    cards: getDeckCards(maxDistanceMin, weights, seenClipIds),
  });
}
