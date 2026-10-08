using System;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace IdleGame.Network
{
    public sealed class ApiException : Exception
    {
        public readonly long Status;
        public readonly string Code;
        public ApiException(long status, string code, string message) : base(message)
        { Status = status; Code = code; }
    }

    public sealed class AuthSession
    {
        private readonly DeviceSessionStore store;
        private string savedServer;
        public DateTime SavedUntilUtc { get; private set; }
        public bool HasSavedLogin => store.Exists;
        public string UserId { get; private set; }
        public string PlayerId { get; private set; }
        public string AccessToken { get; private set; }
        public string RefreshToken { get; private set; }
        public bool IsAuthenticated => !string.IsNullOrEmpty(AccessToken);

        public AuthSession(DeviceSessionStore store = null)
        { this.store = store ?? new DeviceSessionStore(); }

        public void Remember(string server, DateTime? now = null)
        {
            savedServer = server;
            SavedUntilUtc = (now ?? DateTime.UtcNow).AddDays(21);
            Persist();
        }

        public bool Restore(string server, DateTime? now = null)
        {
            var data = store.Read();
            if (data == null) return false;
            if ((string)data["server"] != server || (string)data["device"] != SystemInfo.deviceUniqueIdentifier ||
                !DateTime.TryParse((string)data["until"], System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.RoundtripKind, out var until) || until <= (now ?? DateTime.UtcNow) ||
                string.IsNullOrWhiteSpace((string)data["userId"]) || string.IsNullOrWhiteSpace((string)data["playerId"]) ||
                string.IsNullOrWhiteSpace((string)data["refreshToken"]))
            { Clear(); return false; }
            UserId = (string)data["userId"]; PlayerId = (string)data["playerId"];
            RefreshToken = (string)data["refreshToken"]; AccessToken = null;
            savedServer = server; SavedUntilUtc = until;
            return true;
        }

        private void Persist()
        {
            if (string.IsNullOrEmpty(savedServer)) return;
            store.Write(new JObject { ["server"] = savedServer, ["device"] = SystemInfo.deviceUniqueIdentifier,
                ["until"] = SavedUntilUtc.ToString("O"), ["userId"] = UserId, ["playerId"] = PlayerId,
                ["refreshToken"] = RefreshToken });
        }

        public void Apply(JObject response)
        {
            string userId = (string)response["userId"];
            string playerId = (string)response["playerId"];
            string access = (string)response["tokens"]?["accessToken"];
            string refresh = (string)response["tokens"]?["refreshToken"];
            if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(playerId) ||
                string.IsNullOrWhiteSpace(access) || string.IsNullOrWhiteSpace(refresh))
                throw new ApiException(0, "INVALID_AUTH_RESPONSE", "로그인 응답을 확인할 수 없습니다.");
            UserId = userId;
            PlayerId = playerId;
            AccessToken = access;
            RefreshToken = refresh;
            savedServer = null;
        }

        public void ApplyTokens(JObject response)
        {
            string access = (string)response["accessToken"];
            string refresh = (string)response["refreshToken"];
            if (string.IsNullOrWhiteSpace(access) || string.IsNullOrWhiteSpace(refresh))
                throw new ApiException(0, "INVALID_AUTH_RESPONSE", "인증 갱신 응답이 올바르지 않습니다.");
            AccessToken = access;
            RefreshToken = refresh;
            Persist();
        }

        public void Clear()
        { store.Clear(); ClearMemory(); }

        public void ClearMemory()
        { UserId = PlayerId = AccessToken = RefreshToken = savedServer = null; SavedUntilUtc = default; }
    }

    public sealed class GameApi
    {
        public readonly AuthSession Session;
        public string BaseUrl { get; }
        private Task refreshTask;

        public GameApi(string baseUrl, DeviceSessionStore store = null)
        {
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) ||
                (uri.Scheme != "http" && uri.Scheme != "https") || !string.IsNullOrEmpty(uri.UserInfo))
                throw new ArgumentException("서버 주소가 올바르지 않습니다.");
            BaseUrl = baseUrl.TrimEnd('/');
            Session = new AuthSession(store);
        }

        public static string ResolveUrl(string baseUrl, string route)
        {
            string root = baseUrl.TrimEnd('/');
            string path = route.TrimStart('/');
            if (root.EndsWith("/api", StringComparison.Ordinal) && path.StartsWith("api/", StringComparison.Ordinal))
                path = path.Substring(4);
            return root + "/" + path;
        }

        public async Task Login(string email, string password)
        {
            var response = await Send("api/auth/login", "POST", new { email, password }, false);
            Session.Apply((JObject)response);
            Session.Remember(BaseUrl);
        }

        public async Task Register(string email, string password, string nickname)
        {
            var response = await Send("api/auth/register", "POST", new { email, password, nickname }, false);
            Session.Apply((JObject)response);
            Session.Remember(BaseUrl);
        }

        public async Task<bool> RestoreLogin()
        {
            if (!Session.Restore(BaseUrl)) return false;
            try { await Refresh(); return true; }
            catch (ApiException error) when (error.Status == 401 || error.Status == 403) { return false; }
            catch { Session.ClearMemory(); throw; }
        }

        public async Task Logout()
        {
            string refreshToken = Session.RefreshToken;
            try
            {
                if (!string.IsNullOrEmpty(refreshToken))
                    await Send("api/auth/logout", "POST", new { refreshToken }, false);
            }
            finally { Session.Clear(); }
        }

        public Task<JToken> Wallet() => Send("api/players/" + Session.PlayerId);
        public Task<JToken> Pending() => Send("api/players/" + Session.PlayerId + "/claim");
        public Task<JToken> Claim() => Send("api/players/" + Session.PlayerId + "/claim", "POST");
        public Task<JToken> UpgradeCost() => Send("api/players/" + Session.PlayerId + "/upgrade");
        public Task<JToken> Upgrade() => Send("api/players/" + Session.PlayerId + "/upgrade", "POST");
        public Task<JToken> Stages() => Send("api/stages", authenticated: false);
        public Task<JToken> Parts() => Send("api/parts/my");
        public Task<JToken> StartBattle(string stageCode) =>
            Send("api/battles/start", "POST", new { stageCode });
        public Task<JToken> BattleState(string sessionId) =>
            Send("api/battles/" + Uri.EscapeDataString(sessionId));
        public Task<JToken> AbandonBattle(string sessionId) =>
            Send("api/battles/" + Uri.EscapeDataString(sessionId) + "/abandon", "POST");
        public Task<JToken> ReportBattle(string sessionId, object report, string key) =>
            Send("api/battles/" + Uri.EscapeDataString(sessionId) + "/progress", "POST", report, idempotencyKey: key);
        public Task<JToken> FinishBattle(string sessionId, object report, string key) =>
            Send("api/battles/" + Uri.EscapeDataString(sessionId) + "/finish", "POST", report, idempotencyKey: key);

        public async Task<JToken> Send(string route, string method = "GET", object body = null,
            bool authenticated = true, string idempotencyKey = null)
        {
            string payload = body == null ? null : JsonConvert.SerializeObject(body);
            string key = method == "GET" ? null : idempotencyKey ?? Guid.NewGuid().ToString();
            string sentToken = Session.AccessToken;
            try { return await SendOnce(route, method, payload, key, authenticated ? sentToken : null); }
            catch (ApiException error) when (authenticated && error.Status == 401 && Session.IsAuthenticated)
            {
                if (Session.AccessToken == sentToken)
                {
                    if (refreshTask == null || refreshTask.IsCompleted) refreshTask = Refresh();
                    await refreshTask;
                }
                return await SendOnce(route, method, payload, key, Session.AccessToken);
            }
        }

        private async Task Refresh()
        {
            try
            {
                var response = await SendOnce("api/auth/refresh", "POST",
                    JsonConvert.SerializeObject(new { refreshToken = Session.RefreshToken }),
                    Guid.NewGuid().ToString(), null);
                Session.ApplyTokens((JObject)response);
            }
            catch (ApiException error) when (error.Status == 401 || error.Status == 403)
            { Session.Clear(); throw; }
        }

        private async Task<JToken> SendOnce(string route, string method, string payload, string key, string token)
        {
            using var request = new UnityWebRequest(ResolveUrl(BaseUrl, route), method);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.timeout = 12;
            if (payload != null)
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(payload));
                request.SetRequestHeader("Content-Type", "application/json");
            }
            if (key != null) request.SetRequestHeader("Idempotency-Key", key);
            if (!string.IsNullOrEmpty(token)) request.SetRequestHeader("Authorization", "Bearer " + token);
            var operation = request.SendWebRequest();
            var completion = new TaskCompletionSource<bool>();
            operation.completed += _ => completion.TrySetResult(true);
            if (operation.isDone) completion.TrySetResult(true);
            await completion.Task;
            if (request.result == UnityWebRequest.Result.ConnectionError)
                throw new ApiException(0, "CONNECTION_FAILED", "서버에 연결할 수 없습니다. 주소와 네트워크를 확인해 주세요.");
            JToken response;
            try { response = JToken.Parse(request.downloadHandler.text); }
            catch (JsonException)
            { throw new ApiException(request.responseCode, "INVALID_RESPONSE", "게임 API가 아닌 응답입니다. 서버 경로를 확인해 주세요."); }
            if (request.responseCode >= 400)
                throw new ApiException(request.responseCode, (string)response["code"] ?? "REQUEST_FAILED",
                    (string)response["error"] ?? "요청을 처리할 수 없습니다.");
            return response;
        }
    }
}
