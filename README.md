# ASCII Knight

A real-time, single-player ASCII fantasy RPG that runs in the browser. The whole world is rendered as colored text glyphs with WebGL, lit by torches, campfires, runes and spells.

## Play
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (Vercel builds this automatically via vercel.json)
```

**Desktop:** WASD / arrows or hold left mouse to move, Shift to run, Space or a quick left-click to slash, F or right-click for Fire Orb (hold to charge a Fireball with all your MP), G lightning, R summon blades, hold Q to shield, C or Ctrl to dodge roll, mouse wheel or `-` / `=` to zoom. Training dummies stand just south of the stone circle.
**Phone:** drag anywhere to move, tap `/` to slash and `*` for Fire Orb.

## How it works
- The world is generated once as a color map plus a material map (grass, water, stone, dirt, trees, flowers, glow).
- A WebGL pass lights every cell (moonlight + up to 16 point lights), adds wind, water shimmer and mist, then picks a glyph per cell by brightness and material.
- A second pass draws those glyphs from a font atlas.
- The knight is AI-generated art (see `art/`): a pixel-art 8-direction run sheet and hero idle, plus a moves sheet (back idle, sword combo, block, dodge), all on green screen. `python art/build_knight.py` (needs Pillow, NumPy, SciPy) cuts each frame off the studio background, packs them into `art/knight-atlas.webp` + `art/knight-atlas.json`, which `src/main.js` imports. The game converts the frames to ASCII at runtime.

## Roadmap
1. ~~World look, movement, camera, lighting~~
2. Enemies (skeleton warriors), combat, damage numbers
3. More spells and mana
4. Towns, NPCs, quests, loot
