using IdleGame;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace IdleGame.Editor
{
    public static class ClientProjectSetup
    {
        [MenuItem("Idle Game/Create Bootstrap Scene")]
        public static void Create()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            if (!AssetDatabase.IsValidFolder("Assets/Scenes")) AssetDatabase.CreateFolder("Assets", "Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("ClientApp").AddComponent<ClientApp>();
            var camera = new GameObject("Main Camera").AddComponent<Camera>();
            camera.tag = "MainCamera"; camera.orthographic = true;
            camera.backgroundColor = new Color32(12, 20, 30, 255);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.gameObject.AddComponent<AudioListener>();
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Bootstrap.unity");
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/Bootstrap.unity", true) };
            PlayerSettings.companyName = "CoreForge";
            PlayerSettings.productName = "Core Forge";
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.defaultScreenWidth = 540;
            PlayerSettings.defaultScreenHeight = 960;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.runInBackground = true;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.coreforge.idleclient");
            AssetDatabase.SaveAssets();
            Debug.Log("Idle Game bootstrap scene ready.");
        }
    }
}
