using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using IdleGame.Network;
using Newtonsoft.Json.Linq;
using UnityEngine.UI;
using UnityEngine;

namespace IdleGame
{
    public sealed partial class ClientApp
    {
        private static readonly string[] PartGroups = { "frames", "weapons", "cores", "modules" };
        private static readonly string[] PartSlots = { "frame", "weapon", "core", "module" };
        private static readonly string[] PartSlotNames = { "프레임", "무기", "코어", "모듈" };

        private const string MetaPreviewNotice =
            "파츠 장착 및 연구 강화는 서버에 저장됩니다. (현재 전투 세션 스탯 스냅샷에는 아직 자동 반영되지 않는 메타 관리 프리뷰 기능입니다.)";

        // 서버에서 성공 처리됐는지 알 수 없는 요청을 재시도할 때 같은 Idempotency-Key를 재사용하기 위한 보관소.
        private readonly Dictionary<string, string> pendingActionKeys = new Dictionary<string, string>();
        private readonly List<CraftTimer> craftTimers = new List<CraftTimer>();
        private float nextCraftTick;

        private sealed class CraftTimer
        {
            public Text Label;
            public Button Claim;
            public string PartName;
            public DateTime CompletesAtUtc;
        }

        private Task ShowHangar() => ShowHangar(null);
        private Task ShowWorkshop() => ShowWorkshop(null);
        private Task ShowResearch() => ShowResearch(null);

        /// <summary>
        /// 변경 요청을 actionId 단위의 안정적인 Idempotency-Key로 보낸다. 요청이 실패하면 키를 유지해 재시도 시 재사용하고,
        /// 성공하면 즉시 폐기한다. 이후 화면 갱신이 실패해도 이미 처리된 요청을 다시 보내지 않는다.
        /// </summary>
        private async Task ExecuteMetaMutation(string actionId, Func<string, Task<JToken>> mutation,
            Func<JToken, string> successBanner, Func<string, Task> refreshScreen)
        {
            if (!pendingActionKeys.TryGetValue(actionId, out string key))
                pendingActionKeys[actionId] = key = Guid.NewGuid().ToString();
            var result = await mutation(key);
            pendingActionKeys.Remove(actionId);
            try { await refreshScreen(successBanner(result)); }
            catch (Exception)
            {
                if (this && notice) notice.text = "처리되었으나 화면 갱신에 실패했습니다. 새로고침해 주세요.";
            }
        }

        private async Task ShowHangar(string message)
        {
            var wallet = await api.WalletSummary();
            var mine = await api.Parts();
            var catalog = await api.PartsCatalog();
            var details = await api.MechaParts();
            if (!(mine["inventory"] is JArray inventory))
                throw new ApiException(0, "INVALID_RESPONSE", "파츠 목록 형식이 올바르지 않습니다.");
            var names = PartNames(catalog);
            var stats = new Dictionary<string, JToken>();
            if (details is JArray detailList)
                foreach (var detail in detailList)
                    if (detail["partCode"] != null) stats[(string)detail["partCode"]] = detail["stats"];
            var equipped = mine["equipped"] as JObject;

            Clear("격납고 · 파츠");
            notice.text = message ?? "보유 파츠를 장착하거나 강화하세요.";
            Label(MetaPreviewNotice, 16, Muted, TextHeight(4, 16));
            WalletLines(wallet);
            Label("장착 중", 22, Accent, 34);
            for (int i = 0; i < PartSlots.Length; i++)
            {
                string code = equipped == null ? null : (string)equipped[PartSlots[i]];
                Label($"{PartSlotNames[i]} · {(string.IsNullOrEmpty(code) ? "비어 있음" : NameOf(names, code))}", 18, Color.white, 28);
            }
            Label($"보유 파츠 {inventory.Count}개", 22, Accent, 34);
            if (inventory.Count == 0) Label("보유한 파츠가 없습니다. 제작소에서 파츠를 제작하세요.", 17, Muted, 40);
            foreach (var part in inventory)
            {
                string code = (string)part["partCode"];
                if (string.IsNullOrEmpty(code)) continue;
                string type = (string)part["partType"];
                bool isEquipped = Truthy(part["equipped"]) ||
                    (equipped != null && type != null && (string)equipped[type] == code);
                Label($"{NameOf(names, code)}{(isEquipped ? "  [장착 중]" : "")}", 22, Color.white, 34);
                string statLine = stats.TryGetValue(code, out var stat) ? StatLine(stat) : "";
                Label($"{SlotName(type)} · Lv {(int?)part["level"] ?? 1}" + (statLine.Length > 0 ? "\n" + statLine : ""),
                    17, Muted, TextHeight(statLine.Length > 0 ? 2 : 1, 17));
                if (!isEquipped)
                    ActionButton("장착", () => Run(() => ExecuteMetaMutation("part-equip:" + code,
                        key => api.EquipPart(code, key),
                        result => $"{NameOf(names, code)} 장착 완료",
                        ShowHangar)));
                ActionButton("파츠 강화", () => Run(() => ExecuteMetaMutation("part-upgrade:" + code,
                    key => api.UpgradePart(code, key),
                    result => $"{NameOf(names, code)} Lv {(int?)result["level"] ?? 0} 강화 완료",
                    ShowHangar)));
            }
            ActionButton("새로고침", () => Run(ShowHangar), true);
            ActionButton("기지로 돌아가기", () => Run(ShowBase));
        }

