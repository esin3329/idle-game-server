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
                var app = host.AddComponent<ClientApp>();
                var execute = typeof(ClientApp).GetMethod("ExecuteMetaMutation", BindingFlags.NonPublic | BindingFlags.Instance);
                var pending = (Dictionary<string, string>)typeof(ClientApp)
                    .GetField("pendingActionKeys", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(app);
                var keys = new List<string>();
                Func<string, Task<JToken>> failing = key => { keys.Add(key); throw new ApiException(0, "CONNECTION_FAILED", "offline"); };
                Func<string, Task<JToken>> succeeding = key => { keys.Add(key); return Task.FromResult<JToken>(new JObject()); };
                Func<JToken, string> banner = result => "ok";
                Func<string, Task> refresh = message => Task.CompletedTask;
                Func<string, Task> brokenRefresh = message => throw new InvalidOperationException("refresh failed");

                Func<string, Func<string, Task<JToken>>, Func<string, Task>, bool> call = (id, mutation, screen) =>
                {
                    try { ((Task)execute.Invoke(app, new object[] { id, mutation, banner, screen })).GetAwaiter().GetResult(); return true; }
                    catch (TargetInvocationException) { return false; }
                    catch (ApiException) { return false; }
                };

                Check("failed mutation reports failure", !call("craft-start:bp", failing, refresh));
                Check("failed mutation keeps its key", pending.ContainsKey("craft-start:bp"));
                Check("retry succeeds", call("craft-start:bp", succeeding, refresh));
                Check("retry reuses the failed request key", keys.Count == 2 && keys[0] == keys[1] && Guid.TryParse(keys[0], out _));
                Check("successful mutation clears its key", !pending.ContainsKey("craft-start:bp"));
                Check("next action gets a fresh key", call("craft-start:bp", succeeding, brokenRefresh) && keys[2] != keys[0]);
                Check("refresh failure never keeps a completed key", !pending.ContainsKey("craft-start:bp"));
                Check("different actions use different keys", call("craft-complete:1", succeeding, refresh) && keys[3] != keys[2]);
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }
    }
}
