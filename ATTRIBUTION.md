# Attribution

This repository is OJ Labs' fork of [sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail), created by Kelly Sun and released under the MIT licence. The Map, the Kitchen and almost all of the code here are theirs.

## Licence

The MIT licence in [LICENSE](LICENSE) is unchanged and its copyright notice (Copyright (c) 2026 Kelly Sun) stays in every copy of the software, as the licence requires. OJ Labs' changes are released under the same MIT licence. Third-party notices for Kitchen assets are in [packages/kitchen/docs/THIRD-PARTY.md](packages/kitchen/docs/THIRD-PARTY.md).

## What the fork is for

OJ Labs Director embeds the Kitchen so customers can see what is happening with their tickets. The fork keeps upstream's structure, file names and package names (`agenttrail`, `agenttrail-kitchen`) so that upstream changes merge cleanly. It is not a rebrand.

## Rules the fork keeps

- No packages are published to npm from the fork. Use the upstream packages or build from source.
- Both services bind to `127.0.0.1`, and the fork adds no telemetry or outbound calls.
- No new npm dependencies unless a ticket asks for one.

The list of fork changes is in the README under [What OJ Labs changed](README.md#what-oj-labs-changed). How upstream changes are brought in is in [docs/UPSTREAM-SYNC.md](docs/UPSTREAM-SYNC.md).
