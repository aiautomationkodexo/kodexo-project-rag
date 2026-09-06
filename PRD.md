# Technical Specification Document
## Portfolio Knowledge Base

**Version 1.1** · Complete implementation spec. Build in the task order in §14.

---

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | Server Components default |
| Hosting | Vercel (Pro) | `maxDuration = 800` on processing routes |
| Database | Supabase Postgres + pgvector | HNSW indexes |
| Storage | Supabase Storage, private bucket | signed URLs both directions |
| Auth | Supabase Auth, magic link only | PKCE flow |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dims |
| LLM | OpenAI `gpt-4o-mini` | JSON mode |
| STT | Deepgram `nova-3` | accepts mp4/mov directly, no ffmpeg |
| Email | Resend | Supabase SMTP + direct API |
| Styling | Tailwind v4 | `@import "tailwindcss"` |

**No separate worker process.** Files cap at 50 MB, so worst-case processing fits in
Vercel's limit. Background work uses `after()` from `next/server`. A cron sweep
handles crashed invocations.

### Dependencies

```json
{
  "dependencies": {
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.47.0",
    "next": "^15.3.0",
    "openai": "^4.77.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.8.0",
    "jszip": "^3.10.1",
    "fast-xml-parser": "^4.5.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

`jszip` + `fast-xml-parser` are for PPTX (unzip, read `ppt/slides/slideN.xml` and
`ppt/notesSlides/`). No maintained pure-JS pptx text extractor exists; do it manually.

---

## 2. Folder structure

```
app/
  layout.tsx  page.tsx  globals.css
  login/page.tsx
  auth/callback/route.ts
  projects/
    page.tsx  actions.ts
    new/page.tsx
    [id]/page.tsx  [id]/live-status.tsx  [id]/file-uploader.tsx
  users/
    page.tsx  actions.ts
    new/page.tsx  [id]/page.tsx
  admin/tags/page.tsx  admin/tags/actions.ts
  api/
    upload-url/route.ts
    process/[documentId]/route.ts
    finalize/[projectId]/route.ts
    cron/sweep/route.ts
lib/
  supabase/client.ts  supabase/server.ts
  auth/claims.ts
  ai/openai.ts  ai/deepgram.ts
  pipeline/chunk.ts  pipeline/extract.ts
