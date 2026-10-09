# Feed-only mode: the contract for an external feeder

Feed-only mode runs the Kitchen as a headless intake. A feeder (for example OJ Labs Director) pushes agent events in over HTTP, and reads the resulting state back. The Kitchen reads nothing from the host: no log discovery, no file watching, no setup routes.

This page is the contract. The machine-readable form is [`packages/kitchen/schema/feed.schema.json`](../../packages/kitchen/schema/feed.schema.json) (JSON Schema 2020-12). The service validates every incoming event against it and rejects unknown fields. `packages/kitchen/test/feed-docs.test.mjs` fails if a property in the schema is missing from this page, so the two cannot drift apart.

## Before you show this to customers

The GET routes do not require a token. They are protected only by binding to `127.0.0.1` and by a Host and Origin check. Anything that can reach that port can read the state. If Director shows the Kitchen to customers, it must put its own authentication in front, and it must decide which sessions each customer may see.

A snapshot is not anonymous. It contains:

- file names, made relative to the project root from the `cwd` and `file` you sent;
- session task titles (`sessionTasks`, `currentTask` and the `title` of each order), exactly as the feeder sent them;
- the logical project root paths you configured with `--project`.

Do not put anything in a task title or file name that a customer should not see.

## Start the service

```sh
export AGENTTRAIL_FEED_TOKEN="<a random string of at least 16 characters>"
npx agenttrail-kitchen --feed-only --project /feeds/acme --project /feeds/globex --port 4780
```

- `--feed-only` selects the mode. It never opens a browser.
- `AGENTTRAIL_FEED_TOKEN` is the bearer token. It is read from the environment only, never from an argument, because arguments leak through process listings and shell history. The service refuses to start if it is missing or shorter than 16 characters.
- Each `--project` is a **logical root**: an absolute path used as a name. It is never looked up on disk, so it does not have to exist. At least one is required and relative paths are rejected.
- `--port` defaults to 4780 and must be between 1024 and 65515. If the port is taken, the next free ones are tried.
- The service binds `127.0.0.1` only and makes no outbound calls.

An event is accepted only when its `cwd` is inside one of the logical roots. A file that resolves outside its root is dropped from the event.

## Routes

Every other path under `/api/` returns 404. The Kitchen web page itself is also served at `/`, from the package's own `public` folder.

| Route | Method | Auth | Accepts | Returns |
| --- | --- | --- | --- | --- |
| `/api/hook` | POST | Bearer token | A hook event (below) | `{"accepted": true}` or `{"accepted": false}` |
| `/api/artifact` | POST | Bearer token | An artifact event (below) | `{"accepted": true}` or `{"accepted": false}` |
| `/api/bootstrap` | GET | None | Nothing | The snapshot. No CSRF token is added in this mode |
| `/api/state` | GET | None | Nothing | The snapshot |
| `/api/events` | GET | None | Nothing | A `text/event-stream`: the snapshot as the first message, then one message whenever it changes |

### Authentication

Send `Authorization: Bearer <token>` on both POST routes. The comparison is constant-time. A missing or wrong token gets `403` with `{"error": "Invalid connector key."}`. Note that any non-POST request to `/api/hook` or `/api/artifact` is answered the same way.

