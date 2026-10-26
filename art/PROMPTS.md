# Art prompts for every class, spell and monster

## ★ All-in-one sheet (one 6×8 green screen per character)

Attach the knight run sheet (`knight-run8-sheet.webp`) as the layout reference and paste this, with the character block filled in.
West, south-west and north-west aren't drawn; the game mirrors east, south-east and north-east for them.

```
Using the attached sprite sheet ONLY as a layout and style reference, create a NEW sprite sheet with exactly the same grid: 8 rows × 6 columns of equal cells, black grid lines, a black label column on the left, a black header row reading FRAME 1 … FRAME 6, and a pure flat chroma-green background (#00FF00) in every cell (no shadows, gradients, ground or floor).
Same pixel-art style, outline weight, 3/4 top-down RPG camera and upper-left lighting as the reference. The character is the same size in every cell, centred, feet on the same baseline. Nothing crosses a cell border. No text inside cells.

THE CHARACTER: [CHARACTER]
Rules: no green anywhere on the character or effects. Keep one bright RED cloth element (cape, sash or plume) for player recolouring.

Fill the rows like this (left label in brackets):
Row 1 [RUN EAST →]: 6-frame running cycle facing right.
Row 2 [RUN SOUTH ↓]: 6-frame running cycle facing the viewer.
Row 3 [RUN NORTH ↑]: 6-frame running cycle facing away.
Row 4 [RUN SOUTH-EAST ↘]: 6-frame running cycle, front-right diagonal.
Row 5 [RUN NORTH-EAST ↗]: 6-frame running cycle, back-right diagonal.
Row 6 [IDLE / DEFEND]: 1 idle facing front · 2 idle facing right · 3 idle facing away · 4 guard / block pose facing right · 5 hit reaction (knocked back) · 6 defeated, collapsed on the ground.
Row 7 [ATTACKS] (all facing right): [ATTACKS]
Row 8 [DASH / POWERS]: [POWERS]
```

### Character blocks

**⚔ Knight**
- CHARACTER: an armoured knight in polished steel plate with gold trim, a red plume and a long red cape, a longsword and a round steel shield.
- ATTACKS: 1 sword raised, winding up · 2 wide horizontal slash with a white arc trail · 3 overhead vertical slash · 4 thrust forward · 5 spin attack with a full white trail ring · 6 casting pose, sword raised to the sky with golden light.
- POWERS: 1 shield charge, leaning forward behind the shield with speed lines · 2 forward roll · 3 a pale-blue crescent wave of light (no character) · 4 a giant glowing summoned sword pointing down (no character) · 5 a pillar of golden light hitting the ground (no character) · 6 a white starburst impact (no character).

**⚒ Berserker**
- CHARACTER: a hulking barbarian berserker with bare scarred arms, dark bronze and blackened-iron spiked armour, a horned helmet, glowing orange ember cracks in the armour, a torn red cape, and a huge two-handed battle axe.
- ATTACKS: 1 axe raised behind the head · 2 wide horizontal axe cleave with a fire trail · 3 overhead axe chop into the ground · 4 whirling axe spin · 5 throwing a fireball from the open hand · 6 roaring, fists clenched, wreathed in flames (rage).
- POWERS: 1 mid-leap with the axe overhead, flames trailing · 2 landing slam, axe in the ground · 3 a flaming fireball (no character) · 4 a fire explosion (no character) · 5 a ring of flame columns bursting from the ground (no character) · 6 a patch of burning ground (no character).

**✦ Sorcerer**
- CHARACTER: a battle sorcerer in flowing deep-violet robes over light silver armour, a hood with glowing violet eyes, a red cape, a crystal-topped staff, and a floating violet rune orb.
- ATTACKS: 1 staff raised, gathering power · 2 staff swept sideways, casting · 3 staff thrust forward firing · 4 both arms raised to the sky (calling a meteor) · 5 palm thrust, pushing a shockwave · 6 lightning crackling between the hands.
- POWERS: 1 dissolving into violet sparks (teleport out) · 2 reforming from violet sparks (teleport in) · 3 a violet arcane missile orb with a trail (no character) · 4 a jagged white-blue lightning bolt striking down (no character) · 5 a flaming meteor falling diagonally (no character) · 6 a bubbling purple ooze puddle (no character).

