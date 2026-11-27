using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading.Tasks;
using IdleGame.Network;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace IdleGame.Editor
{
    public static class MetaLoopVerification
    {
        private static readonly List<string> passed = new List<string>();

        private static readonly string[] ApiMethods =
        {
            "WalletSummary", "PartsCatalog", "EquipPart", "UpgradePart", "MechaConfigs", "MechaParts",
            "ResearchCatalog", "MyResearch", "LevelUpResearch", "Blueprints", "MyBlueprints", "CraftingQueue",
            "StartCraft", "CompleteCraft", "Rankings"
        };

        private static readonly string[] Routes =
        {
            "api/wallet", "api/parts", "api/parts/equip", "api/parts/upgrade", "api/mecha/configs", "api/mecha/parts",
            "api/research", "api/research/my", "api/research/code/levelup", "api/crafting/blueprints",
            "api/crafting/my-blueprints", "api/crafting/queue", "api/crafting/bp/start", "api/crafting/id/complete",
            "api/rankings?limit=20"
        };

        private static readonly string[] Screens = { "ShowHangar", "ShowWorkshop", "ShowResearch", "ShowRankings" };

        [MenuItem("Idle Game/Verify Meta Loop")]
        public static void Run() => Debug.Log(Verify());

        public static string Verify()
        {
            passed.Clear();
            foreach (string route in Routes)
            {
                Check("api base resolves " + route, GameApi.ResolveUrl("https://host.test/api", route) == "https://host.test/" + route);
                Check("root base resolves " + route, GameApi.ResolveUrl("https://host.test", route) == "https://host.test/" + route);
            }

            foreach (string name in ApiMethods)
            {
                var method = typeof(GameApi).GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
                Check("GameApi." + name + " returns Task<JToken>", method != null && method.ReturnType == typeof(Task<JToken>));
            }

            Check("equip and upgrade send partCode body",
                JsonConvert.SerializeObject(new { partCode = "light_frame" }) == "{\"partCode\":\"light_frame\"}" &&
                typeof(GameApi).GetMethod("EquipPart").GetParameters()[0].Name == "partCode" &&
                typeof(GameApi).GetMethod("UpgradePart").GetParameters()[0].Name == "partCode");
            Check("rankings default limit is 20", typeof(GameApi).GetMethod("Rankings").GetParameters()[0].DefaultValue is int limit && limit == 20);

            foreach (string name in new[] { "EquipPart", "UpgradePart", "LevelUpResearch", "StartCraft", "CompleteCraft" })
            {
                var parameters = typeof(GameApi).GetMethod(name).GetParameters();
                var last = parameters[parameters.Length - 1];
                Check("GameApi." + name + " accepts optional idempotencyKey",
                    last.Name == "idempotencyKey" && last.ParameterType == typeof(string) && last.IsOptional && last.DefaultValue == null);
            }

            Check("remaining zero is ready", ClientApp.CraftRemainingText(TimeSpan.Zero) == "완료됨");
            Check("overdue is ready", ClientApp.CraftRemainingText(TimeSpan.FromSeconds(-5)) == "완료됨");
            Check("partial second rounds up", ClientApp.CraftRemainingText(TimeSpan.FromSeconds(.2)) == "남은 시간 00:01");
            Check("minutes countdown", ClientApp.CraftRemainingText(TimeSpan.FromSeconds(65)) == "남은 시간 01:05");
            Check("hours countdown", ClientApp.CraftRemainingText(TimeSpan.FromSeconds(3725)) == "남은 시간 1:02:05");
            Check("4xx business rejections clear the key", ClientApp.ShouldKeepPendingKey(new ApiException(400, "BAD", "x")) == false &&
                ClientApp.ShouldKeepPendingKey(new ApiException(403, "FORBIDDEN", "x")) == false &&
                ClientApp.ShouldKeepPendingKey(new ApiException(409, "CONFLICT", "x")) == false);
            Check("ambiguous failures keep the key", ClientApp.ShouldKeepPendingKey(new ApiException(0, "CONNECTION_FAILED", "x")) &&
                ClientApp.ShouldKeepPendingKey(new ApiException(408, "TIMEOUT", "x")) &&
                ClientApp.ShouldKeepPendingKey(new ApiException(429, "RATE", "x")) &&
                ClientApp.ShouldKeepPendingKey(new ApiException(500, "SERVER", "x")) &&
                ClientApp.ShouldKeepPendingKey(new InvalidOperationException()));
            Check("only wired research is labeled live", ClientApp.IsLiveResearchEffect("prod_passive") &&
                ClientApp.IsLiveResearchEffect("prod_cap") && ClientApp.IsLiveResearchEffect("util_idle_reward") &&
                !ClientApp.IsLiveResearchEffect("prod_eff_1") && !ClientApp.IsLiveResearchEffect("combat_atk_1") &&
                !ClientApp.IsLiveResearchEffect(null));
            VerifyMutationKeys();

            foreach (string name in Screens)
            {
                var screen = typeof(ClientApp).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
                Check("ClientApp." + name + " returns Task", screen != null && screen.ReturnType == typeof(Task));
            }
            return "META_LOOP_VERIFICATION_PASS: " + passed.Count + " checks";
        }

        private static void Check(string name, bool condition)
        {
            if (!condition) throw new InvalidOperationException("META_LOOP_FAILED: " + name);
            passed.Add(name);
        }

        private static void VerifyMutationKeys()
        {
            var host = new GameObject("MetaLoopVerificationHost");
            try
            {
                const BindingFlags instance = BindingFlags.NonPublic | BindingFlags.Instance;
                var app = host.AddComponent<ClientApp>();
                var execute = typeof(ClientApp).GetMethod("ExecuteMetaMutation", instance);
                var pending = (Dictionary<string, string>)typeof(ClientApp).GetField("pendingActionKeys", instance).GetValue(app);
                var keys = new List<string>();
                Func<Exception, Func<string, Task<JToken>>> failing = error => key => { keys.Add(key); throw error; };
                Func<string, Task<JToken>> succeeding = key => { keys.Add(key); return Task.FromResult<JToken>(new JObject()); };
                Func<JToken, string> banner = result => "ok";
                Func<string, Task> refresh = message => Task.CompletedTask;
                Func<string, Task> brokenRefresh = message => throw new InvalidOperationException("refresh failed");
                Func<Func<string, Task<JToken>>, Func<string, Task>, bool> call = (mutation, screen) =>
                {
                    try { ((Task)execute.Invoke(app, new object[] { "craft-start:bp", mutation, banner, screen, "제작소 · 설계도" })).GetAwaiter().GetResult(); return true; }
                    catch (Exception) { return false; }
                };
                const string action = "craft-start:bp";

                Check("400 rejection reports failure", !call(failing(new ApiException(400, "BAD", "rejected")), refresh));
                Check("400 rejection clears its key", !pending.ContainsKey(action));
                Check("500 failure reports failure", !call(failing(new ApiException(500, "SERVER", "down")), refresh));
                Check("500 failure keeps its key", pending.ContainsKey(action) && keys[1] != keys[0]);
                Check("retry after 500 succeeds", call(succeeding, refresh));
                Check("retry reuses the retained key", keys.Count == 3 && keys[1] == keys[2] && Guid.TryParse(keys[1], out _));
                Check("successful mutation clears its key", !pending.ContainsKey(action));
                Check("transport failure keeps its key", !call(failing(new TimeoutException()), refresh) && pending.ContainsKey(action));
                Check("success after transport failure reuses key", call(succeeding, refresh) && keys[3] == keys[4]);

                var area = new GameObject("MetaLoopSafeArea", typeof(RectTransform));
                area.transform.SetParent(host.transform, false);
                typeof(ClientApp).GetField("safeArea", instance).SetValue(app, area.GetComponent<RectTransform>());
                Check("refresh failure after success is not reported as failure", call(succeeding, brokenRefresh));
                Check("refresh failure never keeps a completed key", !pending.ContainsKey(action));
                var notice = (UnityEngine.UI.Text)typeof(ClientApp).GetField("notice", instance).GetValue(app);
                Check("refresh failure shows reload notice", notice != null &&
                    notice.text == "요청이 서버에 반영되었으나 최신 화면을 불러오지 못했습니다. 새로고침해 주세요.");
                var captions = new List<string>();
                foreach (var button in area.GetComponentsInChildren<UnityEngine.UI.Button>())
                    captions.Add(button.GetComponentInChildren<UnityEngine.UI.Text>().text);
                Check("refresh failure leaves only reload and back actions",
                    captions.Count == 2 && captions[0] == "화면 다시 불러오기" && captions[1] == "기지로 돌아가기");
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }
    }
}