### Responses and error codes

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{"accepted": true}` | The event changed the state |
| 200 | `{"accepted": false}` | Valid but ignored: a repeated `id` for that provider, a `cwd` outside every logical root, or a kind the state machine refuses (for example a `role` event for an unknown session). Not an error; do not retry |
| 400 | `{"error": "Event does not match the feed schema.", "errors": [...]}` | The event failed validation. `errors` holds up to 20 entries of the form `$.sessionId: required` or `$.bogus: unknown property`. The messages name the field and the rule, never the value |
| 400 | `{"error": "Request body is not valid JSON."}` | The body did not parse |
| 400 | `{"error": "Request is too large."}` | The body is over 32,000 characters |
| 403 | `{"error": "Invalid connector key."}` | Missing or wrong token, or a non-POST method on a POST route |
| 403 | `{"error": "Local connections only."}` or `{"error": "Origin is not allowed."}` | The Host or Origin header is not this service on `127.0.0.1` or `localhost` |
| 404 | `{"error": "Not found."}` | Any other `/api/` path, including the setup, attach and project routes that feed-only mode removes |
| 405 | `{"error": "Method not allowed."}` | A non-GET method on a route that is not an intake |

Events are not queued. If a request fails, the feeder owns the retry. Because a repeated `id` is ignored, retrying with the same `id` is safe.

## The hook event

`POST /api/hook` takes the event that `normalizeHook` (in `packages/kitchen/src/connectors/events.mjs`) produces from a provider's raw hook payload. A feeder that already holds raw Claude Code or Cursor payloads can reproduce that mapping; a feeder that builds its own events can send the wire shape directly.

### Raw payload fields that `normalizeHook` reads

`normalizeHook(provider, raw)` takes `provider` (`claude` or `cursor`) and the parsed JSON the provider's hook sends. It returns `null` when the payload carries no usable identity or an event it does not map. Matching of `hook_event_name` is case-insensitive.

| Raw field | Used for |
| --- | --- |
| `hook_event_name` | Chooses `kind` (table below) |
| `session_id` | `sessionId` for Claude. For Cursor it is the last fallback for the parent |
| `agent_id` | Claude subagent. When present it becomes `sessionId`, and `session_id` becomes `parentId` |
| `conversation_id`, `parent_conversation_id`, `subagent_id` | The Cursor equivalents: the parent is `parent_conversation_id`, then `conversation_id`, then `session_id`; `subagent_id` is the child |
| `cwd`, `workspace_roots` | `cwd`. The first entry of `workspace_roots` is used when `cwd` is absent |
| `generation_id`, `turn_id` | `turnId` |
| `tool_use_id`, `tool_call_id` | `toolId` |
| `tool_name` | `tool`. Cursor's file and shell events have no tool name, so `afterFileEdit` gives `Write`, `beforeReadFile` and `beforeFileRead` give `Read`, and the shell events give `Shell` |
| `tool_input.file_path`, `tool_input.path`, `file_path` | `file`, in that order of preference |
| `status` | `error` is true when it is `error` or `failed` |
| `tool_input`, `tool_response`, `tool_output` | Read only on `PostToolUse`, to build `tasks` or `taskChange` (below) |
| `notification_type` | On `Notification`: `permission_prompt` gives kind `permission`, `idle_prompt` gives kind `input`; any other value is dropped |
| `office_event_id` | `id`. The relay adds it; a raw payload without it produces an empty `id`, which the schema rejects |

A `SubagentStart` or `SubagentStop` without a child identity returns `null`, so that a missing child can never end its parent.

How `hook_event_name` maps to `kind`:

| `hook_event_name` | `kind` |
| --- | --- |
| `SessionStart`, `SubagentStart` | `session-start` |
| `SessionEnd` | `session-end` |
| `UserPromptSubmit`, `beforeSubmitPrompt` | `turn-start` |
| `Stop`, `SubagentStop` | `turn-end` |
| `PreToolUse`, `beforeFileRead` | `tool-start` |
| `PostToolUse`, `PostToolUseFailure`, `afterShellExecution` | `tool-end` |
| `PermissionRequest` | `permission` |
| `beforeReadFile`, `afterFileEdit`, `beforeShellExecution`, `afterMcpExecution` | `activity` |

Text fields are passed through `clean`: control characters become spaces and the value is cut to a maximum length (80 for `tool`, 200 for `sessionId`, `parentId` and `id`, 500 for `file`, 180 for task titles, 100 for task ids).

**Task lists.** Only a `PostToolUse` whose `status` is not `error` or `failed` can carry tasks, and only a confirmed result changes the task list:

- `TodoWrite`, `todo_write` and `write_todos` give `tasks` from `tool_input.todos` (each item's `content`, `step`, `subject` or `title`, with a `status` of `pending`, `in_progress` or `completed`), at most 24. `tasksPartial` is true when `tool_input.merge` is true.
- `TaskList` gives `tasks` from the result's `tasks` array.
- `TaskCreate`, `TaskUpdate` and `TaskGet` give a single `taskChange`, taken from the structured result, or from Claude's confirmation text (`Task #3 created successfully: ...`, `Updated task #3 status`). A result that is an error, or text that does not match, gives nothing.

### The wire event validated by POST /api/hook

This is the shape in `$defs.hookEvent`. Unknown fields are rejected. Fields marked required must be present; `undefined` counts as absent.

