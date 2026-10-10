# Embedding the Kitchen in another page

A host page can show the Kitchen two ways: call `mountKitchen` from its own script, or put the Kitchen's embed page in an iframe. Both take the same options, show the same scene, and send the same bearer token to the two URLs you give them and nowhere else. A working host page is in [examples/embedded-kitchens](../../examples/embedded-kitchens/README.md). What the embed reads and sends is listed in [Embedded Kitchen](../OBSERVABILITY.md#embedded-kitchen).

## Mount it from a script

Build the package, then import the bundled module. The fork does not publish to npm, so install `agenttrail-kitchen` from a checkout or a packed tarball.

```sh
npm ci --prefix packages/kitchen
npm run build --prefix packages/kitchen
```

```js
import {mountKitchen} from 'agenttrail-kitchen/public/build/embed.js';

const kitchen = mountKitchen(document.getElementById('kitchen'), {
  snapshotUrl: 'https://feed.example/kitchen/snapshot',
  eventsUrl: 'https://feed.example/kitchen/events',
  token: shortLivedToken,
  theme: 'dark'
});

document.getElementById('kitchen').addEventListener('agenttrail-kitchen:evidence', event => {
  openEvidence(event.detail);
});

// Later, when the ticket page closes:
kitchen.destroy();
```

The scene lives in a shadow root on the element you pass, so the host's styles cannot reach it and its styles cannot reach the host. A mount keeps no module state and sets no globals, so several can share a page. `destroy()` closes the feed, stops rendering and empties the element.

### Options

| Option | Required | Meaning |
| --- | --- | --- |
| `snapshotUrl` | yes | An `http` or `https` URL that answers a `GET` with the snapshot (version 2, see [FEED.md](FEED.md#the-snapshot-version-2)). Any other scheme throws. |
| `eventsUrl` | no | An `http` or `https` URL that streams the same snapshot as server-sent events. Without it the Kitchen shows the one snapshot and does not update. |
| `token` | yes | Sent as `Authorization: Bearer <token>` to `snapshotUrl` and `eventsUrl` only. A missing token throws. |
| `theme` | no | `light` (the default) or `dark`. Any other value is treated as `light`. |
| `reducedMotion` | no | `true` forces the static scene and `false` forces motion. Left out, the Kitchen follows the visitor's `prefers-reduced-motion` setting. |

A bad URL or a missing token throws from `mountKitchen` before anything is drawn.

The Kitchen requests the feed with `fetch`, because `EventSource` cannot send a header. If the feed is on a different origin from the host page, it must answer CORS preflight requests and allow the `Authorization` header. If a request fails or the stream ends, the Kitchen shows "Reconnecting…" and tries again every five seconds with the same token.

## Mount it in an iframe

The embed page is `/embed.html` on a running Kitchen, or `public/embed.html` and `public/embed-page.js` from the package if you serve them yourself. It reads its options from the query string.

```html
<iframe
  title="Kitchen"
  src="/embed.html?snapshotUrl=https%3A%2F%2Ffeed.example%2Fsnapshot&eventsUrl=https%3A%2F%2Ffeed.example%2Fevents&token=...&theme=dark&parentOrigin=https%3A%2F%2Fhost.example">
</iframe>
```

| Parameter | Required | Meaning |
| --- | --- | --- |
| `snapshotUrl` | yes | As for `mountKitchen`. URL-encode it. |
| `eventsUrl` | no | As for `mountKitchen`. |
| `token` | yes | As for `mountKitchen`; see the caveats below. |
| `theme` | no | `dark` selects the dark theme. Anything else is `light`. |
| `reducedMotion` | no | `true` forces the static scene; any other value forces motion. Left out, the visitor's setting applies. |
| `parentOrigin` | no | The host's origin, exactly `scheme://host[:port]`, with no path. It switches on the `postMessage` form of the evidence event, below. |

If the options are invalid the page shows "This kitchen could not start" and the reason, which never includes the token.

Two limits to know before choosing the iframe:

- A Kitchen started with `agenttrail-kitchen` sends `frame-ancestors 'self'` for `/embed.html` and `frame-ancestors 'none'` for every other page, and its `connect-src` is `'self'`. Served by the Kitchen itself, the embed page can only be framed by, and can only fetch from, its own origin. A host on another origin should serve `embed.html` and `embed-page.js` with `build/embed.js` from its own server under its own content security policy, or use `mountKitchen`.
- The page removes `token` from its address with `history.replaceState` once it has read it. That does not remove it from the iframe's `src` attribute, from the host's markup, or from any server or proxy log that recorded the request for the page.

## Following a plate to its evidence

When a viewer follows a plate, either by clicking it in the scene or by pressing its button in the list, the Kitchen dispatches a `CustomEvent` named `agenttrail-kitchen:evidence` on the element you mounted into. The event bubbles and is composed, so a listener on the element or anywhere above it hears it across the shadow boundary. Its `detail` holds five fields and nothing else:

| Field | Meaning |
| --- | --- |
| `orderId` | The ticket the plate belongs to. |
| `artifactId` | The plate that was followed. |
| `label` | Its short label, as shown to the viewer. |
| `kind` | The kind of artifact. |
| `revisionId` | The revision the viewer saw. |

The Kitchen does not open anything itself. The host decides what these fields point to, and should check them against what the viewer is allowed to see.

### The postMessage form

Inside an iframe the host cannot listen on the element, so the embed page posts the same five fields to the parent window, plus `type: 'agenttrail-kitchen:evidence'`:

```js
window.addEventListener('message', event => {
  if (event.origin !== 'https://feed.example') return; // the origin that serves the iframe
  if (event.data?.type !== 'agenttrail-kitchen:evidence') return;
  openEvidence(event.data);
});
```

The message is posted with `parentOrigin` as its target origin. Without a valid `parentOrigin`, or when the page is not in a frame, nothing is posted. The target is never `*`.

## When motion or WebGL is missing

- **Reduced motion.** With `reducedMotion` set to `true`, or the visitor's `prefers-reduced-motion: reduce` when it is left out, the scene is static: no idle animation. A visitor who changes the setting while the page is open is followed.
- **No WebGL.** If the browser cannot create a WebGL context, or the renderer fails to start, the Kitchen draws no scene. It shows a notice and a plain list of chefs and tickets instead, with the same evidence button on each plate. The list is built from text only, so snapshot strings can never become markup.
- **Frame cap.** The scene renders at most 30 frames a second. The cap is fixed; `mountKitchen` has no option for it.
- **Hidden tab.** While `document.hidden` is true the scene stops rendering, and it resumes when the tab is shown again.

## Token caveats

The token is a credential that anyone who can read it can use. How it travels depends on the form:

- With `mountKitchen` it stays in your script's memory and goes out only in the `Authorization` header of the two feed requests. Prefer this form when you can.
- In an iframe it travels in the query string. Query strings end up in the iframe's `src`, in browser history for the page that carries it, and in access logs along the way. The embed page sets `no-referrer` so it does not leak the token onward, but it cannot undo what already recorded the address.

Serve any feed that is not on the same machine over `https:`. The Kitchen accepts `http:` URLs so a local feed works, but over plain `http:` to another host the token crosses the network unencrypted.

Because of that, issue a token that does one job: read the snapshot and the events for the one ticket or project being shown, with nothing else on the feed. Make it short-lived, minutes rather than days, and mint a new one each time the page opens. The Kitchen never refreshes a token. When it expires the feed will refuse it and the Kitchen will sit on "Reconnecting…" until you call `destroy()` and mount again with a fresh one, or reload the iframe with a new `src`.
