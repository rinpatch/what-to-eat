"use client";

/* eslint-disable @next/next/no-img-element, react-hooks/set-state-in-effect */

import {
  Bookmark,
  ChevronDown,
  Check,
  Flame,
  Heart,
  MapPin,
  Navigation,
  RotateCcw,
  SlidersHorizontal,
  Star,
  X
} from "lucide-react";
import {
  PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent
} from "react";
import {
  CUISINE_TAGS,
  type CuisineTag,
  type DeckCard,
  type SwipeAction,
  type TasteWeights,
  type UserLocation
} from "@/lib/types";

type DragState = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
};

type SessionState = {
  seenClipIds: string[];
  savedCards: DeckCard[];
  weights: TasteWeights;
  maxDistanceKm: number;
  selectedCuisines: CuisineTag[];
};

type HistoryEntry = SessionState & {
  cards: DeckCard[];
};

type LocationStatus = "requesting" | "granted" | "denied" | "unavailable";

const STORAGE_KEY = "what-to-eat-ah-session";
const DEFAULT_DISTANCE_KM = 10;
const MIN_DISTANCE_KM = 1;
const MAX_DISTANCE_KM = 15;
const SWIPE_THRESHOLD = 92;
const SWIPE_OUT_MS = 220;
const cuisineSet = new Set<string>(CUISINE_TAGS);
const cuisineLabels: Record<CuisineTag, string> = {
  local: "Local",
  malay: "Malay",
  chinese: "Chinese",
  japanese: "Japanese",
  korean: "Korean",
  thai: "Thai",
  western: "Western",
  french: "French",
  spanish: "Spanish",
  italian: "Italian",
  peruvian: "Peruvian",
  mediterranean: "Mediterranean",
  indian: "Indian",
  russian: "Russian",
  african: "African"
};

const emptyDrag: DragState = {
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  dragging: false
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeCuisines(value: unknown): CuisineTag[] {
  const rawItems = Array.isArray(value) ? value : [];

  return Array.from(
    new Set(
      rawItems
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is CuisineTag => cuisineSet.has(item)),
    ),
  );
}

function clampDistanceKm(value: unknown): number {
  const distance = Number(value);

  if (!Number.isFinite(distance)) {
    return DEFAULT_DISTANCE_KM;
  }

  return Math.min(MAX_DISTANCE_KM, Math.max(MIN_DISTANCE_KM, distance));
}

function deckUrl({
  maxDistanceKm,
  cuisines,
  seenClipIds,
  weights,
  userLocation
}: {
  maxDistanceKm: number;
  cuisines: CuisineTag[];
  seenClipIds: string[];
  weights: TasteWeights;
  userLocation: UserLocation | null;
}) {
  const params = new URLSearchParams({
    maxDistanceKm: String(maxDistanceKm)
  });

  if (cuisines.length) {
    params.set("cuisines", cuisines.join(","));
  }

  if (seenClipIds.length) {
    params.set("seenClipIds", seenClipIds.join(","));
  }

  if (Object.keys(weights).length) {
    params.set("weights", JSON.stringify(weights));
  }

  if (userLocation) {
    params.set("lat", String(userLocation.lat));
    params.set("lng", String(userLocation.lng));
  }

  return `/api/deck?${params.toString()}`;
}

function readSession(): SessionState {
  if (typeof window === "undefined") {
    return {
      seenClipIds: [],
      savedCards: [],
      weights: {},
      maxDistanceKm: DEFAULT_DISTANCE_KM,
      selectedCuisines: []
    };
  }

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "{}"
    ) as Partial<SessionState>;

    return {
      seenClipIds: Array.isArray(parsed.seenClipIds) ? parsed.seenClipIds : [],
      savedCards: Array.isArray(parsed.savedCards) ? parsed.savedCards : [],
      weights: parsed.weights ?? {},
      maxDistanceKm: clampDistanceKm(
        "maxDistanceKm" in parsed ? parsed.maxDistanceKm : undefined
      ),
      selectedCuisines: normalizeCuisines(parsed.selectedCuisines)
    };
  } catch {
    return {
      seenClipIds: [],
      savedCards: [],
      weights: {},
      maxDistanceKm: DEFAULT_DISTANCE_KM,
      selectedCuisines: []
    };
  }
}