scripts/seed-admin.ts
supabase/migrations/*.sql
middleware.ts          ← project root, NOT in app/
next.config.ts  vercel.json  postcss.config.mjs
```

`@/*` maps to project root. `lib/` is at root, not inside `app/`.

---

## 3. Environment

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL          exact origin, no trailing slash
SUPABASE_SERVICE_ROLE_KEY     server only
OPENAI_API_KEY
DEEPGRAM_API_KEY
RESEND_API_KEY
EMAIL_FROM
INTERNAL_SECRET               guards /api/process + /api/finalize
CRON_SECRET                   Vercel-provided
SUPER_ADMIN_EMAIL
SUPER_ADMIN_NAME
```

### Supabase dashboard config

- Auth → Providers → Email: **disable signups**, OTP expiry 900s
- Auth → URL Configuration: Site URL + `{SITE_URL}/auth/callback` in Redirect URLs
- Auth → SMTP: Resend, domain verified (SPF/DKIM)
- Database → Replication: enable Realtime on `projects` and `documents`
- Storage: create private bucket `project-files`

---

## 4. Schema

### 0001_schema.sql

```sql
create extension if not exists vector;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table user_claims (
  user_id uuid not null references profiles(id) on delete cascade,
  claim text not null,
  primary key (user_id, claim)
);

create index on profiles (email);
create index on profiles (is_active) where deleted_at is null;

create table industries (name text primary key);

create table tech_tags (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  is_approved boolean not null default true,
  created_at timestamptz not null default now()
);

create table tech_tag_aliases (
  alias text primary key,
  tech_tag_id uuid not null references tech_tags(id) on delete cascade
);

create index on tech_tags (is_approved);

create table projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) >= 3),
  description text,
  status text not null default 'processing'
    check (status in ('processing','finalizing','ready')),
  industry text references industries(name),
  industry_confidence real,
  summary jsonb,              -- { "sections": [ {key,label,content}, ... ] }
  summary_text text,          -- rendered prose, for display + embedding
  summary_embedding vector(1536),
  created_by uuid references profiles(id),
  last_updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table project_tech_tags (
  project_id uuid not null references projects(id) on delete cascade,
  tech_tag_id uuid not null references tech_tags(id) on delete cascade,
  primary key (project_id, tech_tag_id)
);

create table project_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  summary jsonb not null,
  summary_text text,
  created_at timestamptz not null default now()
);

create index on projects (created_at desc) where deleted_at is null;
create index on projects (status);
create index on projects (industry) where deleted_at is null;
create index on project_tech_tags (tech_tag_id);
create index on project_summaries (project_id, created_at desc);
create index projects_summary_embedding_idx
  on projects using hnsw (summary_embedding vector_cosine_ops);

create table documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  filename text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_key text,
  content_hash text,
  doc_role text,              -- FREE TEXT. "client testimonial", "kickoff call",
                              -- "award submission". No enum, no CHECK constraint.
  status text not null default 'queued'
    check (status in ('queued','processing','done','failed')),
  raw_text text,
  error text,
  attempts int not null default 0,
  is_synthetic boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index documents_project_hash_idx
  on documents (project_id, content_hash) where content_hash is not null;
create unique index documents_one_synthetic_idx
  on documents (project_id) where is_synthetic;
create index on documents (project_id);
create index on documents (status, updated_at);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  ordinal int not null,
  text text not null,
  embedding vector(1536),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index on chunks (project_id) where is_active;
create index on chunks (document_id);
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index chunks_fts_idx on chunks using gin (to_tsvector('english', text));

create table audit_log (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  meta jsonb,
  at timestamptz not null default now()
);

create index on audit_log (entity_type, entity_id, at desc);
```

**`doc_role` is deliberately free text.** People upload testimonials, award
submissions, press coverage, retrospectives — no enum survives contact with real
usage. The value is passed to the summariser as context, so an arbitrary string is
more useful than a constrained one.

### Helper functions

```sql
create or replace function is_active_user(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = uid and is_active and deleted_at is null);
$$;

create or replace function is_super_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = uid and is_super_admin and is_active and deleted_at is null);
$$;

create or replace function has_claim(uid uuid, c text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_active_user(uid) and (
    is_super_admin(uid)
    or exists (select 1 from user_claims where user_id = uid and claim = c)
  );
$$;

create or replace function assert_not_last_super_admin(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from profiles where id = target and is_super_admin
                 and is_active and deleted_at is null) then return; end if;
  select count(*) into n from profiles
   where is_super_admin and is_active and deleted_at is null;
  if n <= 1 then raise exception 'Cannot remove the last active super admin'; end if;
end;
$$;

create or replace function guard_super_admin() returns trigger
language plpgsql as $$
begin
  if (old.is_super_admin and not new.is_super_admin)
     or (old.is_active and not new.is_active)
     or (old.deleted_at is null and new.deleted_at is not null) then
    perform assert_not_last_super_admin(old.id);
  end if;
  return new;
end;
$$;

create or replace function guard_super_admin_delete() returns trigger
language plpgsql as $$
begin perform assert_not_last_super_admin(old.id); return old; end;
$$;

create trigger profiles_guard_super_admin before update on profiles
  for each row execute function guard_super_admin();
create trigger profiles_guard_delete before delete on profiles
  for each row execute function guard_super_admin_delete();

create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create trigger projects_touch  before update on projects
  for each row execute function touch_updated_at();
create trigger documents_touch before update on documents
  for each row execute function touch_updated_at();
create trigger profiles_touch  before update on profiles
  for each row execute function touch_updated_at();

create or replace function grant_default_claims() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.is_super_admin then
    insert into user_claims (user_id, claim) values (new.id, 'projects:view')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger profiles_default_claims after insert on profiles
  for each row execute function grant_default_claims();
```

---

## 5. RLS

Enable on all tables. `service_role` bypasses everything.

```sql
-- profiles
create policy profiles_select on profiles for select to authenticated
using (id = auth.uid() or has_claim(auth.uid(), 'users:view'));

create policy profiles_update_self on profiles for update to authenticated
using (id = auth.uid() and is_active_user(auth.uid()))
with check (id = auth.uid());

create policy profiles_update_admin on profiles for update to authenticated
using (has_claim(auth.uid(), 'users:update'));

create policy profiles_delete on profiles for delete to authenticated
using (has_claim(auth.uid(), 'users:delete'));

-- user_claims — privilege escalation guard is the second condition
create policy claims_select on user_claims for select to authenticated
using (user_id = auth.uid() or has_claim(auth.uid(), 'users:view'));

create policy claims_insert on user_claims for insert to authenticated
with check (has_claim(auth.uid(), 'users:update') and has_claim(auth.uid(), claim));

create policy claims_delete on user_claims for delete to authenticated
using (has_claim(auth.uid(), 'users:update') and has_claim(auth.uid(), claim));

-- projects
create policy projects_select on projects for select to authenticated
using (deleted_at is null and has_claim(auth.uid(), 'projects:view'));
create policy projects_insert on projects for insert to authenticated
with check (has_claim(auth.uid(), 'projects:create'));
create policy projects_update on projects for update to authenticated
using (deleted_at is null and has_claim(auth.uid(), 'projects:update'));
create policy projects_delete on projects for delete to authenticated
using (has_claim(auth.uid(), 'projects:delete'));

-- children
create policy ptt_select on project_tech_tags for select to authenticated
using (has_claim(auth.uid(), 'projects:view'));
create policy ptt_write on project_tech_tags for all to authenticated
using (has_claim(auth.uid(), 'projects:update'))
with check (has_claim(auth.uid(), 'projects:update'));

create policy summaries_select on project_summaries for select to authenticated
using (has_claim(auth.uid(), 'projects:view'));

create policy documents_select on documents for select to authenticated
using (has_claim(auth.uid(), 'projects:view'));
create policy documents_insert on documents for insert to authenticated
with check (has_claim(auth.uid(), 'projects:update')
            or has_claim(auth.uid(), 'projects:create'));
create policy documents_update on documents for update to authenticated
using (has_claim(auth.uid(), 'projects:update'));
create policy documents_delete on documents for delete to authenticated
using (has_claim(auth.uid(), 'projects:delete'));

create policy chunks_select on chunks for select to authenticated
using (is_active and has_claim(auth.uid(), 'projects:view'));

-- taxonomy
create policy industries_select on industries for select to authenticated
using (is_active_user(auth.uid()));
create policy tags_select on tech_tags for select to authenticated
using (is_active_user(auth.uid()));
create policy tags_write on tech_tags for all to authenticated
using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
create policy aliases_select on tech_tag_aliases for select to authenticated
using (is_active_user(auth.uid()));
create policy aliases_write on tech_tag_aliases for all to authenticated
using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

create policy audit_select on audit_log for select to authenticated
using (is_super_admin(auth.uid()));
```

### Storage policies (bucket `project-files`, private)

```sql
create policy storage_read on storage.objects for select to authenticated
using (bucket_id = 'project-files' and has_claim(auth.uid(), 'projects:view'));

create policy storage_write on storage.objects for insert to authenticated
with check (bucket_id = 'project-files'
            and (has_claim(auth.uid(), 'projects:create')
              or has_claim(auth.uid(), 'projects:update')));

create policy storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'project-files' and has_claim(auth.uid(), 'projects:delete'));
```

Path convention: `projects/{project_id}/{document_id}/{filename}`

---

## 6. Search RPC

```sql
create or replace function search_projects(
  query_embedding vector(1536),
  query_text text default '',
  filter_industry text default null,
  filter_tags uuid[] default null,
  match_limit int default 10,
  min_similarity real default 0.15
)
returns table (project_id uuid, score real, best_snippet text, best_source text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_claim(auth.uid(), 'projects:view') then
    raise exception 'Missing permission: projects:view';
  end if;

  return query
  with eligible as (
    select p.id from projects p
    where p.deleted_at is null
      and (filter_industry is null or p.industry = filter_industry)
      and (filter_tags is null or not exists (
        select 1 from unnest(filter_tags) t(tag)
        where not exists (select 1 from project_tech_tags ptt
                          where ptt.project_id = p.id and ptt.tech_tag_id = t.tag)))
  ),
  vec as (
    select c.id, c.project_id, c.text, c.document_id,
           1 - (c.embedding <=> query_embedding) as sim,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c join eligible e on e.id = c.project_id
    where c.is_active and c.embedding is not null
    order by c.embedding <=> query_embedding limit 60
  ),
  fts as (
    select c.id, c.project_id, c.text, c.document_id,
           row_number() over (order by ts_rank(to_tsvector('english', c.text),
             websearch_to_tsquery('english', query_text)) desc) as rnk
    from chunks c join eligible e on e.id = c.project_id
    where c.is_active and query_text <> ''
      and to_tsvector('english', c.text) @@ websearch_to_tsquery('english', query_text)
    limit 60
  ),
  fused as (
    select coalesce(v.id, f.id) as chunk_id,
           coalesce(v.project_id, f.project_id) as pid,
           coalesce(v.text, f.text) as text,
           coalesce(v.document_id, f.document_id) as did,
           coalesce(v.sim, 0) as sim,
           coalesce(1.0/(60+v.rnk),0) + coalesce(1.0/(60+f.rnk),0) as rrf
    from vec v full outer join fts f on f.id = v.id
  ),
  ranked as (
    select distinct on (pid) pid, rrf, sim, text, did from fused
    where sim >= min_similarity or sim = 0
    order by pid, rrf desc
  )
  select r.pid, r.rrf::real, left(r.text, 300),
         coalesce(d.filename, 'description')
  from ranked r left join documents d on d.id = r.did
  order by r.rrf desc limit match_limit;
end;
$$;
```

**Search is content-agnostic.** Every chunk is embedded regardless of what it holds —
testimonials, transcripts, architecture notes, press quotes. No content type is
privileged or excluded. A client's words in a testimonial PDF rank the same way as a
technical paragraph in a design doc.

**RRF rationale:** cosine similarity (0–1) and `ts_rank` (unbounded) aren't comparable
numbers. Ranks are. `1/(60+rank)` from each list, summed.

### Pipeline RPCs

```sql
create or replace function claim_finalize(p_project uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare pending int;
begin
  select count(*) into pending from documents
  where project_id = p_project and status in ('queued','processing');
  if pending > 0 then return false; end if;
  update projects set status = 'finalizing'
  where id = p_project and status = 'processing';
  return found;
end;
$$;

create or replace function stuck_documents(older_than_minutes int default 15)
returns table (id uuid, project_id uuid)
language sql stable security definer set search_path = public as $$
  select id, project_id from documents
  where status = 'processing'
    and updated_at < now() - (older_than_minutes || ' minutes')::interval
    and attempts < 3
  limit 50;
$$;
```

---

## 7. Taxonomy seed

Industries (20): Fintech, Healthcare, E-commerce, Logistics, EdTech, Real Estate,
Manufacturing, Media & Entertainment, Gaming, Travel & Hospitality, Insurance, Legal,
HR & Recruiting, Marketing & AdTech, Energy, Government, Telecom, Agriculture,
Non-profit, Other.

Tech tags (~80 canonical): languages (JavaScript, TypeScript, Python, Java, C#, Go,
Rust, PHP, Ruby, Kotlin, Swift, Dart, SQL), frontend (React, Next.js, Vue.js, Nuxt,
Angular, Svelte, React Native, Flutter, Tailwind CSS, Redux), backend (Node.js,
Express, NestJS, Django, FastAPI, Flask, Spring Boot, .NET, Laravel, Ruby on Rails,
GraphQL, REST API), data (PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch, Supabase,
Firebase, DynamoDB, SQLite, ClickHouse, Snowflake, BigQuery, pgvector, Pinecone),
infra (AWS, Google Cloud, Azure, Vercel, Docker, Kubernetes, Terraform, GitHub
Actions, Nginx, Cloudflare, Kafka, RabbitMQ, Celery), AI (OpenAI, LangChain, RAG,
TensorFlow, PyTorch, Hugging Face, Whisper, Deepgram), other (Stripe, Twilio, Auth0,
Shopify, WordPress, Figma).

Aliases — key is `lower(name)` with non-alphanumerics stripped:

```
js/ecmascript/es6 → JavaScript      ts → TypeScript
py/python3 → Python                 csharp/cs → C#
golang → Go                         reactjs → React
nextjs/next → Next.js               vue/vuejs → Vue.js
node/nodejs → Node.js               rails/ror → Ruby on Rails
postgres/postgresql/psql → PostgreSQL
mongo/mongodb → MongoDB             es/elastic → Elasticsearch
gcp/googlecloud → Google Cloud      k8s/kube → Kubernetes
gpt/gpt4/chatgpt → OpenAI           tf → TensorFlow  torch → PyTorch
tailwind/tailwindcss → Tailwind CSS aspnet/dotnetcore → .NET
```

Also insert every canonical name as a self-alias.

---

## 8. Auth

### middleware.ts (project root)

Runs on all routes except static assets. Must:

1. Create `createServerClient` with cookie get/set wiring
2. Call `supabase.auth.getUser()` — **required**, refreshes the session cookie
3. Public paths: `/login`, `/auth/callback`, `/auth/error`
4. No user + non-public path → redirect `/login`
5. **Query `profiles` for `is_active`/`deleted_at`** — if inactive, `signOut()` and
   redirect `/login?error=deactivated`. Makes deactivation immediate rather than
   waiting for JWT expiry.
6. Signed-in user hitting `/login` → redirect `/projects`

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
```

### Login

`signInWithOtp({ email, options: { shouldCreateUser: false,
emailRedirectTo: `${SITE_URL}/auth/callback` } })`

Always redirect to `/login?sent=1` regardless of outcome — no account enumeration.

### Callback

`GET /auth/callback?code=…` → `exchangeCodeForSession(code)` → redirect `/projects`.
On error redirect `/login?error=expired`.

---

## 9. Claims layer (`lib/auth/claims.ts`)

```ts
export const CLAIMS = [
  'projects:view','projects:create','projects:update','projects:delete',
  'users:view','users:create','users:update','users:delete',
] as const;

export const PRESETS = {
  Viewer:  ['projects:view'],
  Editor:  ['projects:view','projects:create','projects:update'],
  Manager: ['projects:view','projects:create','projects:update','projects:delete',
            'users:view','users:create','users:update'],
};
```

Exports:

- `getCurrentUser()` — wrapped in React `cache()`, returns `null` if signed out or
  inactive. Loads profile + claims into a `Set`.
- `can(user, claim)` — `user.isSuperAdmin || user.claims.has(claim)`
- `requireUser()` / `requireClaim(claim)` — for pages, redirect on failure
- `assertClaim(claim)` — for server actions, throws

**Never compare against a role string anywhere.** `is_super_admin` is the only flag,
and it short-circuits `can()` to true so future claims are covered automatically.

---

## 10. Ingestion pipeline

### Flow

```
server action → insert project (status: processing)
              → insert documents (status: queued)
              → redirect immediately
              → after(() => dispatch(docIds))

dispatch: POST /api/process/{id}, concurrency 4

/api/process/{id}:
  set status=processing, attempts+1
  extract text by mime
  chunk (~800 tok, 15% overlap)
  embedBatch (100 per call)
  delete existing chunks for doc, insert new
  set status=done, store raw_text
  on error: attempts>=3 ? 'failed' : 'queued'
  after(): claim_finalize → if won, POST /api/finalize/{projectId}

/api/finalize/{projectId}:
  gather raw_text from done+active docs, each prefixed with filename + doc_role
  extractMetadata (additive)
  normalize tags via alias map
  generateSummary (additive, open sections)
  embed summary_text, insert into project_summaries, update projects
  status=ready
  Resend completion email
  catch → force status=ready (never strand in 'finalizing')
```

### Concurrency

```ts
async function dispatch(ids: string[]) {
  const CONCURRENCY = 4;           // OpenAI rate limits, not Vercel
  const queue = [...ids];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      await fetch(`${SITE_URL}/api/process/${id}`, {
        method: 'POST', headers: { 'x-internal': INTERNAL_SECRET },
      }).catch(() => {});
    }
  }));
}
```

### Race condition

Parallel completion means multiple invocations can each believe they're last.
`claim_finalize` resolves it with a single conditional UPDATE — Postgres guarantees
one winner. Do not replace this with an application-level check.

### Extraction (`lib/pipeline/extract.ts`)

```ts
switch (true) {
  case mime.startsWith('text/'):        return buf.toString('utf-8');
  case mime === 'application/pdf':      return (await pdfParse(buf)).text;
  case mime.includes('wordprocessingml'):
    return (await mammoth.extractRawText({ buffer: buf })).value;
  case mime.includes('presentationml'): return extractPptx(buf);
  case mime.startsWith('audio/'):
  case mime.startsWith('video/'):       return transcribe(signedUrl);
  default: throw new Error(`Unsupported type: ${mime}`);
}
```

**PDF:** if extracted text < 100 chars, throw `'No text layer — scanned PDFs are not
supported'`. Do not attempt OCR.

**PPTX:** unzip with JSZip, read `ppt/slides/slide*.xml` in numeric order, extract
`<a:t>` nodes, join slide text with `\n`, separate slides with `\n\n`. Also read
`ppt/notesSlides/notesSlide*.xml` and append as `Notes: …` — speaker notes often hold
the real content.

**Deepgram:** POST the Storage signed URL, don't upload bytes.

```ts
await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&paragraphs=true', {
  method: 'POST',
  headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: signedUrl }),
});
```

Build text from `results.channels[0].alternatives[0].paragraphs.paragraphs`, one
paragraph per block, prefixed with `Speaker N:` when diarization is present.

### Chunking (`lib/pipeline/chunk.ts`)

```
TARGET = 3200 chars (~800 tokens)
OVERLAP = 480 chars (~15%)
```

Normalize newlines, split on `\n\n+`, pack paragraphs until TARGET. Oversized single
paragraphs hard-split at TARGET with OVERLAP stride. Carry the tail of the previous
chunk forward as overlap. Discard chunks under 30 chars.

Chunking is uniform across content types. Do not add special handling for
testimonials or any other category.

### Upload

`POST /api/upload-url` → validate mime against allowlist, validate size ≤ 50 MB,
generate `documentId`, return
`createSignedUploadUrl('projects/{projectId}/{documentId}/{filename}')`.

Client uploads directly to Storage, then calls the server action to insert the
`documents` row and dispatch.

**MIME validation:** DOCX and PPTX are ZIP files — magic bytes are `PK\x03\x04` for
both. Validate extension AND declared MIME AND let the parser fail loudly. Reject
`.zip/.rar/.tar/.7z/.gz` explicitly. Reject legacy `.doc/.ppt`.

Allowlist:
```
text/plain  text/markdown  application/pdf
application/vnd.openxmlformats-officedocument.wordprocessingml.document
application/vnd.openxmlformats-officedocument.presentationml.presentation
audio/mpeg  audio/wav  audio/mp4  audio/x-m4a
video/mp4   video/quicktime
```

Limits: 50 MB/file, 20 files/project.

---

## 11. AI layer (`lib/ai/openai.ts`)

### Embeddings

`text-embedding-3-small`, batches of 100, returns `number[][]`.

### Metadata extraction — additive

System prompt requires JSON with:
- `industry`: exactly one from the supplied list, or `"Other"`
- `industry_confidence`: 0–1
- `tech`: array of names actually used; no versions; omit generic terms like "web app"

Pass existing tags in the user message as context. **Never remove tags** — finalize
only upserts.

Validate the returned industry against the DB list; fall back to `'Other'` if
unrecognised.

### Summary — open sections, additive

```ts
export type SummarySection = { key: string; label: string; content: string };
export type Summary = { sections: SummarySection[] };
```

Stored as an **ordered array**, not an object, so display order is explicit and
sections can be reordered or appended without key collisions.

`key` is a stable slug (`client_feedback`). `label` is the display heading (`Client
feedback`). Content is plain prose.

**Sections are not predefined.** The model creates whatever the material warrants —
`client_feedback`, `awards`, `press_coverage`, `team_and_timeline`, `migration_notes`,
anything. What makes regeneration safe is not a fixed list but the requirement to
reuse existing keys exactly.

#### System prompt rules

```
You maintain a structured project summary. Reply with JSON only:
{ "sections": [ { "key": "...", "label": "...", "content": "..." } ] }

RULES
1. Reuse existing section keys EXACTLY as given. Never rename, merge, or re-slug them.
2. Create a new section only when content genuinely fits none of the existing ones.
   Use a lowercase_snake_case key and a short human label.
3. Return a section unchanged when the new content adds nothing to it.
4. Preserve every fact already present. On direct contradiction, prefer the newer
   content — later documents supersede earlier ones.
5. Omit a section only if it would be empty.
6. Reproduce client quotes and testimonials VERBATIM, in quotation marks, with
   attribution when known. Never paraphrase them.
7. Plain prose. No markdown. 2-6 sentences per section.
8. Order sections so general context comes before specifics.
```

Rule 1 is what prevents drift across regenerations — it does the job a fixed enum
would, without constraining what can be captured. Rule 3 is what stops unnecessary
rewrites. Rule 6 exists because a paraphrased testimonial has no reuse value.

#### First generation

Pass suggested starting keys as a *hint*, not a requirement:

```
Suggested starting sections (use only those that fit, add others freely):
overview, problem, solution, architecture, outcomes
```

Without an anchor, thin descriptions come back as a single blob keyed `summary`, and
every later regeneration inherits that shape.

#### Regeneration input

- Existing summary JSON (full)
- New document text only — **not** the whole corpus re-summarised
- Each document prefixed with `--- {filename} ({doc_role}) ---`

The `doc_role` string is passed through verbatim. It's how the model distinguishes a
client testimonial from an internal retro.

#### Rendering

```ts
export function renderSummary(s: Summary): string {
  return (s.sections ?? [])
    .filter(x => x.content?.trim())
    .map(x => `${x.label}\n${x.content.trim()}`)
    .join('\n\n');
}
```

`summary_text` is used for display and for the project-level embedding. Always insert
into `project_summaries` before updating `projects` — version history is the rollback
path.

---

## 12. UI

### `/projects` — listing

Query params: `q`, `industry`, `limit` (5/10/25), `sort` (recent/oldest).

- With `q`: embed the query, call `search_projects`, fetch projects by returned IDs,
  **preserve relevance order** (`ids.map(id => data.find(...))`). Show best snippet +
  source filename per result. Hide the sort control; show "Ranked by relevance."
- Without `q`: plain filtered query ordered by `created_at`.

Empty state with `q`: "No strong matches for that search." Do not pad results.

**Never select `raw_text`, `embedding`, or `summary_embedding` in list queries.**

### `/projects/new`

Title (min 3), description (min 200 chars when no files), file dropzone. Each queued
file gets a free-text label input, placeholder `e.g. client testimonial, final
report`. Client-side validation of type and size before upload.

### `/projects/[id]`

Server component: summary rendered by iterating `summary.sections` in array order
(heading = `label`, body = `content`), industry, tags (unapproved marked `*`),
created_by / last_updated_by, per-document status list showing filename and
`doc_role`, edit form, add-files, delete.

Do not hardcode section names in the UI. Iterate whatever is in the array.

Client component `live-status.tsx`: Realtime subscription to `postgres_changes` on
`projects` and `documents` filtered by project. On `status === 'ready'`, call
`router.refresh()`. Banner text must state that closing the page is safe.

### `/users`

Listing with name/email search, sort by name/created. Create form (email + name +
preset + individual claim checkboxes). Detail page for editing claims, deactivate,
delete.

**Claim checkboxes must be disabled for claims the current user doesn't hold** — the
DB blocks it anyway, but the UI shouldn't offer it.

Creation uses `supabase.auth.admin.createUser({ email, email_confirm: true })` via
service role, then inserts the profile. **No invite email is sent** — the admin
notifies out of band.

### `/admin/tags`

Super admin only. Lists `is_approved = false` tags with usage counts. Actions:
approve (`is_approved = true`), or merge into an existing tag (repoint
`project_tech_tags`, insert an alias row, delete the tag).

---

## 13. Cron sweep

`vercel.json`: `{ "crons": [{ "path": "/api/cron/sweep", "schedule": "*/5 * * * *" }] }`

