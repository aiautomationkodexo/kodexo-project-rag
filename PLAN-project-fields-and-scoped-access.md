# Implementation Plan — Project fields, NDA disclosure, and scoped access

Status: proposal. Nothing here is built.

This plan covers the features requested in conversation:

1. Client information, stored separately and gated by a claim
2. NDA status governing external disclosure
3. `engagement_type`, `start_date`, `end_date`, `team_size`
4. `confidentiality_tier`
5. Document-level `visibility`
6. Links (paste a URL, optional title/description, AI fills the rest)
7. **Scoped claims** — restricting a user to a subset of projects

Item 7 is the architecturally significant one and is treated first, because it
changes the shape of the authorization primitive that everything else uses.

---

## PART A — Scoped claims

### A.1 The problem, precisely

`user_claims (user_id, claim)` has no resource column, and `has_claim(uid, c)`
takes no resource argument. `can(user, claim)` mirrors it. The predicate
answers "may this person view projects?" — there is no way to ask "may this
person view *this* project?"

### A.2 The constraint that shapes the answer

`supabase/migrations/0002_rls.sql` opens by explaining that a policy expression
calling `auth.uid()` is evaluated **once per candidate row**, and that wrapping
it as `(select has_claim(...))` lets the planner hoist it into an InitPlan —
"worth 10-100x on list queries", legal only because the helpers are `stable`.

**That in-repo estimate understates the real figure by two orders of
magnitude.** Supabase benchmarked this exact shape — a `stable security
definer` function called from a policy over a 100K-row table, which is
`has_claim` precisely — at **178,000 ms unwrapped vs 12 ms wrapped**
(~15,000x). Supabase's own wording for the mechanism: *"Wrapping the function
causes an `initPlan` to be run by the Postgres optimizer, which allows it to
'cache' the results per-statement, rather than calling the function on each
row."* The existing hoisting is not an optimisation; it is the difference
between a working product and an unusable one.

The same page states the precondition as a warning, verbatim: *"You can only do
this if the results of the query or function do not change based on the row
data."* That is the constraint below, from the primary source.

A scoped check references the candidate row, so **it cannot be hoisted**. This
is structural, not a tuning problem. The goal is therefore not to preserve the
hoist everywhere, but to keep the *common* case on the hoisted path and make
the scoped case index-backed.

### A.3 The design: two permissive policies

Postgres OR's permissive policies. So "global claim OR specific grant" is
expressible as two independent policies, each individually optimisable:

```sql
-- Arm 1: the GLOBAL claim. Row-independent -> InitPlan-hoisted. Unchanged
-- from today's policy, so existing users keep exactly today's access.
create policy projects_select_global on projects for select to authenticated
using (deleted_at is null
       and (select has_claim((select auth.uid()), 'projects:view')));

-- Arm 2: the SCOPED grant. UNCORRELATED `in (...)`, NOT `exists (...)`.
create policy projects_select_scoped on projects for select to authenticated
using (deleted_at is null
       and id in (select project_id from project_grants
                  where user_id = (select auth.uid())
                    and claim = 'projects:view'));
```

**Arm 2 must be `in (...)`, never `exists (...)`. This is the single most
important detail in Part A.** An `EXISTS` whose body references the outer row
(`g.project_id = projects.id`) is *correlated*. Inside a security qual Postgres
frequently does **not** pull it up into a semi-join — it becomes a per-row
`SubPlan` and abandons the index. A reproducible case on the pgsql-performance
list shows the identical predicate at **5 ms as a join vs 9,256 ms inside a
policy** — 1,850x, with `Filter: (SubPlan 1)` and `loops=100000` in the plan.

The `in (...)` form contains **no reference to the outer row**, so it is
uncorrelated: evaluated once, hashed, then probed per row. Supabase measured
the analogous rewrite at 9,000 ms → 20 ms (~450x). That single property — no
outer-row reference inside the subquery — is what buys the index, the single
evaluation, and a parallel-safe plan simultaneously.

**Known ceiling:** Supabase documents degradation when the `in` list exceeds
roughly 10,000 elements. That is the count of *one user's* grant rows for one
claim. At hundreds of users and thousands of projects this is orders of
magnitude away; record it as the point at which the shape would need
revisiting, not as a present concern.

