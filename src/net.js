/* Peer-to-peer rooms over WebRTC (Trystero). There is no game server: peers find each other through
   public Nostr relays, then talk directly. The world lives on whoever is online; one peer acts as host for
   shared state, and standby hosts can take over instantly because every peer holds the latest snapshot. */
import {joinRoom, selfId, getRelaySockets} from "trystero";

export {selfId};
const APP_ID = "gizmo-knight-v1";
// Relays checked to answer quickly and accept the ephemeral events Trystero uses for matchmaking.
// Every peer connects to all of them, so any two players always share several working relays.
// (Trystero's own default picks 5 from a long list, and several of those were refusing connections.)
const RELAYS = [
  "wss://nos.lol", "wss://relay.damus.io", "wss://relay.primal.net", "wss://nostr.mom", "wss://0x-nostr-relay.fly.dev",
  "wss://nostr.rblb.it", "wss://nostr.red5d.dev", "wss://nostrcity-club.fly.dev", "wss://relay.agentry.com",
];
// STUN finds each player's public address; a TURN relay (optional, set at build time) carries traffic for
// players whose networks block direct connections (common on mobile data).
const ICE = [{urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}, {urls: "stun:stun.cloudflare.com:3478"}];
const env = import.meta.env;
if (env.VITE_TURN_URLS) ICE.push({urls: env.VITE_TURN_URLS.split(","), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS});

// message types: hello (who I am), st (my knight, ~15/s), fx (a spell/attack to replay as visuals),
// hit (you got hit), dh (I hit a shared dummy: host applies), kill (I died), snap (host's shared state)
const ACTIONS = ["hello", "st", "fx", "hit", "dh", "kill", "snap"];

// TURN credentials come from our tiny /api/turn function (Cloudflare); without it we still try direct links
export async function fetchTurn() {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch("/api/turn", {signal: ctl.signal});
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return {iceServers: [], configured: false};
    return await r.json();
  } catch (e) { return {iceServers: [], configured: false}; } finally { clearTimeout(t); }
}

export function connect(hello, on, turn = []) {
  const room = joinRoom({appId: APP_ID, relayConfig: {urls: RELAYS, warnOnRelayFailure: false}, rtcConfig: {iceServers: [...ICE, ...turn]}}, "realm", {
    onJoinError: d => on.joinError && on.joinError(d),
  });
  const acts = {};
  for (const name of ACTIONS) {
    const a = room.makeAction(name);
    a.onMessage = (data, meta) => { try { on[name] && on[name](data, meta.peerId); } catch (e) { console.warn("[net]", name, e); } };
    acts[name] = a;
  }
  room.onPeerJoin = id => { acts.hello.send(hello(), {target: id}).catch(() => {}); on.join && on.join(id); };
  room.onPeerLeave = id => on.leave && on.leave(id);
  acts.hello.send(hello()).catch(() => {});
  return {
    send(name, data, target) { acts[name].send(data, target ? {target} : undefined).catch(() => {}); },
    leave() { room.leave(); },
  };
}
// how many matchmaking relays are connected right now (for the status line)
export function relaysUp() {
  const s = getRelaySockets();
  return Object.values(s).filter(ws => ws && ws.readyState === 1).length;
}
export const RELAY_COUNT = RELAYS.length;
