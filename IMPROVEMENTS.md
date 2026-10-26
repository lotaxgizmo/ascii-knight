# Gizmo Knight: how to make it better

A long, concrete wish list grounded in how the game works today. Each idea says **what** it is, **why** it helps, and roughly **how** it fits the current code. Ideas are grouped by area, and a suggested order to build them is at the end.

Legend: 🟢 small (an hour or two) · 🟡 medium (an afternoon) · 🔴 large (a few days)

---

## 1. Combat feel (applies to everyone)

Most of a brawler's fun comes from how hits *feel*. The game already has hitstop, shake, damage numbers and flashes. These build on that.

- 🟢 **Directional hit reactions.** A victim slides a little away from the hit and flinches (stagger frames). The `knock` system from Shield Charge already exists: give every melee hit a tiny shove (4–6 cells/s), and a big one on crits.
- 🟢 **Crit feedback.** Crits get their own sound layer (a high "ting"), a white flash on the target and a bigger, slower damage number. Today a crit only shows as `123!`.
- 🟢 **Kill confirm.** On a kill, add 120 ms of slow motion (scale `dt` by 0.35), a soft ring of light where the enemy died, and a distinct "ka-ching" layered over the hit sound.
- 🟡 **Animation cancelling rules.** Let a dash cancel the last 40% of any swing or cast recovery. Let a swing cancel a dash's get-up. This gives skilled players "tech" without changing the basics.
- 🟡 **Perfect dodge.** A dodge that starts within 120 ms before a hit lands refunds 50% of the dash cooldown, gives +10 MP and shows "PERFECT". It rewards reading opponents instead of mashing.
- 🟡 **Perfect block (parry).** Raising the shield within 150 ms of a hit reflects 30% of the damage, staggers the attacker for 0.4 s and plays a bright "clang" spark. The Knight could get a wider parry window as part of his identity.
- 🟡 **Elemental interactions** (the big one for depth):
  - Fire + Ooze → **combustion**: the ooze puddle explodes.
  - Lightning + Water → **conduction**: a bolt landing in water arcs to everyone standing in it.
  - Frost (a future class) + Fire → **steam cloud** that blocks vision like the Shadow's smoke.
  - Holy + Necro → **purge**: Holy damage destroys minions instantly.
  - Arcane + Arcane → **resonance**: a second arcane hit within 1 s deals +25%.
  - The code already tags damage with a `kind` (`fire`, `shock`, `holy`, `arcane`, `necro`, `poison`…), so a small `REACTIONS` table keyed by `(residue kind, incoming kind)` in `damage()` / `addResidue()` covers most of this.
- 🟡 **Status effects as first-class objects.** Burn, chill (slow), shock (brief stun on the 3rd stack), bleed, weaken, silence. Show them as tiny icons over heads, sync them in the state array, and decay them on the victim's client.
- 🔴 **Server-side-feel hit validation.** "Owner decides hits" is snappy but trusting. See §8 for light anti-cheat that fits peer-to-peer.

## 2. Class-by-class upgrades

Every class now has a unique kit, dash and signature. The next layer is **choice**: pick one of two variants per ability before a match (a "talent" or "rune" in Diablo / Lost Ark terms). It's cheap to add because spells are plain objects in `KITS`.