**This shape is already precedent in this repo.** `profiles_update_self` and
`profiles_update_admin` (0002:41-47) are two permissive policies on the same
table and command, OR'd. 0011:126 states the property explicitly.

**Confirmed against the Postgres docs**, not just inferred:

- *"When multiple policies apply to a given query, they are combined using
  either `OR` (for permissive policies, which are the default) or using `AND`
  (for restrictive policies)."* — so OR semantics come for free; `AS PERMISSIVE`
  need not be written.
- *"This expression will be evaluated for each row prior to any conditions or
  functions coming from the user's query."* — per-row is the documented
  **baseline**. The InitPlan hoist is the optimizer improving on that for a
  row-*independent* expression. Confirms A.2: a scoped check gets per-row
  treatment and no amount of parenthesising changes it.
- *"A `STABLE` function ... allows the optimizer to optimize multiple calls of
  the function to a single call."* — exactly what 0002's comment claims.
- *"a function containing only `SELECT` commands can safely be marked `STABLE`,
  even if it selects from tables that might be undergoing modifications"* —
  sanctions the existing `security definer` + `stable` combination on
  `has_claim`, which can otherwise look suspect.
- The docs call a policy that compares against a session value with **no
  subquery to another table** *"the simplest and best-performing case."* The
  global arm is exactly that; the scoped arm cannot be. **That asymmetry is the
  argument for the split** — it keeps most traffic on the path the docs call
  best-performing and confines the join to users who actually have grants.

**Do NOT mark `has_claim` LEAKPROOF** to chase performance. Leakproof functions
are the one documented exception the optimizer may apply *ahead of* the
row-security check. Asserting it on a `security definer` function that reads
other users' rows would let it jump the security queue — actively dangerous,
and only a superuser can set it.

Why this over a nullable `project_id` meaning "all": that puts an `OR` inside
a correlated subquery, mixing two access paths against one index. The two-policy
form keeps each arm on a single clean path.

### A.3a Two properties to preserve deliberately

**No deny primitive.** Grants are purely additive: adding a row can never
remove anyone's access. This is what makes the rollout risk-free and makes
"what can this user reach?" a plain union rather than an ordered evaluation.
AWS has deny and consequently needs seven ordered steps, per-pair
union/intersection rules, and a simulator to answer that question; GitHub and
Kubernetes have no deny and stay simple. **Do not add a restrictive policy for
scoping** — it would forfeit the guarantee above. The cost is that "everything
except project X" is inexpressible; that is the right trade here.

**Scope lives in the GRANT, never in the claim vocabulary.** `CLAIMS` in
claim-set.ts stays at its current 9 entries plus the new client-info one. Do
NOT invent scope-aware variants like `projects:view:own` — that fuses the two
axes back together, which is exactly the flaw in GitHub's classic OAuth scopes
(where `repo` unavoidably means every repo). Kubernetes separates the rule
from the binding for the same reason. Keeping scope in `project_grants` is what
lets `can()` stay untouched and `canOn()` be purely additive.

### A.3b What this model is, in the literature's terms

Useful for justifying the choice later, and for knowing what we are *not*
building.

This is **enumerated, role-centric authorization with a resource scope** — not
ABAC, not ReBAC, and not a policy engine.

- **Not ABAC.** NIST SP 800-162 is explicit that ABAC suits "environments where
  subjects and objects carry a rich set of attributes and access decisions
  involve complex relationships among these attributes", and equally explicit
  that "ABAC is not the right solution for every access control problem" and
  costs more to maintain than simpler schemes. Our decision is
  `(user, claim, project)`. There is no attribute richness to exploit.
- **Role-centric**, in the sense of Kuhn/Coyne/Weil (IEEE Computer, 2010): the
  claim sets the permission ceiling and scope narrows it. *(That hybrid
  taxonomy is in the IEEE paper, NOT in SP 800-162 — do not misattribute it.)*
  One deviation to be honest about: our scoped arm **adds** access rather than
  only constraining, which is what makes the migration safe. Worth knowing it
  is a deliberate departure.
