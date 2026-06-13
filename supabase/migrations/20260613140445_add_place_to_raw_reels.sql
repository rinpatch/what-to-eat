alter table raw_reels add column if not exists raw_place_name text;
alter table raw_reels add column if not exists place_id text references places(place_id) on delete set null;
