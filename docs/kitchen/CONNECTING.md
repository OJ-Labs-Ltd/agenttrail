# Open a working repo

Keep your existing agents running. In the kitchen, choose **Open repo**, select a recently active folder or paste its absolute path, and open its Live kitchen. It works with an ordinary local folder, including a Git repo, without a PLAN.md or Agenttrail installation. The companion reads the selected project; opening it does not write project files.

Launch the preview from the working repo with `npx agenttrail-kitchen .`. From a source checkout, use `node /path/to/agenttrail/packages/kitchen/bin/office.mjs .` after building. An existing companion is reused through its authenticated local registration; the requested folder is added, selected, and opened in Live even if the browser previously showed Example. Repeat `--project /absolute/path` for multiple folders. Up to 12 roots can be watched. `--saved` reopens the saved set. See the [quick start](README.md) for requirements and source setup.

## What connects automatically

| Source | Without setup | Additional detail |
| --- | --- | --- |
| Local Codex sessions | Discovers recent session logs, including sessions resumed from an older creation-date folder. Reads available lifecycle, tool, structured `update_plan`, and desktop completed-item metadata. | No repo hooks required. Parsed reads, simple checks, browser work, and coordination provide role context. Unsupported operations remain unknown; they do not generate native todos. |
| Local Claude Code sessions | Reads available local project logs, lifecycle, supported tool events, and structured task metadata. | Connect Claude previews an additive hook configuration for more direct events. |
| Cursor | No automatic transcript discovery. | Connect Cursor once for the selected repo. Start a new conversation if the running one does not load the hooks. |

The connection panel reports observations **for the selected repo**, including whether native todos are available. A provider being installed elsewhere does not establish an active connection to this repo. Native Codex and Claude Code have been checked together in the Maze Shift build. Claude’s confirmed text TaskCreate/TaskUpdate receipts are supported alongside structured results. Cursor adapters and reversible hooks have automated coverage; native Cursor live validation remains pending.