- **Enumerated, not logical** — and this is the decisive property. NIST SP
  800-178 puts it precisely: reviewing a logic-based policy "is equivalent to
  the satisfiability problem in propositional logic", whereas reviewing
  enumerated relations "is relatively simple". A row in `project_grants`
  answers "who can see this project?" by **lookup**. A condition-evaluating
  policy engine answers it only by **search**. For an internal tool that will
  be audited by people, lookup wins decisively.

### A.4 The grants table

```sql
create table project_grants (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  claim      text not null,
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id, claim)
);

-- user_id leads: it is the constant (the hoisted auth.uid()), so the planner
-- seeks one user's contiguous slice and can serve the subquery index-only.
-- Mirrors user_claims' (user_id, claim). This ordering is the one the
-- uncorrelated `in (...)` form wants.
create index on project_grants (user_id, claim, project_id);
```

**This index is not a refinement to add later — it is co-equal with the policy
shape.** Supabase's benchmark for "add an index on the column used in the RLS
filter" is 171 ms → <0.1 ms on a 100K-row table, and they lead their guidance
with it. Ship the index in the same migration as the table; a scoped policy
over an unindexed grants table is the slow path the two-policy split exists to
avoid.

Note the ordering is deliberately *three* columns, not the two you will see in
most write-ups. The subquery filters `user_id` **and** `claim`; with only
`(user_id, project_id)` the `claim` predicate degrades into a post-scan filter
and `project_id` stops being index-only.

Mark the helper functions **`parallel safe`** as well as `stable`. User-defined
functions default to *parallel unsafe*, and a single unsafe function disables
parallel query for the whole statement. One word, easily missed.

**Child tables use the same uncorrelated shape.** For `documents`, `chunks`,
`project_tech_tags`, `project_summaries` the scoped arm is:

```sql
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:view'))
```

Not `exists (select 1 from projects p where p.id = t.project_id and ...)`,
which is correlated twice over and is the worst shape available.

### A.5 The TS surface — additive, not a signature change

`can(user, claim)` stays exactly as it is. Add a sibling:

```ts
canOn(user, "projects:update", projectId)   // true if can() is true, OR a grant exists
```

`canOn` returning true whenever `can` returns true is the code-level statement
of "an existing flat claim is an implicit global scope". Only 3 of ~19 `can()`
call sites are project-scoped, so this is a small diff.

**`CurrentUser.claims` is a `Set<Claim>` and cannot carry a scope.** Rather
than change that shape (it is used by the claims-grid client component), add a
separate lazily-loaded per-project grant lookup. Do NOT load every grant for
every user on every render.

### A.6 Everything that must be taught the rule

Verified inventory. Ordered by exposure, not by effort.

| # | Target | File | Why |
|---|---|---|---|
| 1 | `soft_delete_project` | 0006:32 | **WORST GAP.** Checks the bare claim then deletes by `p_project` with no ownership test. Under scoping, delete rights on one project = delete any project by id. Smallest diff, largest exposure. |
| 2 | `search_projects` `eligible` CTE | 0005:55-63 | SECURITY DEFINER, bypasses RLS. The file already carries a written standing invariant naming this exact change. One `and` clause in the CTE scopes the whole search. |
| 3 | `documents_select` | 0002:103 | No `project_id` correlation. Leaks documents of hidden projects. |
| 4 | `chunks_select` | 0002:119 | Same. This is the retrieval corpus. |
| 5 | `ptt_select` / `ptt_write` | 0002:93,96 | Same. |
| 6 | `summaries_select` | 0002:100 | Same. |
| 7 | The 4 project Server Actions | actions.ts:64,218,304,366 | Each asserts a bare claim while holding a `projectId` it never checks. |
| 8 | `/api/upload-url` | route.ts:57 | `can()` with `body.projectId` in hand, unchecked. |
| 9 | Failed-documents stat | queries.ts:169-173 | Counts by status+is_active only, never project_id. Reports failures from invisible projects. |
| 10 | `MAX_FILES_PER_PROJECT` count | actions.ts:381-386 | The authority for the cap. A wrong count lets the cap be exceeded. |
| 11 | `merge_tech_tag` / `unapproved_tag_usage` | 0011:285,356 | Cross-project writes and an out-of-scope count. **Decide policy:** does `tags:manage` imply portfolio-wide tag authority? If yes, document it and skip. |
| 12 | `email/project-ready.ts:43` | — | Picks `last_updated_by ?? created_by` with no scope test. A user whose access was revoked still gets a link. Minor but real. |