**☾ Shadow**
- CHARACTER: a nimble assassin in tight dark-charcoal leather, a hood and face mask with glowing teal eyes, a lean crouched build, a short tattered red scarf, and twin curved daggers.
- ATTACKS: 1 daggers crossed, coiled to strike · 2 fast double slash with teal trails · 3 leaping downward stab · 4 throwing a fan of three daggers · 5 spinning blade flurry · 6 backstab, stabbing downward from behind.
- POWERS: 1 throwing a smoke bomb at her feet · 2 half-vanished into smoke (body fading) · 3 a spinning thrown dagger with a teal glint (no character) · 4 a thick grey-teal smoke cloud (no character) · 5 a dark slash mark with a teal edge (no character) · 6 a dark fading afterimage silhouette with a teal outline (no character).

**☠ Necromancer**
- CHARACTER: a dark necromancer in black and bone-grey robes with rib and skull motifs, a skull-shaped helmet with glowing pale-purple eye sockets, a ragged red cape, purple smoke at the feet, a scythe, and a floating skull lantern.
- ATTACKS: 1 scythe drawn back · 2 wide scythe reap with a purple trail · 3 skull lantern raised, firing a soul bolt · 4 scythe spin · 5 both arms raised over the ground, summoning · 6 hunched over, drained (paying the blood price).
- POWERS: 1 wrapped in swirling dark-purple smoke (swapping places) · 2 a small purple copy of himself, half size (his minion) · 3 a ghostly pale-white skull projectile with a wispy tail (no character) · 4 a purple summoning circle with runes on the ground (no character) · 5 a purple shockwave ring with bone shards (no character) · 6 a purple smoke burst with sparks (no character).

**✟ Angel**
- CHARACTER: a radiant angel knight in polished white and gold armour, a golden halo, two large white feathered wings kept inside the cell, a red sash, a soft white glow, floating just off the ground, a glowing golden spear, and a small round gold shield.
- ATTACKS: 1 spear drawn back, wings spread · 2 horizontal spear sweep with a gold trail · 3 spear pointed forward firing a beam · 4 both hands raised calling down stars · 5 wing spin with the spear · 6 kneeling in prayer, glowing (healing).
- POWERS: 1 gliding forward with wings fully spread · 2 barrel-roll glide with feathers · 3 a horizontal beam of white-gold light (no character) · 4 a white-gold falling star (no character) · 5 an expanding golden healing ring with light motes (no character) · 6 a golden shield-bubble outline (no character).

---

Use these with an image model that edits from a reference (ChatGPT image editing, Gemini, etc.). There are two kinds of sheets:

| Kind | Background | Why |
|---|---|---|
| **Characters and monsters** (bodies that move) | flat chroma green `#00FF00` | `build_knight.py` cuts them out by keying the green |
| **Effects** (projectiles, explosions, beams, auras) | pure black `#000000` | effects are drawn with additive light, where black means "nothing", so glows keep their soft edges |

Once a sheet is ready, drop it in `art/` and the pipeline turns it into ASCII frames like the knight. Today spells are drawn procedurally from glyphs, so effect sheets need a small new loader (an effect atlas, same idea as the knight atlas).

---

## 1. Character sheets (one set per class)

Each class needs the same three sheets the Knight has:

1. **Run sheet**: 8 directions × 6 frames (`knight-run8-sheet.webp`). Prompt A.
2. **Moves sheet**: 5 rows × 6 poses: idle turnaround, running, attacks, defend/hit, special moves (`knight-moves-sheet.webp`). Prompt B.
3. **Hero idle**: one big front pose (`knight-idle-hero.webp`). Prompt C.

### Prompt A: run sheet
Attach `knight-run8-sheet.webp`.
```
Edit this sprite sheet. Keep EVERYTHING about the layout identical:
the same 8 rows (South, South-West, West, North-West, North, North-East, East, South-East) by 6 columns (Frame 1–6), the same header labels, the same black grid lines, the same pure flat chroma-green background (#00FF00) with no shadows, gradients or ground.
Keep every pose, the running animation, the camera angle, the character's size in each cell and the foot position EXACTLY the same, frame for frame. Same pixel-art style, same outline weight, same lighting from the upper left.
Only change the character's design into: [CHARACTER]
Rules: no green anywhere on the character. Keep one bright RED cloth element (cape, sash or plume) where the original red cape is, so it can be recoloured per player. Nothing may cross the cell borders. No extra text, no watermark.
```

