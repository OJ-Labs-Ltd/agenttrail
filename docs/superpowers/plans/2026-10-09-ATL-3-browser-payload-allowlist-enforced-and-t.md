# ATL-3: Browser payload allowlist enforced and tested: no prompts, command bodies, tool arguments, absolute paths or secrets reach the browser

> Machine-generated plan (model `claude-sonnet-5-5`, effort `high`) for
> http://oashaikh.local:9999/local-development/projects/2ac4ce0f-4a28-41ae-b1fa-5b8445f030ec/issues/247e765c-8b5f-45a1-9ab9-4c9657f08c17. Progress below is written by the orchestrator; the
> database copy is authoritative — editing this file does not change execution.
> A task's [x] is the orchestrator's record that the task finished; the
> criteria beneath it are what the planner asked for, not individually
> verified — no per-criterion outcome is recorded anywhere.
> Prose written under a task entry is kept across progress ticks and is
> the place to record analysis; the entry's heading and its Intent,
> Files, criteria, Risk and Commit bullets are re-rendered from the
> database, so edits to those are lost.

## Assumptions

- The shared module lives at packages/kitchen/src/runtime/payload-allowlist.mjs. It is already in the Kitchen tarball (files: src) and is added to the root package's files list so the Map ships it. A copy, or a new root lib/, would break 'one place' or the Kitchen tarball.
- Task, todo and PLAN.md titles are visible by design (the docs say so). The guard for them is a length cap, control-character stripping and secret redaction, not detection of prompts in general.
- Kitchen project ids and recentProjects become opaque handles. This is a deliberate change to the browser contract that the ticket's 'no absolute paths' requires. Server-side keys and stored history are untouched; only the output and the inbound lookups change.
- The Map's tests live in packages/kitchen/test because the root has no test runner and CI runs only that package's npm test plus node --check on the Map. No new dependency or root test script is added.
- The whole ticket is likely 600-800 lines including tests, above the ~400-line PR guidance (COD-10). Tasks 1-4 (module, Kitchen ingestion, egress, Kitchen test) and tasks 5-6 (Map) are separate cut points, so the orchestrator can ship them as two PRs.
- Event-kind lists were taken from CrewStore.accept (13 kinds), PlateStore.accept (4 artifact kinds) and the Map's handleHookEvent (6 hook names). Cursor hook names are already mapped by normalizeHook onto the Kitchen kinds.
- The worktree's CLAUDE.md/AGENTS.md plan convention applies to the implementer: mark PLAN.md tasks [~] before starting and [x] on completion, with by: lines.

## Out of scope