**Correctly OUT of scope:** all of `src/lib/pipeline/*` (admin client, service_role,
`auth.uid()` is null there), and the 6 service_role-only RPCs. The pipeline acts
for the system, not a user.

**`toPaged` (queries.ts:70) is a silent-failure risk:** `count ?? items.length`
means a scope bug renders a plausible-looking total rather than throwing.

### A.6a Verify the plan shape before trusting it

Non-negotiable, because the failure mode is silent — correct results, 1000x
slower. After adding the scoped policies, run against real data:

```sql
explain (analyze, buffers)
select id, title from projects where deleted_at is null limit 20;
```

**Good:** `InitPlan`, or a hashed subplan evaluated once. **Bad:** the literal
strings `Filter: (SubPlan 1)` together with a high `loops=` count on the inner
node — that is the correlated-per-row degradation, and it means the `in (...)`
form did not stay uncorrelated.

Also check `row_security = off` as an assertion tool: it does not bypass RLS,
it *errors* if a query's results would be filtered by a policy. Useful for
proving a query is or is not policy-dependent.

Two documented traps to remember while reading plans:

- **RLS degrades selectivity estimation, not just plan choice.** Non-leakproof
  operators may not consult table statistics, so bad estimates can produce bad
  plans downstream of the policy.
- **`stable` permits single evaluation, it does not guarantee it.** The
  `(select ...)` wrapper is still required even on a `stable` function; the only
  place one evaluation is guaranteed is an index-scan comparison value.

### A.7 Rollout — additive, reversible, never removes access

1. **Ship `project_grants` empty.** No policy references it. Zero behaviour change.
2. **Add the scoped policies alongside the global ones.** Still zero change — the table is empty.
3. **New restricted users get grants instead of the blanket claim.** Existing users untouched. The two populations coexist indefinitely.
4. **Optionally, per user:** grant explicit rows, then remove their blanket claim. Reversible, one user at a time.

**Do not mass-backfill** a grant row per (user, project) pair. It is a cross
join encoding no actual intent, it can never be safely narrowed later because
nobody will know which rows were deliberate, and it is worse than the blanket
claim because it *looks* specific. An honest global grant beats fabricated
precision.

**The permissive phase needs a named end condition.** "Everyone keeps what they
have" is only safe when paired with a stated finish line — otherwise the
migration never completes and you are left worse off than before, with grants
that look deliberate but are only residue. Kubernetes' ABAC→RBAC migration
defines its terminus concretely ("remove the ABAC authorizer") and uses denial
logging as the objective completion signal. The equivalent here:

- **End condition:** every user who should be restricted holds grants instead of
  the blanket claim. Users who legitimately need portfolio-wide access keep the
  global claim permanently — that is a correct end state, not incomplete work.
  Kubernetes keeps `ClusterRoleBinding` forever for the same reason.
- **The distinction that matters:** "global because it is right" is fine;
  "global because nobody narrowed it" is drift. Record which is which.

**Optional shadow check.** Before removing anyone's blanket claim, log what the
scoped path *would* have denied while still enforcing the old answer, and flip
only when divergence is zero for that user. This is cheaper here than in the
literature's examples — both answers come from the same database in one query,
so there is no async fan-out and no dual-write skew. Given that step 4 is
per-user and instantly reversible, treat this as optional insurance.

**Decide explicitly:** `grant_default_claims` (0001:271) auto-grants
`projects:view` to every new non-super-admin. Under scoping, does a new user
see everything or nothing? One line, large consequences.

**Super admins:** `can()` and `has_claim()` short-circuit on `is_super_admin`,
and a super admin correctly has ZERO rows in `user_claims`. The scope rule must
sit below that short-circuit, and must not assume grant rows exist for them.

### A.8 Rejected: Zanzibar / SpiceDB / OpenFGA