function writeSession(session: SessionState) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (typeof window.fetch === "function") {
    return window.fetch(url, init).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}.`);
      }

      return (await response.json()) as T;
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init?.method ?? "GET", url);

    const headers = init?.headers;
    if (headers) {
      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        headers.forEach((value, key) => xhr.setRequestHeader(key, value));
      } else if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
          xhr.setRequestHeader(key, value);
        }
      } else {
        for (const [key, value] of Object.entries(headers)) {
          xhr.setRequestHeader(key, value);
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Request failed with ${xhr.status}.`));
        return;
      }

      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch {
        reject(new Error("Could not parse API response."));
      }
    };

    xhr.onerror = () => reject(new Error("Network request failed."));
    xhr.send(typeof init?.body === "string" ? init.body : undefined);
  });
}

function formatPostedAt(value: string) {
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const days = Math.round(
    (new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  );

  if (Math.abs(days) < 1) {
    return "today";
  }

  return formatter.format(days, "day");
}

function priceLabel(priceLevel: number | null) {
  if (!priceLevel) {
    return null;
  }

  return "$".repeat(priceLevel);
}

export function SwipeDeck() {
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [seenClipIds, setSeenClipIds] = useState<string[]>([]);
  const [savedCards, setSavedCards] = useState<DeckCard[]>([]);
  const [weights, setWeights] = useState<TasteWeights>({});
  const [maxDistanceKm, setMaxDistanceKm] = useState(DEFAULT_DISTANCE_KM);
  const [selectedCuisines, setSelectedCuisines] = useState<CuisineTag[]>([]);
  const [draftCuisines, setDraftCuisines] = useState<CuisineTag[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [drag, setDrag] = useState<DragState>(emptyDrag);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>("requesting");
  const cardRef = useRef<HTMLDivElement | null>(null);

  const activeCard = cards[0] ?? null;
  const nextCard = cards[1] ?? null;
  const thirdCard = cards[2] ?? null;
  const distanceProgress =
    ((maxDistanceKm - MIN_DISTANCE_KM) / (MAX_DISTANCE_KM - MIN_DISTANCE_KM)) *
    100;
  const cuisineSummary = selectedCuisines.length
    ? selectedCuisines.map((cuisine) => cuisineLabels[cuisine]).join(", ")
    : "All cuisines";

  const persist = useCallback(
    (overrides: Partial<SessionState> = {}) => {
      const session = {
        seenClipIds,
        savedCards,
        weights,
        maxDistanceKm,
        selectedCuisines,
        ...overrides
      };
      writeSession(session);
    },
    [maxDistanceKm, savedCards, seenClipIds, selectedCuisines, weights]
  );

  const loadDeck = useCallback(
    async (
      distance: number,
      cuisines: CuisineTag[],
      location: UserLocation | null,
    ) => {
      setIsLoading(true);
      setError(null);

      try {
        const session = readSession();
        const payload = await requestJson<{ cards: DeckCard[] }>(
          deckUrl({
            maxDistanceKm: distance,
            cuisines,
            seenClipIds: session.seenClipIds,
            weights: session.weights,
            userLocation: location,
          }),
        );
        setCards(payload.cards);
        setSeenClipIds(session.seenClipIds);
        setSavedCards(session.savedCards);
        setWeights(session.weights);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Load failed.");
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const session = readSession();
    setSeenClipIds(session.seenClipIds);
    setSavedCards(session.savedCards);
    setWeights(session.weights);
    setMaxDistanceKm(session.maxDistanceKm);
    setSelectedCuisines(session.selectedCuisines);
    setDraftCuisines(session.selectedCuisines);
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocationStatus("unavailable");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLocationStatus("granted");
      },
      () => setLocationStatus("denied"),
      {
        enableHighAccuracy: false,
        maximumAge: 10 * 60 * 1000,
        timeout: 6500
      }
    );
  }, []);

  useEffect(() => {
    if (hasHydrated) {
      void loadDeck(maxDistanceKm, selectedCuisines, userLocation);
    }
  }, [hasHydrated, loadDeck, maxDistanceKm, selectedCuisines, userLocation]);

  useEffect(() => {
    if (hasHydrated) {
      persist();
    }
  }, [hasHydrated, persist]);

  useEffect(() => {
    const foodCard = cardRef.current?.querySelector<HTMLElement>(".food-card");
    if (foodCard) {
      foodCard.scrollTop = 0;
    }
  }, [activeCard?.clip.clipId]);

  const resetDrag = useCallback(() => setDrag(emptyDrag), []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isSwiping || !activeCard) {
      return;
    }

    if (
      event.target instanceof HTMLElement &&
      event.target.closest("a, button, input")
    ) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      startX: event.clientX,
      startY: event.clientY,
      x: 0,
      y: 0,
      dragging: false
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!activeCard || isSwiping || drag.startX === 0) {
      return;
    }

    const x = event.clientX - drag.startX;
    const y = event.clientY - drag.startY;
    const shouldDrag = Math.abs(x) > 12 && Math.abs(x) > Math.abs(y);

    if (shouldDrag) {
      setDrag((current) => ({
        ...current,
        x,
        y,
        dragging: true
      }));
    }
  };

  const commitSwipe = useCallback(
    async (action: SwipeAction) => {
      if (!activeCard || isSwiping) {
        return;
      }

      const direction = action === "right" ? 1 : -1;
      const cardWidth = cardRef.current?.offsetWidth ?? 360;
      const exitX = direction * Math.max(520, cardWidth * 1.75);
      const nextSeen = Array.from(
        new Set([...seenClipIds, activeCard.clip.clipId])
      );
      const nextSaved =
        action === "right" &&
        !savedCards.some(
          (savedCard) => savedCard.clip.clipId === activeCard.clip.clipId
        )
          ? [...savedCards, activeCard]
          : savedCards;

      setHistory((current) => [
        ...current,
        {
          cards,
          seenClipIds,
          savedCards,
          weights,
          maxDistanceKm,
          selectedCuisines
        }
      ]);
      setIsSwiping(true);
      setDrag({
        startX: 0,
        startY: 0,
        x: exitX,
        y: -18,
        dragging: true
      });

      try {
        const payload = await requestJson<{
          weights: TasteWeights;
          cards: DeckCard[];
        }>("/api/swipe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            clipId: activeCard.clip.clipId,
            action,
            weights,
            seenClipIds,
            maxDistanceKm,
            cuisines: selectedCuisines,
            userLocation
          })
        });

        if (action === "right") {
          setToastVisible(true);
          window.setTimeout(() => setToastVisible(false), 1100);
        }

        window.setTimeout(() => {
          setCards(payload.cards);
          setSeenClipIds(nextSeen);
          setSavedCards(nextSaved);
          setWeights(payload.weights);
          persist({
            seenClipIds: nextSeen,
            savedCards: nextSaved,
            weights: payload.weights
          });
          resetDrag();
          setIsSwiping(false);
        }, SWIPE_OUT_MS);
      } catch (swipeError) {
        setError(
          swipeError instanceof Error ? swipeError.message : "Swipe failed."
        );
        resetDrag();
        setIsSwiping(false);
      }
    },
    [
      activeCard,
      cards,
      isSwiping,
      maxDistanceKm,
      persist,
      resetDrag,
      savedCards,
      seenClipIds,
      selectedCuisines,
      userLocation,
      weights
    ]
  );

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag.dragging) {
      resetDrag();
      return;
    }

    if (Math.abs(drag.x) >= SWIPE_THRESHOLD) {
      void commitSwipe(drag.x > 0 ? "right" : "left");
      return;
    }

    resetDrag();
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetDrag();
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) {
      return;
    }

    setCards(previous.cards);
    setSeenClipIds(previous.seenClipIds);
    setSavedCards(previous.savedCards);
    setWeights(previous.weights);
    setMaxDistanceKm(previous.maxDistanceKm);
    setSelectedCuisines(previous.selectedCuisines);
    setDraftCuisines(previous.selectedCuisines);
    setHistory((current) => current.slice(0, -1));
    writeSession(previous);
  };

  const updateDistance = (value: number) => {
    setMaxDistanceKm(value);
    setHistory([]);
    persist({ maxDistanceKm: value });
  };

  const openCuisineDrawer = () => {
    setDraftCuisines(selectedCuisines);
    setCuisineOpen(true);
  };

  const toggleDraftCuisine = (cuisine: CuisineTag) => {
    setDraftCuisines((current) =>
      current.includes(cuisine)
        ? current.filter((item) => item !== cuisine)
        : [...current, cuisine],
    );
  };

  const clearCuisineFilters = () => {
    setDraftCuisines([]);
    setSelectedCuisines([]);
    setSeenClipIds([]);
    setHistory([]);
    setCards([]);
    persist({ selectedCuisines: [], seenClipIds: [] });
  };

  const clearDraftCuisines = () => setDraftCuisines([]);

  const applyCuisineFilters = () => {
    setSelectedCuisines(draftCuisines);
    setSeenClipIds([]);
    setHistory([]);
    setCards([]);
    persist({ selectedCuisines: draftCuisines, seenClipIds: [] });
    setCuisineOpen(false);
  };

  const scrollToDetails = () => {
    const foodCard = cardRef.current?.querySelector<HTMLElement>(".food-card");
    const detail = cardRef.current?.querySelector<HTMLElement>(".detail-layer");

    if (foodCard && detail) {
      foodCard.scrollTo({ top: detail.offsetTop, behavior: "smooth" });
    }
  };

  const activeTransform = activeCard
    ? `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${clamp(
        drag.x / 22,
        -14,
        14,
      )}deg)`
    : undefined;

  return (
    <main className="app-shell">
      <section className="phone-stage" aria-label="What To Eat Ah deck">
        <header className="topbar">
          <div className="brand-block">
            <div className="brand">
              <h1>
                what to eat <span>ah</span>
              </h1>
              <i aria-hidden="true" />
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Open shortlist"
            title="Shortlist"
            onClick={() => setShortlistOpen(true)}
          >
            <Bookmark size={20} />
            <span>{savedCards.length}</span>
          </button>
        </header>

        <div className="filter-bar">
          <div className="filter-copy">
            <label htmlFor="distance">Distance</label>
            <span className="range-value">
              {locationStatus === "granted" ? "near you" : "SG center"} · up to{" "}
              {maxDistanceKm} km
            </span>
          </div>
          <input
            id="distance"
            type="range"
            min={MIN_DISTANCE_KM}
            max={MAX_DISTANCE_KM}
            step="1"
            value={maxDistanceKm}
            aria-valuetext={`Up to ${maxDistanceKm} kilometers away`}
            style={{
              background: `linear-gradient(90deg, var(--pandan) 0%, var(--pandan) ${distanceProgress}%, rgba(22, 19, 15, 0.14) ${distanceProgress}%, rgba(22, 19, 15, 0.14) 100%)`
            }}
            onChange={(event) => updateDistance(Number(event.target.value))}
          />
          <div className="filter-actions">
            <button
              className={`filter-pill ${selectedCuisines.length ? "active" : ""}`}
              type="button"
              aria-label={`Open cuisine filters. ${cuisineSummary} selected.`}
              onClick={openCuisineDrawer}
            >
              <SlidersHorizontal size={15} />
              <span>
                {selectedCuisines.length
                  ? `Cuisine · ${selectedCuisines.length}`
                  : "Cuisine"}
              </span>
            </button>
            <p>{cuisineSummary}</p>
          </div>
        </div>

        <section className="deck-area" aria-live="polite">
          {isLoading ? (
            <div className="state-panel">Loading the deck...</div>
          ) : error ? (
            <div className="state-panel">{error}</div>
          ) : activeCard ? (
            <>
              {thirdCard ? <FoodCard card={thirdCard} stackLevel={2} /> : null}
              {nextCard ? (
                <FoodCard card={nextCard} stackLevel={1} />
              ) : (
                <div className="next-placeholder" />
              )}
              <div
                key={activeCard.clip.clipId}
                ref={cardRef}
                className={`swipe-card active-card ${
                  drag.dragging && !isSwiping ? "dragging-card" : ""
                } ${isSwiping ? "swiping-card" : ""}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                style={{ transform: activeTransform }}
              >
                <FoodCard card={activeCard} isActive />
                <div
                  className={`decision-badge nope ${
                    drag.x < -40 ? "visible" : ""
                  }`}
                >
                  Nope
                </div>
                <div
                  className={`decision-badge save ${
                    drag.x > 40 ? "visible" : ""
                  }`}
                >
                  Save
                </div>
              </div>
            </>
          ) : (
            <div className="state-panel">
              {selectedCuisines.length ? (
                <>
                  <SlidersHorizontal size={26} />
                  <strong>No bites in this cuisine</strong>
                  <span>Clear the filter or try a larger distance.</span>
                  <button
                    className="state-action"
                    type="button"
                    onClick={clearCuisineFilters}
                  >
                    Show all
                  </button>
                </>
              ) : (
                <>
                  <Flame size={26} />
                  <strong>Deck finished</strong>
                  <span>Open your shortlist and pick dinner.</span>
                </>
              )}
            </div>
          )}
        </section>

        <nav className="action-rail" aria-label="Swipe actions">
          <button
            className="round-button nope-button"
            type="button"
            aria-label="Nope"
            title="Nope"
            disabled={!activeCard || isSwiping}
            onClick={() => void commitSwipe("left")}
          >
            <X size={25} />
          </button>
          <button
            className="round-button"
            type="button"
            aria-label="Undo"
            title="Undo"
            disabled={!history.length || isSwiping}
            onClick={undo}
          >
            <RotateCcw size={22} />
          </button>
          <button
            className="round-button yum-button"
            type="button"
            aria-label="Save"
            title="Save"
            disabled={!activeCard || isSwiping}
            onClick={() => void commitSwipe("right")}
          >
            <Heart size={25} />
          </button>
          <button
            className="round-button info-button"
            type="button"
            aria-label="Details"
            title="Details"
            disabled={!activeCard || isSwiping}
            onClick={scrollToDetails}
          >
            <ChevronDown size={24} />
          </button>
        </nav>
      </section>

      <div className={`toast ${toastVisible ? "show" : ""}`}>
        saved to your crawl
      </div>

      <Shortlist
        cards={savedCards}
        open={shortlistOpen}
        onClose={() => setShortlistOpen(false)}
      />
      <CuisineSheet
        draftCuisines={draftCuisines}
        open={cuisineOpen}
        onApply={applyCuisineFilters}
        onClear={clearDraftCuisines}
        onClose={() => setCuisineOpen(false)}
        onToggle={toggleDraftCuisine}
      />
    </main>
  );
}

function FoodCard({
  card,
  isActive = false,
  stackLevel = 0
}: {
  card: DeckCard;
  isActive?: boolean;
  stackLevel?: 0 | 1 | 2;
}) {
  const price = priceLabel(card.place.priceLevel);
  const isPreview = stackLevel > 0;

  return (
    <article
      className={`food-card ${isPreview ? "preview-card" : ""} ${
        stackLevel === 2 ? "preview-card-two" : ""
      }`}
    >
      <div className="media-layer">
        {isActive && card.clip.videoUrl ? (
          <ClipPlayer
            clipId={card.clip.clipId}
            posterUrl={card.clip.posterUrl}
            videoUrl={card.clip.videoUrl}
            start={card.clip.clipStart}
            end={card.clip.clipEnd}
          />
        ) : (
          <img
            className="clip-video"
            src={card.clip.posterUrl}
            alt=""
            aria-hidden="true"
          />
        )}
      </div>

      <div className="card-gradient" />
      <section className="card-front">
        <div className="metric-row">
          <span>
            <MapPin size={15} />
            {card.place.distanceKm.toFixed(1)} km
          </span>
          {card.place.googleRating ? (
            <span>
              <Star size={14} />
              {card.place.googleRating.toFixed(1)}
              {card.place.googleReviewCount
                ? ` · ${Intl.NumberFormat("en", {
                    notation: "compact"
                  }).format(card.place.googleReviewCount)}`
                : ""}
            </span>
          ) : null}
        </div>

        <div className="title-block">
          <p>{card.place.name}</p>
          <h2>{card.clip.dishName}</h2>
          {card.clip.pullQuote ? (
            <blockquote>&quot;{card.clip.pullQuote}&quot;</blockquote>
          ) : null}
        </div>

        <div className="chip-row">
          {card.clip.price ? <span>{card.clip.price}</span> : null}
          {price ? <span>{price}</span> : null}
          <span>{card.clip.tags.cuisine}</span>
          <span>{card.clip.tags.vibe}</span>
        </div>

        <ChevronDown className="scroll-cue" size={22} aria-hidden="true" />
      </section>

      {!isPreview ? <CardDetails card={card} /> : null}
    </article>
  );
}

function ClipPlayer({
  clipId,
  videoUrl,
  posterUrl,
  start,
  end
}: {
  clipId: string;
  videoUrl: string;
  posterUrl: string;
  start: number;
  end: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const safeStart = Math.max(0, start || 0);
  const safeEnd = end && end > safeStart ? end : safeStart + 18;

  const syncStart = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (Number.isFinite(safeStart) && video.currentTime < safeStart) {
      video.currentTime = safeStart;
    }
  };

  const loopClip = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (video.currentTime >= safeEnd) {
      video.currentTime = safeStart;
      void video.play().catch(() => undefined);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = safeStart;
    void video.play().catch(() => undefined);
  }, [clipId, safeStart]);

  if (failed) {
    return (
      <img
        className="clip-video"
        src={posterUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <video
      key={clipId}
      ref={videoRef}
      className="clip-video"
      src={videoUrl}
      poster={posterUrl}
      muted
      playsInline
      autoPlay
      preload="metadata"
      onLoadedMetadata={syncStart}
      onTimeUpdate={loopClip}
      onError={() => setFailed(true)}
    />
  );
}

function CuisineSheet({
  draftCuisines,
  open,
  onApply,
  onClear,
  onClose,
  onToggle
}: {
  draftCuisines: CuisineTag[];
  open: boolean;
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
  onToggle: (cuisine: CuisineTag) => void;
}) {
  return (
    <aside className={`filter-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <button
        className="scrim"
        type="button"
        aria-label="Close cuisine filters"
        onClick={onClose}
      />
      <section className="filter-sheet" aria-label="Cuisine filters">
        <header>
          <div>
            <p className="eyebrow">Filters</p>
            <h2>Cuisine</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close cuisine filters"
            title="Close"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <div className="cuisine-grid" aria-label="Cuisine options">
          <button
            className={`cuisine-chip ${draftCuisines.length ? "" : "active"}`}
            type="button"
            aria-pressed={!draftCuisines.length}
            onClick={onClear}
          >
            {!draftCuisines.length ? <Check size={15} /> : null}
            All
          </button>
          {CUISINE_TAGS.map((cuisine) => {
            const selected = draftCuisines.includes(cuisine);

            return (
              <button
                className={`cuisine-chip ${selected ? "active" : ""}`}
                key={cuisine}
                type="button"
                aria-pressed={selected}
                onClick={() => onToggle(cuisine)}
              >
                {selected ? <Check size={15} /> : null}
                {cuisineLabels[cuisine]}
              </button>
            );
          })}
        </div>

        <footer className="filter-sheet-actions">
          <button className="sheet-button secondary" type="button" onClick={onClear}>
            Clear
          </button>
          <button className="sheet-button primary" type="button" onClick={onApply}>
            Apply
          </button>
        </footer>
      </section>
    </aside>
  );
}

function CardDetails({ card }: { card: DeckCard }) {
  const price = priceLabel(card.place.priceLevel);

  return (
    <section className="detail-layer">
      <div className="place-panel">
        <div>
          <h3>{card.place.name}</h3>
          <p>{card.place.address}</p>
        </div>
        <a className="maps-button" href={card.place.mapUrl} target="_blank">
          <Navigation size={17} />
          Maps
        </a>
      </div>

      <div className="place-facts">
        {card.place.googleRating ? (
          <span>
            <Star size={16} />
            {card.place.googleRating.toFixed(1)}
            {card.place.googleReviewCount
              ? ` from ${Intl.NumberFormat("en", {
                  notation: "compact"
                }).format(card.place.googleReviewCount)} reviews`
              : ""}
          </span>
        ) : null}
        {price ? <span>{price}</span> : null}
        <span>
          <MapPin size={16} />
          {card.place.distanceKm.toFixed(1)} km
        </span>
      </div>

      <div className="creator-list">
        {card.creators.map((creator) => (
          <article key={creator.clipId} className="creator-row">
            <div>
              <strong>{creator.influencer}</strong>
              <span>{formatPostedAt(creator.postedAt)}</span>
            </div>
            {creator.pullQuote ? <p>&quot;{creator.pullQuote}&quot;</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function Shortlist({
  cards,
  open,
  onClose
}: {
  cards: DeckCard[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <aside className={`shortlist ${open ? "open" : ""}`} aria-hidden={!open}>
      <button
        className="scrim"
        type="button"
        aria-label="Close shortlist"
        onClick={onClose}
      />
      <section className="shortlist-sheet">
        <header>
          <div>
            <p className="eyebrow">Shortlist</p>
            <h2>{cards.length ? `${cards.length} saved spots` : "No saves yet"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close shortlist"
            title="Close"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <div className="saved-list">
          {cards.length ? (
            cards.map((card) => (
              <article key={card.clip.clipId} className="saved-card">
                <img src={card.clip.posterUrl} alt="" aria-hidden="true" />
                <div>
                  <h3>{card.clip.dishName}</h3>
                  <p>{card.place.name}</p>
                  <span>
                    {card.place.distanceKm.toFixed(1)} km
                    {card.place.googleRating
                      ? ` · ${card.place.googleRating.toFixed(1)} stars`
                      : ""}
                  </span>
                </div>
                <a href={card.place.mapUrl} target="_blank" aria-label="Open in Maps">
                  <Navigation size={18} />
                </a>
              </article>
            ))
          ) : (
            <p className="empty-copy">Right-swipes land here.</p>
          )}
        </div>
      </section>
    </aside>
  );
}
