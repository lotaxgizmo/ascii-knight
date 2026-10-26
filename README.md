# Gizmo Knight

A real-time multiplayer ASCII fantasy brawler that runs in the browser. The whole world is rendered as colored text glyphs with WebGL, lit by torches, campfires, runes and spells.

## Play
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (Vercel builds this automatically via vercel.json)
```

Pick a name (no account) and enter the arena: everyone online plays one **Free for All** match (first to 15 kills) around the Stone Circle.

**Classes:** ⚔ **Knight** (wide, long sword sweep; balanced), ⚒ **Berserker** (burning brute: most HP and melee, weak magic), ✦ **Sorcerer** (arcane: biggest mana pool, strongest spells, fragile up close), ☾ **Shadow** (smoke and speed: fastest, quickest dash). Max HP never grows during a match; kills add damage and mana. Mana also comes back faster while moving, from melee hits and in a waystone's light.

**Sound:** every effect and the ambience (wind, insects, water, campfire crackle) is synthesized live with Web Audio, no audio files. `M` or the ♪ button mutes.

**Desktop:** WASD / arrows or hold left mouse to move, Shift to run, Space or a quick left-click to slash (hold Space for a ground slam), F or right-click for fire, G lightning, R summon blades (hold any spell key to charge it with all your MP), hold Q to shield, C or Ctrl to dash, E to travel at a waystone, Tab for the scoreboard, M to mute, mouse wheel or `-` / `=` to zoom.
**Phone:** drag to move; `/` slash (hold to slam), `*` fire, `ϟ` lightning, `†` blades (hold any to charge), `◊` shield, `»` dash; pinch with two fingers to zoom.

## How it works
- The world is generated once as a color map plus a material map (grass, water, stone, dirt, trees, flowers, glow), with baked hill shading.
- A WebGL pass lights every cell (moonlight, drifting cloud shadows, up to 16 point lights), adds wind, water shimmer and mist, then picks a glyph per cell by brightness and material. A second pass draws those glyphs from a font atlas.
- The knight is AI-generated art (see `art/`) on green screen. `python art/build_knight.py` (needs Pillow, NumPy, SciPy) cuts each frame out, packs `art/knight-atlas.webp` + `.json`, and the game converts frames to ASCII at runtime, recoloring the cape per player.
- **Multiplayer has no game server** (`src/net.js`, [Trystero](https://github.com/dmotz/trystero)). Players find each other through public Nostr relays and connect directly over WebRTC. When a direct link is impossible (mobile data, strict Wi-Fi), game messages fall back to short-lived events on those same relays, a little laggier but it works on any network. The longest-standing host keeps the shared state and two standby hosts can take over. `?relayonly` in the URL forces the relay path for testing. An optional `/api/turn` Vercel function can hand out TURN credentials if `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` are ever set.

## Roadmap
1. ~~World look, movement, camera, lighting~~
2. ~~Spells, combat, damage numbers~~
3. ~~Peer-to-peer multiplayer: Free for All, Team Deathmatch~~
4. Enemies (skeleton warriors), towns, NPCs, quests, loot