The relation-tuple model is the right *vocabulary* — `project_grants` is a
relation-tuple store. But adopting the software is wrong here: it solves
multi-service consistency, recursive hierarchies, and geo-distributed causal
consistency, and this app has none of those. Decisively, it would move
filtering out of SQL: `search_projects` fuses pgvector and FTS with RRF *inside*
one query, and interposing a network call returning an id list would be a
serious regression.

**The vendors concede this themselves**, which is worth recording so the
decision is not relitigated on vibes:

- OpenFGA documents the architecture as "Filter: Your database / Sort: Your
  database / Authorize: OpenFGA", and says of its list API that "**a partial
  list from the API is not enough, because you won't be able to sort using
  it**", becoming "impractical" as counts grow.
- **Silent truncation.** OpenFGA's list defaults cap at 1000 results with a 3s
  deadline, and open issues report truncation with *no indication to the client
  and no continuation token* — so result counts vary with system load. For a
  search page that is a correctness bug, not a performance note.
- SpiceDB: "the wrong `LookupResources` call can return the entire world and
  therefore be slow"; its own advisory says LookupResources "shouldn't gate
  access decisions". The scalable fix (Materialize) is early-access and
  dedicated-tier only, and works by *"a simple JOIN against the local copy"* —
  i.e. you buy back the JOIN you gave up.
- Pagination breaks structurally: post-filtering makes `LIMIT`/`OFFSET` unsound
  and totals uncomputable. `listProjects` already paginates with exact counts.

That last point is fatal here on its own. Revisit only if cross-service authz
or genuinely nested hierarchies appear.

### A.9 One rule to hold to as this grows

Oso's guidance, and worth adopting verbatim as a design constraint:
**"don't do the exact same thing in two different ways"** — for any one
resource type, access should come by *one* path. Today that path is the claim.
After this change it is "claim OR grant", which is already two, and that is the
maximum. Do **not** additionally introduce implicit ownership access (e.g.
`created_by = auth.uid()` silently granting rights), even though the column
exists and it looks free. Three paths to the same permission is how a system
becomes unauditable — and an implicit ownership rule would retroactively widen
access for every project already in the database.

If ownership *should* confer access, express it as a real grant row written at
create time. Explicit, revocable, visible in an audit.

---

## PART B — Client information

### B.1 Separate table, not a column

```sql
create table project_client (
  project_id  uuid primary key references projects(id) on delete cascade,
  client_name text,
  -- room for contact, account manager, etc.
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now()
);
alter table project_client enable row level security;

create policy project_client_select on project_client for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view-client-info')));
```

A separate table because RLS is row-level and cannot hide one column of
`projects`. The alternative — column grants plus a definer read RPC, mirroring
0007 — works but requires auditing every `select` in `queries.ts` forever. A
separate table makes the leak structurally impossible.

**§15.10 already bans `select("*")` in queries.ts, which helps — but a separate
table means even a mistake there cannot leak client data.**

### B.2 It must never enter the RAG

This is the load-bearing rule:

- `project_client` is **never** chunked, **never** embedded, **never** written
  into `summary_text`.
- If the AI extracts a client name from uploaded material, it goes **straight to
  `project_client`** — it must not pass through the chunking path.
- The summariser prompt must be instructed not to name the client.

**Honest limitation to state plainly:** source documents still contain the
client's name in `documents.raw_text` and therefore in `chunks.text` and the
embeddings. Excluding the *field* from the RAG does not scrub the *corpus*.
True scrubbing is a separate, larger piece of work (NER or a known-names pass)
and is deliberately out of scope here. Do not describe this as full
confidentiality; describe it as what it is — the structured field is not
retrievable, the prose may still mention the client.

### B.3 New claim

Add `projects:view-client-info` to `CLAIMS` in claim-set.ts. Adding to that
array surfaces a type error at `CLAIM_LABELS`, which is the intended forcing
function.

---

## PART C — NDA status and disclosure

### C.1 Status enum, plus two derived booleans

Store the full vocabulary verbatim (it is a legal artifact and BD/legal need
their own words):

`Brand Name Use + Client Name Use`, `Brand Name Use Only`,
`Client Name Use Only`, `Nothing Can Be Used`, `NDA Hold — Nothing Can Be Used`,
`Pending BD/Legal Clearance`, `Permanently Excluded`,
`Internal Only — Never External`, `Needs Review`, `Select`

