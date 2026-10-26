/* Peer-to-peer rooms over WebRTC (Trystero). There is no game server: peers find each other through
   public Nostr relays, then talk directly. The world lives on whoever is online; one peer acts as host for
   shared state, and standby hosts can take over instantly because every peer holds the latest snapshot. */
import {joinRoom, selfId, getRelaySockets, createEvent, subscribe} from "trystero";

export {selfId};
// bump PROTOCOL whenever messages change: older cached copies of the game then land in a different room and
// can never mix their match state into this one (that caused players to be thrown around the arena)
export const PROTOCOL = 3;
const APP_ID = `gizmo-knight-p${PROTOCOL}`;
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

/* Relay fallback. Many networks (mobile data, strict Wi-Fi) block direct WebRTC links, and with no TURN
   server those players would never see each other. So every player also talks through the same public
   Nostr relays used for matchmaking: a presence beat every few seconds, and for anyone we can't reach
   directly, game messages as short-lived (ephemeral, unstored) relay events. Direct links stay the fast
   path; relay traffic is only sent while someone actually needs it, and knight updates are thinned. */
// ?relayonly in the URL ignores direct links, to test the fallback between two tabs on one machine
const FORCE_RELAY = typeof location !== "undefined" && new URLSearchParams(location.search).has("relayonly");
const FB_TOPIC = `${APP_ID}-fallback`, FB_SUB = "gk-fb", FB_PUBLISH_TO = 3, FB_ST_INTERVAL = 250, FB_PEER_TIMEOUT = 10000;

export function connect(hello, on, turn = []) {
  const room = joinRoom({appId: APP_ID, relayConfig: {urls: RELAYS, warnOnRelayFailure: false}, rtcConfig: {iceServers: [...ICE, ...turn]}}, "arena", {
    onJoinError: d => on.joinError && on.joinError(d),
    // Every direct link starts with a tiny check from both sides: same game version, and neither is in
    // relay-only test mode. Either side refusing drops the link on both ends (like a blocked network), and
    // those players carry on through the relay fallback instead.
    onPeerHandshake: async (id, send, receive) => {
      await send({v: PROTOCOL, ro: FORCE_RELAY});
      const {data} = await receive();
      if (FORCE_RELAY || !data || data.ro || data.v !== PROTOCOL) throw new Error("no direct link");
    },
    handshakeTimeoutMs: 6000,
  });
  const deliver = (name, data, id) => { try { on[name] && on[name](data, id); } catch (e) { console.warn("[net]", name, e); } };
  const direct = new Set(), relayPeers = new Map(); // relayPeers: id -> last time heard via relay (not directly connected)
  const acts = {};
  for (const name of ACTIONS) {
    const a = room.makeAction(name);
    a.onMessage = (data, meta) => { if (!FORCE_RELAY) deliver(name, data, meta.peerId); };
    acts[name] = a;
  }
  room.onPeerJoin = id => {
    if (FORCE_RELAY) return;
    direct.add(id); relayPeers.delete(id); // a direct link beats the relay
    acts.hello.send(hello(), {target: id}).catch(() => {}); on.join && on.join(id);
  };
  room.onPeerLeave = id => { direct.delete(id); if (!relayPeers.has(id)) on.leave && on.leave(id); };
  acts.hello.send(hello()).catch(() => {});

  // ---- relay fallback ----
  const seen = new Set(), seenQ = [], hooked = new WeakSet();
  const openSockets = () => Object.values(getRelaySockets()).filter(ws => ws && ws.readyState === 1);
  const onRelayMsg = e => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m[0] !== "EVENT" || m[1] !== FB_SUB || !m[2]) return;
    const ev = m[2]; if (seen.has(ev.id)) return; // the same event arrives from several relays
    seen.add(ev.id); seenQ.push(ev.id); if (seenQ.length > 600) seen.delete(seenQ.shift());
    let p; try { p = JSON.parse(ev.content); } catch (err) { return; }
    if (!p || p.f === selfId || (p.to && p.to !== selfId) || direct.has(p.f)) return;
    const isNew = !relayPeers.has(p.f);
    relayPeers.set(p.f, Date.now());
    if (p.t === "beat") { deliver("hello", p.d, p.f); if (isNew) beat(p.f); return; } // answer a newcomer right away
    if (ACTIONS.includes(p.t)) deliver(p.t, p.d, p.f);
  };
  const hookSockets = () => { // sockets get replaced when they reconnect: subscribe on each new one
    for (const ws of openSockets()) {
      if (hooked.has(ws)) continue;
      hooked.add(ws); ws.addEventListener("message", onRelayMsg);
      ws.send(subscribe(FB_SUB, FB_TOPIC));
    }
  };
  const publish = async (t, d, to) => {
    const socks = openSockets(); if (!socks.length) return;
    const ev = await createEvent(FB_TOPIC, JSON.stringify({f: selfId, t, d, to}));
    for (const ws of socks.slice(0, FB_PUBLISH_TO)) if (ws.readyState === 1) ws.send(ev);
  };
  const beat = to => publish("beat", hello(), to).catch(() => {});
  let lastSt = 0;
  const timer = setInterval(() => {
    hookSockets(); beat();
    const now = Date.now();
    for (const [id, t] of relayPeers) if (now - t > FB_PEER_TIMEOUT) { relayPeers.delete(id); if (!direct.has(id)) on.leave && on.leave(id); }
  }, 3000);
  setTimeout(() => { hookSockets(); beat(); }, 800);

  return {
    send(name, data, target) {
      // direct link only where one exists (targeting a relay-only player made Trystero log a warning per message)
      if (!target) { if (direct.size) acts[name].send(data).catch(() => {}); }
      else if (direct.has(target)) acts[name].send(data, {target}).catch(() => {});
      // also through the relay, but only for players we can't reach directly
      if (!relayPeers.size || (target && !relayPeers.has(target))) return;
      if (name === "st") { const now = Date.now(); if (now - lastSt < FB_ST_INTERVAL) return; lastSt = now; }
      publish(name, data, target).catch(() => {});
    },
    leave() { clearInterval(timer); room.leave(); },
    relayCount: () => relayPeers.size,
    viaRelay: id => relayPeers.has(id),
  };
}
// how many matchmaking relays are connected right now (for the status line)
export function relaysUp() {
  const s = getRelaySockets();
  return Object.values(s).filter(ws => ws && ws.readyState === 1).length;
}
export const RELAY_COUNT = RELAYS.length;
