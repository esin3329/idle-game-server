using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace IdleGame
{
    // Combat uses simulation time, never timeScale or a client-supplied reward value.
    public sealed class BattleRun
    {
        public sealed class Enemy
        {
            public string Name, BossId;
            public float X, Y = 250, Hp, MaxHp, Damage;
            public float AttackWait;
        }

        public readonly List<Enemy> Enemies = new List<Enemy>();
        public readonly List<string> BossesDefeated = new List<string>();
        public readonly string SessionId, StageName;
        public readonly int Duration, MaxKills, MaxCore;
        public readonly float MaxHp, AttackPower, AttackInterval;
        public float Elapsed { get; private set; }
        public float Hp { get; private set; }
        public float PlayerX { get; private set; }
        public int Kills { get; private set; }
        public int Core { get; private set; }
        public bool Ended => Hp <= 0 || Elapsed >= Duration;
        public bool Cleared => Hp > 0 && Elapsed >= Duration && BossesDefeated.Count == bossDefinitions.Count;
        private readonly JArray bossDefinitions, bossTimes;
        private readonly Random random;
        private readonly int corePerKill;
        private int nextBoss, spawned;
        private float shotWait, spawnWait, dodgeWait, invincible;

        public BattleRun(JToken stage, JToken session)
        {
            SessionId = (string)session["sessionId"] ?? (string)session["id"];
            StageName = (string)stage["name"];
            Duration = (int?)stage["durationSeconds"] ?? 0;
            MaxKills = (int?)stage["maxKills"] ?? 0;
            MaxCore = (int?)stage["maxCoreEnergy"] ?? 300;
            corePerKill = (int?)stage["corePerKill"] ?? 5;
            var stats = session["statSnapshot"];
            if (stats?.Type == JTokenType.String) stats = JToken.Parse((string)stats);
            MaxHp = (float?)stats?["maxHp"] ?? 0;
            AttackPower = (float?)stats?["attackPower"] ?? 0;
            AttackInterval = ((float?)stats?["attackSpeed"] ?? 0) / 1000f;
            bossDefinitions = stage["bosses"] as JArray ?? new JArray();
            var times = stage["bossTimings"];
            bossTimes = times?.Type == JTokenType.String ? JArray.Parse((string)times) : times as JArray ?? new JArray();
            if (string.IsNullOrEmpty(SessionId) || Duration <= 0 || MaxKills <= 0 ||
                MaxHp <= 0 || AttackPower <= 0 || AttackInterval <= 0 || bossDefinitions.Count != bossTimes.Count)
                throw new ArgumentException("서버의 전투 스탯 또는 보스 정보가 부족합니다.");
            foreach (var boss in bossDefinitions)
                if (string.IsNullOrEmpty((string)boss["code"]) || (float?)boss["hp"] <= 0 || boss["hp"] == null)
                    throw new ArgumentException("보스 정보를 확인할 수 없습니다.");
            int seed = 17;
            foreach (char c in (string)session["sessionSeed"] ?? SessionId) seed = unchecked(seed * 31 + c);
            random = new Random(seed);
            Hp = MaxHp;
        }

        public void Dodge(int direction)
        {
            if (Ended || dodgeWait > 0) return;
            PlayerX = Math.Max(-160, Math.Min(160, PlayerX + Math.Sign(direction) * 100));
            dodgeWait = 1.5f;
            invincible = .6f;
        }

        public void Tick(float delta)
        {
            if (Ended || delta <= 0) return;
            // Frame stalls do not manufacture kills or advance the simulation by minutes.
            delta = Math.Min(delta, .1f);
            Elapsed = Math.Min(Duration, Elapsed + delta);
            dodgeWait -= delta;
            invincible -= delta;
            spawnWait -= delta;
            shotWait -= delta;
            while (nextBoss < bossTimes.Count && Elapsed >= (float)bossTimes[nextBoss])
            {
                var boss = bossDefinitions[nextBoss++];
                Enemies.Add(new Enemy { Name = (string)boss["name"], BossId = (string)boss["code"],
                    Hp = (float)boss["hp"], MaxHp = (float)boss["hp"], Damage = (float?)boss["attackPower"] ?? 10 });
            }
            if (spawnWait <= 0 && spawned < MaxKills - bossDefinitions.Count)
            {
                spawnWait = Math.Max(2, (float)Duration / MaxKills);
                spawned++;
                // MVP scout balance. Boss and player stats come from the server.
                Enemies.Add(new Enemy { Name = "정찰 드론", X = random.Next(-160, 161), Hp = 20, MaxHp = 20, Damage = 5 });
            }
            if (shotWait <= 0 && Enemies.Count > 0)
            {
                shotWait = Math.Max(.05f, AttackInterval);
                var target = Enemies.Find(e => e.BossId != null) ?? Enemies[0];
                target.Hp -= AttackPower;
                if (target.Hp <= 0)
                {
                    Enemies.Remove(target);
                    Kills++;
                    Core = Math.Min(MaxCore, Core + corePerKill);
                    if (target.BossId != null) BossesDefeated.Add(target.BossId);
                }
            }
            foreach (var enemy in Enemies)
            {
                enemy.Y = Math.Max(-180, enemy.Y - delta * (enemy.BossId == null ? 45 : 25));
                enemy.AttackWait -= delta;
                if (enemy.Y <= -170 && Math.Abs(enemy.X - PlayerX) < 75 && enemy.AttackWait <= 0)
                {
                    enemy.AttackWait = 1;
                    if (invincible <= 0) Hp = Math.Max(0, Hp - enemy.Damage);
                }
            }
        }
    }
}