### Prompt B: moves sheet (this is where the attacks live)
Attach `knight-moves-sheet.webp`.
```
Edit this sprite sheet. Keep the layout identical: 5 labelled rows × 6 cells, the same row titles and cell captions, the same grid, the same pure flat chroma-green background (#00FF00), the same camera angle, character size and foot position in every cell. Same rendering style and lighting as the original.
Change the character into: [CHARACTER]
Replace the poses row by row:
Row 1 IDLE / TURNAROUND: same six facings (front, front-right, right, back, left, front-left), holding [WEAPON].
Row 2 RUNNING: same six stride phases.
Row 3 ATTACKS: [ATTACKS ROW]
Row 4 DEFEND / HIT: [DEFEND ROW]
Row 5 SPECIAL MOVES: [SPECIAL ROW]
Rules: no green on the character or effects, keep one bright RED cloth element for player recolouring, nothing crosses the cell borders, keep the poses readable as silhouettes, no extra text beyond the existing captions.
```

### Prompt C: hero idle
Attach `knight-idle-hero.webp`.
```
Redraw this exact pose, framing and green background (#00FF00) as: [CHARACTER], holding [WEAPON]. Same style and lighting, one bright red cloth element, no green on the character, no text.
```

### Fill-ins per class

**⚔ Knight** (already done; listed so the others line up)
- ATTACKS: wind-up, horizontal slash, vertical slash, thrust, spin attack, recovery.
- DEFEND: block front, block left, block right, shield bash, hit reaction, recover.
- SPECIAL: jump start, in air, landing, roll, crouch, get up.

**⚒ Berserker**
- CHARACTER: a hulking barbarian berserker: bare scarred arms, dark bronze and blackened-iron armour with spikes, a horned helmet, a torn red cape, glowing orange ember cracks in the armour
- WEAPON: a huge two-handed battle axe
- ATTACKS: axe raised high behind the head (wind-up) · wide horizontal axe cleave · overhead axe chop into the ground · axe thrown forward from the hip · whirling 360° axe spin · heavy breath with the axe resting on the shoulder
- DEFEND: axe haft held across the body · braced to the left · braced to the right · shoulder charge forward · staggered back by a hit · roaring as he straightens up
- SPECIAL: deep crouch before a leap · mid-leap with the axe over his head · landing in a crouch slamming the axe into the ground · forward roll · beating his chest (rage) · getting up

**✦ Sorcerer**
- CHARACTER: a battle sorcerer in flowing deep-violet robes over light silver armour, a hood with glowing violet eyes, a red cape, faint violet sparkles at the hands
- WEAPON: a crystal-topped staff in the right hand, a floating violet rune orb by the left hand
- ATTACKS: staff raised, gathering power · staff swept sideways, casting · both arms raised to the sky (calling a meteor) · staff thrust forward (firing a missile) · spinning with the staff, robes flaring · lowering the staff, recovering
- DEFEND: rune orb held up as a shield in front · orb to the left · orb to the right · palm thrust forward pushing a shockwave · knocked back by a hit · steadying himself with the staff
- SPECIAL: dissolving into violet sparks (teleport out, half faded) · reforming from sparks (teleport in) · landing lightly · short sliding dodge · kneeling, channelling into the ground · rising

**☾ Shadow**
- CHARACTER: a nimble assassin in tight dark-charcoal leather, hood and face mask with glowing teal eyes, a lean slightly crouched build, a short tattered red scarf trailing like the cape
- WEAPON: twin curved daggers, one in each hand
- ATTACKS: daggers crossed, coiled to strike · fast horizontal double slash · leaping downward stab · throwing a fan of three daggers · spinning blade flurry · flipping a dagger, recovering
- DEFEND: daggers crossed in front · parry left · parry right · low sweeping kick · knocked back clutching the side · back on her feet
- SPECIAL: crouching, throwing a smoke bomb at her feet · half-vanished in smoke (body fading) · appearing behind, stabbing downward (backstab) · fast forward roll · low stealth crouch · getting up