| Field | Required | Type and limit | Meaning |
| --- | --- | --- | --- |
| `id` | Yes | Non-empty string, at most 200 characters | Unique per `provider`. A repeat is ignored (`accepted: false`). The server remembers the last 4,000 |
| `provider` | Yes | `claude`, `codex` or `cursor` | The agent product |
| `sessionId` | Yes | Non-empty string, at most 200 characters | The session. Together with `provider` it identifies one executor as `provider:sessionId` |
| `parentId` | No | String (at most 200) or `null` | The parent session of a subagent |
| `cwd` | Yes | String | Absolute path that must sit inside a logical root, otherwise `accepted: false` |
| `kind` | Yes | One of the kinds below | What happened |
| `turnId` | No | String | A new value retires the previous turn |
| `toolId` | No | String | Pairs a `tool-start` with its `tool-end` |
| `tool` | No | String, at most 80 characters | The tool name, such as `Write` |
| `file` | No | String, at most 500 characters | Absolute, or relative to `cwd`. Ignored when it resolves outside the root. Shown relative to the root in the snapshot |
| `error` | No | Boolean | The tool call failed |
| `tasks` | No | Array of `hookTask`, at most 24 | The session's task list. Replaces the previous list unless `tasksPartial` is true |
| `tasksPartial` | No | Boolean | When true, `tasks` holds only the changed tasks |
| `taskChange` | No | `hookTaskChange` | One confirmed task change |
| `planId` | No | String, at most 100 | Identifies the plan the tasks belong to |
| `outcomeId` | No | String, at most 100 | The shared outcome the session works towards |
| `outcomeTitle` | No | String, at most 180 | Its display title |
| `work` | No | `hookWork` | A classified piece of work, used with `kind: "observation"` |
| `roleId` | No | String matching `^[\w-]{1,100}$`, or `null` | With `kind: "role"`: the workflow role bound to the session. `null` clears the binding |
| `workflowId` | No | String, at most 100 | With a role binding: the workflow |
| `runId` | No | String, at most 100 | With a role binding: the run |
| `itemId` | No | String, at most 180 | With a role binding: the item being worked |
| `orderId` | No | String, at most 100 | With a role binding: the order |
| `at` | No | Number | **Overwritten** by the server with its own clock. It is accepted only so that `normalizeHook` output validates unchanged |
| `source` | No | String | **Overwritten** by the server with `hook`. Accepted for the same reason |

`kind` is one of `session-start`, `session-end`, `turn-start`, `turn-end`, `tool-start`, `tool-end`, `permission`, `input`, `interrupted`, `activity`, `unknown`, `role`, `observation`. `normalizeHook` produces only some of these; `interrupted`, `role`, `observation` and `unknown` are available to a feeder that builds events itself.

The nested shapes:

| Shape | Field | Required | Type and limit | Meaning |
| --- | --- | --- | --- | --- |
| `hookTask` | `id` | No | String, at most 100 | Task id from the agent |
| | `title` | Yes | String, at most 180 | Task wording, shown as an order ticket |
| | `status` | Yes | `pending`, `in_progress` or `completed` | |
| `hookTaskChange` | `id` | Yes | String, at most 100 | Task id |
| | `title` | No | String, at most 180 | New wording, if it changed |
| | `status` | Yes | `pending`, `in_progress`, `completed` or `deleted` | |
| `hookWork` | `category` | Yes | `coordinate`, `research`, `build`, `simulation`, `review`, `publish` or `execute` | The kind of work |
| | `label` | No | String | A short description |
| | `file` | No | String | The file concerned |
| | `completed` | No | Boolean | Whether the work finished |

### Example

```json
{
  "id": "evt-0001",
  "provider": "claude",
  "sessionId": "session-a",
  "cwd": "/feeds/acme",
  "kind": "tool-start",
  "turnId": "turn-1",
  "toolId": "tool-1",
  "tool": "Write",
  "file": "/feeds/acme/src/report.js",
  "tasks": [{"id": "t1", "title": "Draft the report", "status": "in_progress"}]
}
```

```sh
curl -sS -X POST http://127.0.0.1:4780/api/hook \
  -H "Authorization: Bearer $AGENTTRAIL_FEED_TOKEN" \
  -H "Content-Type: application/json" \
  --data @event.json
```

## The artifact event

`POST /api/artifact` records an artifact revision, or the hand-over of one between sessions. The shape is `$defs.artifactEvent`. Unknown fields are rejected.

