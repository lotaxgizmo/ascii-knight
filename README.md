# ASCII Knight

A real-time, single-player ASCII fantasy RPG that runs in the browser. The whole world is rendered as colored text glyphs with WebGL, lit by torches, campfires, runes and spells.

## Play
Open `index.html` in a browser (no build step), or deploy the folder as a static site.

**Desktop:** WASD / arrows to move, Shift to run, Space or left-click to slash, F or right-click for Fire Orb.
**Phone:** drag anywhere to move, tap `/` to slash and `*` for Fire Orb.

## How it works
- The world is generated once as a color map plus a material map (grass, water, stone, dirt, trees, flowers, glow).
- A WebGL pass lights every cell (moonlight + up to 16 point lights), adds wind, water shimmer and mist, then picks a glyph per cell by brightness and material.
- A second pass draws those glyphs from a font atlas.
- The knight is AI-generated art (see `art/`) on a green screen. It is keyed and converted to ASCII at runtime, so new characters only need one generated image.

## Roadmap
1. ~~World look, movement, camera, lighting~~
2. Enemies (skeleton warriors), combat, damage numbers
3. More spells and mana
4. Towns, NPCs, quests, loot