### ⚔ Knight (pure physical, wide AoE)
- **Talent (Summon Blades):** *Barrage* (today's volleys) **or** *Blade Wall*, a ring of swords stuck in the ground around him for 3 s that blocks projectiles.
- **Talent (Crescent Wave):** *Twin Moon*, two crossing waves **or** *Riptide*, a slow wave that drags enemies with it.
- **Judgment upgrade:** charge it fully to call **three** pillars in a line toward the aim.
- **Valor meter:** each melee hit fills Valor; at 100 the next Whirlwind becomes **Cyclone**, a 2 s spinning hurricane that pulls enemies in. It gives the Knight a moment to build toward.
- **Shield bash on block:** pressing slash while blocking does a short-range bash that stuns for 0.3 s.
- **Banner** (ultimate idea): plants a banner giving nearby allies +15% damage in raids.

### ⚒ Berserker (fire brute)
- **Rage resource:** taking or dealing damage builds Rage (a red bar under HP). At full Rage, **Inferno Form**: +25% size, flaming sword trails, every swing leaves fire for 5 s.
- **Inferno Leap talent:** *Meteor Drop* (higher, slower, bigger crater) **or** *Skip* (two quick short leaps).
- **Eruption talent:** *Volcano* (lingers and spits fire globs) **or** *Shockwave* (instant, bigger knockback).
- **Throwable axe:** hold slash to throw his weapon. It boomerangs back, and he's unarmed (weaker punches) until it returns.
- **Execution:** enemies under 15% HP take double damage from his heavy combo finisher, with a special "EXECUTE" text.

### ✦ Sorcerer (arcane caster, teleports)
- **Spell weaving:** casting three different spells within 4 s triggers **Arcane Surge**: the next spell is free and 30% larger.
- **Phase Shift talents:** *Echo*, where the rift also fires a missile at the nearest enemy, **or** *Blink Strike*, landing on an enemy to daze them.
- **Meteor talent:** *Comet*, a fast line meteor **or** *Meteor Shower*, three small ones.
- **Mana shield:** a toggle that spends MP instead of HP at 1.5 MP per HP. It's a classic and fits the "deep mana" fantasy.
- **Time warp ultimate:** slows all projectiles in a bubble for 3 s.

### ☾ Shadow (assassin)
- **Marked for death:** the first hit from stealth marks a target. Marked targets take +20% from her for 5 s and show a skull above their head on her screen only.
- **Daggers talent:** *Fan of Knives* (wider, more knives) **or** *Poison Blade* (one dagger that poisons heavily).
- **Smoke Bomb talent:** *Decoy*, leaving a fake Shadow that walks forward (great with how stealth already renders) **or** *Blind*, where enemies inside see a darkened screen.
- **Wall-hop:** dashing into a wall rebounds her off it (a parkour feel).
- **Combo points:** daggers build points; Shadowstrike spends them for bigger hits.

### ☠ Necromancer (summoner)
- **Minion variety:**
  - Skeleton **archers**: ranged and fragile.
  - **Bone golem**: one big minion, costs 30% HP.
  - **Ghouls**: fast and leap at targets.
  - Pick the raise type with a talent, or hold the cast to cycle.
- **Corpses:** killed players and imps leave a corpse for 8 s. Raise Dead near a corpse creates a free, stronger minion. The classic Diablo II loop.
- **Bone Spear:** a piercing line projectile as an alternative to Soul Bolt.
- **Death Pact:** sacrifice all minions to heal for 10 HP each.
- **Minion commands:** a tap on the minimap or a key sets an "attack this target" order.
- **Lich form ultimate:** for 8 s his spells cost HP instead of MP and deal +50%.

### ✟ Angel (healer / light)
- **Allies matter in raids:** Radiance already heals raid allies. Add a **Guardian Bond**: link to one ally to take 30% of their damage for 6 s.
- **Holy Lance talent:** *Prism* (splits into three beams) **or** *Sunspear* (charged, longer, burns).
- **Starfall talent:** *Constellation*, stars that connect with beams between impact points.
- **Resurrection** (raid only): channel 2 s on a fallen ally to bring them back early at 50% HP.
- **Wings of Dawn:** while hovering over water or lava she regenerates 2 MP/s, rewarding her unique mobility.

### New class ideas
- ❄ **Frost Warden.** Ice walls (block movement and projectiles), freezing nova, an ice slide dash (fast on any surface), and Shatter (bonus damage vs frozen). Pairs well with the Frostmere map.
- 🏹 **Ranger.** Long-range charged shots, traps (snare, explosive), and a falcon companion that scouts (reveals stealth briefly).
- 🔨 **Paladin / Warden.** A slow, tanky hammer user. Consecrate ground, taunt bosses (raids need a tank!), a hammer throw that stuns.
- 🎵 **Bard.** Buffs through songs (aura zones), a sound-wave cone that knocks back, and a dash that is a dance step leaving music notes. A support for raids.
- 🌿 **Druid.** Shapeshift into a wolf (fast melee) or a bear (tank); roots and thorns.
- 🩸 **Blood Mage.** Every spell costs HP, not MP. Huge damage, life-steal, a risky glass cannon.

## 3. Boss Raid: make it a real event

- 🟡 **Phases.** At 66% and 33% HP the boss roars, becomes briefly immune, and the arena changes: lava cracks open on the ground (Ashen Wastes), ice spikes rise (Frostmere), or ghosts circle (Vale). New attacks unlock per phase.
- 🟡 **More boss attacks:**
  - *Grab*: picks up a player; others must hit his hand to free them.
  - *Spin*: rotating flame arms you must run around.
  - *Pillars*: indestructible stones fall; hide behind them from a room-wide blast.
  - *Ground pound chain*: three slams walking toward a target.
  - *Shield phase*: four imps channel a shield, and you must kill them to break it.
- 🟡 **A boss per map:**
  - **Gorrath** (Ashen Wastes, fire).
  - **The Frost Wyrm** (Frostmere): a long serpent body made of segments, breath that freezes.
  - **The Wailing Queen** (Moonlit Vale): a ghost who teleports, splits into clones, and drains life.
- 🟢 **Boss name plate and entrance.** Camera shake, a big title card, the music swelling (synthesize a low drone and drums with Web Audio).
- 🟡 **Loot and rewards** (see §6): the raid drops cosmetic shards, titles, and a rare "trophy" aura.
- 🟢 **Difficulty scaling.** HP already scales with player count. Also scale attack frequency, imp cap and enrage threshold by player count, and show "Heroic" when 5+ players join.
- 🟡 **Revive system.** In raids, downed players can be revived by allies standing near them for 2 s (instead of respawning), which encourages teamwork.
- 🟢 **Raid timer and grades.** Show the clear time and grade S/A/B/C by time and deaths. People love beating their record.
- 🔴 **Endless mode.** After the boss, waves keep coming with escalating imp types (shielded imps, bomber imps that explode, flying bats) until the team wipes. Show a "wave reached" leaderboard.

## 4. Maps and world

- 🟡 **Map hazards that matter:**
  - **Frostmere:** thin ice cracks if you stand still for 3 s and drops you into freezing water (slow + damage).
  - **Ashen Wastes:** lava geysers erupt on a telegraph every few seconds, and falling ash periodically reduces vision.
  - **Moonlit Vale:** fog banks drift through and hide nameplates; fireflies reveal stealthed players they touch.
- 🟡 **Weather and time of day.** Rain (darker ambient light, puddles that conduct lightning), thunderstorms (random lightning strikes that hurt anyone), sunrise and sunset color grading. The ambient color `AMB` and the mist color are already uniforms, so these are cheap.
- 🟡 **Destructible props.** Rocks and trees with HP. A Berserker can smash a path, and fire burns trees down (they become dead trees).
- 🟡 **Jump pads / wind gusts.** Glowing runes that launch you across the arena (reusing the Inferno Leap arc).
- 🟡 **Capture shrines.** Small zones that buff whoever holds them (damage, speed, mana) in FFA, so the map flow pushes fights to different places.
- 🔴 **More maps:**
  - **Sunken Temple:** shallow water everywhere, which slows everyone except the Angel, with pillars and narrow corridors.
  - **Sky Isles:** floating platforms over a void, where falling off means death. That makes knockback deadly and exciting.
  - **Crimson Marsh:** poison bogs and hanging vines.
  - **The Clockwork Ruin:** rotating walls that reshape the arena every 30 s.
- 🟢 **Map vote.** At the round break, show the next three maps and let players vote (the host counts). It's more agency than a fixed rotation.
- 🟢 **Minimap pings.** Hold a key or long-press on the minimap to drop a ping that allies see (raid callouts).

## 5. Modes

- 🟡 **Team Deathmatch** (code still exists, just hidden): re-enable it with auto team balance by class mix.
- 🟡 **King of the Hill:** hold the Stone Circle to earn points; the circle moves every 60 s.
- 🟡 **Capture the Relic:** one relic in the middle. Carrying it slows you and reveals you on everyone's minimap; score by bringing it to your shrine.
- 🔴 **Last Knight Standing (mini battle royale):** one life each and a shrinking ring of purple fog. Waystones become one-time escape teleports.
- 🟡 **Duel / 1v1 queue:** two players get a private mini-arena while others spectate (spectating means the camera follows another player, which is easy since all positions are known).
- 🟡 **Survival:** co-op waves without a boss, wave 1 to infinity.
- 🟢 **Practice room:** re-enable the old Practice mode (dummies exist) for learning combos.
- 🟡 **Custom lobby code:** `?room=abc123` puts friends in a private realm. The room name is already a parameter in `connect()`.

## 6. Progression without accounts

There's no login, so progress lives in `localStorage`. It can still feel rewarding.

- 🟢 **Profile card:** total kills, raid clears, favorite class and hours played, shown in the lobby.
- 🟡 **Cosmetics unlocked by playing:**
  - Cape colors are already per-player palette colors; add patterns too: stripes, flame trim, starfield.
  - Weapon trails: fire, ice, rainbow, shadow.
  - Auras: crown of embers, orbiting runes, falling petals.
  - Titles shown under the name: "Bane of Gorrath", "Untouchable", "Necro Lord".
- 🟡 **Class mastery levels:** each class levels separately (XP already exists). Levels unlock talents (§2) and cosmetics, never raw stats, so matches stay fair.
- 🟢 **Daily challenges:** for example "Win a raid without dying" or "Get 5 backstabs". They're generated from the date, so everyone gets the same ones without a server.
- 🟢 **Achievements** with toast popups.
- 🔴 **Optional cloud save:** a "save code" export/import string so players can move profiles between devices with no account.

## 7. UI / UX

- 🟢 **Ability tooltips with numbers** (damage, cost, cooldown) on hover and long-press.
- 🟢 **Cooldown text** on buttons when over 1 s (today it's only a dark overlay).
- 🟢 **Class preview in the lobby:** a small animated knight in the class tint with its aura, beside the class card.
- 🟡 **Tutorial island:** a 60-second guided intro (move, slash, charge, dash, spell) using the dummies.
- 🟡 **Settings panel:** volume sliders (music, effects, ambience), screen-shake strength, damage-number size, reduced flashes (accessibility), colorblind palettes for teams and enemies, key rebinding.
- 🟢 **Emote wheel:** wave, bow, laugh, taunt; text emotes over the head, sent as a small `fx`.
- 🟢 **Quick chat:** "Help!", "Boss is enraged!", "Group up!", "GG". Players have no keyboard chat on phones, so this matters.
- 🟢 **End-of-round summary:** MVP, most damage, most healing (Angel), most minion kills (Necromancer) and a funny stat ("fell in lava 3 times").
- 🟡 **Spectator camera on death:** follow your killer for the 3.5 s respawn timer (a Killcam-lite).
- 🟢 **Off-screen boss and objective pointers:** pointers already exist for knights; add the boss and imps.
- 🟡 **Better touch controls:**
  - Drag-to-aim on spell buttons (release to cast in the dragged direction), like Wild Rift / Brawl Stars.
  - Auto-aim assist toggle.
  - Button layout editor.

## 8. Netcode and fairness

- 🟡 **Snapshot interpolation tuning:** buffer 2–3 states and interpolate at `now − 100 ms` with an adaptive delay based on measured jitter per peer. Extrapolate up to 150 ms when packets are late, then freeze.
- 🟡 **Delta compression:** send state fields only when they change, and pack `st` as a typed array (Int16 positions, Uint8 hp%) to cut bandwidth by about 60%. This matters on the Nostr relay fallback.
- 🟡 **Lag-compensated hits:** when deciding a hit, the attacker rewinds the target to where the attacker saw them (they already do implicitly), and the victim rejects hits more than 250 ms old or from more than 1.5× weapon reach away.
- 🟡 **Light anti-cheat for P2P:**
  - Victims sanity-check incoming damage (cap per hit by class and kind, cap per second).
  - The host checks claimed kills against hit logs.
  - Ignore impossible movement speed (more than 2× sprint).
  - None of this is bulletproof, but it stops casual console cheating.
- 🟡 **Host migration polish:** the new host inherits the boss's HP already. Also hand over the imp positions and the boss's current attack so a migration is invisible.
- 🟡 **Region-aware relays:** ping the relay list on start and prefer the fastest four.
- 🟢 **Network HUD:** a small ping and packet-loss indicator per player (color-coded dot on the scoreboard).
- 🔴 **Optional dedicated relay:** if the player count grows, a tiny WebSocket relay on a free tier (Fly.io, Deno Deploy) beats public Nostr relays for latency, while P2P stays as the primary path.

## 9. Performance (phones first)

The game already has adaptive quality, glyph caching, lazy sprite baking and capped particles. Next steps:

- 🟡 **OffscreenCanvas + worker for world generation:** map switches would stop blocking the main thread (they take 0.5–2 s on phones today). Generate `COL`/`MAT`/`BLK` in a worker and transfer the buffers.
- 🟡 **Pre-generate the three maps** in the background after the lobby loads, so switching is instant (≈2.6 MB each in memory).
- 🟢 **Particle pooling:** reuse particle objects instead of pushing new ones. Garbage collection on phones causes the occasional hitch.
- 🟢 **Batch glows:** draw all glows of the same color in one pass with a shared radial gradient sprite (already sprite-based; add an atlas).
- 🟡 **Overlay layer split:** draw static-ish things (waystones, nameplates) at half rate.
- 🟢 **Frame pacing on 120 Hz phones:** cap at 60 to save battery unless the device is plugged in (Battery Status API where available).
- 🟢 **Tab-hidden throttling:** when hidden, run the network at 5 Hz and skip mob AI except for the host.
- 🟡 **Profiling HUD (`?perf`):** a frame-time graph plus counts of particles, lights, glyph draws and network messages per second, so regressions are obvious.

## 10. Audio

- 🟡 **Music:** a generative soundtrack per map (Web Audio).
  - Vale: soft harp arpeggios.
  - Ashen Wastes: low drums and drones.
  - Frostmere: glassy bells.
  - The music builds intensity when enemies are near or the boss is enraged.
- 🟢 **Class voice "barks"** as synthesized grunts and short melodic stings on kills or ultimates.
- 🟢 **Positional audio for the boss:** footsteps that shake (low thumps) and get louder as he approaches.
- 🟢 **Audio cues for telegraphs:** a rising whine during a boss wind-up helps players react without looking.

## 11. Visual polish

- 🟢 **Knight sprite per class:** a different weapon silhouette per class: an axe for the Berserker, a staff for the Sorcerer and Necromancer, daggers for the Shadow, a spear of light for the Angel. Overlay a small glyph-drawn weapon on top of the existing sprite.
- 🟡 **Hit sparks per material:** steel on steel is white, bone is grey chips, imp flesh is orange embers.
- 🟡 **Death animations:** shatter into glyphs that fall and fade, colored by class.
- 🟢 **Footprints** in snow (Frostmere) and ash (Ashen Wastes) that fade over 5 s.
- 🟡 **Water reflections:** mirror nearby glyphs faintly in water cells (the shader already knows water).
- 🟢 **Screen-space color grade per map:** warmer for the Wastes, colder for Frostmere (the second shader pass already grades).
- 🟡 **Boss animation frames:** two or three ASCII poses (idle, wind-up, slam) instead of one sprite plus bob.

## 12. Code health

- 🔴 **Split `main.js` (≈3,500 lines) into modules:** `world/`, `render/`, `combat/`, `classes/`, `mobs/`, `net/`, `ui/`. Vite already bundles, so it's free at runtime and makes every idea above easier.
- 🟡 **Data-driven classes:** move `CLASSES`, `KITS`, `DASHES` and mob definitions into JSON-like config so balancing doesn't need code reading.
- 🟡 **Automated smoke tests:** a Playwright script that opens two tabs, joins, casts every spell, checks no console errors, and checks that state and mobs sync.
- 🟢 **Balance sheet:** a generated table (DPS per class at 0/50/100% charge, time-to-kill vs each class) to spot outliers quickly.
- 🟢 **Version banner:** show the build hash in the lobby so players can tell if they're on the latest version.

## 13. Balance targets (rules of thumb)

- **Time to kill:** 4–6 s of sustained focused damage on a full-HP target with no dodges; 2–3 s with a perfect combo. One-shots should only come from fully charged, telegraphed spells.
- **Mana loop:** a player should be able to cast a basic spell about every 2 s indefinitely, and a full-charge spell about every 15–20 s.
- **Mobility:** every class gets one "get out" tool with a meaningful cost (mana, HP or a cooldown).
- **Summons:** minions should deal about 25–35% of the Necromancer's total damage so he isn't just an AFK pet class.
- **Healing:** in FFA, self-heal should not exceed about 20% of incoming damage in a fight, or fights never end.
- **Raids:** with 3 players, a clear should take 3–5 minutes with 2–4 deaths total.

---

## Suggested order

1. **Feel first** (§1): crit feedback, kill confirm, perfect dodge and parry. Small changes, big impact on every match.
2. **Settings and touch aiming** (§7): reduced flashes, volume, drag-to-aim. Phones are a big part of the audience.
3. **Raid phases plus revive** (§3): turns Boss Raid from a fight into an event.
4. **Elemental reactions and status effects** (§1): the depth layer that makes six classes play off each other.
5. **Talents per ability** (§2): replay value without new art.
6. **Map vote, weather and hazards** (§4).
7. **Cosmetic progression and daily challenges** (§6): reasons to come back tomorrow.
8. **New classes and bosses** (§2, §3).
9. **Netcode polish and light anti-cheat** (§8) as the player count grows.
10. **Split `main.js` into modules** (§12) before the codebase gets much bigger.