        private async Task ShowWorkshop(string message)
        {
            var wallet = await api.WalletSummary();
            var owned = await api.MyBlueprints();
            var catalog = await api.Blueprints();
            var queueResult = await api.CraftingQueue();
            var partNames = PartNames(await api.PartsCatalog());
            if (!(owned is JArray ownedList))
                throw new ApiException(0, "INVALID_RESPONSE", "설계도 목록 형식이 올바르지 않습니다.");
            var byCode = new Dictionary<string, JToken>();
            if (catalog["blueprints"] is JArray catalogList)
                foreach (var blueprint in catalogList) byCode[(string)blueprint["code"]] = blueprint;
            var queue = (queueResult["queue"] as JArray ?? new JArray()).Where(craft => !Truthy(craft["completed"])).ToList();

            Clear("제작소 · 설계도");
            notice.text = message ?? "설계도로 파츠를 제작하고 완료된 제작물을 수령하세요.";
            WalletLines(wallet);
            Label($"제작 대기열 {queue.Count}", 22, Accent, 34);
            if (queue.Count == 0) Label("진행 중인 제작이 없습니다.", 17, Muted, 28);
            foreach (var craft in queue)
            {
                string craftId = (string)craft["id"];
                string partName = NameOf(partNames, (string)craft["resultCode"]);
                var timer = new CraftTimer { PartName = partName, CompletesAtUtc = ParseUtc(craft["completesAt"]) };
                timer.Label = Label("", 19, Color.white, 30);
                timer.Claim = ActionButton("제작 완료 · 수령", () => Run(() => ExecuteMetaMutation("craft-complete:" + craftId,
                    key => api.CompleteCraft(craftId, key),
                    result => $"{NameOf(partNames, (string)result["partCode"])} 수령 완료",
                    ShowWorkshop)), true, false);
                craftTimers.Add(timer);
            }
            RefreshCraftTimers();
            Label($"보유 설계도 {ownedList.Count}개", 22, Accent, 34);
            if (ownedList.Count == 0) Label("보유한 설계도가 없습니다. 전투에서 설계도를 획득하세요.", 17, Muted, 40);
            foreach (var entry in ownedList)
            {
                string code = (string)entry["blueprintCode"] ?? (string)entry["code"];
                if (string.IsNullOrEmpty(code)) continue;
                var info = byCode.TryGetValue(code, out var known) ? known : entry;
                string name = (string)info["name"] ?? code;
                string materials = info["materials"] is JObject cost
                    ? string.Join(", ", cost.Properties().Select(p => $"{NameOf(partNames, p.Name, p.Name == "scrap" ? "스크랩" : null)} {p.Value}"))
                    : "-";
                Label($"{name} · {(string)info["rarity"]}", 21, Color.white, 32);
                Label($"결과 {NameOf(partNames, (string)info["partCode"])} · {Duration(TimeSpan.FromSeconds((double?)info["craftSeconds"] ?? 0))}\n재료 {materials}",
                    17, Muted, TextHeight(2, 17));
                ActionButton("제작 시작", () => Run(() => ExecuteMetaMutation("craft-start:" + code,
                    key => api.StartCraft(code, key),
                    result => $"{name} 제작을 시작했습니다.",
                    ShowWorkshop)));
            }
            ActionButton("새로고침", () => Run(ShowWorkshop), true);
            ActionButton("기지로 돌아가기", () => Run(ShowBase));
        }

