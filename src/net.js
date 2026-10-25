/* Peer-to-peer rooms over WebRTC (Trystero). There is no game server: peers find each other through
   public Nostr relays, then talk directly. The world lives on whoever is online; one peer (the lowest
   random rank) acts as host for shared state, and the next two are standby hosts that can take over
   instantly because every peer already holds the latest snapshot. */
import {joinRoom, selfId} from "trystero";

export {selfId};
const APP_ID = "gizmo-knight-v1";
// message types: hello (who I am), st (my knight, ~15/s), fx (a spell/attack to replay as visuals),
// hit (you got hit), dh (I hit a shared dummy: host applies), kill (I died), snap (host's shared state)
const ACTIONS = ["hello", "st", "fx", "hit", "dh", "kill", "snap"];

export function connect(hello, on) {
  const room = joinRoom({appId: APP_ID}, "realm"); // one shared realm; the host picks the mode
  const acts = {};
  for (const name of ACTIONS) {
    const a = room.makeAction(name);
    a.onMessage = (data, meta) => on[name] && on[name](data, meta.peerId);
    acts[name] = a;
  }
  room.onPeerJoin = id => { acts.hello.send(hello(), {target: id}); on.join && on.join(id); };
  room.onPeerLeave = id => on.leave && on.leave(id);
  acts.hello.send(hello());
  return {
    send(name, data, target) { acts[name].send(data, target ? {target} : undefined).catch(() => {}); },
    leave() { room.leave(); },
  };
}
