using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace IdleGame
{
    // Combat uses simulation time, never timeScale or a client-supplied reward value.
    public sealed class BattleRun
    {
        public enum EnemyKind { Guard, Rifle, Armored, MachineGun }

        public sealed class Enemy
        {
            public string Name, BossId;
            public EnemyKind Kind;
            public float X, Y = 250, Hp, MaxHp, Damage;
            public float AttackWait, BurstAim;
            public int ShotWave, BurstLeft;
            public float LastShotAt = -10, LastHitAt = -10;
            public float BurnRemaining, BurnDps;
            public bool Moving;
            public bool IsRanged => BossId != null || Kind == EnemyKind.Rifle || Kind == EnemyKind.MachineGun;
            public float Radius => BossId != null ? 32 : Kind == EnemyKind.Armored ? 26 : 18;
        }

        public sealed class Bullet
        {
            public float X, Y, VelocityX, VelocityY, Damage, Radius = 5, Age;
            public bool Friendly;
            public EnemyKind Weapon;
            public bool BossShot;
            public Enemy Target;
        }

        public readonly List<Enemy> Enemies = new List<Enemy>();
        public readonly List<Bullet> Bullets = new List<Bullet>();
        public const float PlayerRadius = 9, MoveSpeed = 360;
        private const float DefaultDashCooldown = .75f, BaseDashCooldownMs = 5000, MinDashCooldown = .2f, MinAttackInterval = .05f;
        private const float ProjectileBaseSpeed = 620f, CritBaseMultiplier = 1.5f;
        // Combat-effect tuning: area radii are scaled from the server's per-upgrade units to arena units.
        private const float DefaultUltimatePower = 30f, DefaultUltimateCooldownMs = 30000f, MinUltimateCooldown = 3f;
        private const float UltimateInvincibleSeconds = .35f, DodgeInvincibleSeconds = .25f;
        private const float SplashUnitRadius = 24f, SplashDamageRatio = .5f;
        private const float ChainRange = 140f, ChainDamageRatio = .6f;
        private const float BombUnitRadius = 28f, BombDamageRatio = .8f;
        private const int MaxExplosionDepth = 3;
        private const float BurnBaseSeconds = 1.5f, BurnDpsRatio = .25f;
        public readonly List<string> BossesDefeated = new List<string>();
        public readonly string SessionId, StageName;
        public readonly int Duration, MaxKills, MaxCore;
        public float MaxHp { get; private set; }
        public float AttackPower { get; private set; }
        public float AttackInterval { get; private set; }
        // Per-instance stats from the server snapshot and in-battle upgrades; MoveSpeed stays the 100% baseline.
        public float CurrentMoveSpeed { get; private set; } = MoveSpeed;
        public float DashCooldownDuration { get; private set; } = DefaultDashCooldown;
        public float HpRegenPerSec { get; private set; }
        public float ShieldHp { get; private set; }
        public float HealOnKill { get; private set; }
        // Crit chance and extra crit damage are percentages; ProjectileSpeedMultiplier scales friendly shot speed.
        public float CritRate { get; private set; }
        public float CritDamage { get; private set; }
        public float ProjectileSpeedMultiplier { get; private set; } = 1f;
        // Ultimate: power is the damage dealt to every enemy; the cooldown is in seconds (server ms / 1000, at least 3 s).
        public float UltimatePower { get; private set; } = DefaultUltimatePower;
        public float UltimateCooldownDuration { get; private set; } = DefaultUltimateCooldownMs / 1000f;
        public float UltimateCooldown => Math.Max(0, ultimateWait);
        public int UltimatesUsed { get; private set; }
        // Combat effects from upgrades: splash/bomb radii and chain count are units; DurationBonus is a percentage.
        public float SplashRadius { get; private set; }
        public int ChainTargets { get; private set; }
        public float BombRadius { get; private set; }
        public float DurationBonus { get; private set; }
        public readonly List<string> AppliedUpgrades = new List<string>();
        public float Elapsed { get; private set; }
        public float Hp { get; private set; }
        public float PlayerX { get; private set; }
        public float PlayerY { get; private set; }
        public float AimX { get; private set; }
        public float AimY { get; private set; } = 1;
        public int Kills { get; private set; }
        public int Core { get; private set; }
        public int ShotsFired { get; private set; }
        public int HitsTaken { get; private set; }
        public float DodgeCooldown => Math.Max(0, dodgeWait);
        public bool IsInvulnerable => invincible > 0;
        public bool HitFlash => hitFlash > 0;
        public bool Ended => Hp <= 0 || Elapsed >= Duration;
        public bool Cleared => Hp > 0 && Elapsed >= Duration && BossesDefeated.Count == bossDefinitions.Count;
        private readonly JArray bossDefinitions, bossTimes;
        private readonly Random random;
        private readonly int corePerKill;
        private int nextBoss, spawned;
        private float shieldCapacity;
        private readonly Random critRandom;
        private float shotWait, spawnWait, dodgeWait, invincible, hitFlash, lastPlayerX, lastPlayerY, ultimateWait;

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
            float moveSpeed = (float?)stats?["moveSpeed"] ?? 0;
            if (moveSpeed > 0) CurrentMoveSpeed = MoveSpeed * moveSpeed / 100f;
            float dashCooldown = (float?)stats?["dashCooldown"] ?? 0;
            if (dashCooldown > 0) DashCooldownDuration = ScaleDashCooldown(dashCooldown);
            float ultimatePower = (float?)stats?["ultimatePower"] ?? 0;
            if (ultimatePower > 0) UltimatePower = ultimatePower;
            float ultimateCooldown = (float?)stats?["ultimateCooldown"] ?? 0;
            if (ultimateCooldown > 0) UltimateCooldownDuration = ScaleUltimateCooldown(ultimateCooldown);
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
            critRandom = new Random(unchecked(seed ^ 0x2F6B1D));
            ApplyLoadoutBonuses(session["loadoutSnapshot"]);
            Hp = MaxHp;
        }

        // Module bonuses from the session's loadoutSnapshot (JSON object or JSON string) apply from the first tick.
        private void ApplyLoadoutBonuses(JToken loadout)
        {
            if (loadout?.Type == JTokenType.String)
            {
                try { loadout = JToken.Parse((string)loadout); }
                catch (Newtonsoft.Json.JsonException) { return; }
            }
            var bonuses = (loadout as JObject)?["bonuses"] as JObject;
            if (bonuses == null) return;
            float shield = Math.Max(0, (float?)bonuses["shieldHp"] ?? 0);
            ShieldHp = shieldCapacity = shield;
            HpRegenPerSec = Math.Max(0, (float?)bonuses["hpRegenPerSec"] ?? 0);
        }

        private static float ScaleDashCooldown(float milliseconds) =>
            Math.Max(MinDashCooldown, DefaultDashCooldown * (milliseconds / BaseDashCooldownMs));

        private static float ScaleUltimateCooldown(float milliseconds) => Math.Max(MinUltimateCooldown, milliseconds / 1000f);

        /// <summary>
        /// Applies the server's effectiveStats (attackSpeed/dashCooldown in ms, moveSpeed in % of 100) after an upgrade pick.
        /// Max HP and shield gains also heal by the same amount; reductions only clamp the current value.
        /// </summary>
        public void ApplyEffectiveStats(JToken effectiveStats, JToken selectedUpgrade = null)
        {
            bool projectileFromStats = false, splashFromStats = false, chainFromStats = false, bombFromStats = false, durationFromStats = false;
            if (effectiveStats != null && effectiveStats.Type != JTokenType.Null)
            {
                float? attack = (float?)effectiveStats["attackPower"];
                if (attack > 0) AttackPower = attack.Value;
                float? attackSpeed = (float?)effectiveStats["attackSpeed"];
                if (attackSpeed > 0) AttackInterval = Math.Max(MinAttackInterval, attackSpeed.Value / 1000f);
                float? maxHp = (float?)effectiveStats["maxHp"];
                if (maxHp > 0)
                {
                    float gained = Math.Max(0, maxHp.Value - MaxHp);
                    MaxHp = maxHp.Value;
                    if (Hp > 0) Hp = Math.Min(MaxHp, Hp + gained);
                }
                float? moveSpeed = (float?)effectiveStats["moveSpeed"];
                if (moveSpeed > 0) CurrentMoveSpeed = MoveSpeed * (moveSpeed.Value / 100f);
                float? dashCooldown = (float?)effectiveStats["dashCooldown"];
                if (dashCooldown > 0) DashCooldownDuration = ScaleDashCooldown(dashCooldown.Value);
                float? ultimatePower = (float?)effectiveStats["ultimatePower"];
                if (ultimatePower > 0) UltimatePower = ultimatePower.Value;
                float? ultimateCooldown = (float?)effectiveStats["ultimateCooldown"];
                if (ultimateCooldown > 0) UltimateCooldownDuration = ScaleUltimateCooldown(ultimateCooldown.Value);
                float? regen = (float?)effectiveStats["hpRegenPerSec"];
                if (regen != null) HpRegenPerSec = Math.Max(0, regen.Value);
                float? shield = (float?)effectiveStats["shieldHp"];
                if (shield != null)
                {
                    float target = Math.Max(0, shield.Value);
                    ShieldHp = Math.Max(0, ShieldHp + target - shieldCapacity);
                    shieldCapacity = target;
                }
                float? healOnKill = (float?)effectiveStats["healOnKill"];
                if (healOnKill != null) HealOnKill = Math.Max(0, healOnKill.Value);
                float? critRate = (float?)effectiveStats["critRate"];
                if (critRate != null) CritRate = Math.Max(0, Math.Min(100, critRate.Value));
                float? critDamage = (float?)effectiveStats["critDamage"];
                if (critDamage != null) CritDamage = Math.Max(0, critDamage.Value);
                // effectiveStats carries totals; a card-level projectileSpeed is a delta applied once per pick.
                float? projectileSpeed = (float?)effectiveStats["projectileSpeed"];
                if (projectileSpeed != null)
                {
                    ProjectileSpeedMultiplier = Math.Max(.1f, 1f + projectileSpeed.Value / 100f);
                    projectileFromStats = true;
                }
                // Combat effects: effectiveStats carries totals when the server reports them.
                float? splash = (float?)effectiveStats["splashRadius"];
                if (splash != null) { SplashRadius = Math.Max(0, splash.Value); splashFromStats = true; }
                float? chain = (float?)effectiveStats["chainTargets"];
                if (chain != null) { ChainTargets = Math.Max(0, (int)Math.Round(chain.Value)); chainFromStats = true; }
                float? bomb = (float?)effectiveStats["bombRadius"];
                if (bomb != null) { BombRadius = Math.Max(0, bomb.Value); bombFromStats = true; }
                float? duration = (float?)effectiveStats["duration"];
                if (duration != null) { DurationBonus = Math.Max(0, duration.Value); durationFromStats = true; }
            }
            if (!projectileFromStats)
            {
                float? pickedProjectile = (float?)((selectedUpgrade as JObject)?["effects"] as JObject)?["projectileSpeed"];
                if (pickedProjectile != null) ProjectileSpeedMultiplier = Math.Max(.1f, ProjectileSpeedMultiplier + pickedProjectile.Value / 100f);
            }
            // Older servers send only the card's deltas: accumulate them for keys effectiveStats did not report.
            var pickedEffects = (selectedUpgrade as JObject)?["effects"] as JObject;
            if (pickedEffects != null)
            {
                float? pickedSplash = (float?)pickedEffects["splashRadius"];
                if (!splashFromStats && pickedSplash != null) SplashRadius = Math.Max(0, SplashRadius + pickedSplash.Value);
                float? pickedChain = (float?)pickedEffects["chainTargets"];
                if (!chainFromStats && pickedChain != null) ChainTargets = Math.Max(0, ChainTargets + (int)Math.Round(pickedChain.Value));
                float? pickedBomb = (float?)pickedEffects["bombRadius"];
                if (!bombFromStats && pickedBomb != null) BombRadius = Math.Max(0, BombRadius + pickedBomb.Value);
                float? pickedDuration = (float?)pickedEffects["duration"];
                if (!durationFromStats && pickedDuration != null) DurationBonus = Math.Max(0, DurationBonus + pickedDuration.Value);
            }
            string upgradeId = selectedUpgrade != null && selectedUpgrade.Type != JTokenType.Null ? (string)selectedUpgrade["id"] : null;
            if (!string.IsNullOrEmpty(upgradeId)) AppliedUpgrades.Add(upgradeId);
        }

        // Local-only upgrade pool for the practice battle; mirrors the server offer/effect shape.
        private static readonly JArray PracticeUpgrades = JArray.Parse(@"[
            {""upgradeId"":""practice_rapid_fire"",""name"":""연사 강화"",""description"":""사격 간격이 짧아지고 공격력이 오른다."",""category"":""weapon"",""tier"":1,""group"":""practice_rapid"",""effects"":{""attackSpeed"":-40,""attackPower"":2}},
            {""upgradeId"":""practice_armor_plate"",""name"":""장갑판"",""description"":""최대 체력이 늘고 같은 만큼 회복한다."",""category"":""armor"",""tier"":1,""group"":""practice_armor"",""effects"":{""maxHp"":40}},
            {""upgradeId"":""practice_ultimate_core"",""name"":""궁극기 코어"",""description"":""궁극기 위력이 오르고 재사용 대기시간이 줄어든다."",""category"":""special"",""tier"":1,""group"":""practice_ultimate"",""effects"":{""ultimatePower"":20,""ultimateCooldown"":-5000}},
            {""upgradeId"":""practice_splash"",""name"":""확산탄"",""description"":""직격 주변의 적에게 광역 피해를 준다."",""category"":""weapon"",""tier"":1,""group"":""practice_splash"",""effects"":{""splashRadius"":2,""attackPower"":2}},
            {""upgradeId"":""practice_thruster"",""name"":""추진기"",""description"":""이동 속도가 빨라진다."",""category"":""utility"",""tier"":1,""group"":""practice_thruster"",""effects"":{""moveSpeed"":15}},
            {""upgradeId"":""practice_dash_coil"",""name"":""대시 코일"",""description"":""대시 재사용 대기시간이 줄어든다."",""category"":""utility"",""tier"":1,""group"":""practice_dash"",""effects"":{""dashCooldown"":-1000}},
            {""upgradeId"":""practice_chain"",""name"":""연쇄 번개"",""description"":""직격 후 가까운 적에게 번개가 이어진다."",""category"":""weapon"",""tier"":1,""group"":""practice_chain"",""effects"":{""chainTargets"":2,""attackPower"":2}},
            {""upgradeId"":""practice_nanite"",""name"":""수리 나노봇"",""description"":""초당 체력을 회복한다."",""category"":""armor"",""tier"":1,""group"":""practice_nanite"",""effects"":{""hpRegenPerSec"":1.5}},
            {""upgradeId"":""practice_barrier"",""name"":""에너지 보호막"",""description"":""피해를 먼저 흡수하는 보호막을 얻는다."",""category"":""armor"",""tier"":1,""group"":""practice_barrier"",""effects"":{""shieldHp"":30}},
            {""upgradeId"":""practice_bomb"",""name"":""처치 폭발"",""description"":""적을 처치하면 주변에 폭발이 일어난다."",""category"":""special"",""tier"":1,""group"":""practice_bomb"",""effects"":{""bombRadius"":3,""attackPower"":2}},
            {""upgradeId"":""practice_salvage"",""name"":""잔해 회수"",""description"":""적을 처치할 때마다 체력을 회복한다."",""category"":""special"",""tier"":1,""group"":""practice_salvage"",""effects"":{""healAmount"":4}},
            {""upgradeId"":""practice_overcharge"",""name"":""과충전 탄"",""description"":""공격력이 크게 오른다."",""category"":""weapon"",""tier"":1,""group"":""practice_overcharge"",""effects"":{""attackPower"":5}},
            {""upgradeId"":""practice_duration"",""name"":""지속 화염"",""description"":""직격한 적이 불타고 대시 무적이 길어진다."",""category"":""utility"",""tier"":1,""group"":""practice_duration"",""effects"":{""duration"":20,""attackPower"":2}}
        ]");

        /// <summary>Core energy between practice upgrade offers (levels 1-5 arrive at 50, 100, 150, 200, 250).</summary>
        public const int PracticeUpgradeCoreStep = 50;

        /// <summary>Stage used by the Editor practice battle; 15 core per kill reaches the fifth offer within 60 seconds.</summary>
        public static JObject BuildPracticeStage() => JObject.Parse("{\"name\":\"생존 연습 · 보상 없음\",\"durationSeconds\":60,\"maxKills\":40,\"corePerKill\":15,\"maxCoreEnergy\":300,\"bossTimings\":[30],\"bosses\":[{\"code\":\"practice\",\"name\":\"연습 보스\",\"hp\":1200,\"attackPower\":8}]}");

        public static JObject BuildPracticeSession() => JObject.Parse("{\"id\":\"local-bullet-practice\",\"statSnapshot\":{\"maxHp\":200,\"attackPower\":8,\"attackSpeed\":240}}");

        /// <summary>Builds a deterministic three-option offer for practice mode in the same shape as the server's offer.</summary>
        public static JObject BuildPracticeOffer(int level)
        {
            var options = new JArray();
            int first = (Math.Max(1, level) - 1) * 3;
            for (int slot = 0; slot < 3; slot++)
            {
                var option = (JObject)PracticeUpgrades[(first + slot) % PracticeUpgrades.Count].DeepClone();
                option["slot"] = slot;
                options.Add(option);
            }
            return new JObject { ["level"] = level, ["options"] = options };
        }

        /// <summary>Practice-mode equivalent of the server's select response: current stats plus the chosen option's effects.</summary>
        public JObject BuildPracticeSelection(JToken option)
        {
            var effects = option["effects"];
            float Delta(string key) => (float?)effects?[key] ?? 0;
            var stats = new JObject
            {
                ["attackPower"] = AttackPower + Delta("attackPower"),
                ["attackSpeed"] = Math.Max(MinAttackInterval * 1000f, AttackInterval * 1000f + Delta("attackSpeed")),
                ["moveSpeed"] = CurrentMoveSpeed / MoveSpeed * 100f + Delta("moveSpeed"),
                ["dashCooldown"] = Math.Max(MinDashCooldown / DefaultDashCooldown * BaseDashCooldownMs,
                    DashCooldownDuration / DefaultDashCooldown * BaseDashCooldownMs + Delta("dashCooldown")),
                ["maxHp"] = MaxHp + Delta("maxHp"),
                ["hpRegenPerSec"] = HpRegenPerSec + Delta("hpRegenPerSec"),
                ["shieldHp"] = shieldCapacity + Delta("shieldHp"),
                ["healOnKill"] = HealOnKill + Delta("healAmount"),
                ["ultimatePower"] = UltimatePower * (1f + Delta("ultimatePower") / 100f),
                ["ultimateCooldown"] = Math.Max(MinUltimateCooldown * 1000f, UltimateCooldownDuration * 1000f + Delta("ultimateCooldown")),
                ["splashRadius"] = SplashRadius + Delta("splashRadius"),
                ["chainTargets"] = ChainTargets + Delta("chainTargets"),
                ["bombRadius"] = BombRadius + Delta("bombRadius"),
                ["duration"] = DurationBonus + Delta("duration")
            };
            return new JObject
            {
                ["effectiveStats"] = stats,
                ["selectedUpgrade"] = new JObject { ["id"] = option["upgradeId"], ["name"] = option["name"],
                    ["description"] = option["description"], ["category"] = option["category"],
                    ["tier"] = option["tier"], ["effects"] = effects?.DeepClone() }
            };
        }

        public void Dodge(int direction)
        {
            if (Ended || dodgeWait > 0 || direction == 0) return;
            PlayerX = Math.Max(-160, Math.Min(160, PlayerX + Math.Sign(direction) * 100));
            dodgeWait = DashCooldownDuration;
            invincible = Math.Max(invincible, DodgeInvincibleSeconds * (1f + DurationBonus / 100f));
        }

        public void MoveTo(float x, float y, float delta)
        {
            if (Ended || delta <= 0 || float.IsNaN(delta) || float.IsInfinity(delta) ||
                float.IsNaN(x) || float.IsInfinity(x) || float.IsNaN(y) || float.IsInfinity(y)) return;
            float dx = Math.Max(-160, Math.Min(160, x)) - PlayerX;
            float dy = Math.Max(-180, Math.Min(180, y)) - PlayerY;
            float distance = (float)Math.Sqrt(dx * dx + dy * dy);
            if (distance < .001f) return;
            float step = Math.Min(distance, CurrentMoveSpeed * Math.Min(delta, .1f));
            PlayerX += dx / distance * step;
            PlayerY += dy / distance * step;
        }

        public void Tick(float delta)
        {
            if (Ended || delta <= 0 || float.IsNaN(delta) || float.IsInfinity(delta)) return;
            // Frame stalls do not manufacture kills or advance the simulation by minutes.
            delta = Math.Min(delta, .1f);
            Elapsed = Math.Min(Duration, Elapsed + delta);
            dodgeWait -= delta;
            ultimateWait -= delta;
            invincible -= delta;
            hitFlash -= delta;
            spawnWait -= delta;
            shotWait -= delta;
            if (HpRegenPerSec > 0 && Hp > 0) Hp = Math.Min(MaxHp, Hp + HpRegenPerSec * delta);
            while (nextBoss < bossTimes.Count && Elapsed >= Math.Max(Duration * .5f, (float)bossTimes[nextBoss]))
            {
                var boss = bossDefinitions[nextBoss++];
                var enemy = new Enemy { Name = (string)boss["name"], BossId = (string)boss["code"],
                    Hp = (float)boss["hp"], MaxHp = (float)boss["hp"], Damage = (float?)boss["attackPower"] ?? 10,
                    AttackWait = 1 };
                PlaceAtEdge(enemy, (nextBoss - 1) % 4);
                Enemies.Add(enemy);
            }
            if (spawnWait <= 0 && spawned < MaxKills - bossDefinitions.Count)
            {
                spawnWait = Math.Max(2, (float)Duration / MaxKills);
                spawned++;
                float progress = Elapsed / Duration;
                var kind = progress >= .8f && spawned % 3 == 0 ? EnemyKind.MachineGun :
                    progress >= .7f && spawned % 2 == 0 ? EnemyKind.Armored :
                    progress >= .5f && spawned % 2 == 1 ? EnemyKind.Rifle : EnemyKind.Guard;
                float health = (kind == EnemyKind.Armored ? 60 : kind == EnemyKind.MachineGun ? 36 :
                    kind == EnemyKind.Rifle ? 24 : 12) * (1 + Math.Max(0, progress - .5f) * 4);
                var enemy = new Enemy { Kind = kind,
                    Name = kind == EnemyKind.Armored ? "중갑 로봇" : kind == EnemyKind.MachineGun ? "기관총 로봇" :
                        kind == EnemyKind.Rifle ? "소총 로봇" : "경비 로봇",
                    Hp = health, MaxHp = health, Damage = kind == EnemyKind.Armored ? 6 : kind == EnemyKind.Rifle ? 4 : 3,
                    AttackWait = kind == EnemyKind.MachineGun ? 1.5f : 1.2f };
                PlaceAtEdge(enemy, (spawned - 1) % 4);
                Enemies.Add(enemy);
            }
            if (shotWait <= 0 && Enemies.Count > 0)
            {
                shotWait = Math.Max(.05f, AttackInterval);
                var target = ChooseTarget();
                float dx = target.X - PlayerX, dy = target.Y - PlayerY;
                float distance = (float)Math.Sqrt(dx * dx + dy * dy);
                if (distance > .001f) { AimX = dx / distance; AimY = dy / distance; }
                if (Bullets.Count < 256)
                {
                    Bullets.Add(new Bullet { X = PlayerX, Y = PlayerY,
                        VelocityX = AimX * ProjectileBaseSpeed * ProjectileSpeedMultiplier,
                        VelocityY = AimY * ProjectileBaseSpeed * ProjectileSpeedMultiplier,
                        Friendly = true, Target = target, Damage = AttackPower, Radius = 4 });
                    ShotsFired++;
                }
            }
            foreach (var enemy in Enemies)
            {
                float oldX = enemy.X, oldY = enemy.Y;
                float dx = PlayerX - enemy.X, dy = PlayerY - enemy.Y;
                float distance = (float)Math.Sqrt(dx * dx + dy * dy);
                float step = Math.Min(Math.Max(0, distance - (enemy.IsRanged ? 135 : enemy.Radius)),
                    delta * (enemy.BossId != null ? 25 : enemy.Kind == EnemyKind.Armored ? 22 : 32));
                enemy.Moving = step > .001f;
                if (distance > .001f) { enemy.X += dx / distance * step; enemy.Y += dy / distance * step; }
                if (enemy.BossId == null)
                {
                    if (SegmentHits(oldX - lastPlayerX, oldY - lastPlayerY, enemy.X - PlayerX,
                        enemy.Y - PlayerY, 0, 0, PlayerRadius + enemy.Radius)) TakeHit(enemy.Damage);
                }
                if (!enemy.IsRanged) continue;
                enemy.AttackWait -= delta;
                if (enemy.AttackWait <= 0)
                {
                    FireEnemyVolley(enemy);
                    enemy.AttackWait = enemy.BossId != null ? 1.15f :
                        enemy.Kind == EnemyKind.MachineGun ? (enemy.BurstLeft > 0 ? .14f : 2.6f) : 2.2f;
                }
            }
            TickBullets(delta);
            TickBurn(delta);
            lastPlayerX = PlayerX;
            lastPlayerY = PlayerY;
        }

        private void PlaceAtEdge(Enemy enemy, int side)
        {
            if (side % 2 == 0) { enemy.X = random.Next(-160, 161); enemy.Y = side == 0 ? 250 : -250; }
            else { enemy.X = side == 1 ? 235 : -235; enemy.Y = random.Next(-180, 181); }
        }

        private Enemy ChooseTarget()
        {
            Enemy target = null;
            float nearest = float.MaxValue;
            foreach (var enemy in Enemies)
            {
                float dx = enemy.X - PlayerX, dy = enemy.Y - PlayerY;
                float distance = dx * dx + dy * dy;
                if (distance < nearest) { target = enemy; nearest = distance; }
            }
            return target;
        }

        private void FireEnemyVolley(Enemy enemy)
        {
            enemy.LastShotAt = Elapsed;
            float aim = (float)Math.Atan2(PlayerX - enemy.X, enemy.Y - PlayerY);
            if (enemy.BossId == null)
            {
                if (enemy.Kind == EnemyKind.MachineGun)
                {
                    if (enemy.BurstLeft == 0) { enemy.BurstLeft = 6; enemy.BurstAim = aim; }
                    AddEnemyBullet(enemy, enemy.BurstAim + (enemy.BurstLeft % 2 == 0 ? -.035f : .035f), 180);
                    enemy.BurstLeft--;
                }
                else AddEnemyBullet(enemy, aim, 160);
                enemy.ShotWave++;
                return;
            }
            float offset = (enemy.ShotWave % 2 == 0 ? -.08f : .08f);
            for (int i = -4; i <= 4; i++) AddEnemyBullet(enemy, aim + i * .23f + offset, 120);
            if (enemy.ShotWave % 2 == 1)
                for (int i = -1; i <= 1; i++) AddEnemyBullet(enemy, aim + i * .14f, 170);
            enemy.ShotWave++;
        }

        private void AddEnemyBullet(Enemy enemy, float angle, float speed)
        {
            if (Bullets.Count >= 224) return;
            Bullets.Add(new Bullet { X = enemy.X, Y = enemy.Y,
                VelocityX = (float)Math.Sin(angle) * speed, VelocityY = -(float)Math.Cos(angle) * speed,
                Damage = enemy.Damage, Radius = enemy.BossId == null ? 5 : 6,
                Weapon = enemy.Kind, BossShot = enemy.BossId != null });
        }

        private void TickBullets(float delta)
        {
            for (int i = Bullets.Count - 1; i >= 0; i--)
            {
                var bullet = Bullets[i];
                float oldX = bullet.X, oldY = bullet.Y;
                if (bullet.Friendly)
                {
                    if (!Enemies.Contains(bullet.Target)) bullet.Target = ChooseTarget();
                    if (bullet.Target != null)
                    {
                        float dx = bullet.Target.X - bullet.X, dy = bullet.Target.Y - bullet.Y;
                        float length = (float)Math.Sqrt(dx * dx + dy * dy);
                        if (length > .001f)
                        {
                            bullet.VelocityX = dx / length * ProjectileBaseSpeed * ProjectileSpeedMultiplier;
                            bullet.VelocityY = dy / length * ProjectileBaseSpeed * ProjectileSpeedMultiplier;
                        }
                    }
                }
                bullet.X += bullet.VelocityX * delta;
                bullet.Y += bullet.VelocityY * delta;
                bullet.Age += delta;
                if (bullet.Friendly && bullet.Target != null &&
                    SegmentHits(oldX, oldY, bullet.X, bullet.Y, bullet.Target.X, bullet.Target.Y,
                        bullet.Radius + bullet.Target.Radius))
                {
                    float damage = bullet.Damage;
                    if (CritRate > 0 && critRandom.NextDouble() * 100 < CritRate) damage *= CritBaseMultiplier + CritDamage / 100f;
                    var target = bullet.Target;
                    target.Hp -= damage;
                    target.LastHitAt = Elapsed;
                    if (target.Hp <= 0) DefeatEnemy(target);
                    // Splash and chain are one level deep: their damage never triggers another splash/chain.
                    if (SplashRadius > 0) ApplySplash(target, bullet.Damage);
                    if (ChainTargets > 0) ApplyChain(target, bullet.Damage);
                    if (DurationBonus > 0 && target.Hp > 0)
                    {
                        target.BurnRemaining = BurnBaseSeconds * (1f + DurationBonus / 100f);
                        target.BurnDps = AttackPower * BurnDpsRatio;
                    }
                    Bullets.RemoveAt(i);
                }
                else if (!bullet.Friendly && SegmentHits(oldX - lastPlayerX, oldY - lastPlayerY, bullet.X - PlayerX,
                    bullet.Y - PlayerY, 0, 0, PlayerRadius + bullet.Radius))
                {
                    TakeHit(bullet.Damage);
                    Bullets.RemoveAt(i);
                }
                else if (bullet.Age > 8 || Math.Abs(bullet.X) > 270 || bullet.Y < -300 || bullet.Y > 300)
                    Bullets.RemoveAt(i);
            }
        }

        private void TakeHit(float damage)
        {
            if (invincible > 0) return;
            float remaining = damage;
            if (ShieldHp > 0)
            {
                float absorbed = Math.Min(ShieldHp, remaining);
                ShieldHp -= absorbed;
                remaining -= absorbed;
            }
            Hp = Math.Max(0, Hp - remaining);
            HitsTaken++;
            invincible = .4f;
            hitFlash = .15f;
        }

        // Kill bookkeeping, then an optional bomb blast; explosionDepth caps bomb chain reactions.
        private void DefeatEnemy(Enemy enemy, int explosionDepth = 0)
        {
            Enemies.Remove(enemy);
            Kills++;
            Core = Math.Min(MaxCore, Core + corePerKill);
            if (HealOnKill > 0 && Hp > 0) Hp = Math.Min(MaxHp, Hp + HealOnKill);
            if (enemy.BossId != null) BossesDefeated.Add(enemy.BossId);
            if (BombRadius <= 0 || explosionDepth >= MaxExplosionDepth) return;
            float radius = BombRadius * BombUnitRadius;
            foreach (var other in Enemies.ToArray())
            {
                if (other.Hp <= 0 || !Enemies.Contains(other) || DistanceSquared(other, enemy.X, enemy.Y) > radius * radius) continue;
                other.Hp -= AttackPower * BombDamageRatio;
                other.LastHitAt = Elapsed;
                if (other.Hp <= 0) DefeatEnemy(other, explosionDepth + 1);
            }
        }

        private void ApplySplash(Enemy center, float baseDamage)
        {
            float x = center.X, y = center.Y, radius = SplashRadius * SplashUnitRadius;
            foreach (var other in Enemies.ToArray())
            {
                if (other == center || other.Hp <= 0 || !Enemies.Contains(other) || DistanceSquared(other, x, y) > radius * radius) continue;
                other.Hp -= baseDamage * SplashDamageRatio;
                other.LastHitAt = Elapsed;
                if (other.Hp <= 0) DefeatEnemy(other);
            }
        }

        // Picks the nearest ChainTargets living enemies within range first, then damages them.
        private void ApplyChain(Enemy origin, float baseDamage)
        {
            var picked = new List<Enemy>(ChainTargets);
            for (int n = 0; n < ChainTargets; n++)
            {
                Enemy best = null;
                float bestDistance = ChainRange * ChainRange;
                foreach (var other in Enemies)
                {
                    if (other == origin || other.Hp <= 0 || picked.Contains(other)) continue;
                    float distance = DistanceSquared(other, origin.X, origin.Y);
                    if (distance <= bestDistance) { best = other; bestDistance = distance; }
                }
                if (best == null) break;
                picked.Add(best);
            }
            foreach (var other in picked)
            {
                if (other.Hp <= 0 || !Enemies.Contains(other)) continue;
                other.Hp -= baseDamage * ChainDamageRatio;
                other.LastHitAt = Elapsed;
                if (other.Hp <= 0) DefeatEnemy(other);
            }
        }

        private void TickBurn(float delta)
        {
            bool burning = false;
            foreach (var enemy in Enemies)
                if (enemy.BurnRemaining > 0) { burning = true; break; }
            if (!burning) return;
            foreach (var enemy in Enemies.ToArray())
            {
                if (enemy.BurnRemaining <= 0 || enemy.Hp <= 0 || !Enemies.Contains(enemy)) continue;
                float burnStep = Math.Min(delta, enemy.BurnRemaining);
                enemy.BurnRemaining = Math.Max(0, enemy.BurnRemaining - delta);
                enemy.Hp -= enemy.BurnDps * burnStep;
                if (enemy.Hp <= 0) DefeatEnemy(enemy);
            }
        }

        /// <summary>Fires the active ultimate: damages every living enemy, grants brief invulnerability, then starts the cooldown.</summary>
        public bool TriggerUltimate()
        {
            if (Ended || ultimateWait > 0) return false;
            ultimateWait = UltimateCooldownDuration;
            invincible = Math.Max(invincible, UltimateInvincibleSeconds * (1f + DurationBonus / 100f));
            UltimatesUsed++;
            foreach (var enemy in Enemies.ToArray())
            {
                if (enemy.Hp <= 0 || !Enemies.Contains(enemy)) continue;
                enemy.Hp -= UltimatePower;
                enemy.LastHitAt = Elapsed;
                if (enemy.Hp <= 0) DefeatEnemy(enemy);
            }
            return true;
        }

        private static float DistanceSquared(Enemy enemy, float x, float y)
        {
            float dx = enemy.X - x, dy = enemy.Y - y;
            return dx * dx + dy * dy;
        }

        private static bool SegmentHits(float x0, float y0, float x1, float y1, float x, float y, float radius)
        {
            float dx = x1 - x0, dy = y1 - y0, lengthSquared = dx * dx + dy * dy;
            float t = lengthSquared > .0001f ? Math.Max(0, Math.Min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSquared)) : 0;
            float hitX = x0 + dx * t - x, hitY = y0 + dy * t - y;
            return hitX * hitX + hitY * hitY <= radius * radius;
        }
    }
}