| Field | Required | Type and limit | Meaning |
| --- | --- | --- | --- |
| `id` | Yes | String matching `^[\w.:-]{1,220}$` | Unique per event; a repeat is ignored |
| `artifactId` | Yes | Same pattern | The artifact |
| `revisionId` | Yes | Same pattern | One revision of it |
| `provider` | Yes | `claude`, `codex` or `cursor` | The producing or sending provider |
| `sessionId` | Yes | Same pattern | The producing or sending session |
| `cwd` | Yes | String | Must sit inside a logical root |
| `kind` | Yes | `produced`, `offered`, `received` or `failed` | `produced` records the artifact; the others record a hand-over |
| `type` | No | `json`, `image`, `text`, `code` or `table` | What the artifact is. The snapshot shows `unknown` when absent |
| `file` | No | String | Where it lives, relative to the root in the snapshot |
| `label` | No | String, at most 180 characters | Display name |
| `orderId` | No | Same pattern | The order it belongs to |
| `handoffId` | For hand-overs | Same pattern | Identifies one hand-over. Needed for every `kind` except `produced` |
| `recipientProvider` | For hand-overs | `claude`, `codex` or `cursor` | The receiving provider. Needed for every `kind` except `produced` |
| `recipientSessionId` | For hand-overs | Same pattern | The receiving session. Needed for every `kind` except `produced` |
| `at` | No | Number | **Overwritten** with the server clock |
| `source` | No | String | **Overwritten** with `hook` |

The three hand-over fields are optional in the schema but required by the state machine for `offered`, `received` and `failed`; without them the event comes back `accepted: false`.

```json
{
  "id": "art-0001",
  "artifactId": "report",
  "revisionId": "revision-1",
  "provider": "claude",
  "sessionId": "session-a",
  "cwd": "/feeds/acme",
  "kind": "produced",
  "type": "text",
  "file": "out/report.txt",
  "label": "Quarterly report"
}
```

## The snapshot (version 2)

`/api/state`, `/api/bootstrap` and every `/api/events` message carry the same object, `$defs.snapshot`. Times are milliseconds since the Unix epoch. Every object is closed: a field not listed here is not sent. Fields marked "always" below hold the same value in feed-only mode.

| Field | Type | Meaning |
| --- | --- | --- |
| `app` | `"agenttrail-kitchen"` | Always |
| `version` | `2` | Always. A change to the shape will change this number |
| `recentProjects` | Array, at most 24 | Always empty in feed-only mode, because nothing is discovered. Each entry would have `handle`, `name`, `providers` and `lastSeenAt` |
| `discoveryLimited` | Boolean | Always `false` |
| `projects` | Array of project | One per logical root |
| `crew` | Array of crew member | The sessions, and any workflow roles |
| `executors` | Array of executor | One per session |
| `orders` | Array of order | Native tasks as order tickets |
| `tables` | Array of table | Groups of orders per project |
| `unplanned` | Array of unplanned | Sessions that have no task list |
| `artifacts` | Array of artifact | Recorded artifact revisions |
| `transfers` | Array of transfer | Recorded hand-overs |
| `installed` | Object | Always `{}`: no hook configuration is inspected. When populated elsewhere, each key is a project handle and each value has the booleans `claude` and `cursor` |
| `observers` | Object | Always the same three entries (below) |
| `observing` | Boolean | Always `false` |

`observers` is fixed to `codex` `{available: false, mode: "experimental logs"}`, `claude` `{available: false, mode: "hooks or logs"}` and `cursor` `{mode: "hooks"}`. Its `available` and `mode` keys are labels from the shared snapshot builder; they do not describe feed-only intake.

`/api/bootstrap` is the snapshot itself. Unlike the normal mode, it carries no `token`.

### project

One entry per logical root. Nothing under the root is read, so the plan-derived parts are empty.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | String | An opaque handle for the logical root: the first 12 hex characters of its SHA-256. The root path itself is never sent |
| `name` | String | The last segment of the root path |
| `components` | Array | Always empty in feed-only mode. A component has `id`, `title`, `files`, `tasks` (plan tasks), `needs`, `links`, and optionally `kind` (`human` or `knowledge`) and `url` |
| `activity` | Array, at most 10 | Always empty. Each entry would have `file` and `at` |
| `boardUrl` | String or `null` | Always `null` |
| `contextSource` | `plan`, `agenttrail` or `feed` | Always `feed` |
| `watchStatus` | `watching`, `plan only` or `feed` | Always `feed` |
| `kitchens` | Array | One entry, `shared` ("Main kitchen"), with `id`, `title`, `components` and `counts` |
| `deliverables` | Array | Always empty. An entry would have `id`, `title`, `icon`, `tasks`, `missing`, `source`, `counts`, `kitchenIds` and `status` |
| `warnings` | Array of string | Always empty |
| `workflow` | Object or `null` | Always `null`. When set elsewhere it holds `id`, `title`, `roles`, `adapter`, `origin`, `evidence`, `stations` and `queue` |

