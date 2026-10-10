import {mountKitchen} from './build/embed.js';

// The fixtures are served from this folder, so a relative URL is enough; the token is a placeholder because the static server never checks it.
const token='demo-token';
mountKitchen(document.getElementById('kitchen-a'),{snapshotUrl:'snapshot-a.json',token});
mountKitchen(document.getElementById('kitchen-b'),{snapshotUrl:'snapshot-b.json',token,theme:'dark'});

// The event is composed and bubbles, so one listener on the page hears both kitchens.
document.addEventListener('agenttrail-kitchen:evidence',event=>{
  const {orderId,artifactId,label,kind,revisionId}=event.detail;
  document.getElementById('status').textContent=`Evidence requested: ${label} (${kind}), revision ${revisionId}, plate ${artifactId} on ticket ${orderId}.`;
});
