using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using IdleGame.Network;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace IdleGame
{
    public sealed partial class ClientApp
    {
        private BattleRun battle;
        private RectTransform arena, pilot;
        private Text battleHud;
        private readonly Dictionary<BattleRun.Enemy, RectTransform> enemyViews = new Dictionary<BattleRun.Enemy, RectTransform>();
        private readonly Dictionary<BattleRun.Bullet, RectTransform> bulletViews = new Dictionary<BattleRun.Bullet, RectTransform>();
        private readonly List<BattleEffect> battleEffects = new List<BattleEffect>();
        private readonly Queue<BattlePacket> packets = new Queue<BattlePacket>();
        private int sentKills, sentCore, sentBosses, battleSequence;
        private float nextReport;
        private bool battleNetworkBusy, battleNetworkFailed, battleFinishing;
        private string finishKey;
        private object finishReport;
        private Image pilotArt, muzzleArt;
        private int visibleShots;
        private float muzzleUntil, dodgeUntil;
        private int dodgeDirection;
        private bool draggingPilot, battlePreview;
        private const int PracticeUpgradeCoreStep = 50;
        // In-battle upgrade selection: the simulation stays paused while the modal (or its offer request) is pending.
        private bool battlePausedForUpgrade, upgradeSelecting, battleUpgradesUnsupported;
        private JToken upgradeOffer;
        private RectTransform upgradeModal;
        private Text upgradeStatus;
        private string pendingUpgradeOfferKey, pendingUpgradeSelectKey, pendingUpgradeSelectCode;
        private int resolvedUpgradeLevel, nextPracticeUpgradeCore = PracticeUpgradeCoreStep, practiceUpgradeLevel = 1;
        private Vector2 pilotTarget;
        private RectTransform hitMarker;

        private sealed class BattleEffect
        {
            public RectTransform View;
            public float Until;
            public float Started;
            public string Animation;
        }

        private sealed class BattlePacket
        {
            public object Body;
            public string Key = Guid.NewGuid().ToString();
        }

        private async Task StartPlayableStage(JToken stage)
        {
            var session = await api.StartBattle((string)stage["id"]);
            string id = (string)session["sessionId"] ?? (string)session["id"];
            try { battle = new BattleRun(stage, session); }
            catch
            {
                if (!string.IsNullOrEmpty(id)) await api.AbandonBattle(id);
                throw;
            }
            packets.Clear(); enemyViews.Clear(); bulletViews.Clear(); battleEffects.Clear();
            battlePreview = false; draggingPilot = false;
            sentKills = sentCore = sentBosses = battleSequence = 0;
            battleNetworkBusy = battleNetworkFailed = battleFinishing = false;
            nextReport = 5;
            finishKey = null; finishReport = null;
            visibleShots = 0; muzzleUntil = dodgeUntil = 0;
            ResetUpgradeState();
            DrawBattle();
        }

        private void DrawBattle()
        {
            Clear(battle.StageName);
            var layout = content.GetComponent<VerticalLayoutGroup>();
            layout.padding = new RectOffset(18, 18, 18, 18);
            layout.spacing = 8;
            content.GetChild(0).GetComponent<LayoutElement>().preferredHeight = 24;
            content.GetChild(1).GetComponent<LayoutElement>().preferredHeight = 38;
            content.GetChild(1).GetComponent<Text>().fontSize = 28;
            notice.GetComponent<LayoutElement>().preferredHeight = 36;
            notice.fontSize = 15;
            notice.text = "자동 사격 · 드래그 / WASD / 방향키 이동\n경비 → 소총 → 중갑·기관총 · 후반으로 갈수록 체력 증가";
            battleHud = Label("", 17, Accent, 50);
            arena = Box(content, "BattleArena", Panel);
            arena.gameObject.AddComponent<LayoutElement>().preferredHeight = Mathf.Clamp(safeArea.rect.height - 426, 300, 540);
            arena.gameObject.AddComponent<RectMask2D>();
            var input = arena.gameObject.AddComponent<BattleArenaInput>();
            input.MoveTarget = point => { draggingPilot = true; pilotTarget = new Vector2(point.x, point.y * 540 / arena.rect.height); };
            input.Release = () => draggingPilot = false;
            DrawBattleGround();
            pilot = Box(arena, "Pilot", Color.white);
            pilot.sizeDelta = new Vector2(68, 92);
            pilotArt = pilot.GetComponent<Image>();
            MechaArt.Apply(pilotArt, "back");
            pilot.anchorMin = pilot.anchorMax = new Vector2(.5f, .5f);
            pilot.anchoredPosition = BattlePosition(battle.PlayerX, battle.PlayerY);
            hitMarker = Box(pilot, "PilotHitCenter", Accent);
            hitMarker.anchorMin = hitMarker.anchorMax = new Vector2(.5f, .5f);
            hitMarker.sizeDelta = new Vector2(6, 6);
            hitMarker.GetComponent<Image>().raycastTarget = false;
            var muzzle = Box(arena, "PilotMuzzle", Color.white);
            muzzle.anchorMin = muzzle.anchorMax = new Vector2(.5f, .5f);
            muzzle.sizeDelta = new Vector2(38, 22);
            muzzle.localRotation = Quaternion.Euler(0, 0, 180);
            muzzleArt = muzzle.GetComponent<Image>();
            MechaArt.Apply(muzzleArt, "fx-muzzle-0");
            muzzleArt.enabled = false;
            var dashes = BattleButtonRow(50);
            BattleButton(dashes, "왼쪽 대시", () => DodgePilot(-1), true);
            BattleButton(dashes, "오른쪽 대시", () => DodgePilot(1), true);
            var actions = BattleButtonRow(44);
            if (battlePreview) BattleButton(actions, "연습 종료 · 보상 없음", EndBulletPreview);
            else
            {
                BattleButton(actions, "연결 재시도", () => Run(RetryBattle));
                BattleButton(actions, "출격 포기", () => Run(AbandonPlayableBattle));
            }
        }

        private void DrawBattleGround()
        {
            for (int row = 0; row < 5; row++)
                for (int col = 0; col < 4; col++)
                {
                    var tile = Box(arena, "RuinedGround", Color.white);
                    tile.anchorMin = new Vector2(col / 4f, row / 5f);
                    tile.anchorMax = new Vector2((col + 1) / 4f, (row + 1) / 5f);
                    tile.offsetMin = tile.offsetMax = Vector2.zero;
                    var image = tile.GetComponent<Image>();
                    MechaArt.Apply(image, "ground-" + (row * 4 + col));
                    image.preserveAspect = false;
                    image.color = new Color(.5f, .5f, .5f, 1);
                }
            string[] props = { "ruin-rubble", "ruin-crates", "ruin-barrel" };
            Vector2[] anchors = { new Vector2(.12f, .88f), new Vector2(.9f, .12f), new Vector2(.08f, .3f) };
            for (int i = 0; i < props.Length; i++)
            {
                var prop = Box(arena, props[i], Color.white);
                prop.anchorMin = prop.anchorMax = anchors[i];
                prop.anchoredPosition = Vector2.zero;
                prop.sizeDelta = i == 0 ? new Vector2(90, 64) : new Vector2(42, 50);
                MechaArt.Apply(prop.GetComponent<Image>(), props[i]);
                prop.GetComponent<Image>().color = new Color(.65f, .65f, .65f, 1);
            }
        }

        private RectTransform BattleButtonRow(float height)
        {
            var row = Box(content, "BattleActions", Color.clear);
            row.gameObject.AddComponent<LayoutElement>().preferredHeight = height;
            var layout = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.spacing = 10;
            layout.childControlWidth = layout.childControlHeight = true;
            layout.childForceExpandWidth = layout.childForceExpandHeight = true;
            return row;
        }

        private void BattleButton(Transform parent, string caption, Action action, bool primary = false)
        {
            var root = Box(parent, caption, primary ? Accent : Background);
            var button = root.gameObject.AddComponent<Button>();
            button.onClick.AddListener(() => action());
            var obj = new GameObject("Caption", typeof(RectTransform), typeof(Text));
            obj.transform.SetParent(root, false);
            var label = obj.GetComponent<Text>();
            label.font = font; label.text = caption; label.fontSize = 18;
            label.color = primary ? Background : Color.white;
            label.alignment = TextAnchor.MiddleCenter; label.raycastTarget = false;
            Stretch(label.rectTransform);
        }

        private Vector2 BattlePosition(float x, float y)
        {
            return new Vector2(x, y * arena.rect.height / 540);
        }

        private void ReadBattleInput()
        {
            if (battleNetworkFailed) return;
            var keyboard = Keyboard.current;
            Vector2 direction = Vector2.zero;
            if (keyboard != null)
            {
                if (keyboard.aKey.isPressed || keyboard.leftArrowKey.isPressed) direction.x--;
                if (keyboard.dKey.isPressed || keyboard.rightArrowKey.isPressed) direction.x++;
                if (keyboard.wKey.isPressed || keyboard.upArrowKey.isPressed) direction.y++;
                if (keyboard.sKey.isPressed || keyboard.downArrowKey.isPressed) direction.y--;
                if (keyboard.spaceKey.wasPressedThisFrame) DodgePilot(direction.x < 0 ? -1 : 1);
            }
            direction = direction.normalized * battle.CurrentMoveSpeed * Mathf.Min(Time.unscaledDeltaTime, .1f);
            if (direction != Vector2.zero) battle.MoveTo(battle.PlayerX + direction.x,
                battle.PlayerY + direction.y, Time.unscaledDeltaTime);
            else if (draggingPilot) battle.MoveTo(pilotTarget.x, pilotTarget.y, Time.unscaledDeltaTime);
        }

        private void DodgePilot(int direction)
        {
            if (battle == null || battleNetworkFailed || battleFinishing || battlePausedForUpgrade) return;
            float previous = battle.PlayerX;
            battle.Dodge(direction);
            if (battle.PlayerX == previous) return;
            dodgeDirection = direction;
            dodgeUntil = battle.Elapsed + .25f;
            pilotTarget = new Vector2(battle.PlayerX, battle.PlayerY);
        }

        private void TickBattle()
        {
            if (battle == null || !arena || battleFinishing) return;
            if (!battlePausedForUpgrade)
            {
                ReadBattleInput();
                if (!battleNetworkFailed) battle.Tick(Time.unscaledDeltaTime);
            }
            pilot.anchoredPosition = BattlePosition(battle.PlayerX, battle.PlayerY);
            bool dodging = battle.Elapsed < dodgeUntil;
            MechaArt.Apply(pilotArt, dodging ? "dash" + (1 + (int)(battle.Elapsed * 12) % 3) : "back");
            pilot.localScale = new Vector3(dodging && dodgeDirection < 0 ? -1 : 1, 1, 1);
            pilotArt.color = battle.HitFlash ? new Color32(255, 120, 100, 255) :
                new Color(1, 1, 1, battle.IsInvulnerable && (int)(battle.Elapsed * 24) % 2 == 0 ? .45f : 1);
            hitMarker.GetComponent<Image>().color = battle.IsInvulnerable ? Color.white : Accent;
            if (battle.ShotsFired != visibleShots)
            {
                visibleShots = battle.ShotsFired;
                muzzleUntil = battle.Elapsed + .12f;
            }
            muzzleArt.enabled = battle.Elapsed < muzzleUntil;
            if (muzzleArt.enabled) MechaArt.Apply(muzzleArt,
                "fx-muzzle-" + Mathf.Clamp((int)((battle.Elapsed - muzzleUntil + .12f) * 25), 0, 2));
            muzzleArt.rectTransform.anchoredPosition = BattlePosition(battle.PlayerX + battle.AimX * 45,
                battle.PlayerY + battle.AimY * 45);
            muzzleArt.rectTransform.localRotation = Quaternion.Euler(0, 0,
                Mathf.Atan2(battle.AimY * arena.rect.height / 540, battle.AimX) * Mathf.Rad2Deg);
            battleHud.text = $"{Mathf.FloorToInt(battle.Elapsed)} / {battle.Duration}초   HP {battle.Hp:0} / {battle.MaxHp:0}{(battle.ShieldHp > 0 ? $" · 보호막 {battle.ShieldHp:0}" : "")}\n처치 {battle.Kills} · 코어 {battle.Core} · 대시 {(battle.DodgeCooldown > 0 ? battle.DodgeCooldown.ToString("0.0") + "초" : "준비")} · 강화 {battle.AppliedUpgrades.Count}";
            foreach (var enemy in battle.Enemies)
            {
                if (!enemyViews.TryGetValue(enemy, out var view))
                {
                    view = Box(arena, enemy.Name, Color.white);
                    MechaArt.Apply(view.GetComponent<Image>(), enemy.BossId != null ? "purple" :
                        $"enemy-{enemy.Kind}-idle-0");
                    view.anchorMin = view.anchorMax = new Vector2(.5f, .5f);
                    view.sizeDelta = enemy.BossId != null ? new Vector2(90, 110) :
                        enemy.Kind == BattleRun.EnemyKind.Armored ? new Vector2(72, 88) : new Vector2(52, 64);
                    var caption = new GameObject("HP", typeof(RectTransform), typeof(Text));
                    caption.transform.SetParent(view, false);
                    var text = caption.GetComponent<Text>();
                    text.font = font; text.fontSize = 14; text.color = Color.white; text.alignment = TextAnchor.MiddleCenter;
                    text.rectTransform.anchorMin = text.rectTransform.anchorMax = new Vector2(.5f, 1);
                    text.rectTransform.sizeDelta = new Vector2(80, 20);
                    text.rectTransform.anchoredPosition = new Vector2(0, 12);
                    text.raycastTarget = false;
                    var spark = Box(view, "MetalHit", Color.white);
                    spark.anchorMin = spark.anchorMax = new Vector2(.5f, .5f);
                    spark.sizeDelta = new Vector2(42, 30);
                    MechaArt.Apply(spark.GetComponent<Image>(), "fx-metal-0");
                    spark.GetComponent<Image>().enabled = false;
                    enemyViews.Add(enemy, view);
                }
                float halfHeight = view.sizeDelta.y * .5f;
                float edge = arena.rect.height * .5f - halfHeight - 22;
                var position = BattlePosition(enemy.X, enemy.Y);
                position.y = Mathf.Clamp(position.y, -arena.rect.height * .5f + halfHeight, edge);
                position.x = Mathf.Clamp(position.x, -arena.rect.width * .5f + view.sizeDelta.x * .5f,
                    arena.rect.width * .5f - view.sizeDelta.x * .5f);
                view.anchoredPosition = position;
                if (enemy.BossId == null)
                {
                    float sinceShot = battle.Elapsed - enemy.LastShotAt;
                    string state = sinceShot < .32f ? "attack" : enemy.Moving ? "walk" : "idle";
                    int frame = state == "attack" ? Mathf.Min(3, (int)(sinceShot * 12)) : (int)(battle.Elapsed * 8) % 4;
                    MechaArt.Apply(view.GetComponent<Image>(), $"enemy-{enemy.Kind}-{state}-{frame}");
                }
                var hitArt = view.Find("MetalHit").GetComponent<Image>();
                float sinceHit = battle.Elapsed - enemy.LastHitAt;
                hitArt.enabled = sinceHit < .2f;
                if (hitArt.enabled) MechaArt.Apply(hitArt, "fx-metal-" + Mathf.Clamp((int)(sinceHit * 20), 0, 3));
                view.GetComponent<Image>().color = enemy.IsRanged && enemy.AttackWait < .35f ? new Color32(255, 190, 130, 255) : Color.white;
                view.GetComponentInChildren<Text>().text = enemy.BossId != null ? $"{enemy.Hp:0}" :
                    $"{(enemy.Kind == BattleRun.EnemyKind.Armored ? "중갑" : enemy.Kind == BattleRun.EnemyKind.MachineGun ? "기관총" : enemy.Kind == BattleRun.EnemyKind.Rifle ? "소총" : "경비")} {enemy.Hp:0}";
            }
            var removed = new List<BattleRun.Enemy>();
            foreach (var entry in enemyViews)
                if (!battle.Enemies.Contains(entry.Key))
                {
                    if (entry.Key.Hp <= 0)
                    {
                        var effect = Box(arena, "EnemyExplosion", Color.white);
                        string animation = entry.Key.BossId == null ? $"enemy-{entry.Key.Kind}-death-" : null;
                        MechaArt.Apply(effect.GetComponent<Image>(), animation == null ? "explosion" : animation + "0");
                        effect.anchorMin = effect.anchorMax = new Vector2(.5f, .5f);
                        effect.anchoredPosition = entry.Value.anchoredPosition;
                        effect.sizeDelta = entry.Key.BossId == null ? entry.Value.sizeDelta : new Vector2(110, 110);
                        battleEffects.Add(new BattleEffect { View = effect, Started = battle.Elapsed,
                            Until = battle.Elapsed + .4f, Animation = animation });
                    }
                    Destroy(entry.Value.gameObject); removed.Add(entry.Key);
                }
            foreach (var enemy in removed) enemyViews.Remove(enemy);
            DrawBullets();
            for (int i = battleEffects.Count - 1; i >= 0; i--)
            {
                if (battle.Elapsed >= battleEffects[i].Until)
                { Destroy(battleEffects[i].View.gameObject); battleEffects.RemoveAt(i); }
                else if (battleEffects[i].Animation != null)
                    MechaArt.Apply(battleEffects[i].View.GetComponent<Image>(), battleEffects[i].Animation +
                        Mathf.Clamp((int)((battle.Elapsed - battleEffects[i].Started) * 10), 0, 3));
            }
            if (battlePreview)
            {
                if (battle.Ended) EndBulletPreview();
                else if (!battlePausedForUpgrade && nextPracticeUpgradeCore <= battle.MaxCore &&
                    battle.Core >= nextPracticeUpgradeCore) OpenPracticeUpgrade();
                return;
            }
            if (battle.Elapsed >= nextReport || battle.BossesDefeated.Count > sentBosses || battle.Ended)
            {
                QueueProgress();
                nextReport = battle.Elapsed + 5;
            }
            if (!battleNetworkBusy && !battleNetworkFailed && (packets.Count > 0 || battle.Ended))
                _ = PumpBattle();
        }

        private void DrawBullets()
        {
            foreach (var bullet in battle.Bullets)
            {
                if (!bulletViews.TryGetValue(bullet, out var view))
                {
                    view = Box(arena, bullet.Friendly ? "PlayerShot" : "EnemyBullet", Color.white);
                    MechaArt.Apply(view.GetComponent<Image>(), bullet.BossShot ? "fx-pellet" :
                        bullet.Weapon == BattleRun.EnemyKind.MachineGun ? "fx-machine" : "fx-rifle");
                    view.anchorMin = view.anchorMax = new Vector2(.5f, .5f);
                    view.sizeDelta = bullet.BossShot ? Vector2.one * 16 : new Vector2(22, 12);
                    view.GetComponent<Image>().color = bullet.Friendly ? new Color32(150, 220, 255, 255) :
                        new Color32(255, 170, 100, 255);
                    bulletViews.Add(bullet, view);
                }
                view.anchoredPosition = BattlePosition(bullet.X, bullet.Y);
                view.localRotation = Quaternion.Euler(0, 0,
                    Mathf.Atan2(bullet.VelocityY * arena.rect.height / 540, bullet.VelocityX) * Mathf.Rad2Deg);
            }
            var removed = new List<BattleRun.Bullet>();
            foreach (var entry in bulletViews)
                if (!battle.Bullets.Contains(entry.Key)) { Destroy(entry.Value.gameObject); removed.Add(entry.Key); }
            foreach (var bullet in removed) bulletViews.Remove(bullet);
        }

#if UNITY_EDITOR
        public void BeginBulletPreview()
        {
            if (battle != null || busy) return;
            var stage = JObject.Parse("{\"name\":\"생존 연습 · 보상 없음\",\"durationSeconds\":60,\"maxKills\":40,\"bossTimings\":[30],\"bosses\":[{\"code\":\"practice\",\"name\":\"연습 보스\",\"hp\":1200,\"attackPower\":8}]}");
            var session = JObject.Parse("{\"id\":\"local-bullet-practice\",\"statSnapshot\":{\"maxHp\":200,\"attackPower\":8,\"attackSpeed\":240}}");
            battle = new BattleRun(stage, session);
            battlePreview = true; battleNetworkFailed = battleFinishing = false;
            draggingPilot = false; visibleShots = 0; muzzleUntil = dodgeUntil = 0;
            ResetUpgradeState();
            enemyViews.Clear(); bulletViews.Clear(); battleEffects.Clear(); packets.Clear();
            DrawBattle();
        }
#endif

        private void EndBulletPreview()
        {
            battle = null; battlePreview = false; draggingPilot = false;
            ResetUpgradeState();
            enemyViews.Clear(); bulletViews.Clear(); battleEffects.Clear(); packets.Clear();
            ShowLogin();
        }

        private void ResetUpgradeState()
        {
            if (upgradeModal) { upgradeModal.gameObject.SetActive(false); Destroy(upgradeModal.gameObject); }
            upgradeModal = null; upgradeStatus = null; upgradeOffer = null;
            battlePausedForUpgrade = upgradeSelecting = battleUpgradesUnsupported = false;
            pendingUpgradeOfferKey = pendingUpgradeSelectKey = pendingUpgradeSelectCode = null;
            resolvedUpgradeLevel = 0; nextPracticeUpgradeCore = PracticeUpgradeCoreStep; practiceUpgradeLevel = 1;
        }

        private void CloseUpgradeModal()
        {
            if (upgradeModal) { upgradeModal.gameObject.SetActive(false); Destroy(upgradeModal.gameObject); }
            upgradeModal = null; upgradeStatus = null; upgradeOffer = null;
            battlePausedForUpgrade = false;
            pendingUpgradeSelectKey = pendingUpgradeSelectCode = null;
        }

        private void OpenPracticeUpgrade()
        {
            int level = practiceUpgradeLevel++;
            nextPracticeUpgradeCore += PracticeUpgradeCoreStep;
            OpenUpgradeModal(BattleRun.BuildPracticeOffer(level));
        }

        /// <summary>Reads a progress response; a pending offer (or upgradesAvailable) pauses the battle until the player picks.</summary>
        private void ApplyProgressResponse(JToken response)
        {
            if (response == null || battle == null || battlePreview || battle.Ended || battlePausedForUpgrade) return;
            var pending = response["pendingOffer"];
            bool hasOffer = pending != null && pending.Type == JTokenType.Object;
            int level = (hasOffer ? (int?)pending["level"] : (int?)response["battleLevel"]) ?? 0;
            // A response queued before the pick can still report the offer that was just resolved.
            if (level > 0 && level <= resolvedUpgradeLevel) return;
            if (hasOffer && OpenUpgradeModal(pending)) return;
            if ((bool?)response["upgradesAvailable"] == true && !battleUpgradesUnsupported) battlePausedForUpgrade = true;
        }

        private async Task LoadUpgradeOffer()
        {
            var session = battle;
            if (pendingUpgradeOfferKey == null) pendingUpgradeOfferKey = Guid.NewGuid().ToString();
            JToken result;
            try { result = await api.OfferBattleUpgrades(session.SessionId, pendingUpgradeOfferKey); }
            catch (ApiException error) when (error.Status == 404)
            {
                // Servers without the upgrade endpoints: keep fighting and skip the selection modal.
                if (battle == session) { battleUpgradesUnsupported = true; battlePausedForUpgrade = false; pendingUpgradeOfferKey = null; }
                return;
            }
            if (battle != session) return;
            pendingUpgradeOfferKey = null;
            var offer = result?["offer"];
            if (offer != null && OpenUpgradeModal(offer)) return;
            resolvedUpgradeLevel = Math.Max(resolvedUpgradeLevel, (int?)result?["battleLevel"] ?? 0);
            battlePausedForUpgrade = false;
        }

        private static string UpgradeCode(JToken option) => (string)option?["upgradeId"] ?? (string)option?["id"];

        private static readonly (string Key, string Label, string Unit)[] UpgradeEffectLabels =
        {
            ("attackPower", "공격력", ""), ("attackSpeed", "공격 간격", "ms"), ("moveSpeed", "이동속도", "%"),
            ("maxHp", "최대 HP", ""), ("dashCooldown", "대시 쿨다운", "ms"), ("ultimatePower", "궁극기 위력", "%"),
            ("ultimateCooldown", "궁극기 쿨다운", "ms"), ("projectileSpeed", "투사체 속도", "%"),
            ("splashRadius", "폭발 범위", ""), ("critRate", "치명타 확률", "%"), ("critDamage", "치명타 피해", "%"),
            ("hpRegenPerSec", "초당 회복", ""), ("shieldHp", "보호막", ""), ("duration", "지속시간", "%"),
            ("chainTargets", "연쇄 대상", ""), ("bombRadius", "폭탄 범위", ""), ("healAmount", "회복량", "")
        };

        /// <summary>Up to four signed effect values for a card, e.g. "공격력 +2 · 공격 간격 -20ms".</summary>
        public static string UpgradeEffectSummary(JToken effects)
        {
            var parts = new List<string>();
            if (effects is JObject values)
                foreach (var entry in UpgradeEffectLabels)
                {
                    if (parts.Count >= 4) break;
                    var token = values[entry.Key];
                    if (token == null || (token.Type != JTokenType.Integer && token.Type != JTokenType.Float)) continue;
                    double value = (double)token;
                    if (value == 0) continue;
                    parts.Add($"{entry.Label} {value.ToString("+0.##;-0.##", System.Globalization.CultureInfo.InvariantCulture)}{entry.Unit}");
                }
            return string.Join(" · ", parts);
        }

        private static string UpgradeCategoryName(string category)
        {
            switch (category)
            {
                case "weapon": return "무기";
                case "armor": return "방어";
                case "drone": return "드론";
                case "utility": return "보조";
                case "special": return "특수";
                default: return category ?? "강화";
            }
        }

        private Text ModalText(Transform parent, string text, int size, Color color, float height)
        {
            var obj = new GameObject("Text", typeof(RectTransform), typeof(Text), typeof(LayoutElement));
            obj.transform.SetParent(parent, false);
            var label = obj.GetComponent<Text>();
            label.font = font; label.text = text; label.fontSize = size; label.color = color;
            label.alignment = TextAnchor.MiddleLeft; label.raycastTarget = false;
            obj.GetComponent<LayoutElement>().preferredHeight = height;
            return label;
        }

        private void SetUpgradeStatus(string message)
        {
            if (upgradeStatus) upgradeStatus.text = message;
        }

        /// <summary>Shows up to three upgrade cards inside the 540 x 960 portrait safe area. Returns false when the offer has no usable option.</summary>
        private bool OpenUpgradeModal(JToken offer)
        {
            var options = new List<JToken>();
            if (offer?["options"] is JArray list)
                foreach (var option in list)
                    if (options.Count < 3 && !string.IsNullOrEmpty(UpgradeCode(option))) options.Add(option);
            if (options.Count == 0) return false;
            if (upgradeModal) { upgradeModal.gameObject.SetActive(false); Destroy(upgradeModal.gameObject); }
            upgradeOffer = offer;
            battlePausedForUpgrade = true;
            draggingPilot = false;
            upgradeModal = Box(safeArea, "UpgradeModal", new Color(0, 0, 0, .85f));
            Stretch(upgradeModal);
            var panel = Box(upgradeModal, "UpgradePanel", Panel);
            Stretch(panel);
            panel.offsetMin = new Vector2(14, 14);
            panel.offsetMax = new Vector2(-14, -14);
            var layout = panel.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.padding = new RectOffset(16, 16, 16, 16);
            layout.spacing = 8;
            layout.childControlWidth = layout.childControlHeight = true;
            layout.childForceExpandWidth = true; layout.childForceExpandHeight = false;
            ModalText(panel, $"강화 선택 · Lv {(int?)offer["level"] ?? 1}", 28, Accent, 40);
            ModalText(panel, "카드를 눌러 강화를 고르면 전투가 재개됩니다.", 16, Muted, 24);
            float cardHeight = Mathf.Clamp((safeArea.rect.height - 28 - 32 - 40 - 24 - 56 - 52 - 8 * (options.Count + 3)) / options.Count, 120, 200);
            foreach (var option in options)
            {
                var card = Box(panel, "UpgradeCard", Background);
                card.gameObject.AddComponent<LayoutElement>().preferredHeight = cardHeight;
                var button = card.gameObject.AddComponent<Button>();
                var picked = option;
                button.onClick.AddListener(() => { _ = SelectUpgrade(picked); });
                string effects = UpgradeEffectSummary(option["effects"]);
                var text = ModalText(card, $"<size=22><b>{(string)option["name"] ?? UpgradeCode(option)}</b></size>  <color=#5FEBB7>{(int?)option["tier"] ?? 1}단계 · {UpgradeCategoryName((string)option["category"])}</color>\n" +
                    $"{(string)option["description"]}" + (effects.Length > 0 ? $"\n<color=#9BB4C4>{effects}</color>" : ""),
                    19, Color.white, 0);
                Destroy(text.GetComponent<LayoutElement>());
                text.alignment = TextAnchor.UpperLeft;
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.verticalOverflow = VerticalWrapMode.Truncate;
                Stretch(text.rectTransform);
                text.rectTransform.offsetMin = new Vector2(14, 10);
                text.rectTransform.offsetMax = new Vector2(-14, -10);
            }
            upgradeStatus = ModalText(panel, "", 16, Muted, 52);
            if (!battlePreview)
            {
                BattleButton(panel, "강화 목록 다시 불러오기", ReloadUpgradeOffer);
                panel.GetChild(panel.childCount - 1).gameObject.AddComponent<LayoutElement>().preferredHeight = 48;
            }
            return true;
        }

        private void ReloadUpgradeOffer()
        {
            if (upgradeSelecting || battle == null || battlePreview) return;
            if (upgradeModal) { upgradeModal.gameObject.SetActive(false); Destroy(upgradeModal.gameObject); }
            upgradeModal = null; upgradeStatus = null; upgradeOffer = null;
            pendingUpgradeOfferKey = pendingUpgradeSelectKey = pendingUpgradeSelectCode = null;
            battleNetworkFailed = false;
            _ = PumpBattle();
        }

        private async Task SelectUpgrade(JToken option)
        {
            var offer = upgradeOffer;
            if (upgradeSelecting || battle == null || offer == null) return;
            string chosen = UpgradeCode(option);
            // After an ambiguous failure the same pick (and Idempotency-Key) is resent so it cannot be applied twice.
            string code = pendingUpgradeSelectCode ?? chosen;
            if (pendingUpgradeSelectKey == null) pendingUpgradeSelectKey = Guid.NewGuid().ToString();
            pendingUpgradeSelectCode = code;
            upgradeSelecting = true;
            SetUpgradeStatus(code == chosen ? "선택을 전송하는 중…" : "이전에 고른 강화를 다시 전송하는 중…");
            try
            {
                JToken result;
                if (battlePreview)
                {
                    JToken local = null;
                    foreach (var candidate in (JArray)offer["options"]) if (UpgradeCode(candidate) == code) local = candidate;
                    result = battle.BuildPracticeSelection(local);
                }
                else result = await api.SelectBattleUpgrade(battle.SessionId, code, pendingUpgradeSelectKey);
                if (battle == null || upgradeOffer != offer) return;
                if (result?["effectiveStats"] == null)
                    throw new ApiException(0, "INVALID_RESPONSE", "강화 선택 응답이 올바르지 않습니다.");
                battle.ApplyEffectiveStats(result["effectiveStats"], result["selectedUpgrade"]);
                resolvedUpgradeLevel = Math.Max(resolvedUpgradeLevel, (int?)offer["level"] ?? 0);
                CloseUpgradeModal();
            }
            catch (Exception error)
            {
                if (battle == null || upgradeOffer != offer) return;
                if (!ShouldKeepPendingKey(error)) { pendingUpgradeSelectKey = null; pendingUpgradeSelectCode = null; }
                SetUpgradeStatus(error is ApiException ? error.Message : "강화를 전송하지 못했습니다. 카드를 다시 눌러 재시도해 주세요.");
            }
            finally { upgradeSelecting = false; }
        }

        private void QueueProgress()
        {
            int kills = battle.Kills - sentKills, core = battle.Core - sentCore;
            string boss = sentBosses < battle.BossesDefeated.Count ? battle.BossesDefeated[sentBosses++] : null;
            if (kills == 0 && core == 0 && boss == null) return;
            packets.Enqueue(new BattlePacket { Body = new { sequence = ++battleSequence,
                killsDelta = kills, coreEnergyDelta = core, bossId = boss, elapsedSeconds = (int)battle.Elapsed } });
            sentKills = battle.Kills; sentCore = battle.Core;
        }

        private async Task PumpBattle()
        {
            if (battleNetworkBusy || battle == null) return;
            battleNetworkBusy = true;
            try
            {
                while (packets.Count > 0)
                {
                    var packet = packets.Peek();
                    var response = await api.ReportBattle(battle.SessionId, packet.Body, packet.Key);
                    packets.Dequeue();
                    ApplyProgressResponse(response);
                }
                if (battlePausedForUpgrade && upgradeOffer == null) await LoadUpgradeOffer();
                if (battle.Ended) await FinishPlayableBattle();
            }
            catch (Exception error)
            {
                battleNetworkFailed = true;
                notice.text = "전투 동기화 중단: " + error.Message + "\n연결 재시도로 같은 요청을 재전송합니다.";
            }
            finally { battleNetworkBusy = false; }
        }

        private async Task RetryBattle()
        {
            battleNetworkFailed = false;
            battleFinishing = false;
            await PumpBattle();
        }

        private async Task FinishPlayableBattle()
        {
            battleFinishing = true;
            if (!battle.Cleared)
            {
                await api.AbandonBattle(battle.SessionId);
                ShowBattleResult(null, battle.Hp <= 0 ? "메카 파괴" : "보스 미처치", false);
                return;
            }
            if (finishKey == null)
            {
                finishKey = Guid.NewGuid().ToString();
                finishReport = new { totalKills = battle.Kills, totalCoreEnergy = battle.Core,
                    bossDefeated = battle.BossesDefeated.ToArray(), elapsedSeconds = (int)battle.Elapsed };
            }
            var result = await api.FinishBattle(battle.SessionId, finishReport, finishKey);
            ShowBattleResult(result["reward"] ?? result, "작전 완료", true);
        }

        private void ShowBattleResult(JToken reward, string title, bool completed)
        {
            int kills = battle.Kills;
            battle = null;
            ResetUpgradeState();
            enemyViews.Clear(); packets.Clear();
            bulletViews.Clear(); battleEffects.Clear(); draggingPilot = false;
            Clear(title);
            notice.text = completed ? "서버에서 전투 결과와 보상을 확정했습니다." : "작전이 종료되었습니다. 보상은 지급되지 않습니다.";
            Label($"처치 {kills}", 28, Accent, 50);
            if (reward != null)
            {
                Label($"획득 스크랩 {reward["scrap"]}", 26, Accent, 50);
                if (reward["blueprint"] != null) Label($"설계도 {reward["blueprint"]}", 19, Color.white, 64);
                if (reward["part"] != null) Label($"부품 {reward["part"]}", 19, Color.white, 64);
            }
            ActionButton("스테이지 목록", () => Run(ShowStages), true);
            ActionButton("기지로 돌아가기", () => Run(ShowBase));
        }

        private async Task AbandonPlayableBattle()
        {
            if (battleNetworkBusy) { notice.text = "진행 상황 전송 후 다시 시도해 주세요."; return; }
            battleFinishing = true;
            try
            {
                await api.AbandonBattle(battle.SessionId);
                battle = null;
                ResetUpgradeState();
                enemyViews.Clear(); packets.Clear();
                bulletViews.Clear(); battleEffects.Clear(); draggingPilot = false;
                await ShowStages();
            }
            finally { battleFinishing = false; }
        }
    }
}
