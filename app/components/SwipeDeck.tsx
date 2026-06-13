"use client";

/* eslint-disable @next/next/no-img-element, react-hooks/set-state-in-effect */

import {
  Bookmark,
  ChevronDown,
  Clock3,
  Flame,
  Heart,
  MapPin,
  Navigation,
  RotateCcw,
  Star,
  Users,
  X
} from "lucide-react";
import {
  PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type { DeckCard, SwipeAction, TasteWeights } from "@/lib/types";

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
  maxDistanceMin: number;
};

type HistoryEntry = SessionState & {
  cards: DeckCard[];
};

const STORAGE_KEY = "what-to-eat-ah-session";
const DEFAULT_DISTANCE = 30;
const SWIPE_THRESHOLD = 92;

const emptyDrag: DragState = {
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  dragging: false
};

function readSession(): SessionState {
  if (typeof window === "undefined") {
    return {
      seenClipIds: [],
      savedCards: [],
      weights: {},
      maxDistanceMin: DEFAULT_DISTANCE
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
      maxDistanceMin:
        typeof parsed.maxDistanceMin === "number"
          ? parsed.maxDistanceMin
          : DEFAULT_DISTANCE
    };
  } catch {
    return {
      seenClipIds: [],
      savedCards: [],
      weights: {},
      maxDistanceMin: DEFAULT_DISTANCE
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

function tasteEntries(weights: TasteWeights) {
  return Object.entries(weights)
    .filter(([, score]) => score !== 0)
    .sort(([, a], [, b]) => Math.abs(b ?? 0) - Math.abs(a ?? 0))
    .slice(0, 4);
}

export function SwipeDeck() {
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [seenClipIds, setSeenClipIds] = useState<string[]>([]);
  const [savedCards, setSavedCards] = useState<DeckCard[]>([]);
  const [weights, setWeights] = useState<TasteWeights>({});
  const [maxDistanceMin, setMaxDistanceMin] = useState(DEFAULT_DISTANCE);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [drag, setDrag] = useState<DragState>(emptyDrag);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const activeCard = cards[0] ?? null;
  const nextCard = cards[1] ?? null;
  const thirdCard = cards[2] ?? null;
  const tasteBars = tasteEntries(weights);

  const persist = useCallback(
    (overrides: Partial<SessionState> = {}) => {
      const session = {
        seenClipIds,
        savedCards,
        weights,
        maxDistanceMin,
        ...overrides
      };
      writeSession(session);
    },
    [maxDistanceMin, savedCards, seenClipIds, weights]
  );

  const loadDeck = useCallback(async (distance: number) => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await requestJson<{ cards: DeckCard[] }>(
        `/api/deck?maxDistanceMin=${distance}`
      );
      const session = readSession();
      const remainingCards = payload.cards.filter(
        (card) => !session.seenClipIds.includes(card.clip.clipId)
      );
      setCards(remainingCards);
      setSeenClipIds(session.seenClipIds);
      setSavedCards(session.savedCards);
      setWeights(session.weights);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = readSession();
    setSeenClipIds(session.seenClipIds);
    setSavedCards(session.savedCards);
    setWeights(session.weights);
    setMaxDistanceMin(session.maxDistanceMin);
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (hasHydrated) {
      void loadDeck(maxDistanceMin);
    }
  }, [hasHydrated, loadDeck, maxDistanceMin]);

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
      event.currentTarget.setPointerCapture(event.pointerId);
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
        { cards, seenClipIds, savedCards, weights, maxDistanceMin }
      ]);
      setIsSwiping(true);
      setDrag({
        startX: 0,
        startY: 0,
        x: direction * 520,
        y: -28,
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
            maxDistanceMin
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
        }, 170);
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
      maxDistanceMin,
      persist,
      resetDrag,
      savedCards,
      seenClipIds,
      weights
    ]
  );

  const handlePointerUp = () => {
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

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) {
      return;
    }

    setCards(previous.cards);
    setSeenClipIds(previous.seenClipIds);
    setSavedCards(previous.savedCards);
    setWeights(previous.weights);
    setMaxDistanceMin(previous.maxDistanceMin);
    setHistory((current) => current.slice(0, -1));
    writeSession(previous);
  };

  const updateDistance = (value: number) => {
    setMaxDistanceMin(value);
    setHistory([]);
    persist({ maxDistanceMin: value });
  };

  const scrollToDetails = () => {
    const foodCard = cardRef.current?.querySelector<HTMLElement>(".food-card");
    const detail = cardRef.current?.querySelector<HTMLElement>(".detail-layer");

    if (foodCard && detail) {
      foodCard.scrollTo({ top: detail.offsetTop, behavior: "smooth" });
    }
  };

  const activeTransform = activeCard
    ? `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${drag.x / 18}deg)`
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
            <p>trending hawker + makan spots, vetted for real hype lah</p>
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
            <label htmlFor="distance">How far you willing</label>
            <span>{maxDistanceMin} min</span>
          </div>
          <input
            id="distance"
            type="range"
            min="5"
            max="45"
            step="5"
            value={maxDistanceMin}
            onChange={(event) => updateDistance(Number(event.target.value))}
          />
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
                className="swipe-card active-card"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={resetDrag}
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
              <Flame size={26} />
              <strong>Deck finished</strong>
              <span>Open your shortlist and pick dinner.</span>
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

        <PreferencePeek entries={tasteBars} swipeCount={seenClipIds.length} />
      </section>

      <div className={`toast ${toastVisible ? "show" : ""}`}>
        saved to your crawl
      </div>

      <Shortlist
        cards={savedCards}
        open={shortlistOpen}
        onClose={() => setShortlistOpen(false)}
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
  const creatorCount = card.creators.length;
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
          <video
            key={card.clip.clipId}
            className="clip-video"
            src={card.clip.videoUrl}
            poster={card.clip.posterUrl}
            muted
            playsInline
            autoPlay
            loop
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
            <Users size={15} />
            {creatorCount} creator{creatorCount === 1 ? "" : "s"}
          </span>
          <span>
            <Clock3 size={15} />
            {card.place.distanceMinutes} min
          </span>
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

function PreferencePeek({
  entries,
  swipeCount
}: {
  entries: [string, number][];
  swipeCount: number;
}) {
  const max = Math.max(...entries.map(([, score]) => Math.abs(score)), 1);

  return (
    <section className="preference-peek" aria-label="Taste profile">
      <div className="peek-head">
        <span>what it&apos;s learning about you</span>
        <span>
          {swipeCount} swipe{swipeCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="peek-bars">
        {entries.length ? (
          entries.map(([tag, score]) => {
            const width = `${(Math.abs(score) / max) * 100}%`;
            const positive = score > 0;

            return (
              <div className="peek-bar" key={tag}>
                <span className="bar-name">{tag}</span>
                <span className="bar-track">
                  <span
                    className={positive ? "bar-fill good" : "bar-fill nope"}
                    style={{ width }}
                  />
                </span>
                <span className={positive ? "bar-value good" : "bar-value nope"}>
                  {positive ? "+" : ""}
                  {score}
                </span>
              </div>
            );
          })
        ) : (
          <span className="empty-copy compact">
            swipe a few to watch your taste profile build...
          </span>
        )}
      </div>
    </section>
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
          </span>
        ) : null}
        {price ? <span>{price}</span> : null}
        <span>
          <MapPin size={16} />
          {card.place.distanceKm.toFixed(1)} km
        </span>
        <span>
          <Flame size={16} />
          {card.velocityScore.toFixed(1)}
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
                    {card.place.distanceMinutes} min
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
