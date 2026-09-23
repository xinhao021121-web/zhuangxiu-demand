-- 核心表（技术方案 4.3）。
--
-- 部署形态是境内托管 Postgres；这里的 SQL 保持两边都能跑，本地开发与测试用 Node 自带的
-- SQLite。jsonb 在 Postgres 里是原生类型，在 SQLite 里退化成 TEXT，读写都在仓储层完成。
--
-- 两个约束值得单独说：
--   1. 清单条目用 uuid 主键，不用自增：现场端会离线创建记录并引用清单条目。
--   2. 清单与现场记录分表：清单是生成物（可重新生成），现场记录是资产（不能被覆盖）。

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'designer')),
  team_id     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demand_sheets (
  id              TEXT PRIMARY KEY,
  demand_name     TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  payload         TEXT NOT NULL,
  ai_marks        TEXT NOT NULL,
  submitted_at    TEXT NOT NULL,
  source          TEXT NOT NULL,
  submitted_by    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklists (
  id              TEXT PRIMARY KEY,
  demand_sheet_id TEXT NOT NULL REFERENCES demand_sheets (id),
  created_at      TEXT NOT NULL,
  model           TEXT NOT NULL,
  rule_version    TEXT NOT NULL,
  policy_name     TEXT NOT NULL,
  policy_version  TEXT NOT NULL,
  degraded        INTEGER NOT NULL DEFAULT 0,
  understanding   TEXT NOT NULL,
  dropped         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id              TEXT PRIMARY KEY,
  checklist_id    TEXT NOT NULL REFERENCES checklists (id),
  item_key        TEXT NOT NULL,
  item_object     TEXT NOT NULL,
  space           TEXT NOT NULL,
  tier            TEXT NOT NULL,
  source          TEXT NOT NULL,
  question        TEXT NOT NULL,
  why             TEXT NOT NULL,
  onsite_checks   TEXT NOT NULL,
  related_fields  TEXT NOT NULL,
  removed         INTEGER NOT NULL DEFAULT 0,
  removed_at      TEXT,
  removed_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON checklist_items (checklist_id);

CREATE TABLE IF NOT EXISTS outbound_records (
  id                  TEXT PRIMARY KEY,
  demand_sheet_id     TEXT NOT NULL REFERENCES demand_sheets (id),
  policy_name         TEXT NOT NULL,
  policy_version      TEXT NOT NULL,
  field_keys          TEXT NOT NULL,
  redactions          TEXT NOT NULL,
  unselected_freetext INTEGER NOT NULL DEFAULT 0,
  at                  TEXT NOT NULL,
  operator            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_records (
  id              TEXT PRIMARY KEY,
  demand_sheet_id TEXT NOT NULL REFERENCES demand_sheets (id),
  checklist_id    TEXT NOT NULL REFERENCES checklists (id),
  item_key        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('asked', 'skip')),
  note            TEXT NOT NULL DEFAULT '',
  at              TEXT NOT NULL,
  operator        TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_records_checklist ON site_records (checklist_id);
