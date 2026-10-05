using System;
using System.Threading.Tasks;
using IdleGame.Network;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.UI;

namespace IdleGame
{
    public sealed partial class ClientApp : MonoBehaviour
    {
        [SerializeField] private string serverUrl = "http://100.73.115.1:3007";
        private GameApi api;
        private Font font;
        private RectTransform safeArea;
        private RectTransform content;
        private Text notice;
        private CanvasGroup controls;
        private InputField server, email, password, nickname;
        private RectTransform loginError;
        private bool busy;
        private static readonly Color Background = new Color32(12, 20, 30, 255);
        private static readonly Color Panel = new Color32(23, 38, 51, 255);
        private static readonly Color Accent = new Color32(95, 235, 183, 255);
        private static readonly Color Muted = new Color32(155, 180, 196, 255);

        private void Awake()
        {
            Application.targetFrameRate = 60;
            Application.runInBackground = true;
            Screen.orientation = ScreenOrientation.Portrait;
            font = Resources.Load<Font>("Fonts/NotoSansKR");
            if (!font) font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var canvas = new GameObject("ClientCanvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvas.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(540, 960);
            scaler.matchWidthOrHeight = 0;
            var background = Box(canvas.transform, "Background", Background);
            Stretch(background);
            safeArea = Box(background, "SafeArea", Color.clear);
            if (FindFirstObjectByType<EventSystem>() == null)
                new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
            serverUrl = PlayerPrefs.GetString("CoreForge.Server", serverUrl);
            api = new GameApi(serverUrl);
            ShowStart();
            if (api.Session.HasSavedLogin) Run(async () => { await api.RestoreLogin(); ShowStart(); });
        }

        private void Update()
        {
            if (!safeArea) return;
            var area = Screen.safeArea;
            safeArea.anchorMin = new Vector2(area.xMin / Screen.width, area.yMin / Screen.height);
            safeArea.anchorMax = new Vector2(area.xMax / Screen.width, area.yMax / Screen.height);
            safeArea.offsetMin = safeArea.offsetMax = Vector2.zero;
            TickBattle();
        }

        private void Clear(string section)
        {
            loginError = null;
            foreach (Transform child in safeArea) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            var scrollRoot = Box(safeArea, "Page", Color.clear);
            Stretch(scrollRoot);
            var scroll = scrollRoot.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scrollRoot.gameObject.AddComponent<RectMask2D>();
            content = Box(scrollRoot, "Content", Color.clear);
            content.anchorMin = new Vector2(0, 1);
            content.anchorMax = new Vector2(1, 1);
            content.pivot = new Vector2(.5f, 1);
            content.sizeDelta = Vector2.zero;
            var layout = content.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.padding = new RectOffset(28, 28, 32, 32);
            layout.spacing = 14;
            layout.childControlWidth = layout.childControlHeight = true;
            layout.childForceExpandHeight = false;
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = content;
            scroll.viewport = scrollRoot;
            controls = content.gameObject.AddComponent<CanvasGroup>();
            Label("CORE / FORGE", 20, Accent, 30);
            Label(section, 34, Color.white, 48);
            notice = Label("", 17, Muted, 64);
            notice.gameObject.name = "Status";
        }

        private void ShowStart()
        {
            Clear("메카를 깨울 시간");
            notice.text = "폐허에서 코어를 회수하고\n당신의 메카를 성장시키세요.";
            DrawMecha();
            ActionButton("시작", () => Run(async () =>
            {
                if (!api.Session.IsAuthenticated && !await api.RestoreLogin()) { ShowLogin(); return; }
                await ShowBase();
            }), true);
            if (api.Session.IsAuthenticated)
                ActionButton("계정 변경 · 로그아웃", () => Run(async () => { try { await api.Logout(); } finally { ShowLogin(); } }));
            else ActionButton("로그인 / 회원가입", ShowLogin);
        }

        public void ShowLogin()
        {
            Clear("메카를 깨울 시간");
            notice.text = "폐허에서 코어를 회수하고\n당신의 메카를 성장시키세요.";
            DrawMecha();
            server = Field("서버 주소", serverUrl, false);
            email = Field("이메일", "", false);
            password = Field("비밀번호", "", true);
            nickname = Field("닉네임 · 회원가입할 때만 입력", "", false);
            ActionButton("로그인", () => Authenticate(false), true);
            ActionButton("새 파일럿 등록", () => Authenticate(true));
            ActionButton("서버 연결 확인", CheckServer);
            ActionButton("시작 화면으로", ShowStart);
            Label("세로형 클라이언트 · 개발 버전", 15, Muted, 30);
        }

        private void Authenticate(bool register)
        {
            if (string.IsNullOrWhiteSpace(email.text) || string.IsNullOrEmpty(password.text))
            { ShowLoginError("이메일과 비밀번호를 입력해 주세요."); return; }
            if (register && (password.text.Length < 8 || nickname.text.Trim().Length < 2))
            { notice.text = "비밀번호는 8자 이상, 닉네임은 2자 이상 입력해 주세요."; return; }
            string address = server.text.Trim(), mail = email.text.Trim(), secret = password.text, name = nickname.text.Trim();
            Run(async () =>
            {
                api = new GameApi(address);
                serverUrl = address;
                try
                {
                    if (register) await api.Register(mail, secret, name); else await api.Login(mail, secret);
                }
                catch (ApiException error) when (!register && error.Status == 401)
                {
                    password.text = "";
                    notice.text = "";
                    ShowLoginError("이메일 또는 비밀번호가 일치하지 않습니다.");
                    return;
                }
                PlayerPrefs.SetString("CoreForge.Server", api.BaseUrl);
                PlayerPrefs.Save();
                password.text = "";
                ShowStart();
            });
        }

        private void ShowLoginError(string message)
        {
            if (loginError) { loginError.gameObject.SetActive(false); Destroy(loginError.gameObject); }
            loginError = Box(safeArea, "LoginErrorPopup", new Color(0, 0, 0, .75f));
            controls.interactable = false;
            Stretch(loginError);
            var overlay = loginError;
            var dialog = Box(overlay, "LoginErrorDialog", Panel);
            dialog.anchorMin = dialog.anchorMax = new Vector2(.5f, .5f);
            dialog.sizeDelta = new Vector2(Mathf.Min(440, safeArea.rect.width - 40), 250);
            var textObject = new GameObject("LoginErrorMessage", typeof(RectTransform), typeof(Text));
            textObject.transform.SetParent(dialog, false);
            var text = textObject.GetComponent<Text>();
            text.font = font; text.fontSize = 20; text.color = Color.white;
            text.text = "로그인 실패\n\n" + message;
            text.alignment = TextAnchor.MiddleCenter; text.raycastTarget = false;
            text.rectTransform.anchorMin = new Vector2(0, .35f);
            text.rectTransform.anchorMax = new Vector2(1, 1);
            text.rectTransform.offsetMin = new Vector2(20, 0);
            text.rectTransform.offsetMax = new Vector2(-20, -10);
            BattleButton(dialog, "확인", () =>
            {
                overlay.gameObject.SetActive(false);
                Destroy(overlay.gameObject);
                loginError = null;
                controls.interactable = true;
                if (password) EventSystem.current.SetSelectedGameObject(password.gameObject);
            }, true);
            var confirm = dialog.GetChild(dialog.childCount - 1).GetComponent<RectTransform>();
            confirm.anchorMin = confirm.anchorMax = new Vector2(.5f, 0);
            confirm.sizeDelta = new Vector2(dialog.sizeDelta.x - 40, 52);
            confirm.anchoredPosition = new Vector2(0, 38);
            EventSystem.current.SetSelectedGameObject(confirm.gameObject);
        }

        private void CheckServer()
        {
            string address = server.text.Trim();
            Run(async () =>
            {
                var candidate = new GameApi(address);
                var stages = await candidate.Stages();
                if (!(stages is JArray)) throw new ApiException(0, "INVALID_RESPONSE", "스테이지 목록 형식이 올바르지 않습니다.");
                notice.text = "게임 서버에 연결되었습니다.";
            });
        }

        private async Task ShowBase()
        {
            var wallet = await api.Wallet();
            var pending = await api.Pending();
            var cost = await api.UpgradeCost();
            Clear("작전 기지");
            notice.text = "전기를 모아 생산 시설을 강화하세요.";
            DrawMecha();
            Label("보유 전기", 18, Muted, 26);
            Label($"{wallet["electricity"]}  E", 38, Accent, 54);
            Label($"초당 {wallet["electricityPerSecond"]} E 생산 · 수집 대기 {pending["pending"]} E", 20, Color.white, 56);
            ActionButton("전기 수집", () => Run(async () => { await api.Claim(); await ShowBase(); }), true);
            Label($"생산 강화 비용: {cost["cost"] ?? cost["upgradeCost"]} E", 18, Muted, 32);
            ActionButton("생산 시설 강화", () => Run(async () => { await api.Upgrade(); await ShowBase(); }));
            ActionButton("전투 시작 · 스테이지 선택", () => Run(ShowStages));
            ActionButton("새로고침", () => Run(ShowBase));
            ActionButton("로그아웃", () => Run(async () => { try { await api.Logout(); } finally { ShowLogin(); } }));
        }

        private async Task ShowStages()
        {
            var result = await api.Send("stages");
            if (!(result is JArray stages)) throw new ApiException(0, "INVALID_RESPONSE", "스테이지 목록 형식이 올바르지 않습니다.");
            Clear("출격 준비");
            notice.text = "출격 가능한 스테이지를 선택하세요.";
            foreach (var stage in stages)
            {
                string stageId = (string)stage["id"];
                string stageName = (string)stage["name"] ?? stageId;
                Label(stageName, 26, Accent, 40);
                Label($"{stage["durationSeconds"]}초 · 권장 전투력 {stage["recommendedPower"]}\n{stage["description"]}", 18, Color.white, 88);
                Label($"최대 처치 {stage["maxKills"]} · 처치당 스크랩 {stage["scrapPerKill"]}", 17, Muted, 28);
                bool canEnter = (bool?)stage["canEnter"] ?? ((bool?)stage["unlocked"] == true);
                Label(canEnter ? "출격 가능" : "잠김", 17, Muted, 28);
                if (canEnter)
                    ActionButton("이 스테이지에 출격", () => Run(() => StartPlayableStage(stage)));
            }
            ActionButton("기지로 돌아가기", () => Run(ShowBase), true);
        }

        private async Task StartStage(string stageId, string stageName)
        {
            var session = await api.StartBattle(stageId);
            string sessionId = (string)session["sessionId"] ?? (string)session["id"];
            if (string.IsNullOrWhiteSpace(sessionId))
                throw new ApiException(0, "INVALID_BATTLE_RESPONSE", "전투 세션 응답이 올바르지 않습니다.");

            await ShowBattleSession(stageName, sessionId);
        }

        private async Task ShowBattleSession(string stageName, string sessionId)
        {
            var state = await api.BattleState(sessionId);
            string status = (string)state["status"] ?? "unknown";
            int kills = (int?)state["killsReported"] ?? 0;
            int coreEnergy = (int?)state["coreEnergy"] ?? 0;
            int battleLevel = (int?)state["battleLevel"] ?? 1;

            Clear("출격 완료");
            notice.text = $"{stageName} 전투 세션 상태를 확인했습니다.";
            Label(status == "active" ? "전투 진행 중" : $"전투 상태: {status}", 26, Accent, 42);
            Label($"전투 레벨 {battleLevel}\n처치 {kills} · 코어 에너지 {coreEnergy}", 20, Color.white, 70);
            Label($"세션 ID\n{sessionId}", 18, Color.white, 70);
            Label("실제 전투 플레이와 보상 수령은 다음 클라이언트 단계에서 연결됩니다.", 17, Muted, 64);
            ActionButton("상태 새로고침", () => Run(() => ShowBattleSession(stageName, sessionId)), true);
            if (status == "active")
                ActionButton("출격 포기", () => Run(async () => { await api.AbandonBattle(sessionId); await ShowStages(); }));
            ActionButton("스테이지 목록", () => Run(ShowStages));
            ActionButton("기지로 돌아가기", () => Run(ShowBase));
        }

        private async void Run(Func<Task> action)
        {
            if (busy) return;
            busy = true;
            controls.interactable = false;
            notice.text = "서버에 요청하고 있습니다…";
            try { await action(); }
            catch (ApiException error)
            {
                if (!this) return;
                if (error.Status == 401 && !api.Session.IsAuthenticated) ShowLogin();
                notice.text = error.Message;
            }
            catch (Exception error)
            {
                if (this) notice.text = error is ArgumentException ? error.Message : "요청을 완료하지 못했습니다. 다시 시도해 주세요.";
            }
            finally
            {
                busy = false;
                if (controls) controls.interactable = !loginError;
            }
        }

        private static RectTransform Box(Transform parent, string name, Color color)
        {
            var obj = new GameObject(name, typeof(RectTransform), typeof(Image));
            obj.transform.SetParent(parent, false);
            obj.GetComponent<Image>().color = color;
            return obj.GetComponent<RectTransform>();
        }

        private static void Stretch(RectTransform rect)
        { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = rect.offsetMax = Vector2.zero; }

        private Text Label(string text, int size, Color color, float height)
        {
            var obj = new GameObject("Label", typeof(RectTransform), typeof(Text), typeof(LayoutElement));
            obj.transform.SetParent(content, false);
            var label = obj.GetComponent<Text>();
            label.font = font; label.text = text; label.fontSize = size; label.color = color;
            label.alignment = TextAnchor.MiddleLeft; label.raycastTarget = false;
            obj.GetComponent<LayoutElement>().preferredHeight = height;
            return label;
        }

        private InputField Field(string placeholder, string value, bool secret)
        {
            var root = Box(content, placeholder, Panel);
            root.gameObject.AddComponent<LayoutElement>().preferredHeight = 62;
            var textObject = new GameObject("Text", typeof(RectTransform), typeof(Text));
            textObject.transform.SetParent(root, false);
            var text = textObject.GetComponent<Text>(); text.font = font; text.fontSize = 19; text.color = Color.white;
            text.alignment = TextAnchor.MiddleLeft;
            Stretch(text.rectTransform); text.rectTransform.offsetMin = new Vector2(16, 8); text.rectTransform.offsetMax = new Vector2(-16, -8);
            var hint = Instantiate(text, root); hint.name = "Placeholder"; hint.text = placeholder; hint.color = Muted;
            var field = root.gameObject.AddComponent<InputField>();
            field.textComponent = text; field.placeholder = hint; field.lineType = InputField.LineType.SingleLine;
            field.contentType = secret ? InputField.ContentType.Password : InputField.ContentType.Standard;
            field.text = value;
            return field;
        }

        private void ActionButton(string caption, Action action, bool primary = false)
        {
            var root = Box(content, caption, primary ? Accent : Panel);
            root.gameObject.AddComponent<LayoutElement>().preferredHeight = 62;
            var button = root.gameObject.AddComponent<Button>(); button.onClick.AddListener(() => action());
            var obj = new GameObject("Caption", typeof(RectTransform), typeof(Text)); obj.transform.SetParent(root, false);
            var label = obj.GetComponent<Text>(); label.font = font; label.text = caption; label.fontSize = 21;
            label.alignment = TextAnchor.MiddleCenter; label.color = primary ? Background : Color.white; label.raycastTarget = false;
            Stretch(label.rectTransform);
        }

        private void DrawMecha()
        {
            var root = Box(content, "MechaPreview", Panel);
            root.gameObject.AddComponent<LayoutElement>().preferredHeight = 168;
            var art = Box(root, "MechaArtwork", Color.white);
            art.anchorMin = art.anchorMax = new Vector2(.5f, .5f);
            art.sizeDelta = new Vector2(150, 156);
            MechaArt.Apply(art.GetComponent<Image>(), "front");
        }
    }
}