        /// <summary>제작 대기열의 남은 시간을 1초마다 갱신하고 완료된 항목의 수령 버튼을 활성화한다.</summary>
        private void TickCraftTimers()
        {
            if (craftTimers.Count == 0 || Time.unscaledTime < nextCraftTick) return;
            nextCraftTick = Time.unscaledTime + 1f;
            RefreshCraftTimers();
        }

        private void RefreshCraftTimers()
        {
            var now = DateTime.UtcNow;
            foreach (var timer in craftTimers)
            {
                if (!timer.Label || !timer.Claim) continue;
                var remaining = timer.CompletesAtUtc - now;
                timer.Label.text = $"{timer.PartName} · {CraftRemainingText(remaining)}";
                timer.Claim.interactable = remaining.TotalSeconds <= 0;
            }
        }

        public static string CraftRemainingText(TimeSpan remaining)
        {
            if (remaining.TotalSeconds <= 0) return "완료됨";
            int total = Mathf.CeilToInt((float)remaining.TotalSeconds);
            return total >= 3600 ? $"남은 시간 {total / 3600}:{total % 3600 / 60:00}:{total % 60:00}"
                : $"남은 시간 {total / 60:00}:{total % 60:00}";
        }

        private async Task ShowResearch(string message)
        {
            var wallet = await api.WalletSummary();
            var catalog = await api.ResearchCatalog();
            var mine = await api.MyResearch();
            if (!(mine["tree"] is JArray tree))
                throw new ApiException(0, "INVALID_RESPONSE", "연구 목록 형식이 올바르지 않습니다.");
            var progress = tree.ToDictionary(node => (string)node["code"]);
            var nodes = catalog["nodes"] as JArray ?? tree;

            Clear("연구소");
            notice.text = message ?? "연구를 강화해 생산과 전투 능력을 높이세요.";
            Label(MetaPreviewNotice, 16, Muted, TextHeight(4, 16));
            WalletLines(wallet);
            foreach (var node in nodes)
            {
                string code = (string)node["code"];
                var state = progress.TryGetValue(code, out var found) ? found : node;
                int level = (int?)state["currentLevel"] ?? 0, maxLevel = (int?)node["maxLevel"] ?? 0;
                string name = (string)node["name"] ?? code;
                bool can = Truthy(state["canResearch"]);
                Label($"{name} · Lv {level}/{maxLevel}", 21, Accent, 32);
                Label((string)node["description"] ?? "", 17, Color.white, TextHeight(2, 17));
                string currentEffect = (string)state["currentEffect"] ?? "없음";
                if (level >= maxLevel)
                    Label($"최대 레벨 · 효과: {currentEffect}", 17, Muted, TextHeight(2, 17));
                else
                    Label($"다음 비용: {CostText(state["nextCost"] ?? node["baseCost"])}\n효과: {currentEffect} → {(string)state["nextEffect"] ?? (string)node["baseEffect"]}",
                        17, Muted, TextHeight(2, 17));
                ActionButton(level >= maxLevel ? "최대 레벨" : can ? "연구 레벨업" : "선행 연구 필요",
                    () => Run(() => ExecuteMetaMutation("research-up:" + code,
                        key => api.LevelUpResearch(code, key),
                        result => $"{name} Lv {(int?)result["research"]?["level"] ?? level + 1} · 비용 {CostText(result["cost"])}\n{(string)result["nextEffect"]}",
                        ShowResearch)), false, can);
            }
            ActionButton("새로고침", () => Run(ShowResearch), true);
            ActionButton("기지로 돌아가기", () => Run(ShowBase));
        }

