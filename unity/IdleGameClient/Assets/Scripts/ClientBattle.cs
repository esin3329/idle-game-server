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
            direction = direction.normalized * BattleRun.MoveSpeed * Mathf.Min(Time.unscaledDeltaTime, .1f);
            if (direction != Vector2.zero) battle.MoveTo(battle.PlayerX + direction.x,
                battle.PlayerY + direction.y, Time.unscaledDeltaTime);
            else if (draggingPilot) battle.MoveTo(pilotTarget.x, pilotTarget.y, Time.unscaledDeltaTime);
        }

        private void DodgePilot(int direction)
        {
            if (battle == null || battleNetworkFailed || battleFinishing) return;
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
            ReadBattleInput();
            if (!battleNetworkFailed) battle.Tick(Time.unscaledDeltaTime);
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
            battleHud.text = $"{Mathf.FloorToInt(battle.Elapsed)} / {battle.Duration}초   HP {battle.Hp:0} / {battle.MaxHp:0}\n처치 {battle.Kills} · 코어 {battle.Core} · 대시 {(battle.DodgeCooldown > 0 ? battle.DodgeCooldown.ToString("0.0") + "초" : "준비")}";
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
            enemyViews.Clear(); bulletViews.Clear(); battleEffects.Clear(); packets.Clear();
            DrawBattle();
        }
#endif

        private void EndBulletPreview()
        {
            battle = null; battlePreview = false; draggingPilot = false;
            enemyViews.Clear(); bulletViews.Clear(); battleEffects.Clear(); packets.Clear();
            ShowLogin();
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
                    await api.ReportBattle(battle.SessionId, packet.Body, packet.Key);
                    packets.Dequeue();
                }
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
                enemyViews.Clear(); packets.Clear();
                bulletViews.Clear(); battleEffects.Clear(); draggingPilot = false;
                await ShowStages();
            }
            finally { battleFinishing = false; }
        }
    }
}
