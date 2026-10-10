# ATL-6: Embeddable Kitchen: a mountable module and an iframe mode that take a snapshot URL, an events URL and a token, with reduced-motion and no-WebGL fallbacks

> Machine-generated plan (model `claude-sonnet-5-5`, effort `high`) for
> http://oashaikh.local:9999/local-development/projects/2ac4ce0f-4a28-41ae-b1fa-5b8445f030ec/issues/b8775829-a930-4dc8-b665-57beeb989362. Progress below is written by the orchestrator; the
> database copy is authoritative — editing this file does not change execution.
> A task's [x] is the orchestrator's record that the task finished; the
> criteria beneath it are what the planner asked for, not individually
> verified — no per-criterion outcome is recorded anywhere.
> Prose written under a task entry is kept across progress ticks and is
> the place to record analysis; the entry's heading and its Intent,
> Files, criteria, Risk and Commit bullets are re-rendered from the
> database, so edits to those are lost.

## Assumptions

- The ticket's 'A2, A5' are ATL-2 (feed-only server, snapshot v2) and ATL-5 (reproducible build). Both are merged in the recent history, so the dependency is satisfied.
- The token is sent as Authorization: Bearer [REDACTED] to the host-supplied snapshotUrl and eventsUrl. Director is assumed to proxy or host those endpoints. The Kitchen server does not check a bearer token on GET and rejects foreign Origin headers, and neither is changed.
- The Kitchen server cannot be framed or fetched cross-origin from a different origin. The only server change is frame-ancestors 'self' for /embed.html, enough for same-origin and demo use. A cross-origin host serves the built files itself.
- The mounted view is the 3D scene plus a chef/ticket list for the project's first kitchen. It is not the full app (no top bar, setup dialog, recording or inspector).
- 'Evidence' means the artifacts already shown in the snapshot (label, kind, revisionId, orderId). The host decides what a click opens.
- No new npm dependency is needed: esbuild's built-in text loader handles the CSS, and Node's stdlib covers the static server.
- The whole ticket is likely to exceed the ~400-line target (COD-10) because it spans six areas. Each task is sized for one reviewable commit. If the owner wants strict ~400-line PRs, split after task 3 (world, fallback and feed client) and before task 4 (mount, page, demo, docs), and make the second ticket depend on the first.
- Reduced motion uses the existing World behaviour (static pose, no walking, no steam). This ticket only makes it settable per mount and reusable.
- Memory notes about flaky persistence tests and the file-watcher/whoami path leaks are unverified background. Neither is touched by this ticket.

## Out of scope

- Refactoring app.js into mountable pieces
- Changing the Kitchen server's Host/Origin checks, adding bearer checks on GET, or any CORS support
- Redaction fixes for file-watcher activity or /whoami and /spawn, which are privacy work for other tickets
- Map (bin/agenttrail.mjs) changes
- Token minting, rotation or the Director side of the integration
- Self-hosted fonts inside the shadow root (the embed uses the system font stack)
- Off-screen (IntersectionObserver) pausing, since only hidden-tab pausing is asked for
- Adding the embed bundle to the check:csp headless-browser gate
- Any upstream sync or dependency upgrade

## Tasks