**☠ Necromancer**
- CHARACTER: a dark necromancer in black and bone-grey robes with rib and skull motifs, a skull-shaped helmet with glowing pale-purple eye sockets, a ragged red cape, purple smoke curling at the feet
- WEAPON: a scythe, and a floating skull lantern by the left hand
- ATTACKS: scythe drawn back · wide scythe reap · skull lantern raised, firing a soul bolt · scythe planted, one hand raised summoning (purple light from the ground) · scythe spin · leaning on the scythe
- DEFEND: scythe held across the body · lantern raised left · lantern raised right · scythe-butt shove · doubled over, hit · straightening up
- SPECIAL: both arms raised over the ground, raising the dead · kneeling, palm on the ground · a dark shroud swirling around him (swapping places) · forward roll in robes · hunched, drained after paying the blood price · rising

**✟ Angel**
- CHARACTER: a radiant angel knight in polished white and gold armour, a golden halo above the helmet, two large white feathered wings (kept inside the cell), a red sash where the cape was, a soft white glow on the edges, feet just off the ground
- WEAPON: a glowing golden spear and a small round gold shield
- ATTACKS: spear drawn back, wings spread · horizontal spear sweep · spear pointed forward, firing a beam of light · both hands raised calling down stars · wing-spin with the spear · wings folding, recovering
- DEFEND: shield up front with wings curled around · shield left · shield right · wing buffet forward · knocked back, feathers flying · hovering upright again
- SPECIAL: wings beating, rising · gliding forward with wings fully spread · landing softly · barrel-roll glide · kneeling in prayer (healing light) · rising with wings opening

---

## 2. Effect sheets (spells, projectiles, impacts)

One sheet per class. Each row is one effect, read left to right as frames.

### Prompt D: class effect sheet
```
Create a pixel-art VFX sprite sheet on a pure black background (#000000), no ground, no characters, no text inside the cells.
Layout: [N] rows × 6 columns of equal square cells, thin dark-grey grid lines, a short label to the left of each row.
Each row is one animation, left to right, frame 1 to 6, centred in its cells at the same scale. Projectiles point to the RIGHT. Ground effects are seen from the same 3/4 top-down angle as a classic RPG (circles drawn as flat ellipses).
Bright, high-contrast glowing colours that fade to black at the edges (they are drawn with additive light). Crisp pixel edges, 16-colour feel, matching a dark-fantasy pixel-art knight game.
Rows:
[ROWS]
```

### Rows per class

**⚔ Knight**: steel and holy gold
1. Crescent Wave: a pale-blue crescent of light flying right (2 travel frames, then 4 frames fading and splitting)
2. Sword-swing wave: a small white arc, appearing, flying, fading
3. Judgment: a gold warning ring shrinking on the ground (2) → a pillar of golden light slamming down (2) → light and sparks fading (2)
4. Summon Blades: a giant glowing sword appearing (1), hovering point-down (2), diving (1), stuck in the ground with a flash (2)
5. Shield Charge: a blue-white shield-shaped shock front with speed lines
6. Whirlwind: a full ring of white sword trails spinning

**⚒ Berserker**: fire
1. Small fireball flying right (orange core, yellow centre, flame tail), 6-frame loop
2. Huge charged fireball, 6-frame loop of churning flame rings
3. Fire explosion: flash → fireball → smoke and embers
4. Inferno Leap landing: ground shockwave ellipse with a fire burst
5. Eruption: a ring of flame columns bursting out of the ground around the centre
6. Burning ground patch: a 6-frame loop of small flames on a scorched ellipse
7. Bloodlust aura: a pulsing red glow with rising red wisps, loop

**✦ Sorcerer**: arcane violet and lightning
1. Arcane missile: a violet orb with a sparkle tail, loop
2. Arcane missile impact: violet star burst
3. Lightning spark: a crackling white-blue ball flying right, loop
4. Lightning strike: a jagged bolt from the top of the cell to the ground, flash, afterglow
5. Meteor: a flaming rock falling diagonally (3) + crater impact (3)
6. Phase Shift: body-sized violet sparks dispersing (out, 3) + gathering (in, 3)
7. Ooze puddle: a bubbling purple slime ellipse, loop
8. Rift burst: violet implosion then explosion ring

**☾ Shadow**: teal and smoke
1. Thrown dagger: spinning dagger with a teal glint, loop
2. Dagger impact: small teal spark
3. Smoke bomb: puff exploding outward → thick grey-teal cloud (loop the last 3)
4. Shadowstrike: a dark slash across the cell with a teal edge
5. Shadow Step afterimage: a dark, fading knight silhouette with teal outline
6. Backstab crit: a red and teal X-shaped flash

