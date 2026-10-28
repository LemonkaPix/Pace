# Optional memory

`/memory` is available in checkout and npm installations. It opens setup for an unconfigured project, a normal panel for an empty ready database, and connection repair for an unavailable database. Both setup and the panel offer **Global preferences**. Disabling project memory preserves notes and starts no project memory process in subsequent agent runs. Global preferences can remain enabled independently. Settings are frozen for each agent invocation; a revision change resets main/verifier threads for the next invocation, preserving conversation history.

The composer displays **Memory Enabled** beneath the chat parameters whenever either project memory or global preferences are enabled. An unavailable configuration/connection adds a warning; the label describes the enabled setting, not proof of successful recall. It refreshes when changing repos, closing `/memory`, starting/finishing work and periodically for changes made by another Pace process.

## Scopes and links

There is one user preference store and one optional Basic Memory namespace per canonical project directory. Modules and tasks do not allocate additional backends.

| Scope | Contents and visibility | Writes |
| --- | --- | --- |
| User | A short preference/constraint card shared across repos, stored in `~/.pace/memory/global.json`. It has an independent enable switch and requires no Python/backend installation. | Explicit edits in `/memory` → Global preferences only; no global write operation is exposed to agents. |
| Repo | Durable decisions, conventions and procedures shared between tasks in this repo, subject to branch and provenance checks. | Main uses `scope: "repo"`. |
| Path | Durable rules for explicitly named repo-relative files/directories. A note matches the same path, its parent or a descendant at a directory boundary. `src/pay` does not match `src/payment`. | Main uses `scope: "path"` plus up to five `paths`. |
| Task | Working findings for the same task ID **and** session. They survive a new thread for that task, but are excluded from unrelated tasks/sessions. Existing task briefs and checkpoints remain the working state. | Default for new agent findings and automatic checkpoint capture. |

The global card is deliberately capped at **800 UTF-8 bytes**. It is a user-selected set of preferences, not an automatic summary or a dump of historical notes. It is supplied on a fresh thread or task recall and counts against the shared 3,000-byte initial memory budget. Current requests and enforced permissions still take precedence. Clearing or disabling the card never changes project notes; stale concurrent editors are rejected. A malformed card fails visibly and is preserved for repair.

Project recall performs one bounded text search. Explicit paths in the request establish the initial module focus; Pace does not infer a module from keywords or invoke another model. Without a path focus, module notes are excluded. When the agent discovers the relevant code, it can explicitly search with `paths` to replace that focus:

```json
{"operation":"search","query":"retry policy","paths":["src/pay/worker.ts"]}
```

Search returns stable note IDs, excerpts, scope, paths and provenance. The agent reads a returned ID or explicitly calls `relations` to see one hop. Initial recall includes only visible linked IDs; it never fetches their bodies automatically. Search, direct ID reads, relation expansion and relation writes all enforce task/path visibility as well as the existing project/role/branch/source checks. A link cannot make a hidden or retracted record visible. Unsafe absolute paths, traversal, `.git` and globs are rejected. `files` remains provenance and does not define scope.

```json
{"operation":"remember","scope":"path","paths":["src/pay"],"key":"retry-policy","type":"procedure","content":"Retry each payment independently.","relations":["<ID returned by search>"]}
```

The ID placeholder must be replaced with a real 64-character record ID. A relation target must be visible and active (or pending in the same main attempt). `supersedes` and automatic same-key conflict resolution stay within the same scope, path set, branch and, for task records, task/session. Identical keys in two modules do not overwrite each other. Promoting a working finding requires an explicit new repo/path record; global preferences are never populated by capture.

Old records without scope fields retain their IDs and existing repo-wide semantics. This compatibility rule does not silently reclassify historical notes by their `files` field. Imported external Basic Memory notes remain repo-scoped historical data. Path focus is a retrieval boundary inside a repo, not a filesystem sandbox: agents may explicitly select another module in that repo. Project and role isolation remain enforced separately.

Setup detects Basic Memory **0.24.1** and `uv`. An explicit confirmation may install Python ≥3.12 and the pinned backend into `~/.pace/memory/runtime/0.24.1`. Existing compatible runtimes are reused. Ordinary npm installation only builds Pace. Basic Memory is a separate AGPL-3.0-or-later program; its code is neither vendored nor installed through an npm lifecycle hook.

