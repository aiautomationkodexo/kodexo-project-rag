-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 — Simple project fields
--
-- engagement_type, start_date, end_date, team_size.
--
-- CHECK constraints rather than Postgres enums, deliberately: adding a value to
-- an enum is a migration with locking implications, and every one of these
-- vocabularies is expected to change as the business changes. A CHECK is
-- rewritten by a plain ALTER.
--
-- Every column is NULLABLE with no default. There are existing rows, and none
-- of these facts can be inferred for them — a default would manufacture data
-- that nobody entered. "Unknown" is represented as NULL and rendered as "—".
-- ═══════════════════════════════════════════════════════════════════════════

alter table projects
  add column engagement_type text
    check (engagement_type is null or engagement_type in
      ('custom ai','automation','software product',
       'staff augmentation','consulting')),
  add column start_date date,
  add column end_date   date,
  add column team_size  int check (team_size is null or team_size > 0);

-- A table-level constraint, not a column CHECK: it references two columns.
-- Both NULL arms are required — a project with an end date but no start date is
-- legal (we may know when it shipped and not when it began), and Postgres
-- CHECKs pass on NULL anyway, so being explicit documents the intent.
alter table projects
  add constraint projects_date_order_check
  check (end_date is null or start_date is null or end_date >= start_date);

comment on column projects.engagement_type is
  'Commercial shape of the engagement. CHECK-constrained; see src/lib/types.ts.';
comment on column projects.team_size is
  'Headcount on the delivery team. NULL means unrecorded, never zero.';
