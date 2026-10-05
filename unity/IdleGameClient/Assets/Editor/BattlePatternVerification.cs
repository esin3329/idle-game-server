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

        private static void Check(string name, bool condition)
        {
            if (!condition) throw new InvalidOperationException("BULLET_TEST_FAILED: " + name);
            passed.Add(name);
        }
    }
}
