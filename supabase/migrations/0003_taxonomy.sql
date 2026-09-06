-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 — Taxonomy seed (PRD §7)
-- Idempotent: safe to re-run. `on conflict do nothing` throughout.
-- ═══════════════════════════════════════════════════════════════════════════

insert into industries (name) values
  ('Fintech'), ('Healthcare'), ('E-commerce'), ('Logistics'), ('EdTech'),
  ('Real Estate'), ('Manufacturing'), ('Media & Entertainment'), ('Gaming'),
  ('Travel & Hospitality'), ('Insurance'), ('Legal'), ('HR & Recruiting'),
  ('Marketing & AdTech'), ('Energy'), ('Government'), ('Telecom'),
  ('Agriculture'), ('Non-profit'), ('Other')
on conflict (name) do nothing;

insert into tech_tags (canonical_name, is_approved) values
  -- languages
  ('JavaScript', true), ('TypeScript', true), ('Python', true), ('Java', true),
  ('C#', true), ('Go', true), ('Rust', true), ('PHP', true), ('Ruby', true),
  ('Kotlin', true), ('Swift', true), ('Dart', true), ('SQL', true),
  -- frontend
  ('React', true), ('Next.js', true), ('Vue.js', true), ('Nuxt', true),
  ('Angular', true), ('Svelte', true), ('React Native', true), ('Flutter', true),
  ('Tailwind CSS', true), ('Redux', true),
  -- backend
  ('Node.js', true), ('Express', true), ('NestJS', true), ('Django', true),
  ('FastAPI', true), ('Flask', true), ('Spring Boot', true), ('.NET', true),
  ('Laravel', true), ('Ruby on Rails', true), ('GraphQL', true), ('REST API', true),
  -- data
  ('PostgreSQL', true), ('MySQL', true), ('MongoDB', true), ('Redis', true),
  ('Elasticsearch', true), ('Supabase', true), ('Firebase', true),
  ('DynamoDB', true), ('SQLite', true), ('ClickHouse', true), ('Snowflake', true),
  ('BigQuery', true), ('pgvector', true), ('Pinecone', true),
  -- infra
  ('AWS', true), ('Google Cloud', true), ('Azure', true), ('Vercel', true),
  ('Docker', true), ('Kubernetes', true), ('Terraform', true),
  ('GitHub Actions', true), ('Nginx', true), ('Cloudflare', true), ('Kafka', true),
  ('RabbitMQ', true), ('Celery', true),
  -- AI
  ('OpenAI', true), ('LangChain', true), ('RAG', true), ('TensorFlow', true),
  ('PyTorch', true), ('Hugging Face', true), ('Whisper', true), ('Deepgram', true),
  -- other
  ('Stripe', true), ('Twilio', true), ('Auth0', true), ('Shopify', true),
  ('WordPress', true), ('Figma', true)
on conflict (canonical_name) do nothing;

-- ── Self-aliases ───────────────────────────────────────────────────────────
-- PRD §7: "Also insert every canonical name as a self-alias."
-- The alias key is lower(name) with non-alphanumerics stripped, so 'Next.js'
-- keys as 'nextjs', 'C#' as 'c', '.NET' as 'net'. Derived rather than typed out
-- so the normalisation rule lives in exactly one place.
insert into tech_tag_aliases (alias, tech_tag_id)
select regexp_replace(lower(canonical_name), '[^a-z0-9]', '', 'g'), id
from tech_tags
on conflict (alias) do nothing;

-- ── Explicit aliases (PRD §7) ──────────────────────────────────────────────
insert into tech_tag_aliases (alias, tech_tag_id)
select a.alias, t.id
from (values
  ('js','JavaScript'), ('ecmascript','JavaScript'), ('es6','JavaScript'),
  ('ts','TypeScript'),
  ('py','Python'), ('python3','Python'),
  ('csharp','C#'), ('cs','C#'),
  ('golang','Go'),
  ('reactjs','React'),
  ('nextjs','Next.js'), ('next','Next.js'),
  ('vue','Vue.js'), ('vuejs','Vue.js'),
  ('node','Node.js'), ('nodejs','Node.js'),
  ('rails','Ruby on Rails'), ('ror','Ruby on Rails'),
  ('postgres','PostgreSQL'), ('postgresql','PostgreSQL'), ('psql','PostgreSQL'),
  ('mongo','MongoDB'), ('mongodb','MongoDB'),
  ('es','Elasticsearch'), ('elastic','Elasticsearch'),
  ('gcp','Google Cloud'), ('googlecloud','Google Cloud'),
  ('k8s','Kubernetes'), ('kube','Kubernetes'),
  ('gpt','OpenAI'), ('gpt4','OpenAI'), ('chatgpt','OpenAI'),
  ('tf','TensorFlow'),
  ('torch','PyTorch'),
  ('tailwind','Tailwind CSS'), ('tailwindcss','Tailwind CSS'),
  ('aspnet','.NET'), ('dotnetcore','.NET')
) as a(alias, canonical)
join tech_tags t on t.canonical_name = a.canonical
on conflict (alias) do nothing;
