# Two embedded kitchens

A host page that mounts two Kitchens side by side with `mountKitchen`, each from its own invented fixture snapshot. There is no `eventsUrl`, so each kitchen shows its fixture statically. Following a plate prints the `agenttrail-kitchen:evidence` event in the status line.

## Run it

1. `npm ci --prefix packages/kitchen`
2. `npm run build --prefix packages/kitchen`
3. `node examples/embedded-kitchens/serve.mjs`
4. Open <http://127.0.0.1:4790>.

The server binds 127.0.0.1 only and serves three things: this folder, the two fixtures in it, and `packages/kitchen/public/build`. Anything else, including a `../` path, answers 404. It makes no outbound requests.

## Files

- `index.html` and `demo.js`: the host page and the two `mountKitchen` calls.
- `snapshot-a.json` and `snapshot-b.json`: snapshots in the version 2 shape, with invented projects, chefs and tickets. They hold no paths and no secrets.
- `serve.mjs`: the static server.

The `token` in `demo.js` is a placeholder. The static server never checks it; a real host sends its own.
