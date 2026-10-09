# ATL-2: Feed-only mode: a headless intake with a required token, a documented snapshot v2 schema, and no filesystem reading at all

> Machine-generated plan (model `claude-sonnet-5-5`, effort `high`) for
> http://oashaikh.local:9999/local-development/projects/2ac4ce0f-4a28-41ae-b1fa-5b8445f030ec/issues/cee1def9-188c-4165-b654-b6fbd070ee99. Progress below is written by the orchestrator; the
> database copy is authoritative — editing this file does not change execution.
> A task's [x] is the orchestrator's record that the task finished; the
> criteria beneath it are what the planner asked for, not individually
> verified — no per-criterion outcome is recorded anywhere.
> Prose written under a task entry is kept across progress ticks and is
> the place to record analysis; the entry's heading and its Intent,
> Files, criteria, Risk and Commit bullets are re-rendered from the
> database, so edits to those are lost.

## Assumptions

- /api/hook keeps accepting the already-normalized event (what bin/relay.mjs posts), not the raw provider payload. The schema validates that wire shape, and FEED.md also documents the raw fields normalizeHook reads so a feeder can reproduce the mapping.
- Unknown-field rejection and schema validation apply in feed-only mode only. Non-feed mode must behave exactly as before, because the existing test posts an extra `arguments` field and upstream merges stay easy.
- The 'bearer token that must be supplied' is read from the AGENTTRAIL_FEED_TOKEN environment variable (never argv, per SEC-1). The programmatic `startOffice` option is `feedToken`, with a minimum length of 16 characters.
- Feed-only roots are logical absolute paths given with --project and never touched on disk. They exist so `CrewStore.rootFor` can scope events by cwd. At least one root is required.
- The Kitchen UI static files are still served from packages/kitchen/public, since Director embeds the Kitchen. Those reads are inside the package and allowed by the 'no fs read outside the package' test.
- GET /api/bootstrap, /api/state and /api/events stay unauthenticated on 127.0.0.1, as upstream. This is documented in FEED.md, and Director must authenticate in front of them for customers.
- Node 20 compatibility: no JSON import attributes, so the schema is read with fs at startup from inside the package.
- The ~400-line cap (COD-10) is a risk: schema JSON, validator, server changes, three test files and the docs together may exceed it. Tasks 1 to 5 are the runtime change and task 6 is the docs, so the docs can split into a follow-up ticket if the running total is too high.

## Out of scope

- Any change to the Map (bin/agenttrail.mjs), the Kitchen 3D scene or its public/src frontend, or UI changes to hide the Connect agents panel in feed-only mode.
- Fixing the two Map/Kitchen coexistence bugs or the plan-adapter todo-before-confirmation issue named in docs/OBSERVABILITY.md. The ticket asks for feed-only isolation, not for those fixes.
- Authentication on the read routes, rate limiting (SEC-14) and TLS. All are deferred for a loopback, token-gated intake, and the deviation is stated in the final report.
- Adding npm dependencies such as ajv, bumping versions or the lockfile, renaming the project, or touching the MIT notice or upstream credit.
- Validating the raw provider hook payload on the wire, or changing relay.mjs and plate.mjs behaviour in the existing non-feed flow.
- Persisting events or snapshots to disk, or making any outbound or telemetry call.

## Tasks