Auth via `Authorization: Bearer ${CRON_SECRET}`.

1. `stuck_documents(15)` → re-POST each to `/api/process/{id}`
2. Projects in `finalizing` older than 15 min → force `ready`
3. Orphaned Storage objects with no matching `documents` row → delete

Supabase Storage does **not** cascade from Postgres deletes. Step 3 is required or
deleted projects keep costing storage.

---

## 14. Build order

Each task is independently verifiable. Do not proceed until acceptance criteria pass.

**T1 — Scaffold.** `create-next-app` (TS, Tailwind, App Router, no src dir, `@/*`
alias). Config files, `.env.example`, folder skeleton.
*Accept:* `npm run dev` serves; `npm run typecheck` clean.

**T2 — Database.** Migrations 0001–0005 (schema, RLS, taxonomy seed, default claims,
search RPC). Seed script.
*Accept:* migrations apply cleanly; `npm run seed:admin` idempotent across two runs;
`select has_claim(<uuid>, 'projects:view')` returns true for the super admin.

**T3 — Auth.** Supabase clients, middleware, login page, callback route, claims layer.
*Accept:* magic link signs in; signed-out access redirects to `/login`; setting
`is_active = false` forces logout on the next navigation.

**T4 — Description-only projects.** Create action, synthetic document, process route
(text only), finalize route with open-section summary, project detail with Realtime,
listing with hybrid search.
*Accept:* a project with a 200+ char description reaches `ready` within ~20s and is
findable by a semantically-related search sharing no exact words. Summary renders
from the sections array with no hardcoded headings.

