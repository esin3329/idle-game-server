# Mecha artwork

## Survival combat sheets

`EnemySheet.png` (1536 x 1024), `CombatEffects.png` (1774 x 887), and `RuinsSheet.png` (1536 x 1024) are the three additional user-provided sheets, copied without pixel or alpha changes. Embedded headings and example scenes are reference material, not game UI.

`CombatSheetImporter` defines 64 enemy animation frames (four unit types, four states, four frames), 10 projectile/muzzle/metal-impact sprites, and 23 terrain/decoration sprites. The battle uses dedicated guard, rifle, armored and machine-gun art; movement, actual ranged shots, hits and deaths drive animation. Guards still deal contact damage only. Ruins are decorative and do not alter movement or collision.

Unity validation is deferred at the user's request. Later, run `Idle Game > Verify Combat Assets` (or `IdleGame.Editor.CombatSheetImporter.Verify` in batch mode), then `BattlePatternVerification.Verify` and a play-mode review of sprite boundaries, animation, effects and terrain. The asset check has been provided but has not been executed for these sheets.

`MechaSheet.png` is the user-provided 1536 x 1024 PNG, copied without modifying its pixels or alpha channel. Its embedded text is reference labeling, not application UI.

`MechaSheetImporter` imports 47 named sprites with point filtering, no mipmaps, no compression, and preserved source dimensions. The rectangles use top-left source coordinates and exclude section headings and frame captions. The source contains faint fringes and background pixels; these are preserved.

`MechaArt.Get(name)` loads the imported sprites. Login and base use `front`; battle uses `back`, `red`, `purple`, `dash1` through `dash3`, and `jet`. Dodge frames respond to an accepted dodge, and the muzzle effect responds to an actual simulation shot. Remaining poses, color variants, weapons, and effects are imported for subsequent game features.

Run the isolated Unity rendering check with a separate batch editor, while this project is closed in the interactive editor:

```powershell
& 'C:\Unity\Editors\6000.6.4f1\Editor\Unity.exe' -batchmode -projectPath 'C:\Unity\Projects\idle-game-server\unity\IdleGameClient' -executeMethod IdleGame.Editor.MechaAssetVerification.Run -logFile 'C:\Unity\Projects\idle-game-server\.tools\mecha-art-qa.log'
```

The check validates sprite imports and renders the actual login, base preview, battle, and dodge/shot UI to `Captures/mecha-*.png`. Battle inputs are local rendering fixtures; the check makes no server requests and grants no rewards.
