-- creators: 10 SG food influencer accounts to scrape
create table creators (
  id          uuid primary key default gen_random_uuid(),
  handle      text not null unique,
  platform    text not null default 'instagram',
  profile_url text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- raw_reels: one row per scraped reel (Bright Data output, pre-processing)
create table raw_reels (
  reel_id          text primary key,
  creator_id       uuid not null references creators(id),
  url              text not null,
  video_url        text,
  caption          text,
  likes            int not null default 0,
  comments         int not null default 0,
  shares           int not null default 0,
  views            int not null default 0,
  posted_at        timestamptz not null,
  scraped_at       timestamptz not null default now(),
  processed        boolean not null default false,
  processing_error text
);

-- places: canonical venues deduplicated by Google place_id
create table places (
  place_id            text primary key,
  name                text not null,
  address             text not null,
  lat                 double precision not null,
  lng                 double precision not null,
  google_rating       double precision,
  google_review_count int,
  price_level         smallint check (price_level between 1 and 4),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- clips: processed swipeable unit — one per reel×dish, linked to a place
create table clips (
  clip_id          uuid primary key default gen_random_uuid(),
  reel_id          text not null references raw_reels(reel_id) on delete cascade,
  place_id         text references places(place_id) on delete set null,
  dish_name        text not null,
  price            text,
  video_url        text not null,
  clip_start       int,
  clip_end         int,
  transcript       text,
  influencer       text not null,
  posted_at        timestamptz not null,
  caption          text,
  -- closed-vocab tags: {cuisine: string, price_band: budget|mid|splurge, keywords: string[]}
  tags             jsonb not null default '{}',
  pull_quote       text,
  sentiment        text check (sentiment in ('positive', 'neutral', 'negative')),
  -- raw Instagram engagement signals (denormalized from raw_reels for query perf)
  likes            int not null default 0,
  comments         int not null default 0,
  shares           int not null default 0,
  views            int not null default 0,
  -- computed by ingest: (likes + comments*2 + shares*3) / hours_since_post
  engagement_score double precision not null default 0,
  -- final blended rank: engagement × google signals × sentiment multiplier
  rank_score       double precision not null default 0,
  created_at       timestamptz not null default now()
);

-- occupancy_snapshots: optional Bright Data browser scrape of Google "busy" data
create table occupancy_snapshots (
  id            uuid primary key default gen_random_uuid(),
  place_id      text not null references places(place_id) on delete cascade,
  day_of_week   smallint not null check (day_of_week between 0 and 6), -- 0=Sun
  hour          smallint not null check (hour between 0 and 23),
  occupancy_pct smallint check (occupancy_pct between 0 and 100),
  scraped_at    timestamptz not null default now(),
  unique (place_id, day_of_week, hour)
);

-- Indexes
create index clips_rank        on clips (rank_score desc, posted_at desc);
create index clips_place_id    on clips (place_id);
create index clips_tags_gin    on clips using gin (tags);
create index raw_reels_pending on raw_reels (scraped_at) where processed = false;

-- RLS
alter table creators            enable row level security;
alter table raw_reels           enable row level security;
alter table places              enable row level security;
alter table clips               enable row level security;
alter table occupancy_snapshots enable row level security;

-- Public read policies (frontend)
create policy "public read creators"             on creators            for select using (true);
create policy "public read places"               on places              for select using (true);
create policy "public read clips"                on clips               for select using (true);
create policy "public read occupancy_snapshots"  on occupancy_snapshots for select using (true);
-- raw_reels: no public policy — service role only (ingest internal)

-- Seed: 10 SG food creators
insert into creators (handle, platform, profile_url) values
  ('sethlui',          'instagram', 'https://www.instagram.com/sethlui/'),
  ('burrpple',         'instagram', 'https://www.instagram.com/burrpple/'),
  ('misstamchiak',     'instagram', 'https://www.instagram.com/misstamchiak/'),
  ('ladyironchef',     'instagram', 'https://www.instagram.com/ladyironchef/'),
  ('singaporefoodie',  'instagram', 'https://www.instagram.com/singaporefoodie/'),
  ('sgfoodblogger',    'instagram', 'https://www.instagram.com/sgfoodblogger/'),
  ('eatbooksg',        'instagram', 'https://www.instagram.com/eatbooksg/'),
  ('danielfooddiary',  'instagram', 'https://www.instagram.com/danielfooddiary/'),
  ('thesmartlocal',    'instagram', 'https://www.instagram.com/thesmartlocal/'),
  ('ieatishootipost',  'instagram', 'https://www.instagram.com/ieatishootipost/');