- [x] **Task 1: Give KitchenWorld a lifecycle, a testable frame gate and a reduced-motion/fps option**
  - Intent: Make KitchenWorld safe to create and destroy several times on one page. Add a pure `frameGate({now,last,hidden,maxFps})` to public/src/motion.js. It returns the frame delta, or null when the tab is hidden or the cap has not elapsed. The animation loop in world.js calls it instead of the inline `now-last<1000/30` and `document.hidden` checks. The constructor takes an options object `{reducedMotion, maxFps=30}`. `reducedMotion` is true, false, or undefined for 'follow the media query'. It replaces the unconditional `matchMedia(...).matches`. world.js keeps the media-query listener reference so `destroy()` can remove it. `destroy()` clears `setAnimationLoop(null)`, disposes the composer, renderer, ResizeObserver and batches, and removes the listener. Throttling and hiding behaviour is kept. app.js is changed only if the constructor signature requires it, and its default behaviour must not change. Record the decision in PLAN.md under `## decisions` before coding: 'embedding adds public/src/embed*.js beside app.js and does not refactor app.js, to keep upstream merges easy'. Standards touched: COD-1, COD-3, COD-7, COD-8, TST-1, TST-4
  - Files: `packages/kitchen/public/src/motion.js`, `packages/kitchen/public/src/world.js`, `packages/kitchen/test/motion.test.mjs`, `packages/kitchen/test/world-lifecycle.test.mjs`, `PLAN.md`
  - Acceptance criteria the planner set:
    - frameGate returns null while hidden is true, regardless of elapsed time
    - frameGate returns null when less than 1000/maxFps ms has passed
    - frameGate returns a dt capped at 0.1 s otherwise
    - A test with a fake clock, no sleeps, covers all three cases and fails if the hidden check is removed
    - A test on a KitchenWorld built with Object.create(KitchenWorld.prototype) and a fake renderer shows destroy() calls setAnimationLoop(null) and renderer.dispose, and removes the media-query listener
    - A test shows reducedMotion:true sets this.reduced without reading matchMedia
    - A test shows an omitted option falls back to matchMedia
    - app.js still constructs KitchenWorld with its previous behaviour: 30 fps cap, reduced motion from the media query
    - PLAN.md has the dated decision line
    - npm run check, npm test, node --check bin/agenttrail.mjs and npm run build all pass
  - Risk: world.js lines are very long and dense; make small edits. The existing motion.test.mjs builds a world from the prototype, so do not add required constructor state those tests would miss. The flaky persistence tests in repository memory are unrelated; retry once and say so if one fails.
  - Commit: `9f7ab21d4e4c`

- [x] **Task 2: Add WebGL detection and a plain chefs-and-tickets fallback list** (after 1)
  - Intent: New public/src/embed-list.js, pure and DOM-light. `webglAvailable(createCanvas)` returns false when the canvas gives no 'webgl2'/'webgl' context or the call throws, so no renderer is constructed. `listModel(snapshot, projectId?)` returns `{chefs:[{id,name,state,activity}], tickets:[{id,number,title,status,artifacts:[{id,label,kind,revisionId}]}]}`. It reuses projectOrders, orderState and orderCrew from orders.js, and activityText, isCurrent and providerName from activity.js. It uses only fields the snapshot already exposes through the payload allowlist. `renderList(root, model)` builds nodes with createElement and textContent only, never innerHTML, so snapshot strings cannot inject markup. It marks the list as a labelled region and gives each artifact a real button. A pure `evidenceDetail(artifact, order)` returns the plain object the host receives, with only `{orderId, artifactId, label, kind, revisionId}`. Standards touched: COD-1, COD-2, COD-6, SEC-9, SEC-12, TST-1, TST-6
  - Files: `packages/kitchen/public/src/embed-list.js`, `packages/kitchen/test/embed-list.test.mjs`
  - Acceptance criteria the planner set:
    - webglAvailable returns false for a factory returning a canvas whose getContext gives null, and for one that throws
    - webglAvailable returns true when a webgl2 context object is returned
    - listModel on an invented snapshot gives one chef row per observed chef and one ticket row per unwithdrawn order, with artifact button data
    - listModel on an empty snapshot gives empty arrays and does not throw
    - renderList is tested with a minimal fake element: a title such as '<img onerror=x>' ends up as text, never markup
    - evidenceDetail returns only the five named keys even if the artifact carries extra fields
    - Fixtures are invented, with no real names or paths
    - npm run check, npm test and npm run build pass
  - Risk: Confirm in payload-allowlist.mjs and a real /api/state snapshot which artifact and order fields reach the browser before naming keys. Do not widen the allowlist; if a field is missing from the browser payload, drop it from the model.
  - Commit: `3f8dc20dd745`

