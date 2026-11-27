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
    }
}
