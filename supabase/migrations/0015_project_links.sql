-- ═══════════════════════════════════════════════════════════════════════════
-- 0015 — Project links
--
-- Reference URLs attached to a project: a live site, a repo, a case study.
--
-- `title` is nullable and NOT AI-populated. Filling it would require fetching
-- the URL server-side, which is an SSRF vector — a user-supplied URL fetched
-- by our server can reach internal addresses and cloud metadata endpoints.
-- Without a fetch the model has only the URL string, so any "title" it
-- produced would be plausible-sounding fiction. When title is absent the UI
-- displays the domain. If link fetching is ever wanted it needs an allowlist
-- and egress controls, and it should be its own decision.
--
-- Links are not extracted or embedded in v1, so a link is searchable on its
-- title only. Deliberate: the URL is a pointer, not content.
-- ═══════════════════════════════════════════════════════════════════════════

create table project_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  url         text not null check (length(trim(url)) > 0),
  title       text,
  description text,
  created_at  timestamptz not null default now()
);

create index project_links_project_idx on project_links (project_id);

alter table project_links enable row level security;

-- Mirrors the project policies: read with projects:view, write with
-- projects:update. Part A pairs these with scoped arms.
create policy links_select on project_links for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy links_write on project_links for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));
