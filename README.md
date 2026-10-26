# Gizmo Knight

A real-time multiplayer ASCII fantasy brawler that runs in the browser. The whole world is rendered as colored text glyphs with WebGL, lit by torches, campfires, runes and spells.

## Play
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (Vercel builds this automatically via vercel.json)
```

Pick a name (no account), a class and a mode. Everyone online shares one realm and follows the host's mode and map:
- **Free for All**: every knight for themself, first to 15 kills.
- **Boss Raid**: co-op against Gorrath, the Hollow King. He has telegraphed slams, fire breath, imp summons and an enraged meteor rain, and waves of imps join in.

**Maps** rotate every round: **Moonlit Vale**, **Ashen Wastes** (rivers of lava, basalt spires, embers) and **Frostmere** (slippery frozen lake, snowy pines, ice crystals). Water can be waded at reduced speed, and a dash carries you across a narrow stretch. Lava is a wall to everyone but the Angel.

**Classes** (each has its own three spells on F / G / R, its own dash, and a signature):

| Class | Spells | Dash | Signature |
|---|---|---|---|
| ⚔ Knight | Crescent Wave, Judgment, Summon Blades (hold for a barrage) | Shield Charge: bowls enemies over | Wide sweeps, and every swing throws a sword wave; blocking refunds mana |
| ⚒ Berserker | Fireball, Inferno Leap, Eruption | Inferno Rush: leaves burning ground | Bloodlust: under 40% HP he hits harder and heals on hit |
| ✦ Sorcerer | Arcane Missiles, Chain Lightning, Meteor | Phase Shift: chainable teleports (22 MP each) leaving purple ooze | Deepest mana, strongest spells |
| ☾ Shadow | Shadow Daggers, Shadowstrike, Smoke Bomb | Shadow Step: invisible while dashing | Backstab: hits from behind or out of smoke always crit |
| ☠ Necromancer | Soul Bolt (drains life), Raise Dead (costs blood + mana), Corpse Nova | Grave Swap: trade places with a minion | His minions are little purple copies of him |
| ✟ Angel | Holy Lance, Radiance (heal + ward), Starfall | Radiant Glide: a long glide | Flies over water and lava, immune to burning ground |

Tap the dash for a dodge; **hold it to keep sprinting** while mana drains. Max HP never grows during a match; kills add damage and mana. Mana also comes back faster while moving, from melee hits and in a waystone's light.

**Sound:** every effect and the ambience (wind, insects, water, campfire crackle) is synthesized live with Web Audio, no audio files. `M` or the ♪ button mutes.

**Desktop:** WASD / arrows or hold left mouse to move, Shift to run, Space or a quick left-click to slash (hold Space for a ground slam), F / G / R (or right-click for F) for your class's three spells (hold any spell key to charge it with all your MP), hold Q to shield, C or Ctrl to dash (hold to sprint), E to travel at a waystone, Tab for the scoreboard, M to mute, mouse wheel or `-` / `=` to zoom.
**Phone:** drag to move; `/` slash (hold to slam), the three spell buttons (hold any to charge), `◊` shield, the dash button (hold to sprint); pinch with two fingers to zoom.

## How it works
- The world is generated once as a color map plus a material map (grass, water, stone, dirt, trees, flowers, glow), with baked hill shading.
- A WebGL pass lights every cell (moonlight, drifting cloud shadows, up to 16 point lights), adds wind, water shimmer and mist, then picks a glyph per cell by brightness and material. A second pass draws those glyphs from a font atlas.
- The knight is AI-generated art (see `art/`) on green screen. `python art/build_knight.py` (needs Pillow, NumPy, SciPy) cuts each frame out, packs `art/knight-atlas.webp` + `.json`, and the game converts frames to ASCII at runtime, recoloring the cape per player.
- Minions, imps and the boss are "mobs" simulated by whoever owns them (a Necromancer owns their skeletons, the host owns the raid) and broadcast about 8 times a second as compact arrays. A hit on someone else's mob is sent to its owner. Each mob is one pre-rendered sprite, so a full raid costs a handful of draw calls.
- **Multiplayer has no game server** (`src/net.js`, [Trystero](https://github.com/dmotz/trystero)). Players find each other through public Nostr relays and connect directly over WebRTC. When a direct link is impossible (mobile data, strict Wi-Fi), game messages fall back to short-lived events on those same relays, a little laggier but it works on any network. The longest-standing host keeps the shared state and two standby hosts can take over. `?relayonly` in the URL forces the relay path for testing. An optional `/api/turn` Vercel function can hand out TURN credentials if `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` are ever set.

## Roadmap
1. ~~World look, movement, camera, lighting~~
2. ~~Spells, combat, damage numbers~~
3. ~~Peer-to-peer multiplayer: Free for All, Team Deathmatch~~
4. ~~Six classes with unique kits, three rotating maps, Boss Raid~~
5. See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the long list of what comes next
