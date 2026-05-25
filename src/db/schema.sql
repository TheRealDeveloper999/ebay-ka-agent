CREATE TABLE IF NOT EXISTS sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    url             TEXT    NOT NULL,
    interval        INTEGER NOT NULL DEFAULT 30,
    active          INTEGER NOT NULL DEFAULT 1,
    keyword         TEXT,
    min_price       REAL,
    max_price       REAL,
    item_count      INTEGER NOT NULL DEFAULT 0,
    last_scraped_at TEXT,
    last_error      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id       INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id     TEXT    NOT NULL,
    url             TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    price           REAL,
    price_text      TEXT,
    location        TEXT,
    seller_name     TEXT,
    seller_url      TEXT,
    thumbnail_url   TEXT,
    description     TEXT,
    image_urls      TEXT,
    first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
    removed_at      TEXT,
    UNIQUE(source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_items_source_id      ON items(source_id);
CREATE INDEX IF NOT EXISTS idx_items_first_seen_at  ON items(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_items_removed_at     ON items(removed_at);

CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    scraped_at  TEXT NOT NULL DEFAULT (datetime('now')),
    title       TEXT NOT NULL,
    price       REAL,
    price_text  TEXT,
    location    TEXT,
    description TEXT,
    image_urls  TEXT,
    seller_name TEXT,
    raw_data    TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_item_id    ON snapshots(item_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_scraped_at ON snapshots(scraped_at);

CREATE TABLE IF NOT EXISTS changes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_id        INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    snapshot_id      INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    prev_snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE SET NULL,
    change_type      TEXT NOT NULL,
    field_name       TEXT,
    old_value        TEXT,
    new_value        TEXT,
    detected_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_changes_item_id      ON changes(item_id);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at  ON changes(detected_at);
CREATE INDEX IF NOT EXISTS idx_changes_change_type  ON changes(change_type);
CREATE INDEX IF NOT EXISTS idx_changes_source_id    ON changes(source_id);
