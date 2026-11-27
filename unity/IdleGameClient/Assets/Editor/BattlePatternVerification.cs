using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace IdleGame.Editor
{
    public static class BattlePatternVerification
    {
        private static readonly List<string> passed = new List<string>();

        [MenuItem("Idle Game/Preview Bullet Battle")]
        public static void Preview()
        {
            if (!EditorApplication.isPlaying)
            {
                SessionState.SetBool("BulletBattlePreview", true);
                EditorApplication.EnterPlaymode();
                return;
            }
            var app = UnityEngine.Object.FindFirstObjectByType<ClientApp>();
            if (!app) throw new InvalidOperationException("Open the Bootstrap scene first.");
            app.BeginBulletPreview();
        }

        [InitializeOnLoadMethod]
        private static void Resume()
        {
            EditorApplication.update += AwaitPreview;
        }

        private static void AwaitPreview()
        {
            if (!SessionState.GetBool("BulletBattlePreview", false) || !EditorApplication.isPlaying) return;
            if (!UnityEngine.Object.FindFirstObjectByType<Canvas>()) return;
            SessionState.SetBool("BulletBattlePreview", false);
            Preview();
        }

        [MenuItem("Idle Game/Verify Bullet Patterns")]
        public static void Run() => Debug.Log(Verify());

        public static string Verify()
        {
            passed.Clear();
            var hit = EmptyRun();
            hit.Bullets.Add(Shot(0, 100, -2000));
            hit.Tick(.1f);
            Check("swept collision catches fast projectile", hit.Hp == 93 && hit.HitsTaken == 1 && hit.Bullets.Count == 0);

            var miss = EmptyRun();
            miss.Bullets.Add(Shot(30, 100, -2000));
            miss.Tick(.1f);
            Check("near miss outside small player hitbox", miss.Hp == 100);

            var burst = EmptyRun();
            burst.Bullets.Add(Shot(0, 100, -2000));
            burst.Bullets.Add(Shot(0, 100, -2000));
            burst.Tick(.1f);
            Check("overlapping bullets respect hit grace", burst.Hp == 93 && burst.HitsTaken == 1);

            var dodge = EmptyRun();
            dodge.Dodge(1);
            dodge.Tick(.01f);
            dodge.Bullets.Add(Shot(100, 100, -2000));
            dodge.Tick(.1f);
            Check("dash grants brief invulnerability", dodge.PlayerX == 100 && dodge.Hp == 100 && dodge.Bullets.Count == 0);
            dodge.Dodge(-1);
            Check("dash cooldown prevents repeat teleport", dodge.PlayerX == 100);
            for (int i = 0; i < 8; i++) dodge.Tick(.1f);
            dodge.Dodge(-1);
            Check("dash is available after cooldown", dodge.PlayerX == 0);

            var moving = EmptyRun();
            moving.MoveTo(500, 0, .1f);
            Check("movement is limited by speed", moving.PlayerX == 36);
            for (int i = 0; i < 10; i++) moving.MoveTo(500, 0, .1f);
            Check("movement stays inside arena", moving.PlayerX == 160);
            moving.MoveTo(float.NaN, 0, .1f);
            moving.Tick(float.NaN);
            Check("invalid input does not corrupt simulation", moving.PlayerX == 160 && !float.IsNaN(moving.Elapsed));

            var lifetime = EmptyRun();
            var expired = Shot(200, 100, 0); expired.Age = 9;
            lifetime.Bullets.Add(expired);
            lifetime.Tick(.1f);
            Check("expired projectiles are removed", lifetime.Bullets.Count == 0);

            var movingUp = EmptyRun();
            movingUp.MoveTo(0, 500, .1f);
            Check("vertical movement uses same speed", movingUp.PlayerY == 36);
            movingUp.Bullets.Add(Shot(0, 20, 0));
            movingUp.Tick(.1f);
            Check("vertical player motion sweeps against bullets", movingUp.Hp == 93);
            for (int i = 0; i < 20; i++) movingUp.MoveTo(-500, -500, .1f);
            Check("left and down movement stays inside arena", movingUp.PlayerX == -160 && movingUp.PlayerY == -180);
            var diagonal = EmptyRun();
            diagonal.MoveTo(100, 100, .1f);
            Check("diagonal movement does not gain speed", Math.Abs(Math.Sqrt(diagonal.PlayerX * diagonal.PlayerX +
                diagonal.PlayerY * diagonal.PlayerY) - 36) < .001);

            var nearest = NewRun();
            var close = new BattleRun.Enemy { X = 60, Y = 0, Hp = 20, MaxHp = 20, AttackWait = 10 };
            nearest.Enemies.Add(new BattleRun.Enemy { X = 0, Y = -200, Hp = 20, MaxHp = 20, AttackWait = 10 });
            nearest.Enemies.Add(close);
            nearest.Tick(.01f);
            Check("automatic shot targets closest enemy in two dimensions", nearest.Bullets.Exists(b => b.Friendly && b.Target == close));

            var surround = NewRun(false, 40);
            var seen = new HashSet<BattleRun.Enemy>();
            var sides = new HashSet<int>();
            bool approaching = true;
            for (int i = 0; i < 65; i++)
            {
                surround.Tick(.1f);
                foreach (var enemy in surround.Enemies)
                    if (seen.Add(enemy))
                    {
                        sides.Add(Math.Abs(enemy.Y) > 240 ? (enemy.Y > 0 ? 0 : 2) : (enemy.X > 0 ? 1 : 3));
                        float x = enemy.X, y = enemy.Y;
                        approaching &= x * x + y * y < (Math.Abs(y) > 240 ? 250 * 250 + x * x : 235 * 235 + y * y);
                    }
            }
            Check("enemies spawn on all four sides and approach player", sides.Count == 4 && approaching);

            var scout = NewRun();
            scout.Tick(.01f);
            Check("weak security robots use low health and contact damage", scout.Enemies[0].Name == "경비 로봇" &&
                scout.Enemies[0].Hp == 12 && scout.Enemies[0].Damage == 3);
            scout.Enemies[0].Hp = scout.Enemies[0].MaxHp = 100000;
            for (int i = 0; i < 100; i++) scout.Tick(.1f);
            Check("security robots never fire hostile bullets", scout.Bullets.FindAll(b => !b.Friendly).Count == 0 && scout.Enemies[0].ShotWave == 0);

            var progression = NewRun(false, 40);
            var firstSeen = new Dictionary<BattleRun.EnemyKind, float>();
            var firstHealth = new Dictionary<BattleRun.EnemyKind, float>();
            var lastHealth = new Dictionary<BattleRun.EnemyKind, float>();
            bool earlyGuardsOnly = true;
            for (int i = 0; i < 600; i++)
            {
                progression.Tick(.1f);
                foreach (var enemy in progression.Enemies)
                {
                    if (progression.Elapsed < 30) earlyGuardsOnly &= enemy.Kind == BattleRun.EnemyKind.Guard;
                    if (!firstSeen.ContainsKey(enemy.Kind))
                    { firstSeen.Add(enemy.Kind, progression.Elapsed); firstHealth.Add(enemy.Kind, enemy.MaxHp); }
                    lastHealth[enemy.Kind] = enemy.MaxHp;
                }
                progression.Enemies.Clear(); progression.Bullets.Clear();
            }
            Check("enemy classes unlock in guard rifle armored machine-gun order", earlyGuardsOnly && firstSeen.Count == 4 &&
                firstSeen[BattleRun.EnemyKind.Rifle] >= 30 && firstSeen[BattleRun.EnemyKind.Armored] >= 42 &&
                firstSeen[BattleRun.EnemyKind.MachineGun] >= 48 &&
                firstSeen[BattleRun.EnemyKind.Rifle] < firstSeen[BattleRun.EnemyKind.Armored] &&
                firstSeen[BattleRun.EnemyKind.Armored] < firstSeen[BattleRun.EnemyKind.MachineGun]);
            Check("late spawns gain health while armored enemies are toughest", lastHealth[BattleRun.EnemyKind.Guard] > firstHealth[BattleRun.EnemyKind.Guard] &&
                lastHealth[BattleRun.EnemyKind.Rifle] > firstHealth[BattleRun.EnemyKind.Rifle] &&
                lastHealth[BattleRun.EnemyKind.Armored] > lastHealth[BattleRun.EnemyKind.Rifle]);

            var rifle = EmptyRun();
            rifle.Enemies.Add(new BattleRun.Enemy { Kind = BattleRun.EnemyKind.Rifle, Y = 200, Hp = 10000, MaxHp = 10000, Damage = 4 });
            rifle.Tick(.01f);
            Check("rifle fires one aimed projectile", rifle.Bullets.FindAll(b => !b.Friendly).Count == 1 &&
                rifle.Bullets.Exists(b => !b.Friendly && b.VelocityY < 0 && Math.Abs(b.VelocityX) < .001f));
            for (int i = 0; i < 10; i++) rifle.Tick(.1f);
            Check("rifle pauses between single shots", rifle.Enemies[0].ShotWave == 1);

            var machine = EmptyRun();
            var gunner = new BattleRun.Enemy { Kind = BattleRun.EnemyKind.MachineGun, Y = 250, Hp = 10000, MaxHp = 10000, Damage = 3 };
            machine.Enemies.Add(gunner);
            machine.Tick(.01f);
            machine.MoveTo(100, 0, .1f);
            for (int i = 0; i < 18; i++) machine.Tick(.05f);
            Check("machine gun fires six rounds along its initial aim", gunner.ShotWave == 6 && gunner.BurstLeft == 0 &&
                machine.Bullets.FindAll(b => !b.Friendly).Count == 6 &&
                !machine.Bullets.Exists(b => !b.Friendly && Math.Abs(b.VelocityX) > 7));
            for (int i = 0; i < 10; i++) machine.Tick(.1f);
            Check("machine gun reload gives player a movement window", gunner.ShotWave == 6 && gunner.AttackWait > 0);

            var armored = EmptyRun();
            var heavy = new BattleRun.Enemy { Kind = BattleRun.EnemyKind.Armored, Y = 100, Hp = 10000, MaxHp = 10000, Damage = 6 };
            armored.Enemies.Add(heavy);
            armored.Tick(.1f);
            Check("armored robot moves slowly and does not shoot", Math.Abs(heavy.Y - 97.8f) < .001f &&
                heavy.Radius > 18 && !armored.Bullets.Exists(b => !b.Friendly));

            var contact = EmptyRun();
            contact.Enemies.Add(new BattleRun.Enemy { X = 20, Hp = 10000, MaxHp = 10000, Damage = 3, Y = 0 });
            contact.Tick(.1f);
            Check("touching robot deals contact damage", contact.Hp == 97 && contact.HitsTaken == 1);
            contact.Tick(.1f);
            Check("continuous contact respects hit protection", contact.Hp == 97 && contact.HitsTaken == 1);
            for (int i = 0; i < 5; i++) contact.Tick(.1f);
            Check("contact damage resumes after protection expires", contact.Hp == 94 && contact.HitsTaken == 2);

            var separated = EmptyRun();
            separated.Enemies.Add(new BattleRun.Enemy { X = 40, Y = 0, Hp = 10000, MaxHp = 10000, Damage = 3 });
            separated.Tick(.1f);
            Check("nearby robots do not deal damage before contact", separated.Hp == 100);

            var dashContact = EmptyRun();
            dashContact.Enemies.Add(new BattleRun.Enemy { X = 100, Y = 0, Hp = 10000, MaxHp = 10000, Damage = 3 });
            dashContact.Dodge(1);
            dashContact.Tick(.1f);
            Check("dash invulnerability also prevents contact damage", dashContact.Hp == 100);

            var firing = NewRun();
            var target = new BattleRun.Enemy { X = 0, Y = 100, Hp = 20, MaxHp = 20, AttackWait = 10 };
            firing.Enemies.Add(target);
            firing.Tick(.01f);
            Check("player damage waits for projectile impact", target.Hp == 20 && firing.ShotsFired == 1);
            for (int i = 0; i < 10; i++) firing.Tick(.1f);
            Check("projectile impact records kill and core", target.Hp <= 0 && firing.Kills >= 1 && firing.Core >= 5);

            var early = NewRun(true, 1, false);
            for (int i = 0; i < 299; i++) early.Tick(.1f);
            Check("first half contains no shooting boss or hostile bullets", early.Enemies.Count == 0 && !early.Bullets.Exists(b => !b.Friendly));
            for (int i = 0; i < 15; i++) early.Tick(.1f);
            Check("shooting boss arrives in second half", early.Enemies.Count == 1 && early.Bullets.Exists(b => !b.Friendly));

            var boss = NewRun(true);
            for (int i = 0; i < 13; i++) boss.Tick(.1f);
            int hostile = boss.Bullets.FindAll(b => !b.Friendly).Count;
            Check("boss emits nine-shot fan", hostile == 9 && boss.Enemies[0].ShotWave == 1);
            Check("fan has both left and right trajectories", boss.Bullets.Exists(b => !b.Friendly && b.VelocityX < -20) &&
                boss.Bullets.Exists(b => !b.Friendly && b.VelocityX > 20));
            for (int i = 0; i < 20; i++) boss.Tick(.1f);
            Check("boss alternates fan and aimed burst", boss.Enemies[0].ShotWave >= 2 && boss.Bullets.FindAll(b => !b.Friendly).Count > 9);
            for (int i = 0; i < 300; i++) boss.Tick(.1f);
            Check("projectile population is bounded", boss.Bullets.Count <= 256);

            var a = NewRun(true); var b = NewRun(true);
            for (int i = 0; i < 50; i++) { a.Tick(.1f); b.Tick(.1f); }
            bool identical = a.Hp == b.Hp && a.Bullets.Count == b.Bullets.Count;
            for (int i = 0; identical && i < a.Bullets.Count; i++)
                identical = a.Bullets[i].X == b.Bullets[i].X && a.Bullets[i].Y == b.Bullets[i].Y;
            Check("same seed and inputs produce same pattern", identical);

            var clock = EmptyRun(); float before = clock.Elapsed;
            clock.Tick(10);
            Check("frame stall advances at most 100ms", Math.Abs(clock.Elapsed - before - .1f) < .0001f);
            var upgraded = EmptyRun();
            upgraded.ApplyEffectiveStats(null);
            upgraded.ApplyEffectiveStats(JObject.Parse("{\"attackPower\":25,\"attackSpeed\":20,\"moveSpeed\":150,\"dashCooldown\":2500,\"maxHp\":130}"),
                new JObject { ["id"] = "machine_gun_1" });
            Check("effective stats raise attack power and clamp attack interval", upgraded.AttackPower == 25 &&
                Math.Abs(upgraded.AttackInterval - .05f) < .0001f);
            Check("effective stats scale move speed and dash cooldown", Math.Abs(upgraded.CurrentMoveSpeed - 540) < .01f &&
                Math.Abs(upgraded.DashCooldownDuration - .375f) < .0001f);
            Check("max hp gain heals the same amount", upgraded.MaxHp == 130 && upgraded.Hp == 130);
            Check("applied upgrade ids are recorded", upgraded.AppliedUpgrades.Count == 1 && upgraded.AppliedUpgrades[0] == "machine_gun_1");
            upgraded.MoveTo(500, 0, .1f);
            Check("raised move speed moves farther per step", Math.Abs(upgraded.PlayerX - 54) < .01f);
            upgraded.ApplyEffectiveStats(JObject.Parse("{\"dashCooldown\":100,\"maxHp\":90}"));
            Check("dash cooldown never drops below its floor", Math.Abs(upgraded.DashCooldownDuration - .2f) < .0001f);
            Check("lower max hp only clamps current hp", upgraded.MaxHp == 90 && upgraded.Hp == 90);
            upgraded.Dodge(1);
            for (int i = 0; i < 3; i++) upgraded.Tick(.1f);
            upgraded.Dodge(-1);
            Check("applied dash cooldown governs the next dash", Math.Abs(upgraded.PlayerX - 54) < .01f);

            var shielded = EmptyRun();
            shielded.ApplyEffectiveStats(JObject.Parse("{\"shieldHp\":10}"));
            shielded.Bullets.Add(Shot(0, 100, -2000));
            shielded.Tick(.1f);
            Check("shield absorbs damage before hp", shielded.Hp == 100 && shielded.ShieldHp == 3 && shielded.HitsTaken == 1);
            shielded.ApplyEffectiveStats(JObject.Parse("{\"shieldHp\":15}"));
            Check("raising shield capacity adds only the increase", shielded.ShieldHp == 8);
            for (int i = 0; i < 5; i++) shielded.Tick(.1f);
            shielded.Bullets.Add(Shot(0, 100, -2000));
            shielded.Tick(.1f);
            Check("hits that exceed the shield spill into hp", shielded.ShieldHp == 1 && shielded.Hp == 100);
            for (int i = 0; i < 5; i++) shielded.Tick(.1f);
            shielded.Bullets.Add(Shot(0, 100, -2000));
            shielded.Tick(.1f);
            Check("remaining damage reaches hp once the shield breaks", shielded.ShieldHp == 0 && Math.Abs(shielded.Hp - 94) < .001f);

            var regen = EmptyRun();
            regen.Bullets.Add(Shot(0, 100, -2000));
            regen.Tick(.1f);
            regen.ApplyEffectiveStats(JObject.Parse("{\"hpRegenPerSec\":10}"));
            for (int i = 0; i < 5; i++) regen.Tick(.1f);
            Check("hp regenerates per second", Math.Abs(regen.Hp - 98) < .01f);
            for (int i = 0; i < 10; i++) regen.Tick(.1f);
            Check("hp regeneration stops at max hp", regen.Hp == 100);

            var heal = NewRun();
            heal.ApplyEffectiveStats(JObject.Parse("{\"healOnKill\":5}"));
            heal.Bullets.Add(Shot(0, 100, -2000));
            heal.Enemies.Add(new BattleRun.Enemy { X = 0, Y = 100, Hp = 1, MaxHp = 1, AttackWait = 10 });
            for (int i = 0; i < 10; i++) heal.Tick(.1f);
            Check("kills heal by the healOnKill amount", heal.Kills == 1 && Math.Abs(heal.Hp - 98) < .01f);

            var practice = EmptyRun();
            var offer = BattleRun.BuildPracticeOffer(1);
            var selection = practice.BuildPracticeSelection(offer["options"][1]);
            practice.ApplyEffectiveStats(selection["effectiveStats"], selection["selectedUpgrade"]);
            Check("practice offer has three options with unchanged baseline stats", ((JArray)offer["options"]).Count == 3 &&
                Math.Abs(practice.AttackInterval - 1) < .0001f && Math.Abs(practice.DashCooldownDuration - .75f) < .0001f);
            Check("practice selection applies through effective stats", practice.MaxHp == 140 && practice.Hp == 140 &&
                practice.AppliedUpgrades.Count == 1 && practice.AppliedUpgrades[0] == "practice_armor_plate");
            // Upgrade notification flow: a pick at level 2, stale replays, then the next level-up must still open an offer.
            var levelTwoOffer = JObject.Parse("{\"accepted\":true,\"battleLevel\":2,\"upgradesAvailable\":true,\"pendingOffer\":{\"level\":2,\"options\":[]}}");
            var levelOneOffer = JObject.Parse("{\"accepted\":true,\"battleLevel\":1,\"upgradesAvailable\":true,\"pendingOffer\":{\"level\":1,\"options\":[]}}");
            var levelThreeOffer = JObject.Parse("{\"accepted\":true,\"battleLevel\":3,\"upgradesAvailable\":true,\"pendingOffer\":{\"level\":3,\"options\":[]}}");
            var levelTwoBare = JObject.Parse("{\"accepted\":true,\"battleLevel\":2,\"upgradesAvailable\":true,\"pendingOffer\":null}");
            var levelOneBare = JObject.Parse("{\"accepted\":true,\"battleLevel\":1,\"upgradesAvailable\":true,\"pendingOffer\":null}");
            var quiet = JObject.Parse("{\"accepted\":true,\"battleLevel\":2,\"upgradesAvailable\":false,\"pendingOffer\":null}");
            Check("first level-up offer opens the modal", ClientApp.DecideUpgradeProgress(levelTwoOffer, 0, false, false) == ClientApp.UpgradeProgressAction.OpenOffer);
            Check("stale level 1 and level 2 offers are ignored after the level 2 pick",
                ClientApp.DecideUpgradeProgress(levelOneOffer, 2, false, false) == ClientApp.UpgradeProgressAction.Ignore &&
                ClientApp.DecideUpgradeProgress(levelTwoOffer, 2, false, false) == ClientApp.UpgradeProgressAction.Ignore);
            Check("bare upgradesAvailable at the resolved level requests the next offer",
                ClientApp.DecideUpgradeProgress(levelTwoBare, 2, false, false) == ClientApp.UpgradeProgressAction.RequestOffer);
            Check("bare upgradesAvailable older than the resolved level is ignored",
                ClientApp.DecideUpgradeProgress(levelOneBare, 2, false, false) == ClientApp.UpgradeProgressAction.Ignore);
            Check("level 3 offer opens after the level 2 pick", ClientApp.DecideUpgradeProgress(levelThreeOffer, 2, false, false) == ClientApp.UpgradeProgressAction.OpenOffer);
            Check("responses without upgrades are ignored", ClientApp.DecideUpgradeProgress(quiet, 2, false, false) == ClientApp.UpgradeProgressAction.Ignore &&
                ClientApp.DecideUpgradeProgress(levelTwoBare, 2, false, true) == ClientApp.UpgradeProgressAction.Ignore);
            Check("ended battle still opens an unresolved pending offer", ClientApp.DecideUpgradeProgress(levelThreeOffer, 2, true, false) == ClientApp.UpgradeProgressAction.OpenOffer);
            Check("ended battle finishes on bare upgradesAvailable or a resolved offer",
                ClientApp.DecideUpgradeProgress(levelTwoBare, 2, true, false) == ClientApp.UpgradeProgressAction.Ignore &&
                ClientApp.DecideUpgradeProgress(levelTwoOffer, 2, true, false) == ClientApp.UpgradeProgressAction.Ignore);

            // Module bonuses from loadoutSnapshot.bonuses apply at the start, and effective stats then raise them.
            BattleRun WithLoadout(JToken loadout)
            {
                var loadoutStage = JObject.Parse("{\"name\":\"verification\",\"durationSeconds\":60,\"maxKills\":1}");
                var loadoutSession = new JObject { ["id"] = "loadout", ["loadoutSnapshot"] = loadout,
                    ["statSnapshot"] = new JObject { ["maxHp"] = 100, ["attackPower"] = 20, ["attackSpeed"] = 1000 } };
                return new BattleRun(loadoutStage, loadoutSession);
            }
            var bonusObject = WithLoadout(JObject.Parse("{\"bonuses\":{\"shieldHp\":10,\"hpRegenPerSec\":1}}"));
            var bonusString = WithLoadout("{\"bonuses\":{\"shieldHp\":10,\"hpRegenPerSec\":1}}");
            Check("loadout module bonuses set the initial shield and regen",
                bonusObject.ShieldHp == 10 && bonusObject.HpRegenPerSec == 1 && bonusString.ShieldHp == 10 && bonusString.HpRegenPerSec == 1);
            bonusObject.ApplyEffectiveStats(JObject.Parse("{\"shieldHp\":25,\"hpRegenPerSec\":3}"));
            Check("effective stats stack on top of module bonuses", bonusObject.ShieldHp == 25 && bonusObject.HpRegenPerSec == 3);
            var noLoadout = WithLoadout(null);
            Check("missing loadout bonuses leave defaults", noLoadout.ShieldHp == 0 && noLoadout.HpRegenPerSec == 0);

            var plain = NewRun();
            var plainTarget = new BattleRun.Enemy { X = 0, Y = 100, Hp = 100, MaxHp = 100, AttackWait = 10 };
            plain.Enemies.Add(plainTarget);
            for (int i = 0; i < 6; i++) plain.Tick(.1f);
            var crit = NewRun();
            crit.ApplyEffectiveStats(JObject.Parse("{\"critRate\":100,\"critDamage\":50}"));
            var critTarget = new BattleRun.Enemy { X = 0, Y = 100, Hp = 100, MaxHp = 100, AttackWait = 10 };
            crit.Enemies.Add(critTarget);
            for (int i = 0; i < 6; i++) crit.Tick(.1f);
            Check("hits without crit deal base damage", plainTarget.Hp == 80);
            Check("guaranteed crit deals 1.5x plus critDamage", crit.CritRate == 100 && crit.CritDamage == 50 && critTarget.Hp == 60);

            var fast = NewRun();
            fast.ApplyEffectiveStats(new JObject(), JObject.Parse("{\"id\":\"rail\",\"effects\":{\"projectileSpeed\":50}}"));
            fast.Enemies.Add(new BattleRun.Enemy { X = 0, Y = 100, Hp = 1000, MaxHp = 1000, AttackWait = 10 });
            fast.Tick(.01f);
            var fastShot = fast.Bullets.Find(shot => shot.Friendly);
            Check("picked projectileSpeed raises friendly shot speed", fast.ProjectileSpeedMultiplier == 1.5f && fastShot != null &&
                Math.Abs(Math.Sqrt(fastShot.VelocityX * fastShot.VelocityX + fastShot.VelocityY * fastShot.VelocityY) - 930) < 1);
            var totals = NewRun();
            totals.ApplyEffectiveStats(JObject.Parse("{\"projectileSpeed\":30}"), JObject.Parse("{\"id\":\"x\",\"effects\":{\"projectileSpeed\":30}}"));
            Check("effectiveStats projectileSpeed is a total, not stacked with the card", Math.Abs(totals.ProjectileSpeedMultiplier - 1.3f) < .0001f);

            // ── Ultimate ──
            var ultDefault = NewRun();
            Check("ultimate defaults to 30 power and a 30 second cooldown, ready at the start", ultDefault.UltimatePower == 30 &&
                Math.Abs(ultDefault.UltimateCooldownDuration - 30) < .0001f && ultDefault.UltimateCooldown == 0 && ultDefault.UltimatesUsed == 0);
            var ultSnapshot = WithStats("{\"ultimatePower\":50,\"ultimateCooldown\":12000}");
            Check("session snapshot sets ultimate power and cooldown", ultSnapshot.UltimatePower == 50 &&
                Math.Abs(ultSnapshot.UltimateCooldownDuration - 12) < .0001f);
            Check("ultimate cooldown never drops below 3 seconds", Math.Abs(WithStats("{\"ultimateCooldown\":500}").UltimateCooldownDuration - 3) < .0001f);

            var ult = EmptyRun();
            var ultWeak = Foe(0, 150, 20);
            var ultBoss = Foe(80, 150, 25); ultBoss.BossId = "ult-boss";
            var ultTank = Foe(-80, 150, 100);
            ult.Enemies.Add(ultWeak); ult.Enemies.Add(ultBoss); ult.Enemies.Add(ultTank);
            Check("ultimate fires when ready", ult.TriggerUltimate() && ult.UltimatesUsed == 1);
            Check("ultimate damages every enemy and defeats weak ones", ultWeak.Hp <= 0 && ultBoss.Hp <= 0 && ultTank.Hp == 70 &&
                ult.Kills == 2 && ult.Enemies.Count == 1 && ult.Enemies[0] == ultTank);
            Check("ultimate can defeat a boss and records it", ult.BossesDefeated.Count == 1 && ult.BossesDefeated[0] == "ult-boss");
            Check("ultimate starts its cooldown and blocks a second use", !ult.TriggerUltimate() && ult.UltimatesUsed == 1 &&
                Math.Abs(ult.UltimateCooldown - 30) < .001f);
            ult.Enemies.Clear();
            for (int i = 0; i < 299; i++) ult.Tick(.1f);
            Check("ultimate stays on cooldown until the full duration passes", !ult.TriggerUltimate() && ult.UltimateCooldown > 0);
            ult.Tick(.1f); ult.Tick(.1f);
            Check("ultimate is available again after its cooldown", ult.UltimateCooldown == 0 && ult.TriggerUltimate() && ult.UltimatesUsed == 2);

            var ultEnded = EmptyRun();
            for (int i = 0; i < 610; i++) ultEnded.Tick(.1f);
            Check("ultimate cannot fire after the battle ended", ultEnded.Ended && !ultEnded.TriggerUltimate() && ultEnded.UltimatesUsed == 0);

            var ultShield = EmptyRun();
            ultShield.TriggerUltimate();
            ultShield.Bullets.Add(Shot(0, 100, -2000));
            ultShield.Tick(.1f);
            Check("ultimate grants brief invulnerability", ultShield.Hp == 100 && ultShield.HitsTaken == 0);
            for (int i = 0; i < 3; i++) ultShield.Tick(.1f);
            ultShield.Bullets.Add(Shot(0, 100, -2000));
            ultShield.Tick(.1f);
            Check("ultimate invulnerability expires after 0.35 seconds", ultShield.Hp == 93 && ultShield.HitsTaken == 1);

            var ultUp = Armed("{\"ultimatePower\":45,\"ultimateCooldown\":20000}");
            var ultVictim = Foe(0, 150, 40);
            ultUp.Enemies.Add(ultVictim);
            ultUp.TriggerUltimate();
            Check("ultimate upgrades raise power and shorten the cooldown", ultUp.UltimatePower == 45 && ultVictim.Hp <= 0 &&
                Math.Abs(ultUp.UltimateCooldown - 20) < .001f);
            ultUp.ApplyEffectiveStats(JObject.Parse("{\"ultimateCooldown\":1000}"));
            Check("upgraded ultimate cooldown keeps the 3 second floor", Math.Abs(ultUp.UltimateCooldownDuration - 3) < .0001f);

            var ultCluster = Armed("{\"bombRadius\":3}");
            for (int i = 0; i < 6; i++) ultCluster.Enemies.Add(Foe(i * 10, 150, 30));
            ultCluster.TriggerUltimate();
            Check("ultimate with kill explosions iterates a snapshot safely", ultCluster.Kills == 6 && ultCluster.Enemies.Count == 0);

            // ── Splash ──
            var splash = Armed("{\"splashRadius\":2}");
            var splashHit = Foe(0, 120, 100); var splashNear = Foe(30, 120, 100); var splashFar = Foe(100, 120, 100);
            splash.Enemies.Add(splashHit); splash.Enemies.Add(splashNear); splash.Enemies.Add(splashFar);
            Strike(splash, splashHit, 10);
            splash.Tick(.1f);
            Check("splash deals half damage to enemies near the impact", splashHit.Hp == 90 && Math.Abs(splashNear.Hp - 95) < .001f);
            Check("splash leaves enemies outside its radius untouched", splashFar.Hp == 100 && splash.SplashRadius == 2);
            var splashKill = Armed("{\"splashRadius\":2}");
            var splashCenter = Foe(0, 120, 100); var splashWeak = Foe(30, 120, 4);
            splashKill.Enemies.Add(splashCenter); splashKill.Enemies.Add(splashWeak);
            Strike(splashKill, splashCenter, 10);
            splashKill.Tick(.1f);
            Check("splash defeats weakened enemies", splashKill.Kills == 1 && !splashKill.Enemies.Contains(splashWeak) && splashCenter.Hp == 90);
            var noSplash = EmptyRun();
            var noSplashHit = Foe(0, 120, 100); var noSplashNear = Foe(30, 120, 100);
            noSplash.Enemies.Add(noSplashHit); noSplash.Enemies.Add(noSplashNear);
            Strike(noSplash, noSplashHit, 10);
            noSplash.Tick(.1f);
            Check("without splash nearby enemies take no damage", noSplashNear.Hp == 100);

            // ── Chain lightning ──
            var chain = Armed("{\"chainTargets\":2}");
            var chainHit = Foe(0, 120, 100); var chainA = Foe(50, 120, 100); var chainB = Foe(0, 200, 100);
            var chainC = Foe(100, 120, 100); var chainD = Foe(200, 120, 100);
            chain.Enemies.AddRange(new[] { chainHit, chainA, chainB, chainC, chainD });
            Strike(chain, chainHit, 10);
            chain.Tick(.1f);
            Check("chain hits the nearest enemies for 60% damage", chainHit.Hp == 90 && Math.Abs(chainA.Hp - 94) < .001f && Math.Abs(chainB.Hp - 94) < .001f);
            Check("chain respects target count and range", chainC.Hp == 100 && chainD.Hp == 100 && chain.ChainTargets == 2);
            var chainOne = Armed("{\"chainTargets\":1}");
            var chainOneHit = Foe(0, 120, 100); var chainOneNear = Foe(50, 120, 5); var chainOneBeyond = Foe(100, 120, 100);
            chainOne.Enemies.AddRange(new[] { chainOneHit, chainOneNear, chainOneBeyond });
            Strike(chainOne, chainOneHit, 10);
            chainOne.Tick(.1f);
            Check("chain defeats weak targets and does not re-chain", chainOne.Kills == 1 && !chainOne.Enemies.Contains(chainOneNear) &&
                chainOneBeyond.Hp == 100);
            var chainAlone = Armed("{\"chainTargets\":5}");
            var chainAloneHit = Foe(0, 120, 100);
            chainAlone.Enemies.Add(chainAloneHit);
            Strike(chainAlone, chainAloneHit, 10);
            chainAlone.Tick(.1f);
            Check("chain with no other enemies in range is harmless", chainAloneHit.Hp == 90 && chainAlone.Enemies.Count == 1);

            // ── Kill explosion ──
            var bomb = Armed("{\"bombRadius\":2}");
            var bombVictim = Foe(0, 120, 1); var bombNear = Foe(40, 120, 100); var bombFar = Foe(300, 120, 100);
            bomb.Enemies.AddRange(new[] { bombVictim, bombNear, bombFar });
            Strike(bomb, bombVictim, 10);
            bomb.Tick(.1f);
            Check("kill explosion deals 80% attack power around the victim", bomb.Kills == 1 && Math.Abs(bombNear.Hp - 84) < .001f && bombFar.Hp == 100);
            var bombChain = Armed("{\"bombRadius\":2}");
            var bombLine = new List<BattleRun.Enemy> { Foe(0, 120, 1) };
            for (int i = 1; i <= 4; i++) bombLine.Add(Foe(i * 50, 120, 10));
            bombChain.Enemies.AddRange(bombLine);
            Strike(bombChain, bombLine[0], 10);
            bombChain.Tick(.1f);
            Check("explosion chain reactions stop after three levels", bombChain.Kills == 4 && bombLine[4].Hp == 10 &&
                bombChain.Enemies.Count == 1 && bombChain.Enemies[0] == bombLine[4]);

            // ── Burn and duration ──
            var burnHit = Armed("{\"duration\":100}");
            var burnTarget = Foe(0, 120, 1000);
            burnHit.Enemies.Add(burnTarget);
            Strike(burnHit, burnTarget, 10);
            burnHit.Tick(.1f);
            Check("direct hit ignites with duration-scaled burn at a quarter of attack power", Math.Abs(burnTarget.BurnDps - 5) < .001f &&
                Math.Abs(burnTarget.BurnRemaining - 2.9f) < .001f && Math.Abs(burnTarget.Hp - 989.5f) < .01f);
            var coldHit = EmptyRun();
            var coldTarget = Foe(0, 120, 1000);
            coldHit.Enemies.Add(coldTarget);
            Strike(coldHit, coldTarget, 10);
            coldHit.Tick(.1f);
            Check("without duration bonus hits do not burn", coldTarget.BurnRemaining == 0 && coldTarget.Hp == 990);
            var burnTick = EmptyRun();
            var burning = Foe(0, 200, 100); burning.BurnRemaining = 1.5f; burning.BurnDps = 5;
            burnTick.Enemies.Add(burning);
            for (int i = 0; i < 5; i++) burnTick.Tick(.1f);
            Check("burn deals damage over time and counts down", Math.Abs(burning.Hp - 97.5f) < .01f && Math.Abs(burning.BurnRemaining - 1) < .001f);
            var burnEnd = EmptyRun();
            var embers = Foe(0, 200, 100); embers.BurnRemaining = .2f; embers.BurnDps = 5;
            burnEnd.Enemies.Add(embers);
            for (int i = 0; i < 5; i++) burnEnd.Tick(.1f);
            Check("burn stops after its remaining time", Math.Abs(embers.Hp - 99) < .01f && embers.BurnRemaining == 0);
            var burnKill = EmptyRun();
            var scorched = Foe(0, 200, 5); scorched.BurnRemaining = 3; scorched.BurnDps = 10;
            burnKill.Enemies.Add(scorched);
            for (int i = 0; i < 6; i++) burnKill.Tick(.1f);
            Check("burn damage can defeat enemies", burnKill.Kills == 1 && burnKill.Enemies.Count == 0);
            var dashBase = EmptyRun(); var dashLong = Armed("{\"duration\":100}");
            foreach (var dasher in new[] { dashBase, dashLong })
            {
                dasher.Dodge(1);
                for (int i = 0; i < 3; i++) dasher.Tick(.1f);
                dasher.Bullets.Add(Shot(100, 100, -2000));
                dasher.Tick(.1f);
            }
            Check("duration bonus extends dash invulnerability", dashBase.Hp == 93 && dashLong.Hp == 100);
            var ultLong = Armed("{\"duration\":100}");
            ultLong.TriggerUltimate();
            for (int i = 0; i < 4; i++) ultLong.Tick(.1f);
            ultLong.Bullets.Add(Shot(0, 100, -2000));
            ultLong.Tick(.1f);
            Check("duration bonus extends ultimate invulnerability", ultLong.DurationBonus == 100 && ultLong.Hp == 100);

            // ── effectiveStats totals versus old-server selectedUpgrade.effects ──
            var totalsRun = EmptyRun();
            var comboCard = JObject.Parse("{\"id\":\"combo\",\"effects\":{\"splashRadius\":3,\"chainTargets\":2,\"bombRadius\":4,\"duration\":25}}");
            totalsRun.ApplyEffectiveStats(JObject.Parse("{\"splashRadius\":3,\"chainTargets\":2,\"bombRadius\":4,\"duration\":25,\"ultimatePower\":33,\"ultimateCooldown\":27000}"), comboCard);
            Check("effectiveStats totals are not stacked with the card deltas", totalsRun.SplashRadius == 3 && totalsRun.ChainTargets == 2 &&
                totalsRun.BombRadius == 4 && totalsRun.DurationBonus == 25 && totalsRun.UltimatePower == 33 &&
                Math.Abs(totalsRun.UltimateCooldownDuration - 27) < .0001f);
            totalsRun.ApplyEffectiveStats(JObject.Parse("{\"splashRadius\":5,\"chainTargets\":1,\"bombRadius\":4,\"duration\":0}"), comboCard);
            Check("later effectiveStats totals replace earlier values", totalsRun.SplashRadius == 5 && totalsRun.ChainTargets == 1 &&
                totalsRun.BombRadius == 4 && totalsRun.DurationBonus == 0);
            var legacyRun = EmptyRun();
            legacyRun.ApplyEffectiveStats(JObject.Parse("{\"attackPower\":22}"), comboCard);
            legacyRun.ApplyEffectiveStats(JObject.Parse("{\"attackPower\":24}"), comboCard);
            Check("old servers without effect totals accumulate card deltas", legacyRun.SplashRadius == 6 && legacyRun.ChainTargets == 4 &&
                legacyRun.BombRadius == 8 && legacyRun.DurationBonus == 50);
            var mixedRun = EmptyRun();
            mixedRun.ApplyEffectiveStats(JObject.Parse("{\"splashRadius\":3}"), comboCard);
            Check("each effect key falls back independently", mixedRun.SplashRadius == 3 && mixedRun.ChainTargets == 2 &&
                mixedRun.BombRadius == 4 && mixedRun.DurationBonus == 25);
            var noEffects = EmptyRun();
            noEffects.ApplyEffectiveStats(null, new JObject { ["id"] = "plain" });
            Check("combat effects stay off by default", noEffects.SplashRadius == 0 && noEffects.ChainTargets == 0 &&
                noEffects.BombRadius == 0 && noEffects.DurationBonus == 0);

            var practiceFx = EmptyRun();
            for (int level = 1; level <= 5; level++)
                foreach (var option in BattleRun.BuildPracticeOffer(level)["options"])
                {
                    var pick = practiceFx.BuildPracticeSelection(option);
                    practiceFx.ApplyEffectiveStats(pick["effectiveStats"], pick["selectedUpgrade"]);
                }
            Check("practice offers cover ultimate splash chain bomb and duration", practiceFx.SplashRadius == 2 && practiceFx.ChainTargets == 2 &&
                practiceFx.BombRadius == 3 && practiceFx.DurationBonus == 20 && Math.Abs(practiceFx.UltimatePower - 36) < .001f &&
                Math.Abs(practiceFx.UltimateCooldownDuration - 25) < .0001f);

            // New effects must not consume the spawn random: spawn placement is identical with and without them.
            List<float> SpawnTrail(bool effects)
            {
                var run = NewRun(false, 40);
                run.ApplyEffectiveStats(JObject.Parse(effects ?
                    "{\"maxHp\":1000000,\"splashRadius\":3,\"chainTargets\":3,\"bombRadius\":3,\"duration\":50,\"ultimatePower\":500,\"ultimateCooldown\":3000,\"critRate\":50}" :
                    "{\"maxHp\":1000000}"));
                var trail = new List<float>();
                var known = new HashSet<BattleRun.Enemy>();
                for (int i = 0; i < 450; i++)
                {
                    if (effects) run.TriggerUltimate();
                    run.Tick(.1f);
                    foreach (var enemy in run.Enemies)
                        if (known.Add(enemy)) { trail.Add(enemy.X); trail.Add(enemy.Y); }
                }
                return trail;
            }
            var plainTrail = SpawnTrail(false); var armedTrail = SpawnTrail(true);
            bool sameTrail = plainTrail.Count > 0 && plainTrail.Count == armedTrail.Count;
            for (int i = 0; sameTrail && i < plainTrail.Count; i++) sameTrail = plainTrail[i] == armedTrail[i];
            Check("combat effects leave enemy spawn positions unchanged", sameTrail);

            // ── Dash and ultimate invulnerability never shorten each other ──
            var ultDash = EmptyRun();
            ultDash.TriggerUltimate();
            ultDash.Dodge(1);
            ultDash.Tick(.1f); ultDash.Tick(.1f);
            ultDash.Bullets.Add(Shot(100, 100, -2000));
            ultDash.Tick(.1f);
            Check("dash right after the ultimate keeps the longer invulnerability", ultDash.PlayerX == 100 && ultDash.IsInvulnerable &&
                ultDash.Hp == 100 && ultDash.HitsTaken == 0);
            var dashUlt = EmptyRun();
            dashUlt.Dodge(1);
            dashUlt.TriggerUltimate();
            dashUlt.Tick(.1f); dashUlt.Tick(.1f);
            dashUlt.Bullets.Add(Shot(100, 100, -2000));
            dashUlt.Tick(.1f);
            Check("ultimate right after a dash extends invulnerability to 0.35 seconds", dashUlt.IsInvulnerable &&
                dashUlt.Hp == 100 && dashUlt.HitsTaken == 0);

            // ── Practice battle: every new effect is reachable through real progress within 60 seconds ──
            var practiceBattle = new BattleRun(BattleRun.BuildPracticeStage(), BattleRun.BuildPracticeSession());
            int offersOpened = 0, nextOfferCore = BattleRun.PracticeUpgradeCoreStep;
            var wantedEffects = new[] { "ultimatePower", "splashRadius", "chainTargets", "bombRadius", "duration" };
            var gotEffects = new HashSet<string>();
            int effectsByLevelFive = 0;
            for (int i = 0; i < 650 && !practiceBattle.Ended; i++)
            {
                practiceBattle.Tick(.1f);
                while (nextOfferCore <= practiceBattle.MaxCore && practiceBattle.Core >= nextOfferCore)
                {
                    var practiceOffer = BattleRun.BuildPracticeOffer(++offersOpened);
                    nextOfferCore += BattleRun.PracticeUpgradeCoreStep;
                    JToken chosen = practiceOffer["options"][0];
                    foreach (var candidate in practiceOffer["options"])
                        foreach (var key in wantedEffects)
                            if (candidate["effects"]?[key] != null && !gotEffects.Contains(key)) chosen = candidate;
                    foreach (var key in wantedEffects)
                        if (chosen["effects"]?[key] != null) gotEffects.Add(key);
                    var practiceChoice = practiceBattle.BuildPracticeSelection(chosen);
                    practiceBattle.ApplyEffectiveStats(practiceChoice["effectiveStats"], practiceChoice["selectedUpgrade"]);
                    if (offersOpened == 5) effectsByLevelFive = gotEffects.Count;
                }
            }
            Check("practice battle reaches the fifth upgrade offer through play", offersOpened >= 5 && practiceBattle.Core >= 250);
            Check("practice offers 1-5 deliver ultimate splash chain bomb and duration during play", effectsByLevelFive == 5 &&
                practiceBattle.UltimatePower > 30 && practiceBattle.UltimateCooldownDuration < 30 && practiceBattle.SplashRadius > 0 &&
                practiceBattle.ChainTargets > 0 && practiceBattle.BombRadius > 0 && practiceBattle.DurationBonus > 0);
            return "BULLET_TESTS_PASS: " + passed.Count + " checks\n" + string.Join("\n", passed);
        }

        private static BattleRun NewRun(bool boss = false, int maxKills = 1, bool advanceToBoss = true)
        {
            var stage = JObject.Parse("{\"name\":\"verification\",\"durationSeconds\":60,\"maxKills\":1}");
            stage["maxKills"] = maxKills;
            if (boss)
            {
                stage["bossTimings"] = new JArray(0);
                stage["bosses"] = new JArray(new JObject { ["code"] = "test", ["hp"] = 100000, ["attackPower"] = 8 });
            }
            var session = new JObject { ["id"] = "verification", ["sessionSeed"] = "repeatable",
                ["statSnapshot"] = new JObject { ["maxHp"] = boss ? 100000 : 100, ["attackPower"] = boss ? 1 : 20, ["attackSpeed"] = 1000 } };
            var run = new BattleRun(stage, session);
            if (boss && advanceToBoss)
                for (int i = 0; i < 299; i++) run.Tick(.1f);
            return run;
        }

        private static BattleRun EmptyRun()
        {
            var run = NewRun(); run.Tick(.01f);
            run.Enemies.Clear(); run.Bullets.Clear();
            return run;
        }

        private static BattleRun.Bullet Shot(float x, float y, float velocity)
        {
            return new BattleRun.Bullet { X = x, Y = y, VelocityY = velocity, Damage = 7, Radius = 5 };
        }

        private static BattleRun.Enemy Foe(float x, float y, float hp)
        {
            return new BattleRun.Enemy { X = x, Y = y, Hp = hp, MaxHp = hp, Damage = 3, AttackWait = 10 };
        }

        // A friendly shot that reaches the target on the next 0.1 second tick.
        private static void Strike(BattleRun run, BattleRun.Enemy target, float damage)
        {
            run.Bullets.Add(new BattleRun.Bullet { X = target.X, Y = target.Y - 60, Friendly = true, Target = target,
                Damage = damage, Radius = 4 });
        }

        private static BattleRun Armed(string effectiveStats)
        {
            var run = EmptyRun();
            run.ApplyEffectiveStats(JObject.Parse(effectiveStats));
            return run;
        }

        private static BattleRun WithStats(string extraStats)
        {
            var snapshot = new JObject { ["maxHp"] = 100, ["attackPower"] = 20, ["attackSpeed"] = 1000 };
            snapshot.Merge(JObject.Parse(extraStats));
            var stage = JObject.Parse("{\"name\":\"verification\",\"durationSeconds\":60,\"maxKills\":1}");
            return new BattleRun(stage, new JObject { ["id"] = "verification", ["statSnapshot"] = snapshot });
        }

        private static void Check(string name, bool condition)
        {
            if (!condition) throw new InvalidOperationException("BULLET_TEST_FAILED: " + name);
            passed.Add(name);
        }
    }
}