Derive two booleans in ONE place:

```ts
disclosure(ndaStatus) -> { mayUseBrand: boolean, mayUseClientName: boolean }
```

**Fail closed.** `Select`, `Needs Review`, NULL, and any unrecognised value
resolve to `{false, false}`. A project with no NDA answer behaves exactly like
`Permanently Excluded` until someone decides otherwise. Write this as an
exhaustive switch so a newly added status cannot silently default to
disclosable.

This is the first thing to unit-test — it is pure logic, and `tests/` currently
has zero authorization coverage.

### C.2 Who sets it

Set by a human via the select; never AI-populated, never derived. Gate it on
its own claim rather than `projects:update`, so an ordinary editor cannot flip
`Permanently Excluded` to disclosable. Audit every change via `writeAudit`
(which never throws — see the note in CLAUDE.md).

### C.3 `external_reference` is dropped

NDA status governs disclosure. Two fields answering one question is how they
drift apart and contradict each other.

---

## PART D — Simple project fields

Low risk, one migration.

| Field | Type | Notes |
|---|---|---|
| `engagement_type` | text + CHECK | custom AI / automation / software product / staff augmentation / consulting |
| `start_date` | date | |
| `end_date` | date | CHECK `end_date is null or end_date >= start_date` |
| `team_size` | int | CHECK `> 0` |
| `confidentiality_tier` | text + CHECK | see E |

CHECK constraints rather than a Postgres enum: adding a value to an enum is a
migration with locking implications, and these lists will change.

---

## PART E — Confidentiality tier and the AI provider

**Store the tier; do not route on it yet.**

There is one provider today (`src/lib/ai/openai.ts`) plus Deepgram. Building a
provider abstraction before a second provider exists is speculative, and it
raises a question with no good answer: what happens to a project whose tier
changes *after* its text was already sent to OpenAI? That is unrecoverable.

Leave a documented seam. If a tier must genuinely never reach an external
provider, the enforceable version is "this tier skips embedding and
summarisation entirely" — no external call ever happens — which is cheap and
real, unlike routing.

---

## PART F — Document visibility

`documents.visibility`: `internal` | `public` | `on_request` | `no_index`.

`no_index` — "stored, never embedded or retrieved" — is the one with teeth:

- The pipeline must skip chunking and embedding for such documents.
- `search_projects` must exclude their chunks.
- **It is reversible only because §15.2 preserves `raw_text`.** Flipping a
  document out of `no_index` requires a re-chunk from `raw_text`; flipping it
  *into* `no_index` requires deleting existing chunks.

The other three values are metadata for the (not yet existing) MCP layer.

---

## PART G — Links

```sql
create table project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  url text not null,
  title text,
  description text,
  created_at timestamptz not null default now()
);
```

Parse one per line; accept a bare URL, `Title — URL`, or a markdown link;
ignore lines with no URL (matches the existing helper text). If title or
description is absent, the AI fills it.

**Do not fetch the URL server-side to populate metadata.** That is an SSRF
vector — a user-supplied URL fetched by our server can reach internal
addresses. If link fetching is wanted later it needs an allowlist and egress
controls, and should be its own decision.

Links are not extracted in v1, so a link is searchable on its title only.

---

## PART H — MCP

**There is no MCP server in this repo** — zero matches for "mcp" across all
`.ts`, `.tsx`, `.sql`, `.md`. So the disclosure rules here are specified but
not enforced anywhere yet.

When it is built, the NDA gate belongs at **exactly one place**: the boundary
where data leaves for an external token. Not scattered across call sites.
`project_client` must be unreachable by an external token under any NDA status.

---

## Suggested order

1. **Part D** (simple fields) — low risk, immediate value, no design risk.
2. **Part C** (NDA status + derived booleans + tests) — pure logic, testable.
3. **Part B** (client info table + claim) — self-contained.
4. **Part G** (links).
5. **Part F** (document visibility) — touches the pipeline.
6. **Part A** (scoped claims) — largest, and the one to do carefully.
7. **Part E / H** — deferred by design.

Part A can be resequenced earlier if per-project restriction is the actual
priority; it is listed last only because it is the largest and most invasive.