- [ ] **Task 3: Add a token-bearing snapshot and event-stream client with abort and reconnect** (after 2)
  - Intent: New public/src/embed-feed.js exporting `connectFeed({snapshotUrl, eventsUrl, token, onSnapshot, onStatus})`, returning `{close()}`. URLs are parsed with `new URL(x, location.href)` and must be http(s), or the call throws with a clear message (SEC-9). The snapshot is fetched with `Authorization: Bearer [REDACTED] in a header only. The token never appears in a URL, a log line, an error message or onStatus. The events stream uses fetch plus a ReadableStream reader and a small SSE `data:` line parser, because EventSource cannot send headers. Each parsed snapshot goes to onSnapshot. A non-200 response or a dropped stream reports status 'offline' and retries after a fixed delay, with a `ponytail:` comment naming the fixed-delay ceiling. close() aborts the in-flight request and cancels pending retries. If eventsUrl is omitted, the snapshot is read once. No other network calls, no telemetry. Standards touched: COD-3, COD-9, SEC-1, SEC-9, SEC-13, TST-1, TST-4, TST-5
  - Files: `packages/kitchen/public/src/embed-feed.js`, `packages/kitchen/test/embed-feed.test.mjs`
  - Acceptance criteria the planner set:
    - Tests stub globalThis.fetch and use a fake timer; there are no sleeps and no live network
    - Every request carries Authorization: Bearer [REDACTED] and the token never appears in any requested URL
    - A javascript:, data: or file: URL is rejected before any fetch
    - A chunked SSE body split mid-line across reads yields the right snapshots, and comment/heartbeat lines are ignored
    - A 401 or dropped stream sets status 'offline' and schedules one retry, and the error text contains no token
    - close() aborts the request and no retry fires afterwards
    - A malformed JSON frame is reported via onStatus and does not stop the stream
    - npm run check, npm test and npm run build pass
  - Risk: SEC-1/SEC-13 are the point of this task: assert in a test that the token string never occurs in anything passed to onStatus or thrown. The Kitchen server ignores bearer tokens on GET and rejects foreign Origin headers; this client targets a host-supplied endpoint such as a Director proxy. It is not a new server auth path.

- [ ] **Task 4: Export mountKitchen(element, options) as a shadow-DOM module with theme, scene and evidence event** (after 3)
  - Intent: New public/src/embed.js exporting `mountKitchen(element, {snapshotUrl, eventsUrl, token, theme='light', reducedMotion})`, returning `{destroy()}`. It attaches a shadow root to element and adopts a stylesheet from new public/embed.css, imported through esbuild's text loader. That is CSP-safe, uses no global selectors, and keeps two mounts independent. The font stack is the system one, because @font-face does not load inside a shadow root. `theme` is 'light' or 'dark'; any other value falls back to 'light'. It builds a canvas plus the fallback list. When webglAvailable() is false, or `new KitchenWorld` throws, it shows only the list with a one-line notice and never constructs a renderer. Otherwise it calls world.setData from the snapshot, using the same filtering as app.js render() for the first kitchen of the project, and feeds the world from connectFeed. The list stays alongside the canvas as the accessible text view. There is no module-level mutable state: no window globals, no localStorage, no location or history use. An artifact button dispatches `new CustomEvent('agenttrail-kitchen:evidence', {bubbles:true, composed:true, detail: evidenceDetail(...)})` on element. destroy() closes the feed, destroys the world and empties the shadow root. scripts/build.mjs gets a second esbuild entry producing public/build/embed.js (esm, minified, loader {'.css':'text'}, same target). Standards touched: COD-1, COD-2, COD-3, COD-8, SEC-9, SEC-12, TST-1
  - Files: `packages/kitchen/public/src/embed.js`, `packages/kitchen/public/embed.css`, `packages/kitchen/scripts/build.mjs`, `packages/kitchen/test/build.test.mjs`, `packages/kitchen/package.json`
  - Acceptance criteria the planner set:
    - npm run build emits public/build/embed.js exporting mountKitchen, and two consecutive builds are byte-identical
    - build.test.mjs includes embed.js in buildOutputs, and the no-eval / no-new-Function bundle test also covers it
    - A test imports the module in Node and asserts mountKitchen is a function and that the module touches no window/localStorage/location at import time
    - A test of the mount decision shows that when webglAvailable is false, KitchenWorld is never constructed and the list is rendered
    - embed.css has no external URLs and no selector outside the shadow host's own classes
    - package.json files lists anything new that is not already under public/build
    - app.js and the existing full-page Kitchen behave as before
    - npm run check, npm test and npm run build pass
  - Risk: The riskiest task. The mount logic is DOM-heavy and the repo has no DOM test library, so keep the mount function thin: put every decision (fallback choice, filtering, theme normalisation) in pure helpers from tasks 2 and 3 plus at most one small exported pure function here, and test those. Do not add a dependency such as jsdom. Check that the bundled output size is reasonable; it is a second copy of three.js, which is accepted for now. This task may overshoot the ~400-line budget given upstream's dense style; if so, say so and split at the build.mjs change.

- [ ] **Task 5: Add the iframe page that reads the same options from query parameters** (after 4)
  - Intent: New public/embed.html and public/embed-page.js (plain static module, not bundled, so no inline script and CSP-safe). The page script imports ./build/embed.js and reads snapshotUrl, eventsUrl, token, theme and reducedMotion from location.search, then calls mountKitchen on a full-size element. It then removes the token from the address bar with history.replaceState. The page sets a no-referrer meta tag. Evidence clicks are also forwarded to the parent with window.parent.postMessage(detail-with-type, parentOrigin) only when a valid `parentOrigin` query parameter is given. The target origin is never '*' and the message is never sent without it. server.mjs: for /embed.html only, the CSP sends `frame-ancestors 'self'` instead of 'none'; every other path keeps 'none'. package.json files gains public/embed.html, public/embed-page.js and public/embed.css if it is read at runtime. Standards touched: SEC-1, SEC-7, SEC-9, COD-3, TST-1, TST-5
  - Files: `packages/kitchen/public/embed.html`, `packages/kitchen/public/embed-page.js`, `packages/kitchen/src/server.mjs`, `packages/kitchen/package.json`, `packages/kitchen/test/embed-server.test.mjs`, `packages/kitchen/test/build.test.mjs`
  - Acceptance criteria the planner set:
    - GET /embed.html returns 200 text/html with frame-ancestors 'self', while GET / still returns frame-ancestors 'none' (server test on port 0, 127.0.0.1)
    - build.test.mjs page check (no inline script, no on*= attributes, no external URLs) also covers embed.html
    - A pure helper in embed-page.js parses the query string; a test shows an unknown theme becomes 'light', a non-http(s) snapshotUrl is rejected, and a parentOrigin that is not a valid origin yields no postMessage target
    - No page code writes the token into the DOM, a log line, or the history after load
    - The service still binds 127.0.0.1 only and adds no outbound call
    - check-package.mjs packed-contents test still passes and the installed package serves /embed.html
    - npm run check, npm test and npm run build pass
  - Risk: A token in an iframe src is visible to the host page and may reach logs and Referer headers before replaceState runs. Document this limit in task 7 and recommend a short-lived scoped token (SEC-4). Cross-origin framing of a loopback Kitchen server cannot work without a host-side proxy, because the server rejects foreign Origin headers. Do NOT loosen the Host or Origin checks.

- [ ] **Task 6: Add the two-kitchen demo page in examples/ with invented fixture snapshots and a loopback static server** (after 5)
  - Intent: New examples/embedded-kitchens/: index.html plus demo.js (a plain module) that calls mountKitchen twice, side by side, with a different fixture each. Fixtures snapshot-a.json and snapshot-b.json are in the documented snapshot v2 shape, with invented project, chef and ticket names, no paths and no secrets. The demo has no eventsUrl, so each kitchen shows its fixture statically. demo.js also listens for the `agenttrail-kitchen:evidence` event and prints it in a status line. serve.mjs is a roughly 20-line node:http static server bound to 127.0.0.1 that serves the demo, the fixtures and ../../packages/kitchen/public/build, with a path-traversal guard. README.md in that folder gives the run steps (npm run build --prefix packages/kitchen, then node examples/embedded-kitchens/serve.mjs). Standards touched: COD-1, COD-2, SEC-1, SEC-9, TST-6, TST-1
  - Files: `examples/embedded-kitchens/index.html`, `examples/embedded-kitchens/demo.js`, `examples/embedded-kitchens/serve.mjs`, `examples/embedded-kitchens/snapshot-a.json`, `examples/embedded-kitchens/snapshot-b.json`, `examples/embedded-kitchens/README.md`, `packages/kitchen/test/embed-example.test.mjs`
  - Acceptance criteria the planner set:
    - A test checks scrubSnapshot() from payload-allowlist.mjs leaves each fixture unchanged, so they match what a real browser would receive
    - A test checks listModel(fixture) is non-empty for both fixtures, and that the two differ
    - A test checks the fixtures contain no absolute path, home directory or token-like string
    - A test starts the exported serve.mjs server on port 0 and gets 200 for the demo page, a fixture and build/embed.js, and 404 for a ../ traversal
    - The server binds 127.0.0.1 only
    - index.html has no inline script and no external URL
    - The report states whether the demo was checked in a real browser or only by tests
    - npm run check, npm test and npm run build pass
  - Risk: Keep fixtures small. Do not copy real snapshots from a running Kitchen, because that can contain real repo names. If no browser is available to confirm both scenes render, say so plainly in the report rather than implying it.

- [ ] **Task 7: Document embedding truthfully and record the work in PLAN.md and the README fork table** (after 6)
  - Intent: New docs/kitchen/EMBEDDING.md covers mountKitchen options, the iframe query parameters, the `agenttrail-kitchen:evidence` event and its detail fields, and the postMessage form with parentOrigin. It also covers the reduced-motion and no-WebGL behaviour, the frame cap, the hidden-tab pause, the package import path, and the token caveats. docs/OBSERVABILITY.md gains an embed section: the browser fetches only the caller-supplied snapshot and events URLs, sends the bearer token only to them, receives the same allowlisted payload, and posts only the five evidence fields to the host. Nothing is sent anywhere else and there is no telemetry. Add an ATL-6 row to the README 'What OJ Labs changed' table, which fork.test.mjs checks, and a link from packages/kitchen/README.md. PLAN.md: add [x] tasks with by: lines under the existing Kitchen component, and an entry under decisions. Do not add a component. Prose is British English. Standards touched: SEC-1, SEC-13, COD-7, GIT-8
  - Files: `docs/kitchen/EMBEDDING.md`, `docs/OBSERVABILITY.md`, `README.md`, `packages/kitchen/README.md`, `PLAN.md`
  - Acceptance criteria the planner set:
    - Every option, query parameter and event field named in the docs exists in the code, checked by a test in the style of feed-docs.test.mjs or by hand and stated in the report
    - OBSERVABILITY.md states which URLs the embed reads and what it sends to the host page
    - The docs state the token-in-query-string limit and the recommended scoped short-lived token
    - README.md still satisfies fork.test.mjs and lists ATL-6
    - PLAN.md has [x] tasks with by: lines and no new component
    - The docs contain no machine paths, Plane URLs, job ids or secrets
    - British spelling throughout, for example 'behaviour' and 'authorise'
    - npm run check, npm test, node --check bin/agenttrail.mjs and npm run build pass
  - Risk: The docs must describe only behaviour the earlier tasks actually shipped; reread embed.js and embed-page.js first. README.md is also edited upstream, so keep the hunk limited to the table row.
