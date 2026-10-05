# Bullet combat verification

Date: 2026-10-05. Scope: add dodgeable bullet patterns and improve combat feedback in the existing Unity client. Verdict: PASS in the Unity Editor.

Implemented actual friendly/enemy projectile movement and swept collision in BattleRun, three-shot aimed scout volleys, alternating nine-shot boss fans and faster aimed bursts, impact-based player damage/kills/core, hit protection, dash timing, bounded projectile lifetimes/counts, and bounded movement. Scouts leave without granting rewards and automatic fire prioritizes the nearest threat. Existing server session statistics and reporting payloads remain the source of player/boss stats and server reward confirmation.

ClientBattle renders projectile resources from the supplied artwork, a small player collision-center marker, firing telegraphs, damage flashes, invulnerability, dash frames, and kill explosions. BattleArenaInput handles arena pointer down/drag/release; keyboard A/D/arrows and Space are connected to the real update loop. The compact portrait layout renders both dash controls and the bottom session actions without scrolling at 540 x 960.

Unity 6000.6.4f1 compiled the changed source successfully. BattlePatternVerification.Verify returned `BULLET_TESTS_PASS: 20 checks`. Checks cover swept collision, near misses, clustered-hit protection, dash invulnerability/cooldown, movement speed/bounds, invalid input, bullet expiry, scout escape without rewards, aimed scout volleys, travel before friendly impact, kill/core recording, boss fan directions/alternation, count limits, deterministic patterns, and stall clamping.

Observed real Play Mode interactions:

- Arena input pointer handlers drove the player to x=110; real updates advanced time, projectiles, kills, and HP while moving.
- A queued A-key state followed by an actual single Unity frame moved the player to x=-7.199995. The key state was released afterward.
- The right dash button moved x=-7.199995 to x=92.8, granted invulnerability, and set a 0.75-second cooldown. A repeated button click during that cooldown did not move the player again.
- A controlled local projectile hit reduced HP from 174 to 167 and activated hit flash/protection in the actual renderer.

Final fresh PNG captures, all 540 x 960, inspected individually:

| File under `unity/IdleGameClient/Captures` | Verified state |
| --- | --- |
| `bullet-final-fan.png` | Boss fan, aimed scout bullets, friendly homing shots, player marker, HUD, and practice controls. At this state: 38 bullets, 3 kills, HP 174. |
| `bullet-final-dash.png` | Accepted dash at x=100, dash artwork, visible cooldown, invulnerability presentation. |
| `bullet-final-hit.png` | Red player damage flash, HP 167, active protection. |
| `bullet-final-session-controls.png` | Normal retry/abandon footer alongside both dash buttons; network explicitly blocked for this local rendering fixture. |

Self-review follows visual-qa's Codex compatibility default. UI components are live reused Images/Text/layouts, not a screenshot replacing gameplay. PNG signatures/dimensions were checked. Source artwork and alpha are reused. No Korean glyph clipping or hidden combat controls was observed in the final captures. `git diff --check` passed.

Capture-pipeline defects were corrected: newly created layout needed to settle/rebuild before reading unit positions, and the installed CanvasScaler uses OnEnable/Handle rather than an Update receiver. The capture utility now re-enables the scaler. After preserving the earlier diagnostic output and clearing the console, all four final captures produced zero console errors. Earlier manual input checks reached the practice time limit and were restarted using paused single-frame checks; those failures were test timing, not a game exception.

All runtime QA used an explicitly labeled Editor-only practice battle and local fixtures. No real server battle, reward claim, or API request was made by practice mode. Actual server completion/rewards and Android/device controls are not verified by this work. Unrelated untracked projects and library backups were preserved.