- [x] **Task 1: Record the feed-only decision and open the tasks in PLAN.md**
  - Intent: PLAN.md convention requires plan-affecting decisions to be recorded BEFORE implementing. Add a dated entry under `## decisions` saying: Kitchen gains a `--feed-only` mode (no fs reads, token-gated intake, schema-validated), upstream names and structure kept for merge-friendliness, and the schema and FEED.md are the contract for Director. Add tasks under the existing `kitchen` component ({#kitchen}, files packages/kitchen/**) for schema, feed-only server, CLI flag and docs. Mark them `[ ]` with `from: agent`. Mark the one being worked `[~]` with `by: claude` as work proceeds. Do NOT add a new component.
Standards touched: GIT-1, GIT-2
  - Files: `PLAN.md`
  - Acceptance criteria the planner set:
    - PLAN.md has a new `## decisions` entry dated 2026-10-09 naming ATL-2 and the feed-only scope
    - New tasks sit under {#kitchen} using `- [ ] Plain outcome {#id}` with verb-led plain-language titles and an indented `tech:` line
    - No new `## component` heading is added; existing `{#id}`s are unchanged
    - Commit message starts with `ATL-2: `
  - Risk: The decision entry is read by the owner, not by engineers. Write it in plain language and keep the engineer phrasing on `tech:` lines.
  - Commit: `f2794ae995fd`

- [x] **Task 2: Add the feed JSON Schema and a small built-in validator** (after 1)
  - Intent: Create packages/kitchen/schema/feed.schema.json (JSON Schema draft 2020-12) with `$defs` for (a) `hookEvent`: the normalized event POST /api/hook accepts, which is `normalizeHook` output and `CrewStore.accept` input, (b) `artifactEvent`: what `PlateStore.accept` reads, and (c) `snapshot`: the version-2 object built by `snapshot()` in server.mjs. Derive snapshot fields from the code, not from memory: the session object in crew.mjs (`accept` init and `snapshot`), `Projects.enrich`, `projects.snapshot` and `kitchenMap`, `OrderStore.snapshot` (orders/tables/unplanned), `PlateStore.snapshot` (artifacts/transfers), and `workflowCrew`/`workflowPlates`. Use `additionalProperties:false` wherever the code emits a fixed shape. Allow `at` and `source` on hookEvent but document them as overwritten by the server. Add src/connectors/feed.mjs exporting a minimal validator, because zero dependencies rules out ajv. It supports only the keywords the schema uses (type incl. type arrays for null, enum, const, properties, required, additionalProperties:false, items, maxItems, maxLength, pattern, minimum/maximum, local $ref into #/$defs). It returns a list of `path: reason` strings that never include the offending value. Add a `ponytail:` comment stating it is a subset validator and that other keywords are unsupported. Add `schema` to package.json `files` so the published tarball carries it (check-package.mjs installs the tarball). Test file test/feed-schema.test.mjs covers: validator rejects an unknown field, a missing required field, a wrong type and a bad enum value. `normalizeHook` output from a claude and a cursor sample validates against hookEvent. A real snapshot from `startOffice({observe:false})` (non-feed mode, scripted events including a TodoWrite, an artifact and a transfer) validates against the snapshot def. This test keeps the schema honest against the code.
Standards touched: COD-1, COD-2, COD-6, COD-7, COD-8, TST-1, TST-5, TST-6, SEC-9
  - Files: `packages/kitchen/schema/feed.schema.json`, `packages/kitchen/src/connectors/feed.mjs`, `packages/kitchen/package.json`, `packages/kitchen/test/feed-schema.test.mjs`
  - Acceptance criteria the planner set:
    - `npm test --prefix packages/kitchen` passes with the new test file
    - A real non-feed snapshot and the `normalizeHook` output for claude and cursor validate against the schema
    - The validator test shows that an unknown property, a missing required property, a type mismatch and an enum miss are each rejected, and error strings contain paths but never values
    - package.json `files` includes `schema`, and `npm run check` and `npm run build` still pass
    - No new npm dependency is added; package-lock.json is unchanged
  - Risk: The schema is the largest diff item and counts toward COD-10's 400-line cap. Keep JSON compact and use shared `$defs` (session state enum, task, etc.) rather than repeating shapes. Optional session fields only appear after certain events (roleBinding, workContext, workHistory, sessionTasks), so enumerate them from crew.mjs, not just from the fields the test happens to hit. If the cumulative diff for the ticket will exceed about 400 lines, stop and report so the docs task can be split into a follow-up ticket (COD-10).
  - Commit: `00b01a1c332d`

- [x] **Task 3: Add feed-only mode to startOffice with token-gated, schema-validated intake** (after 2)
  - Intent: Extend `startOffice` in src/server.mjs with `feedOnly` and `feedToken` options. When `feedOnly` is true, throw before listening unless `feedToken` is a string of at least 16 characters. In this mode: do not construct or poll `LogObserver`; do not call `refreshInstalled` or read `.claude`/`.cursor` configs; do not read or write `server.json`, including in `close()`; do not create `stateDir`. Return `/api/attach`, `/api/projects`, `/api/setup/*` and every other non-allowed POST as 404 or 405. Keep only POST /api/hook and /api/artifact (Bearer token compared in constant time via hashing both sides and `crypto.timingSafeEqual`) and GET /api/bootstrap, /api/state and /api/events. Still serve static files from the package `public/` directory, since Director embeds the Kitchen UI. Omit the csrf `token` from the bootstrap response, because nothing consumes it. Validate the parsed body against the `hookEvent` or `artifactEvent` def (loaded once at startup from the package's schema file) before `store.accept`/`plates.accept`. Reject with 400 and the error list from the validator, never echoing values. Existing behaviour is unchanged when `feedOnly` is false; the existing server test posts an `arguments` field that must still be accepted in non-feed mode. In src/agenttrail/projects.mjs add a feed-only option to `Projects` so `watch`/`poll` seed one project record per root with no fs access (empty components, `kitchenMap([])`, `workflow:null`, `contextSource:'feed'`, `watchStatus:'feed'`) and never call `fs.watch`, `stat`, `readFile` or `fetch`. In the snapshot in feed mode, `recentProjects:[]`, `discoveryLimited:false`, `installed:{}`, `observing:false`, and `observers` all report unavailable, so the version-2 key set is unchanged.
Standards touched: SEC-1, SEC-7, SEC-8, SEC-9, SEC-10, SEC-11, SEC-12, SEC-13, COD-1, COD-2, COD-3, COD-8, COD-9
  - Files: `packages/kitchen/src/server.mjs`, `packages/kitchen/src/agenttrail/projects.mjs`
  - Acceptance criteria the planner set:
    - `startOffice({feedOnly:true})` without a token rejects before binding a port
    - In feed-only mode no module under src/ reads or watches a path outside packages/kitchen; this is proven by the fs-spy test in the integration-test task
    - POST /api/hook and /api/artifact return 403 without the correct bearer token and 400 for an unknown field, with a body that names the path but not the value
    - `/api/attach`, `/api/projects`, `/api/setup/preview` and `/api/setup/apply` are not served in feed-only mode
    - Existing tests in test/server.test.mjs and test/attach.test.mjs pass unchanged
    - The server still binds 127.0.0.1 only and makes no outbound call
    - `npm run check`, `npm test` and `npm run build` pass
  - Risk: server.mjs is dense one-line style; match it and keep the diff small, with no refactor of unrelated lines to keep later upstream merges easy. `close()` currently reads server.json, so it must be skipped in feed mode or the no-fs-read test fails. The tick loop calls `projects.poll`, so that path needs the feed guard too. SEC-14 (rate limiting) is deliberately not added: the intake is loopback-only, token-gated, capped at 32 KB per body, and the stores bound memory (4000 dedup keys, 160 sessions). State this deviation in the final report rather than silently skipping it.

- [ ] **Task 4: Add --feed-only to the agenttrail-kitchen CLI and refuse to start without a token** (after 3)
  - Intent: In bin/office.mjs add `--feed-only` to `parseArgs` and `--help`. The token comes ONLY from the `AGENTTRAIL_FEED_TOKEN` environment variable. Never accept it on argv, because that leaks via `ps` and shell history. When `--feed-only` is set, exit non-zero with a clear message if the variable is missing or shorter than the server's minimum. Treat each `--project` or positional path as a logical absolute path that is NOT stat'ed or realpath'ed, and require at least one. Skip `projects.json` read/write, the `server.json` registration/attach branch, and the browser open (headless). Pass `feedOnly` and `feedToken` through to `startOffice`. Print a ready line that names the port but never the token.
Standards touched: SEC-1, SEC-3, SEC-13, COD-1, COD-2, COD-8, TST-1
  - Files: `packages/kitchen/bin/office.mjs`, `packages/kitchen/test/feed-cli.test.mjs`
  - Acceptance criteria the planner set:
    - A spawned `node bin/office.mjs --feed-only --project /logical/root` without AGENTTRAIL_FEED_TOKEN exits non-zero, prints a message naming the variable, and opens no port
    - With the variable set, the process starts, prints a ready line without the token, and serves /api/state; the test stops it by signal and sleeps on nothing (it waits on stdout)
    - `parseArgs` still accepts every existing option (existing attach tests pass) and rejects `--feed-only` with a non-absolute project path
    - The token never appears in stdout or stderr
    - `npm run check`, `npm test` and `node --check bin/agenttrail.mjs` pass
  - Risk: Current main() performs realpath/stat of roots and reads state files before startOffice, so the feed-only branch must return to startOffice before any of that. `bin/office.mjs` imports at module level, so keep the new branch inside main() and keep parseArgs pure so the existing unit tests are unaffected.

- [ ] **Task 5: Test feed-only end to end: scripted events, schema-valid snapshot and stream, no fs reads outside the package** (after 3, 4)
  - Intent: Add test/feed-only.test.mjs. Start `startOffice({feedOnly:true, feedToken, roots:[logical root], port:0})` and push a scripted, fixture-only sequence through POST /api/hook (session-start, turn-start, tool-start Write with a file, TodoWrite-style `tasks`, tool-end, permission, turn-end, session-end) and POST /api/artifact (produced, then offered/received with handoffId). After each step, assert that GET /api/state and the next /api/events message validate against the schema's snapshot def and show the expected state transitions. The POST calls trigger `tick()` synchronously, so wait on the SSE message itself and never on a timer (TST-4). Also assert: /api/bootstrap validates; wrong or missing token gives 403; an unknown field gives 400 and does not change the snapshot; a cwd outside the root gives `accepted:false`; the removed routes are not served. For the fs guarantee, wrap the read-side functions on both `node:fs` and `node:fs/promises` (readFile, readdir, stat, lstat, realpath, open, access, watch, createReadStream and the sync variants) with recorders BEFORE calling startOffice, restore them in `t.after`, run the whole start, push, read, close cycle, and assert every recorded path resolves inside packages/kitchen/public. Write the test so it fails if any read is added: run it once against a deliberately unguarded path to see it fail, and report that it was seen to fail (TST-2 style). Use only invented data (TST-6) and the loopback server, with no live endpoints (TST-5).
Standards touched: TST-1, TST-3, TST-4, TST-5, TST-6, SEC-7, SEC-9
  - Files: `packages/kitchen/test/feed-only.test.mjs`
  - Acceptance criteria the planner set:
    - The test exercises start, intake sequence, /api/state, /api/events and close in feed-only mode, and every snapshot seen validates against the schema
    - The fs-spy assertion lists no path outside packages/kitchen/public, and demonstrably fails when a read outside the package is injected
    - No `setTimeout`/sleep is used to wait for events
    - `npm test --prefix packages/kitchen` is green with `--test-concurrency=1`
  - Risk: Patching fs works because src/ uses default imports of node:fs and node:fs/promises. If any module uses named imports from them, call `module.syncBuiltinESMExports()` after patching and again after restoring. Tests run with concurrency 1, which keeps the global patch from leaking into other files; still restore in `t.after`, including on failure. ESM module loading uses internal bindings and is not intercepted, so that is not a concern.

- [ ] **Task 6: Write docs/kitchen/FEED.md, update OBSERVABILITY.md, and close out PLAN.md** (after 2, 3, 4, 5)
  - Intent: Write docs/kitchen/FEED.md in British English as the contract an external feeder (Director) builds against. Cover how to start (`AGENTTRAIL_FEED_TOKEN`, `--feed-only`, logical `--project` roots), the four routes and what each accepts or returns, the auth model, and the error codes. Document the hook event field by field: first the raw provider payload fields `normalizeHook` reads for claude and cursor and how they map to `kind`, `tool`, `file`, `tasks`, then the wire event POST /api/hook validates, with required/optional, types, limits (`clean` truncation lengths, 24 tasks, 32 KB body) and which fields the server overwrites (`at`, `source`). Document the artifact event the same way. Document the version-2 snapshot field by field, including sessions/executors, crew, orders/tables/unplanned, artifacts/transfers, projects/kitchens/deliverables and the constant feed-mode values. State plainly that GET routes are unauthenticated on 127.0.0.1, so Director must put its own authentication in front before showing anything to customers, and that snapshots contain `cwd`-derived relative file names and session task titles. Add a short feed-only section to docs/OBSERVABILITY.md saying what is read (nothing outside the package) and what is sent to the browser. Link FEED.md from docs/kitchen/README.md. Add test/feed-docs.test.mjs, which reads the schema and fails if any property name in it is missing from FEED.md, so the doc cannot drift. In PLAN.md flip the finished tasks to `[x]`, keeping their `by:` lines.
Standards touched: SEC-1, SEC-12, COD-7, GIT-1, GIT-8
  - Files: `docs/kitchen/FEED.md`, `docs/OBSERVABILITY.md`, `docs/kitchen/README.md`, `packages/kitchen/test/feed-docs.test.mjs`, `PLAN.md`
  - Acceptance criteria the planner set:
    - FEED.md covers every property in feed.schema.json, enforced by test/feed-docs.test.mjs which fails if one is removed from the doc
    - Every example in FEED.md uses invented data and no real token, path or customer name
    - OBSERVABILITY.md has a feed-only section that stays truthful about reads and about what reaches the browser
    - New prose is in British English and carries no machine paths, job ids or Plane URLs
    - `npm test --prefix packages/kitchen`, `npm run check`, `npm run build` and `node --check bin/agenttrail.mjs` all pass
  - Risk: This is the largest prose diff. Prefer tables for field lists to stay compact. FEED.md is published documentation, so run the humanize skill before finishing if available (the user's global rules ask for it). If the total ticket diff passes about 400 lines, split this task into a follow-up ticket before starting it (COD-10) instead of squeezing it in.
