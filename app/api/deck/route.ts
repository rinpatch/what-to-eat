import { NextResponse } from "next/server";
import { getDeckCards } from "@/lib/deck";

export const dynamic = "force-dynamic";

function parseDistance(value: string | null): number {
  const distance = Number(value);
  if (!Number.isFinite(distance)) {
    return 30;
  }

  return Math.min(45, Math.max(5, distance));
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const maxDistanceMin = parseDistance(url.searchParams.get("maxDistanceMin"));

  return NextResponse.json({
    cards: getDeckCards(maxDistanceMin),
    maxDistanceMin
  });
}