`counts` has four integers: `total`, `done`, `active` and `blocked`. A plan task (`planTask`) has `id`, `title`, `state` (one of `" "`, `x`, `~`, `!`), and optionally `by`, `from`, `componentId` and `key`. None of these are produced in feed-only mode, but the schema allows them so that one snapshot shape covers both modes.

The workflow shapes only appear in normal mode, from `.office/kitchen.json`. Their properties are listed for completeness: a `workflow` role (`workflowRole`) has `id`, `title`, `components`, `description`, `files`, `category` and `origin`; a station has `id`, `title`, `roleId`, `components`, `kind` and `url`; the `queue` has `available`, `items`, `blocked`, `summary` and `counts` (`write`, `evaluate`, `queue`, `publisher`, `history`, `unknown`); each queue item (`queueItem`) has `id`, `file`, `title`, `subreddit`, `createdAt`, `revision`, `verdict`, `stage`, `label`, `scheduledAt`, `approved` and `stale`.

### executors and crew

An executor is one agent session. A crew member has every executor field and can also be a workflow role.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | String | `provider:sessionId` |
| `sessionId` | String | As sent |
| `provider` | `claude`, `codex` or `cursor` | A crew member's can be `null` |
| `project` | String | The handle of the logical root the session sits in |
| `cwd` | String | Relative to its logical root (`.` for the root itself) |
| `startedAt` | Integer | Time of the first event |
| `lastEventAt` | Integer | Time of the latest event. A crew member's can be `null` |
| `state` | One of `unknown`, `working`, `reading`, `writing`, `executing`, `error`, `permission`, `input`, `complete`, `interrupted`, `offline` | Derived from the events. A crew member can also be `idle` |
| `source` | String | `hook` for every fed session |
| `parentId` | String or `null` | Parent session of a subagent |
| `recent` | Array, at most 12 | The latest events: `id` (prefixed with the provider), `at`, `kind`, and optionally `tool`, `file` and `source` |
| `tool` | String | Current or last tool |
| `file` | String or `null` | Last file touched, relative to the root |
| `fileAt` | Integer or `null` | When |
| `currentFile` | String or `null` | The file the session is working on now |
| `turnId` | String or `null` | The live turn |
| `ended` | Boolean | A `session-end` was received |
| `roleBinding` | Object or `null` | `roleId`, `workflowId`, `runId`, `itemId`, `orderId`, `at` from a `role` event |
| `roleBindingAt` | Integer | When the binding was made |
| `workContext` | Object or `null` | The latest classified work: `category`, `label` (at most 120 characters), `file`, `at`, `completed`, `toolId` |
| `workHistory` | Array, at most 24 | Earlier work contexts, same shape |
| `turnStartedAt` | Integer | When the live turn began |
| `sessionTasks` | Array, at most 24 | The session's task list: `id`, `title`, `status` |
| `taskContextAt` | Integer | When the list last changed |
| `planId` | String or `null` | From the event |
| `outcomeId` | String or `null` | From the event |
| `outcomeTitle` | String or `null` | From the event |
| `activeToolCount` | Integer | Tool calls started and not yet ended |
| `freshness` | `recent` or `quiet` | Whether the session has been active lately |
| `component` | Object or `null` | The plan component the session is linked to (`id`, `title`). Always `null` in feed-only mode |
| `componentCandidates` | Array of string | Always empty in feed-only mode |
| `association` | Object | `kind` (`unknown`, `inferred`, `explicit` or `configured`), `reason`, and optionally `source` and `componentId` |
| `planAvailable` | Boolean | Whether the session reported a task list |
| `taskSource` | String or `null` | `native plan` when tasks were reported |
| `currentTask` | Object or `null` | The task in progress: `id`, `title`, `status` |
| `contextAt` | Integer or `null` | When the task context was last known |

Crew members that represent a workflow role add these fields. They are absent for ordinary sessions and for every feed-only snapshot, which has no workflow:

| Field | Type | Meaning |
| --- | --- | --- |
| `roleId` | String | The workflow role |
| `name` | String | Its display name |
| `roleComponents` | Array of string | Components the role covers |
| `roleOrigin` | `configured` or `inferred` | Where the role came from |
| `roleDescription` | String | What it does |
| `roleFiles` | Array of string | Files it owns |
| `recentWork` | Object | Latest work: `category`, `label`, `file`, `at`, `completed`, `toolId`, `sessionId`, `provider` |
| `roleStatus` | String | Summary state |
| `queueCount` | Integer | Items waiting for the role |
| `workingCount` | Integer | Sessions currently filling it |
| `executors` | Array of executor | Those sessions |
| `activityComponentId` | String or `null` | Component showing its activity |
| `unlinkedRole` | Boolean | The role has no component |