Claude `TaskCreate`, `TaskUpdate`, `TaskGet`, and `TaskList` update dishes when a supported successful result supplies a stable task ID and status; task descriptions are discarded. Cursor partial todo updates preserve other items. The adapters also support legacy TodoWrite. Unknown output formats remain ordinary activity rather than guessed tasks. Event handling follows the documented [Claude Code hooks](https://code.claude.com/docs/en/hooks) and [Cursor hooks](https://cursor.com/docs/hooks); provider format changes may require adapter updates.

## What you see

- With no project map, the repo gets a persistent crew of inferred responsibilities. A single session moves between those chefs using observed file and operation context. No activity means the crew waits; creating roles does not start agents.
- With a project map, named role chefs remain available and actual sessions can move between those roles. A session without a reliable role association stays visible as its own session chef. Opening a repo does not fabricate additional workers or collaboration.
- Native todos become numbered dishes. Their source status controls cooking, completion, withdrawal, and reopening. Without a native plan, the available activity stays visible and progress remains unknown.
- Actual inter-agent artifact handoffs still require explicit artifact and receipt metadata. Reading a file alone does not prove a transfer.

Use [workflow configuration](WORKFLOW-INTEGRATION.md) only when you want more precise role names or explicit role/order bindings. It is optional for basic observation.

The default crew is adapted from a bounded scan of directory and file names, not from invented tasks: simulation folders add a Simulation engineer, world/character assets add a World builder, and writing folders add a Writer and optional Publisher. The UI marks these roles as inferred. The Head chef holds activity when a specialist role cannot be identified. A recorded operation can suggest responsibility but does not prove that a separately running specialist exists. Each chef retains its latest observed contribution while the actual session count stays separate.

Codex desktop's structured `item_completed` records supply completed-operation context. Completed metadata is displayed as past activity and does not revive a finished session. The adapter excludes messages, reasoning, raw command bodies, and tool outputs. It recognizes structured parsed reads/searches, complete simple check commands, known preview tools, and coordination events. Other completed commands receive only a generic “Ran a command” label, replacing stale specialist context without interpreting arbitrary orchestration code. An observation alone does not create or complete a dish.

## Local scope and discovery limits

Kitchen reads logs only for the folders you watch. A session is used only if its recorded working directory is inside a watched root (the folder you launched with, or any `--project`). Logs for every other project on the machine are not parsed, tracked, counted or listed, and nothing about them reaches the browser. The folder picker therefore suggests only watched projects; to add another, paste its path.

What is touched under your home directory, exactly:

- **Claude (`~/.claude/projects`):** the directory listing is filtered by name, because Claude names each directory after its project path. Only directories matching a watched root are listed further or opened.
- **Codex (`~/.codex/sessions`):** rollouts are filed by date, not by project, so Kitchen lists the date folders and opens the first 64 KiB of each rollout modified in the last 24 hours to read its recorded working directory. If that directory is not inside a watched root, the header is discarded after the check and the rest of the file is never read. This is the one place another project's file is opened.
- **Watched sessions:** event bodies are processed, and only allowlisted activity and task metadata reaches the browser. No prompts, code bodies or arbitrary command text are displayed or uploaded. The browser uses bundled local assets.
- **`~/.agenttrail`:** Kitchen looks up the one Map registry file belonging to each watched root, to read that board's context. It does not list the directory.

Two switches narrow this further. `--sources hooks,logs,files` chooses which evidence is used (default: all three). `hooks` accepts events from installed provider hooks, `logs` reads the scoped logs above, and `files` watches file changes inside watched roots. `--no-discovery` turns off the home-directory scan entirely: no log directory, and no `~/.agenttrail` file, is listed, opened or counted, so only hooks and file changes in watched roots remain. Both flags apply when Kitchen starts; attaching a folder to an already running Kitchen keeps that instance's settings.

Default stores are `~/.codex/sessions` and `~/.claude/projects`; the production observer also honors `CODEX_HOME` and `CLAUDE_CONFIG_DIR`. Remote/cloud sessions whose logs are not on this machine are not automatically visible.

Discovery refreshes about every five seconds. It considers files modified within 24 hours, examines up to 240 recent metadata candidates, retains up to 120 observation streams, and suggests up to 24 watched folders (eight in the picker). Each initial replay is bounded to the last 2 MiB. Larger archives can hit these bounds; `discoveryLimited` appears in the local state response. Missing older history stays unknown. Quiet activity is not presented as continuously working, and native orders are reconstructed from available observations after restart.

## VS Code and Cursor

Kitchen currently opens in a browser. There is no Agenttrail Kitchen VS Code Marketplace extension or VSIX release. Run the [preview command](README.md#start-with-your-repo) in your editor's integrated terminal and keep the browser beside it. The editor does not need a separate extension to run the companion.

Use **Connect agents → Cursor** to review and install `.cursor/hooks.json` for the selected repo. This connects Cursor agent events; it does not install an editor panel. Claude's optional hooks use `.claude/settings.local.json`. Existing unrelated hooks are preserved. Removal is available from the same panel. After a Kitchen upgrade or clearing npm's cache, reconnect hooks if their saved executable path is no longer available.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| The project map opens instead of a kitchen | `npx agenttrail` is the Map. Use `npx agenttrail-kitchen .` to open Kitchen in the current repo. See the [quick start](README.md). |
| A kitchen appears but nobody works | Select **Live**, choose the same local repo as the agent, and check **Connect agents**. Allow about five seconds for discovery. An idle agent does not generate work. |
| Codex or Claude is running but not listed | Confirm that logs are on this machine and their recorded working directory belongs to the selected repo. Custom `CODEX_HOME` / `CLAUDE_CONFIG_DIR` must be set in the terminal that launches Kitchen. Cloud-only logs are not discovered. |
| Cursor activity is missing | Install its optional hooks through **Connect agents**, then start a new conversation if the current one does not load them. Native Cursor live validation is still pending. |
| Progress is unknown or there are no dishes | The session has not supplied a supported native todo list. File activity and durable `PLAN.md` tasks do not become invented native todos. |
| Several chefs are waiting | They are persistent responsibilities, not independently launched agents. One session can work through them sequentially. |
| No plate passes between agents | Confirmed transfers need explicit artifact/revision/receipt metadata. Similar filenames and ordinary reads do not establish a handoff. See [the contract](HANDOFFS.md). |
| The scene stays blank | Use an up-to-date browser with WebGL enabled. From source, run the graphics build first; the release archive already includes it. |
| The browser does not open automatically | Open the localhost URL printed by the terminal. Keep that terminal running. |
| Port 4780 is occupied | Kitchen reuses its registered local service or tries the next free port. Use the URL it prints. |

For a connection-independent check, add `--example` to the launch command and advance **Next example step**. Example is scripted and labeled; it verifies the scene, not your live provider connection. Include your OS, Node version, package version and whether Example works when [reporting an issue](https://github.com/sodiumsun/agenttrail/issues).
