using System;
using System.IO;
using System.Text;
using IdleGame.Network;
using Newtonsoft.Json.Linq;
using UnityEditor;

namespace IdleGame.Editor
{
    public static class LoginSessionVerification
    {
        [MenuItem("Idle Game/Verify Remembered Login")]
        public static void Run() => UnityEngine.Debug.Log(Verify());

        public static string Verify()
        {
            string directory = Path.Combine(Path.GetTempPath(), "core-forge-login-" + Guid.NewGuid());
            string path = Path.Combine(directory, "session.bin");
            var store = new DeviceSessionStore(path);
            var now = new DateTime(2026, 10, 5, 0, 0, 0, DateTimeKind.Utc).AddTicks(1234567);
            int checks = 0;
            Action<bool> check = success => { if (!success) throw new InvalidOperationException("LOGIN_SESSION_FAILED: " + checks); checks++; };
            try
            {
                var session = new AuthSession(store);
                session.Apply(JObject.Parse("{\"userId\":\"user-test\",\"playerId\":\"player-test\",\"tokens\":{\"accessToken\":\"access-test\",\"refreshToken\":\"refresh-test-secret\"}}"));
                session.Remember("http://localhost:12345", now);
                check(!Encoding.UTF8.GetString(File.ReadAllBytes(path)).Contains("refresh-test-secret"));
                var restarted = new AuthSession(store);
                check(restarted.Restore("http://localhost:12345", now.AddDays(20)) && restarted.PlayerId == "player-test" &&
                    !restarted.IsAuthenticated && restarted.SavedUntilUtc == now.AddDays(21) && restarted.SavedUntilUtc.Kind == DateTimeKind.Utc);
                var deadline = restarted.SavedUntilUtc;
                restarted.ApplyTokens(JObject.Parse("{\"accessToken\":\"new-access\",\"refreshToken\":\"rotated-refresh-secret\"}"));
                var rotated = new AuthSession(store);
                check(rotated.Restore("http://localhost:12345", now.AddDays(20)) && rotated.RefreshToken == "rotated-refresh-secret" && rotated.SavedUntilUtc == deadline);
                restarted.ClearMemory();
                check(new AuthSession(store).Restore("http://localhost:12345", now.AddDays(20)));
                check(!new AuthSession(store).Restore("http://localhost:12345", now.AddDays(21)));
                session.Remember("http://localhost:12345", now);
                check(!new AuthSession(store).Restore("http://localhost:54321", now));
                session.Remember("http://localhost:12345", now);
                var copied = store.Read(); copied["device"] = "another-device"; store.Write(copied);
                check(!new AuthSession(store).Restore("http://localhost:12345", now));
                session.Remember("http://localhost:12345", now);
                File.WriteAllBytes(path, new byte[] { 1, 2, 3 });
                check(!new AuthSession(store).Restore("http://localhost:12345", now));
                session.Remember("http://localhost:12345", now);
                session.Clear();
                check(!new AuthSession(store).Restore("http://localhost:12345", now));
                return "LOGIN_SESSION_PASS: " + checks + " checks; encrypted restart, rotation, fixed deadline, expiry, server/device binding, corruption, logout";
            }
            finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
        }
    }
}