### orders, tables and unplanned

Each native task becomes an order. Orders are grouped into tables: one per `outcomeId` (or per `outcomeTitle`) when the feeder sends one, otherwise one per project.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | String | Order id, stable for the same task |
| `number` | Integer | Ticket number within the table |
| `project` | String | Logical root |
| `sessionId` | String | `provider:sessionId` of the session that reported it |
| `provider` | `claude`, `codex` or `cursor` | |
| `scope` | String | Internal key identifying the task list the order came from |
| `nativeId` | String or `null` | The task `id` the agent used |
| `title` | String | The task wording the feeder sent |
| `status` | `pending`, `in_progress` or `completed` | |
| `createdAt` | Integer | First seen |
| `completedAt` | Integer or `null` | When completed |
| `completionVersion` | Integer | Increments each time the order completes |
| `contributors` | Array, at most 24 | Who worked on it: `identity`, `chefId`, `roleId`, `name`, `sessionId`, `provider`, `association`, `firstAt`, `lastAt` |
| `history` | Array, at most 24 | Wording and status changes: `revision`, `at`, `title`, `status` (which can also be `withdrawn`) |
| `source` | String | The session's task source: `native plan` for tasks the feeder sent |
| `withdrawn` | Boolean | The task is no longer in the session's latest list |
| `index` | Integer | Position in the task list |
| `revision` | Integer | Latest revision |
| `updatedAt` | Integer | Last change |
| `outcomeId` | String or `null` | From the event |
| `outcomeTitle` | String or `null` | From the event |
| `activeChefIds` | Array of string | Crew ids currently on it |
| `activeSessionIds` | Array of string | Session ids currently on it |
| `tableId` | String | The table it sits at |
| `attention` | Boolean, optional | `true` when a session working on the order is waiting on `permission` or `input`, or is in `error` |

A table (`tables`) has `id`, `project`, `title` (the `outcomeTitle`, or the root's name when there is none), `reported` (`true` when the title came from an `outcomeTitle`), `orderIds` and `completedIds` (the orders that are completed and not withdrawn).

`unplanned` lists sessions that have reported no task list. Each has `id`, `project`, `sessionId`, `title`, `state` (as for executors), `source` and `progress`, which is always `null`: progress is unknown, not zero.

### artifacts and transfers

`artifacts` holds what `POST /api/artifact` recorded.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | String | Internal key for the revision |
| `artifactId` | String | As sent |
| `revisionId` | String | As sent |
| `project` | String | Logical root |
| `producer` | String or `null` | `provider:sessionId` of the producer |
| `producerRoleId` | String or `null` | Its workflow role |
| `orderId` | String or `null` | The order it belongs to |
| `kind` | `json`, `image`, `text`, `code`, `table` or `unknown` | The `type` sent |
| `file` | String or `null` | Relative to the root |
| `label` | String | As sent |
| `at` | Integer or `null` | Server clock when recorded |
| `source` | `explicit relay` or `workflow files` | Always `explicit relay` in feed-only mode |
| `eventId` | String | The `id` of the event, optional |
| `componentId` | String | Optional, normal mode only |
| `workflowItem` | Queue item | Optional, normal mode only |

`transfers` holds hand-overs: `id`, `handoffId`, `project`, `artifactKey`, `sender`, `recipient`, `state` (`offered`, `received` or `failed`), `at`, `source` (always `explicit relay`), `eventId`, `orderId`, `senderRoleId` and `recipientRoleId`.

### projects, kitchens and deliverables in feed-only mode

Because no plan is read, each project has the single `shared` kitchen with all-zero `counts` and no `deliverables`. Orders and sessions still appear, grouped into tables as described above.

## Event stream

`GET /api/events` keeps the connection open and sends `data: <snapshot JSON>` followed by a blank line. The first message is the current snapshot, and a new one follows each time the snapshot changes (checked every second). A `: heartbeat` comment line arrives every 15 seconds. A client that falls more than 256,000 bytes behind is disconnected, so reconnect and use the first message to resynchronise.

## What is not in scope

- Writing to the Kitchen other than the two intake routes: there is no way to add a project, change settings or install hooks.
- Persistence: all state is in memory and starts empty after a restart.
- Per-viewer access control: see the warning at the top of this page.
