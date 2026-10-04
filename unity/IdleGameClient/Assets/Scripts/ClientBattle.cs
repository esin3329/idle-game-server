using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using IdleGame.Network;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace IdleGame
{
    public sealed partial class ClientApp
    {
        private BattleRun battle;
        private RectTransform arena, pilot;
        private Text battleHud;
        private readonly Dictionary<BattleRun.Enemy, RectTransform> enemyViews = new Dictionary<BattleRun.Enemy, RectTransform>();
        private readonly Queue<BattlePacket> packets = new Queue<BattlePacket>();
        private int sentKills, sentCore, sentBosses, battleSequence;
        private float nextReport;
        private bool battleNetworkBusy, battleNetworkFailed, battleFinishing;
        private string finishKey;
        private object finishReport;

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
            packets.Clear(); enemyViews.Clear();
            sentKills = sentCore = sentBosses = battleSequence = 0;
            battleNetworkBusy = battleNetworkFailed = battleFinishing = false;
            nextReport = 5;
            finishKey = null; finishReport = null;
            DrawBattle();
        }

        private void DrawBattle()
        {
            Clear(battle.StageName);
            notice.text = "자동 사격 중 · 좌우 회피로 적의 공격을 피하세요.";
            battleHud = Label("", 19, Accent, 64);
            arena = Box(content, "BattleArena", Panel);
            arena.gameObject.AddComponent<LayoutElement>().preferredHeight = 540;
            pilot = Box(arena, "Pilot", Accent);
            pilot.sizeDelta = new Vector2(34, 44);
            pilot.anchorMin = pilot.anchorMax = new Vector2(.5f, .5f);
            pilot.anchoredPosition = new Vector2(0, -210);
            ActionButton("왼쪽 회피", () => battle?.Dodge(-1));
            ActionButton("오른쪽 회피", () => battle?.Dodge(1));
            ActionButton("연결 재시도 / 결과 확인", () => Run(RetryBattle));
            ActionButton("출격 포기", () => Run(AbandonPlayableBattle));
        }

        private void TickBattle()
        {
            if (battle == null || !arena || battleFinishing) return;
            if (!battleNetworkFailed) battle.Tick(Time.unscaledDeltaTime);
            pilot.anchoredPosition = new Vector2(battle.PlayerX, -210);
            battleHud.text = $"{Mathf.FloorToInt(battle.Elapsed)} / {battle.Duration}초   HP {battle.Hp:0} / {battle.MaxHp:0}\n처치 {battle.Kills} · 코어 {battle.Core} · 보스 {battle.BossesDefeated.Count}";
            foreach (var enemy in battle.Enemies)
            {
                if (!enemyViews.TryGetValue(enemy, out var view))
                {
                    view = Box(arena, enemy.Name, enemy.BossId == null ? new Color32(220, 116, 96, 255) : new Color32(230, 180, 70, 255));
                    view.anchorMin = view.anchorMax = new Vector2(.5f, .5f);
                    view.sizeDelta = enemy.BossId == null ? new Vector2(30, 30) : new Vector2(80, 70);
                    var caption = new GameObject("HP", typeof(RectTransform), typeof(Text));
                    caption.transform.SetParent(view, false);
                    var text = caption.GetComponent<Text>();
                    text.font = font; text.fontSize = 14; text.color = Color.white; text.alignment = TextAnchor.MiddleCenter;
                    Stretch(text.rectTransform);
                    text.raycastTarget = false;
                    enemyViews.Add(enemy, view);
                }
                view.anchoredPosition = new Vector2(enemy.X, enemy.Y);
                view.GetComponentInChildren<Text>().text = $"{enemy.Hp:0}";
            }
            var removed = new List<BattleRun.Enemy>();
            foreach (var entry in enemyViews)
                if (!battle.Enemies.Contains(entry.Key)) { Destroy(entry.Value.gameObject); removed.Add(entry.Key); }
            foreach (var enemy in removed) enemyViews.Remove(enemy);
            if (battle.Elapsed >= nextReport || battle.BossesDefeated.Count > sentBosses || battle.Ended)
            {
                QueueProgress();
                nextReport = battle.Elapsed + 5;
            }
            if (!battleNetworkBusy && !battleNetworkFailed && (packets.Count > 0 || battle.Ended))
                _ = PumpBattle();
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
                await ShowStages();
            }
            finally { battleFinishing = false; }
        }
    }
}
