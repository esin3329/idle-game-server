# Mecha asset application verification

Date: 2026-10-04. Project: `unity/IdleGameClient`. Verdict: PASS for the asset integration scope.

The supplied PNG was copied to `Assets/Resources/Art/MechaSheet.png`. Original and project copy both have SHA-256 `1cb9deec56a783e03b8b6de106402bf1edb535272e801ed764c61bb5a063af44`, preserving every source pixel and alpha value. Source labels are not instructions or game UI. The original faint edge/background pixels are retained.

The importer registers 47 named sprites. Unity 6000.6.4f1 successfully compiled the changed C# code and verified all 47 sprites load with positive dimensions and point filtering. Import settings preserve 1536 x 1024 dimensions, alpha, and uncompressed texture data, with mipmaps disabled.

Four fresh 540 x 960 PNG captures were generated in Play Mode by the real ClientApp UI, rendered through a camera to a render texture:

| Capture in `unity/IdleGameClient/Captures` | Observed result |
| --- | --- |
| `mecha-login-final.png` | Front mecha replaces the primitive preview; fields and Korean labels remain readable. |
| `mecha-base-final.png` | The shared base preview displays the same front mecha with preserved proportions. This checks the preview component, not authenticated balances. |
| `mecha-battle-final.png` | Rear player, red scout, purple boss, and HP captions render independently inside the arena. |
| `mecha-dodge-shot-final.png` | An accepted left dodge changes position to -100 and displays the mirrored dash sprite; one simulation shot shows the upward blue effect. Spawned sprites and HP captions remain inside the arena. |

The isolated batch check finished with `MECHA_ASSET_VERIFICATION_PASS: 47 sprites; login/base/battle/dodge-shot rendered. No network requests.` There were no C# compiler errors or game exceptions. A licensing access-token warning was emitted by Unity before verification and did not prevent execution.

Self-review followed the visual-qa skill's Codex compatibility default. The live UI uses reusable Image components and sprite resources rather than a screenshot replacing the UI. Fresh captures were opened and inspected. The base capture was additionally inspected alone and its sprite area checked from PNG pixels after a multi-image preview omitted that region; the saved PNG contains the artwork. All files have valid PNG encoding and expected dimensions. Enemy sprite and caption margins were corrected during visual inspection. `git diff --check` passed.

These are local rendering fixtures, not a real server battle or reward verification. Android/device rendering, all unused atlas frames, and full battle completion were not tested. Existing unrelated untracked Unity projects, captures, and library backups were left intact. No scene or server balance was saved or changed by verification.
