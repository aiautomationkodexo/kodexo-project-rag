-- ═══════════════════════════════════════════════════════════════════════════
-- 0017 — Mark the authorization helpers `parallel safe`
--
-- SHIPPED ALONE, DELIBERATELY. This changes plan shapes across the entire
-- application, and it is unrelated to the scoped-access work in 0018. Pushing
-- them together would mean any post-deploy performance change had two
-- candidate causes. Push this, observe, then push 0018.
--
-- User-defined functions default to PARALLEL UNSAFE, and ONE unsafe function
-- anywhere in a statement disables parallel query for the WHOLE statement —
-- including the sequential scans and the HNSW scan inside search_projects.
-- These three appear in essentially every policy in 0002, so the whole schema
-- has been running serially since 0001. One word each.
--
-- SAFE BY INSPECTION: all three are read-only SELECTs over ordinary tables,
-- with no sequence access, no temp-table writes, no cursor state and no
-- non-immutable settings dependency. `tech_tag_alias_key` in 0011 already
-- uses this marking, so the idiom is established here.
--
-- ALTER FUNCTION rather than CREATE OR REPLACE: restating the bodies would
-- invite them drifting out of step with 0001. This changes only the marking.
-- ═══════════════════════════════════════════════════════════════════════════

alter function is_active_user(uuid)  parallel safe;
alter function is_super_admin(uuid)  parallel safe;
alter function has_claim(uuid, text) parallel safe;

-- NOT marked leakproof, and that is not an oversight. Leakproof functions are
-- the one documented exception the optimizer may apply AHEAD of the row
-- security check — asserting it on a `security definer` function that reads
-- other users' rows would let it jump the security queue. Only a superuser can
-- set it, which is the second reason not to reach for it.