        private async Task ShowRankings()
        {
            var result = await api.Rankings();
            if (!(result is JArray rankings))
                throw new ApiException(0, "INVALID_RESPONSE", "랭킹 형식이 올바르지 않습니다.");
            Clear("랭킹");
            notice.text = "총 자산 기준 상위 파일럿입니다.";
            if (rankings.Count == 0) Label("아직 랭킹이 없습니다.", 18, Muted, 32);
            for (int i = 0; i < rankings.Count; i++)
            {
                var row = rankings[i];
                bool me = !string.IsNullOrEmpty(api.Session.PlayerId) && (string)row["id"] == api.Session.PlayerId;
                Label($"{i + 1}위 · {(string)row["nickname"]}{(me ? "  (나)" : "")}", 21, me ? Accent : Color.white, 32);
                Label($"총 자산 {Number(row["totalWealth"])} E · 초당 {Number(row["electricityPerSecond"])} E", 17, Muted, 28);
            }
            ActionButton("새로고침", () => Run(ShowRankings), true);
            ActionButton("기지로 돌아가기", () => Run(ShowBase));
        }

        private void WalletLines(JToken wallet)
        {
            Label($"전기 {Number(wallet["electricity"])} E · 스크랩 {Number(wallet["scrap"])}", 20, Accent, 30);
        }

        private static Dictionary<string, string> PartNames(JToken catalog)
        {
            var names = new Dictionary<string, string>();
            foreach (string group in PartGroups)
                if (catalog[group] is JArray parts)
                    foreach (var part in parts)
                        if (part["code"] != null) names[(string)part["code"]] = (string)part["name"] ?? (string)part["code"];
            return names;
        }

        private static string NameOf(Dictionary<string, string> names, string code, string fallback = null) =>
            code != null && names.TryGetValue(code, out var name) ? name : fallback ?? code ?? "-";

        private static string SlotName(string type)
        {
            int index = Array.IndexOf(PartSlots, type);
            return index < 0 ? type ?? "-" : PartSlotNames[index];
        }

        private static string StatLine(JToken stats) =>
            stats is JObject values ? string.Join(" · ", values.Properties().Select(p => $"{p.Name} {p.Value}")) : "";

        private static string CostText(JToken cost)
        {
            if (!(cost is JObject values)) return "-";
            var parts = new List<string>();
            if (values["electricity"] != null) parts.Add($"전기 {Number(values["electricity"])} E");
            if (values["scrap"] != null) parts.Add($"스크랩 {Number(values["scrap"])}");
            return parts.Count == 0 ? "-" : string.Join(", ", parts);
        }

        private static string Number(JToken value) =>
            value == null || value.Type == JTokenType.Null ? "0" : ((double)value).ToString("N0", CultureInfo.InvariantCulture);

        private static bool Truthy(JToken value) =>
            value != null && (value.Type == JTokenType.Boolean ? (bool)value : value.Type == JTokenType.Integer && (long)value != 0);

        private static DateTime ParseUtc(JToken value)
        {
            if (value == null) return DateTime.UtcNow;
            if (value.Type == JTokenType.Date) return ((DateTime)value).ToUniversalTime();
            return DateTime.TryParse((string)value, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var parsed) ? parsed : DateTime.UtcNow;
        }

        private static string Duration(TimeSpan span)
        {
            int total = Mathf.Max(0, Mathf.CeilToInt((float)span.TotalSeconds));
            return total >= 3600 ? $"{total / 3600}시간 {total % 3600 / 60}분" : $"{total / 60}분 {total % 60:00}초";
        }

        private static float TextHeight(int lines, int size) => lines * size * 1.5f + 8;
    }
}
