using System;
using System.Collections;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace IdleGame.Editor
{
    public static class MechaAssetVerification
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private static IEnumerator frames;

        public static void Run()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("Use a separate batch editor for this check.");
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("ClientApp").AddComponent<ClientApp>();
            SessionState.SetBool("MechaAssetVerification", true);
            EditorApplication.EnterPlaymode();
        }

        [InitializeOnLoadMethod]
        private static void ResumeVerification()
        {
            EditorApplication.update += AwaitPlay;
        }

        private static void AwaitPlay()
        {
            if (!SessionState.GetBool("MechaAssetVerification", false) ||
                !EditorApplication.isPlaying || EditorApplication.isCompiling) return;
            var app = UnityEngine.Object.FindFirstObjectByType<ClientApp>();
            if (!app || !UnityEngine.Object.FindFirstObjectByType<Canvas>()) return;
            SessionState.SetBool("MechaAssetVerification", false);
            EditorApplication.update -= AwaitPlay;
            Verify(app);
        }

        private static void Verify(ClientApp app)
        {
            frames = VerifyFrames(app);
            EditorApplication.update += NextFrame;
        }

        private static void NextFrame()
        {
            try
            {
                if (frames.MoveNext()) return;
                EditorApplication.update -= NextFrame;
            }
            catch (Exception error)
            {
                EditorApplication.update -= NextFrame;
                Debug.LogException(error);
                EditorApplication.Exit(1);
            }
        }

        private static IEnumerator VerifyFrames(ClientApp app)
        {
                AssetDatabase.ImportAsset("Assets/Resources/Art/MechaSheet.png", ImportAssetOptions.ForceUpdate);
                var sprites = Resources.LoadAll<Sprite>(MechaArt.ResourcePath);
                if (sprites.Length != 47) throw new InvalidOperationException("Expected 47 sprites, got " + sprites.Length);
                foreach (var sprite in sprites)
                    if (sprite.texture.filterMode != FilterMode.Point || sprite.rect.width <= 0 || sprite.rect.height <= 0)
                        throw new InvalidOperationException("Invalid sprite: " + sprite.name);
                yield return null;
                yield return null;
                Capture("mecha-login");
                Invoke(app, "Clear", "작전 기지 · 에셋 검증");
                Invoke(app, "DrawMecha");
                yield return null;
                yield return null;
                Capture("mecha-base");
                var stage = JObject.Parse("{\"name\":\"에셋 렌더링 검증\",\"durationSeconds\":60,\"maxKills\":20}");
                var session = JObject.Parse("{\"id\":\"local-render-verification\",\"statSnapshot\":{\"maxHp\":100,\"attackPower\":1,\"attackSpeed\":1000}}");
                var run = new BattleRun(stage, session);
                run.Enemies.Add(new BattleRun.Enemy { Name = "Scout", X = -100, Y = 100, Hp = 20, MaxHp = 20 });
                run.Enemies.Add(new BattleRun.Enemy { Name = "Boss", BossId = "render-only", X = 70, Y = 180, Hp = 200, MaxHp = 200 });
                typeof(ClientApp).GetField("battle", Private).SetValue(app, run);
                typeof(ClientApp).GetField("battleNetworkFailed", Private).SetValue(app, true);
                Invoke(app, "DrawBattle");
                yield return null;
                yield return null;
                Invoke(app, "TickBattle");
                Capture("mecha-battle");
                typeof(ClientApp).GetField("battleNetworkFailed", Private).SetValue(app, false);
                Invoke(app, "DodgePilot", -1);
                run.Tick(.05f);
                typeof(ClientApp).GetField("battleNetworkFailed", Private).SetValue(app, true);
                Invoke(app, "TickBattle");
                yield return null;
                yield return null;
                Capture("mecha-dodge-shot");
                if (run.PlayerX != -100 || run.ShotsFired != 1)
                    throw new InvalidOperationException("Dodge/shot presentation trigger check failed.");
                Debug.Log("MECHA_ASSET_VERIFICATION_PASS: 47 sprites; login/base/battle/dodge-shot rendered. No network requests.");
                EditorApplication.Exit(0);
        }

        private static void Invoke(ClientApp app, string name, params object[] args)
        {
            typeof(ClientApp).GetMethod(name, Private).Invoke(app, args);
        }

        public static void Capture(string name)
        {
            var camera = new GameObject("CaptureCamera").AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color32(12, 20, 30, 255);
            var target = new RenderTexture(540, 960, 24);
            camera.targetTexture = target;
            var canvas = UnityEngine.Object.FindFirstObjectByType<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = camera;
            canvas.planeDistance = 1;
            var scaler = canvas.GetComponent<CanvasScaler>();
            scaler.enabled = false;
            scaler.enabled = true;
            Canvas.ForceUpdateCanvases();
            var layout = canvas.GetComponentInChildren<VerticalLayoutGroup>();
            LayoutRebuilder.ForceRebuildLayoutImmediate((RectTransform)layout.transform);
            Canvas.ForceUpdateCanvases();
            camera.Render();
            var previous = RenderTexture.active;
            RenderTexture.active = target;
            var capture = new Texture2D(540, 960, TextureFormat.RGBA32, false);
            capture.ReadPixels(new Rect(0, 0, 540, 960), 0, 0);
            capture.Apply();
            string directory = Path.GetFullPath(Path.Combine(Application.dataPath, "../Captures"));
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(Path.Combine(directory, name + ".png"), capture.EncodeToPNG());
            RenderTexture.active = previous;
            camera.targetTexture = null;
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            target.Release();
            UnityEngine.Object.DestroyImmediate(capture);
            UnityEngine.Object.DestroyImmediate(target);
            UnityEngine.Object.DestroyImmediate(camera.gameObject);
        }
    }
}