- The Map's /whoami (repoPath, used by bootDedup and Kitchen's board check), /suggest (lists other repos' absolute paths) and /spawn (takes an absolute path). They are server-to-server or user-input features that need their own handle design. Documented as a limit and filed as a follow-up plan task.
- Restricting which projects' logs the Kitchen log adapter reads from ~/.claude and ~/.codex. Only what reaches the browser changes.
- The two Map/Kitchen coexistence bugs and plan-adapter acknowledgement handling named in OBSERVABILITY.md (separate open PLAN.md tasks).
- Request-boundary hardening for the Map's POST routes (/setup, /spawn, /hook), tracked as runs-request-boundary in PLAN.md.
- Scanning PLAN.md content or git history for secrets, rate limiting, or rotating any key (no real secret is involved; fixtures use invented canaries).
- Any new npm dependency, telemetry or outbound call; both services stay bound to 127.0.0.1.

## Tasks

- [x] **Task 1: Add the payload allowlist module with per-kind field tables, path reduction and secret redaction**
  - Intent: Create packages/kitchen/src/runtime/payload-allowlist.mjs, the single place that says what the browser may receive. It exports: (a) EVENT_FIELDS, an exact allowed-field list for each Kitchen event kind accepted by CrewStore (session-start, session-end, turn-start, turn-end, tool-start, tool-end, permission, input, interrupted, activity, unknown, role, observation), plus ARTIFACT_FIELDS for produced/offered/received/failed; (b) HOOK_FIELDS, the same for the Map's raw Claude hook names (SessionStart, SessionEnd, Stop, PreToolUse, PostToolUse, SubagentStop), where tool_input may carry only file_path/notebook_path and todos[{content,status}]; (c) allowEvent(event) and allowHook(hook), which copy only listed fields and drop everything else (prompt, command, description, query, tool output); (d) redactSecrets(text), which replaces common token prefixes (sk-, sk-ant-, ghp_, github_pat_, gho_, xox[abp]-, AKIA, AIza, glpat-, 'Bearer ', JWT-shaped eyJ strings, PEM BEGIN blocks) and high-entropy runs of 32 or more base64/url-safe characters with '[redacted]'. Hex-only runs (git SHAs) and hyphenated UUIDs must survive; (e) relativePath(file, roots), which turns an absolute path under a watched root into a project-relative one and any other absolute path into its basename or '[path]'; (f) titleText(text), which applies the existing clean() collapse, a hard length cap and redactSecrets. No wiring yet, so no behaviour changes. Tests in packages/kitchen/test/allowlist.test.mjs are table-driven over EVERY kind in EVENT_FIELDS, ARTIFACT_FIELDS and HOOK_FIELDS: feed a hostile event with extra keys (prompt, command, tool_input.command, reasoning, output) and assert only the listed fields survive. Add one test per secret prefix, a false-positive guard (40-hex SHA, UUID, normal prose title), and path cases (inside root, outside root, '..' escape, Windows-style). Fixtures use invented data only. Reuse clean/within from runtime/crew.mjs. Zero new dependencies; use node:path only.
Standards touched: COD-1, COD-2, COD-6, COD-7, SEC-1, SEC-9, SEC-12, SEC-13, TST-1, TST-5, TST-6
  - Files: `packages/kitchen/src/runtime/payload-allowlist.mjs`, `packages/kitchen/test/allowlist.test.mjs`
  - Acceptance criteria the planner set:
    - EVENT_FIELDS has an entry for each of the 13 kinds in CrewStore.accept's kinds array, ARTIFACT_FIELDS has the 4 artifact kinds, and HOOK_FIELDS has the 6 Map hook names. A test asserts the key sets equal those lists, so adding a kind without allowlisting it fails
    - For each kind, a test passes an event with a prompt, a shell command, a tool-output blob and an unknown key, and asserts the result contains only that kind's listed fields
    - redactSecrets removes one canary for each of: sk-ant-, sk-, ghp_, github_pat_, xoxb-, AKIA, AIza, a JWT, a 'Bearer' header, a PEM header, and a 40-character mixed-case random string. It leaves a 40-hex git SHA, a UUID and 'Implement the endpoint' unchanged
    - relativePath maps '<root>/src/a.js' to 'src/a.js', maps '/etc/passwd' (outside roots) to a non-absolute string with no directory prefix, and never returns a string beginning with '/' or a drive letter
    - titleText caps length (180 characters or fewer) and strips control characters and newlines
    - npm run check, npm test and npm run build pass in packages/kitchen; node --check bin/agenttrail.mjs passes
  - Risk: The entropy rule is the false-positive risk: it must not mangle session ids, hashes or file names that legitimately reach the UI. Keep the threshold conservative (about 4.2 bits per character, 32 or more characters, mixed case and digits) and pin it with guard tests. Titles (task and todo text) are shown by design; the guard there is the length cap plus redaction, and a prompt-like title cannot be detected beyond that. Say so in the docs task. The file is shared with the Map, so keep it dependency-free (node:path only).
  - Commit: `fb3e3ab0cd7c`

- [x] **Task 2: Apply the allowlist to every event Kitchen stores** (after 1)
  - Intent: Route all Kitchen ingestion through the allowlist so non-listed fields never reach stored state. CrewStore.accept (runtime/crew.mjs) is the choke point for log adapters (codexEvents/claudeEvents), hooks (normalizeHook) and the raw POST /api/hook body, so call allowEvent(event) first and then use only the returned fields. Run tool, file, label, task and outcome titles, and work.label through titleText/relativePath so stored values are already redacted. PlateStore.accept (runtime/plates.mjs, POST /api/artifact) gets the same treatment through ARTIFACT_FIELDS, covering label and file. Do not change the existing dedupe, ordering or turn logic. Add store-level tests in packages/kitchen/test/allowlist-ingest.test.mjs: feed CrewStore.accept hostile events of every kind and assert the snapshot contains no canary. A prompt in tasks[0].title is capped; sk-... in event.file is redacted or relative; a command in an extra 'command' or 'tool_input' key is gone. Confirm the existing claude-native-acks, crew, orders, plates, attach and workflow tests still pass unchanged.
Standards touched: COD-3, COD-8, SEC-9, SEC-12, TST-1, TST-2, TST-6
  - Files: `packages/kitchen/src/runtime/crew.mjs`, `packages/kitchen/src/runtime/plates.mjs`, `packages/kitchen/test/allowlist-ingest.test.mjs`
  - Acceptance criteria the planner set:
    - CrewStore.accept calls allowEvent before reading any field. A test shows an event carrying extra prompt/command/output keys yields a session snapshot with none of those values anywhere in JSON.stringify(store.snapshot())
    - Each of the 13 kinds is exercised at least once through CrewStore.accept in the new test, with hostile extras on every one
    - PlateStore.accept stores label and file through the allowlist. A test with an artifact label of 'sk-ant-...' and a file under the root yields a redacted label and a project-relative file
    - The new hostile-event test was seen to fail on the pre-change code (recorded in the report), per TST-2
    - All existing Kitchen tests pass unmodified; npm run check, npm test and npm run build pass in packages/kitchen
  - Risk: Do not break ordering semantics: the allowlist must keep 'at', 'turnId', 'toolId', 'id', 'source' and 'parentId', which dedupe and retired-turn logic need, so include them in the base fields for every kind. Events from /api/hook arrive as unvalidated JSON, so type-check each copied field (strings, bounded arrays) instead of copying by reference.
  - Commit: `b69bae4df4bd`

- [x] **Task 3: Strip absolute paths and handles from the Kitchen browser feed (/api/state, /api/bootstrap, /api/events)** (after 1, 2)
  - Intent: Kitchen's snapshot() in server.mjs is the one function behind /api/state, /api/bootstrap and the SSE stream. Add an egress pass there so no absolute path or secret survives, whatever field it sits in. Project ids and composite ids (role:<root>:..., orders, tables, artifacts, transfers, executors' cwd/project) currently embed the absolute root. Replace each watched root with an opaque handle (sha256(root).slice(0,12), exported by the allowlist module as projectHandle) everywhere in the outgoing snapshot, make session cwd project-relative, and run remaining string leaves through redactSecrets and the generic absolute-path fallback. recentProjects (other projects' log discovery) becomes {handle,name,providers,lastSeenAt} with no path. Keep a handle-to-root map server-side so POST /api/projects accepts {handle} as well as a typed absolute path, and POST /api/setup/preview and /api/setup/apply accept the handle for data.project. The CLI (bin/office.mjs) builds its ?project= URL with projectHandle. Update public/src/app.js (the recent-repo button uses the handle and drops the visible repo-path line; project selection already treats ids as opaque) and scripts/check-package.mjs, whose assertion that the ?project= param equals the path must change to the handle. Add a unit test for the egress scrub plus a handle round-trip test in server.test.mjs.
Standards touched: COD-1, COD-3, COD-8, SEC-7, SEC-9, SEC-10, SEC-12, SEC-13, TST-1, TST-5, TST-8
  - Files: `packages/kitchen/src/runtime/payload-allowlist.mjs`, `packages/kitchen/src/server.mjs`, `packages/kitchen/src/connectors/logs.mjs`, `packages/kitchen/bin/office.mjs`, `packages/kitchen/public/src/app.js`, `packages/kitchen/scripts/check-package.mjs`, `packages/kitchen/test/server.test.mjs`, `packages/kitchen/test/allowlist.test.mjs`
  - Acceptance criteria the planner set:
    - JSON.stringify of /api/state, /api/bootstrap and the first /api/events message contains neither the watched root's absolute path, the temp home path, nor any string starting with '/' followed by a directory segment, where roots and home are the test's own temp paths
    - projects[].id and every id derived from it are handles, and the UI still selects and renders a project (app.js selection logic unchanged apart from the recent-repo button)
    - POST /api/projects with {handle} from recentProjects opens that project. A typed absolute path still works. An unknown handle returns 400 with the existing 'could not be found' style error. A test covers all three
    - POST /api/setup/preview with the handle of a watched project works, and with a non-watched handle it is refused (the existing watched-project rule is preserved)
    - scripts/check-package.mjs asserts the handle form of the project param. Run `npm pack` then `node scripts/check-package.mjs ./agenttrail-kitchen-*.tgz` once by hand, since CI runs it but the project validation commands do not (TST-3). Report the result
    - npm run build, check and test pass in packages/kitchen
  - Risk: Highest-risk task: ids are composed by string concatenation across orders.mjs, workflow-crew.mjs and projects.mjs, so replace roots by longest-prefix string replacement over a bounded deep walk of the snapshot instead of editing each producer. Keep the walk linear because snapshot() runs every second. Dedupe in tick() compares JSON, so scrub BEFORE the comparison. Do not change server-side keys (roots, OrderStore ids) or stored order history; this is an output transform only. public/build is generated by esbuild; run npm run build and do not commit build output. If the front-end change grows beyond a few lines, stop and report instead of rewriting the UI.

- [ ] **Task 4: Add the Kitchen hostile-event test over the real HTTP service** (after 2, 3)
  - Intent: Prove the ticket's 'done' condition for Kitchen end to end. New packages/kitchen/test/payload-privacy.test.mjs starts startOffice on a temp root with a temp home and port 0, then feeds hostile events through BOTH ingestion routes: (1) authenticated POST /api/hook, using the hookToken from stateDir/server.json, with a prompt in a todo title, an sk-ant-... key and a shell command in tool_input (command, plus file_path = '<root>/secrets/sk-ant-.../.env'), and an absolute path outside the root; (2) a Codex jsonl and a Claude jsonl in the temp home with the same hostile content so the LogObserver path is covered. Then fetch /api/state, /api/bootstrap and read the first /api/events SSE message. Assert none of the canaries appear in any of them: the full prompt text beyond the title cap, the API key, the command string (e.g. 'rm -rf /tmp/pwned && curl http://evil.invalid'), and the temp root and home absolute paths. Assert the expected sanitised content IS present (session exists, relative file or redaction marker, capped title) so the test cannot pass vacuously. No sleeps: wait on the SSE message or on the service API (TST-4); fakes only, no network (TST-5).
Standards touched: TST-1, TST-4, TST-5, TST-6, SEC-1, SEC-12
  - Files: `packages/kitchen/test/payload-privacy.test.mjs`
  - Acceptance criteria the planner set:
    - The test drives hostile data through POST /api/hook and through Codex and Claude log fixtures, and checks /api/state, /api/bootstrap and /api/events
    - It asserts the absence of at least five distinct canaries (prompt text, API key, shell command, root path, home path) in all three responses
    - It asserts positive evidence that the sanitised session and task were observed, so an empty snapshot fails the test
    - Temporarily reverting the allowlist call in CrewStore.accept or the egress scrub makes the test fail (seen to fail, noted in the report)
    - No setTimeout/sleep is used to wait; npm test passes in packages/kitchen with --test-concurrency=1
  - Risk: SSE reading needs an abort and a bounded, event-driven wait (read until the data: line arrives), as scripts/check-package.mjs already does. The log adapter only watches roots inside the temp home, so reuse the pattern from server.test.mjs ('log reader resumes partial records'). Use mkdtemp under os.tmpdir() and clean up in t.after.

- [ ] **Task 5: Apply the allowlist to the Map's hook events, saved state and live model** (after 1)
  - Intent: In bin/agenttrail.mjs, import allowHook, redactSecrets, relativePath and titleText from ../packages/kitchen/src/runtime/payload-allowlist.mjs (zero deps, same file Kitchen uses). In handleHookEvent, run the raw hook through allowHook first. Change toolDetail so only a project-relative file path is kept for file tools, and the shell command, description, pattern, url, query and prompt are never read; show just the tool name otherwise. The Task sub-agent name currently comes from tool_input.description (a prompt), so use a fixed label ('sub-agent') instead. run.todos content goes through titleText. run.cwd becomes the project-relative form ('' or a subdirectory), not the absolute path, with the root-containment check done before sanitising. loadState passes loaded runs, recentTools and todos through the same sanitiser so files already on disk from older versions are cleaned on the next save. model(), the tick, SSE and the ~/.agenttrail/<hash>.json outputs then inherit the cleaned data with no extra code. Add the shared module to the root package.json 'files' list so the published Map package ships it (root files are currently bin, public, docs/demo.gif). Do not change /whoami, /suggest or /spawn (see out_of_scope).
Standards touched: COD-3, COD-8, SEC-1, SEC-9, SEC-11, SEC-12, SEC-13
  - Files: `bin/agenttrail.mjs`, `package.json`
  - Acceptance criteria the planner set:
    - A PreToolUse/PostToolUse hook with tool_input.command='rm -rf ...' produces a run whose currentTool.detail and recentTools[].detail do not contain the command; a file_path hook produces a project-relative detail
    - A Task hook with a long description produces a sub-agent entry that does not contain the description
    - A TodoWrite todo whose content holds an sk-... token is stored redacted and capped
    - run.cwd and every other stored string are free of the repo's absolute path
    - State written by an older version containing an absolute cwd and a command detail is cleaned when loaded and re-saved (covered in the next task's test)
    - node --check bin/agenttrail.mjs passes; `npm pack --dry-run` in the repo root lists the allowlist module; npm run check, test and build pass in packages/kitchen
  - Risk: The Map UI (public/index.html around lines 513-519, the .td/.hd spans) renders tool.detail. Empty details must render cleanly ('name · ' with an empty tail), so check that and trim the separator if needed. The relative cwd must still satisfy the containment test in handleHookEvent, which uses the raw event cwd, so sanitise after that check. Keep the Map's existing style and avoid refactoring: this is the upstream file, so keep hunks small for later merges.

- [ ] **Task 6: Add the Map hostile-event test (live endpoints and saved state file)** (after 5)
  - Intent: Prove the Map half of the ticket. New packages/kitchen/test/map-privacy.test.mjs (it runs under the existing `npm test --prefix packages/kitchen` gate, because the root has no test runner) spawns `node bin/agenttrail.mjs <tmp repo> --no-open --port <free port>` with HOME set to a temp dir so the saved state file lands in <tmp>/.agenttrail and not in the real home. Wait for the 'agenttrail ·' stdout line (event-driven). POST hostile hook payloads to /hook: a PreToolUse and a PostToolUse whose tool_input has a shell command with a pasted API key, a file_path of '<repo>/secrets/sk-ant-.../x', a TodoWrite whose todo content is a long prompt with a token, and a Task with a prompt-like description. Then GET /model, /board-lite, /summary and the first /events message, send SIGTERM so the daemon flushes its state, wait for exit, and read <tmp>/.agenttrail/*.json. Assert no canary appears in any of them: command text, API key, prompt text beyond the cap, and the repo's absolute path. Assert the sanitised run is present (relative file, redacted todo). Also seed an old-format state file (absolute cwd, command detail) before launch and assert it is cleaned after the SIGTERM save.
Standards touched: TST-1, TST-4, TST-5, TST-6, SEC-1, SEC-12
  - Files: `packages/kitchen/test/map-privacy.test.mjs`
  - Acceptance criteria the planner set:
    - The test spawns bin/agenttrail.mjs with a temp HOME and temp repo, and never touches the real ~/.agenttrail
    - Canaries are absent from /model, /board-lite, /summary, the /events first message and the saved state JSON
    - Positive assertions show the sanitised run, relative file and redacted todo are present
    - The legacy-state migration case passes
    - The test was seen to fail with the bin/agenttrail.mjs changes reverted (noted in the report), and no sleeps are used; it waits on stdout, HTTP responses and the child exit event
    - The child process is always killed in t.after, so a failed assertion cannot leave a daemon running; npm test passes in packages/kitchen
  - Risk: The Map's bootDedup probes ports 5330-5344 for the same repoPath and discoverBoards fetches sibling boards on loopback only. Both stay on 127.0.0.1, which is acceptable for a test; pick a free high port and keep the repo path unique per run. SIGTERM handling calls saveState then process.exit. SIGTERM is not a clean signal on Windows, but CI is Linux and macOS only.

- [ ] **Task 7: Make docs/OBSERVABILITY.md truthful and record the work in PLAN.md** (after 3, 4, 5, 6)
  - Intent: Rewrite the 'What stays on your machine' section of docs/OBSERVABILITY.md (British English) to match what is now enforced. State that both services share one allowlist (packages/kitchen/src/runtime/payload-allowlist.mjs). Give the exact fields per event kind for Kitchen and per hook for the Map, in a short table. Say that absolute paths are reduced to project-relative and Kitchen project ids are opaque handles, and that token-like strings are redacted. Remove the sentence saying the Map 'does not have Kitchen's narrower browser-field policy' and the claim that the Map shows shortened command text. List what is still visible or outside the allowlist: task, todo and PLAN.md titles (length-capped and redacted, but free text), the Map's /whoami, /suggest and /spawn endpoints (which still handle absolute paths), and cross-project log reading by the Kitchen log adapter (unchanged; only what reaches the browser is limited). Keep the two existing coexistence-bug paragraphs unchanged. Follow the repo's agenttrail plan convention (AGENTS.md/CLAUDE.md): under the components whose files cover this work (kitchen, files: packages/kitchen/**, and runs, files: bin/**), add `[x]` tasks with `by:` lines and a `tech:` line, record the decision under '## decisions' (shared module location in packages/kitchen/src/runtime so one file ships in both npm packages), and add the follow-up for /whoami, /suggest and /spawn as an open task with `from: agent`. Do not create a new component. Mark each task `[~]` before starting its implementation task, per the convention.
Standards touched: COD-7, SEC-1, SEC-13, GIT-1, GIT-8
  - Files: `docs/OBSERVABILITY.md`, `PLAN.md`
  - Acceptance criteria the planner set:
    - Every claim in the revised section is backed by a test from tasks 1-6, and the per-kind field table matches EVENT_FIELDS/HOOK_FIELDS in the module
    - The doc no longer says the Map shows command text or lacks a field policy, and it lists the remaining limits named above
    - PLAN.md has the new tasks marked `[x]` with `by:`, an entry under '## decisions', and an open follow-up task with `from:`; no component id was renamed or added
    - The text contains no secrets, machine paths, job ids or Plane URLs; prose is British English
    - No code files changed in this task; all package checks still pass
  - Risk: Keep claims narrow. Do not write 'no absolute path ever reaches the browser' while the /whoami, /suggest and /spawn follow-up is open; state the limits plainly. docs/kitchen/CONNECTING.md may mention project paths in the connect flow, so grep docs/kitchen/*.md for 'path' and fix any statement the handle change makes untrue.