**☠ Necromancer**: souls, bone, purple
1. Soul bolt: a ghostly pale-green skull with a wispy tail flying right, loop
2. Soul bolt impact: green-white soul burst with tiny skulls
3. Raise Dead: a purple summoning circle with runes appearing on the ground, light rising from it
4. Corpse Nova: a purple-green shockwave ring expanding with bone shards
5. Minion death: purple smoke puff with sparks
6. Grave Swap: a swirl of dark purple smoke, loop
7. Life drain: a thin green stream of light flowing right

**✟ Angel**: light and gold
1. Holy Lance beam: a horizontal beam spanning the cell (start flash → full beam → thinning → gone)
2. Lance impact: a white starburst
3. Radiance: a golden ring expanding from the centre with rising light motes
4. Divine ward: a golden shield-bubble outline, shimmering loop
5. Falling star: a white-gold star streaking down (3) + sparkling impact (3)
6. Feather trail: drifting glowing white feathers, loop
7. Halo: a rotating golden halo seen from the 3/4 angle, loop

**Shared effects** (one sheet for everyone)
1. Hit spark (white)
2. Critical hit (big yellow-white star with lines)
3. Shield block (blue sparks off a curved line)
4. Dust puff under feet
5. Death burst (red sparks and fading glyph-like shards)
6. Water splash (ripples and droplets)
7. Waystone teleport (violet column of light)
8. Kill streak flare (golden ring)

---

## 3. Monsters

### Prompt E: boss sheet (Gorrath, the Hollow King)
Green background, like the characters.
```
Create a pixel-art boss sprite sheet on a pure flat chroma-green background (#00FF00), 4 rows × 6 cells, labelled rows, same scale and foot position in every cell, 3/4 top-down RPG camera.
The boss: Gorrath, the Hollow King, a colossal horned demon of black volcanic rock with molten orange cracks, two curved bone-white horns, glowing yellow eyes, a jaw full of molten teeth, a cracked lava chest, massive clawed arms, tattered dark-red banners hanging from his belt. No green anywhere on him.
Row 1 IDLE / WALK: breathing idle (2), heavy walk cycle (4)
Row 2 SLAM: raising both fists (2), smashing the ground (2), fists in a crater (2)
Row 3 BREATH and SUMMON: head rearing back with glowing throat (2), breathing fire forward (2), arms spread roaring as imps are summoned (2)
Row 4 ENRAGED / HIT / DEATH: enraged with flames pouring from the cracks (2), flinching from a hit (1), collapsing and crumbling into lava rock (3)
No text inside the cells, nothing crosses the cell borders.
```

### Prompt F: imp sheet
```
Pixel-art sprite sheet, pure flat chroma-green background (#00FF00), 3 rows × 6 cells, same scale and foot position, 3/4 top-down RPG camera.
A small fire imp: red-orange skin, little bat wings, stubby horns, glowing yellow eyes, a molten belly, claws. No green on it.
Row 1 WALK: facing right, 6-frame walk cycle
Row 2 ATTACK: claw wind-up (2), swipe (2), recover (2)
Row 3 HIT and DEATH: flinch (1), burst into embers and smoke (5)
```

### Boss effects (Prompt D, black background)
1. Slam warning: a red ground ellipse filling in (6 frames)
2. Slam shockwave: a cracked-ground ring blasting outward
3. Fire breath: a widening cone of flame pointing right, loop
4. Meteor-rain warning circle (red) + falling meteor + impact
5. Summoning portal: a dark-purple ground circle that opens and closes

---

## Tips

- **Same scale every frame.** If one frame is bigger or the feet move, the animation will jitter. Regenerate just that row.
- **Green bodies, black effects.** Don't put green on bodies, because the green screen would cut holes in them. Black is fine everywhere on effect sheets.
- **Effects should be bright.** Additive light makes dim colours vanish. Saturated cores fading to black look best.
- **Keep the red cloth** on every character, so each player still gets their own colour.
- **Projectiles face right.** The game rotates them to the direction of travel.
- **Ask for a 2× bigger image** if the model allows it. More pixels per frame gives cleaner ASCII.