Configuration lives under `~/.pace/memory/projects/<canonical-path-sha256>/config.json`. Each setup allocates its own backend configuration with exactly one local project. Repository names and remotes do not merge identities. Existing notes can be indexed without changing the user's global Basic Memory configuration. Setup probes use unique names in `pace-setup/`; cancellation only attempts to remove that exact probe. Installed files, notes and previous ready settings remain. A cancelled setup may leave an unactivated namespace and a `.pending` marker for inspection. Concurrent setting changes reject stale revisions.

The adapter checks the backend configuration and always supplies the project argument, except for the constrained `list_memory_projects` tool which has no such argument. The production App Server exposes `pace_memory`, rather than raw backend tools. It disables detected raw Basic Memory MCP servers for that thread and retains unrelated MCP/Vex configuration. Roles other than main can read but cannot remember. There is no second SDK runner: the benchmark shares the current App Server and production adapter, following the approved plan adjustment.

Recall runs on a new task or thread. Policy v2 searches at most five results, reads at most two notes and limits global preferences plus project recall to 3,000 UTF-8 bytes. Individual tool responses are bounded to 4,000 bytes; explicit expansion has eight calls per invocation and depth one. These are byte safeguards, **not exact token limits**. No compatible tokenizer is installed. Text search is used for this pilot; PL/EN recall effectiveness has not been established. Filtering a bounded backend result set can produce fewer results or no match; it does not trigger a wider search cascade.

Records carry source session/task/attempt, role, time, optional branch/commit/files, type, status and relations. An agent finding stays pending until its completed main attempt is durably saved. Validated checkpoints reuse existing checkpoint generation and are captured once; no extra summarizing model runs. Hypotheses retain their type. Notes tied to a branch are visible only on that branch; branchless imported external notes are explicitly historical. Current code and the current request take precedence.

Undo and source removal invalidate reads through the persisted source, including earlier stages of a discarded turn. Retraction is monotonic across redo. Writers serialize, deduplicate stable source IDs and reject old writers that would replace newer decisions. A failed confirmation never reports a successful write. External edits invalidate the recorded content hash and require source review. A crashed writer lock fails closed. Explicit repair removes only an owned lock whose recorded process is provably dead and whose ownership nonce has not changed; live or unverifiable owners require inspection.

`pace-events.jsonl` records operation timing, bytes, hits, failures and verified provider configuration. Billing is `null` when unavailable. A local embedding provider does not imply zero CPU, indexing time or cost. Cold backend startup can exceed the 20-second production deadline under load; the agent then continues with a visible degraded state. Setup uses a separate 60-second connection/tool deadline.

## Backend contract checked on 2026-10-27

Official versioned sources: [runtime and license](https://raw.githubusercontent.com/basicmachines-co/basic-memory/v0.24.1/pyproject.toml), [configuration](https://raw.githubusercontent.com/basicmachines-co/basic-memory/v0.24.1/src/basic_memory/config.py), [search](https://raw.githubusercontent.com/basicmachines-co/basic-memory/v0.24.1/src/basic_memory/mcp/tools/search.py), [graph](https://raw.githubusercontent.com/basicmachines-co/basic-memory/v0.24.1/src/basic_memory/mcp/tools/build_context.py), [write](https://raw.githubusercontent.com/basicmachines-co/basic-memory/v0.24.1/src/basic_memory/mcp/tools/write_note.py), [read](https://raw.githubusercontent.com/basicmachines-co/basic-memory/v0.24.1/src/basic_memory/mcp/tools/read_note.py).

Live Linux verification used Python 3.12.15, Basic Memory 0.24.1, SQLite, FastEmbed `bge-small-en-v1.5`, reranking disabled, isolated `BASIC_MEMORY_CONFIG_DIR`, explicit project routing and `BASIC_MEMORY_FORCE_LOCAL`. `project index`, MCP initialization, constrained project listing and confirmed write/read/delete worked. FastMCP JSON structured responses wrap payloads in `result`; the adapter unwraps them. Project listing rejects a project argument. A private default project remains required by backend initialization even with constrained routing; Pace never changes the user's global default.

Pace freezes and imports its own validated record/source envelope by confirmed backend writes, preserving relationships and provenance. This is not a promise of compatibility with arbitrary Basic Memory database backups. Local indexing and watcher startup were exercised; cloud sync, Windows and macOS execution were not verified. They are not prerequisites for the Linux pilot. Benchmark dataset preparation and economic evidence are tracked separately in [memory verification](memory-verification.md).

To create a separate dataset and distribute it through GitHub or Supabase Storage, follow [Creating and publishing memory datasets](memory-datasets.md). Supabase stores distribution artifacts in that workflow; it does not replace the local Basic Memory backend.