**T5 — User management.** Listing, create via admin API, claims editor, deactivate,
delete.
*Accept:* a non-super-admin with `users:update` cannot grant a claim they lack (DB
rejects); the last super admin cannot be deactivated.

**T6 — File upload.** Storage bucket + policies, `/api/upload-url`, client uploader
with progress and per-file label input, extraction for pdf/docx/pptx/txt, per-file
status UI.
*Accept:* a 5-file project processes in parallel; one deliberately corrupt file is
marked `failed` while others complete; project still finalizes. Uploading a
testimonial PDF produces a feedback-style section containing a verbatim quote.

**T7 — Audio/video.** Deepgram integration.
*Accept:* a 10-minute MP4 transcribes and its content is searchable.

**T8 — Tag admin + polish.** Approve/merge screen, storage cleanup in cron, audit log
writes on all mutations.
*Accept:* merging a tag repoints projects and creates an alias so the same variant
normalizes automatically next time.

### Regression test for additive summaries

Worth writing once, at T6:

1. Create a project with a technical description → note the sections.
2. Add a testimonial document → a feedback section appears, existing sections keep
   their keys and their facts.
3. Add a retrospective contradicting a fact → the contradicted fact updates, all
   other facts survive, no section is renamed.

Failure here means rule 1 or rule 3 isn't landing in the prompt.

---

## 15. Invariants

Violating any of these breaks the system in ways that surface late:

1. **Never check roles.** `can(user, claim)` only. `is_super_admin` is the sole flag.
2. **Never drop `documents.raw_text`.** It's the re-chunk and model-migration path.
3. **Chunks are immutable.** Corrections are new documents, never edits.
4. **Filters are pre-filters** — inside the SQL before ranking, never applied to a
   result set afterwards.
5. **Similarity floor is mandatory.** Search must be able to return nothing.
6. **`claim_finalize` is the only finalization gate.** No application-level "am I
   last?" checks.
7. **`service_role` never reaches the client.** No `NEXT_PUBLIC_` prefix, no client
   component import.
8. **Metadata extraction is additive.** Tags are only upserted, never deleted.
9. **`finalizing` is always escaped.** Every error path forces `ready`.
10. **List queries never select vectors or `raw_text`.**
11. **Summary section keys are never renamed by the model.** Rule 1 of the prompt is
    load-bearing — without it, every regeneration silently drops content.
12. **The UI never hardcodes section names.** Iterate the array; the set of sections
    differs per project and grows over time.