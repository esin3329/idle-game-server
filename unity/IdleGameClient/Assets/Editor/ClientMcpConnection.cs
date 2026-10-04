using MCPForUnity.Editor.Services;
using UnityEditor;
using UnityEngine;

namespace IdleGame.Editor
{
    [InitializeOnLoad]
    public static class ClientMcpConnection
    {
        static ClientMcpConnection()
        {
            EditorApplication.delayCall += Connect;
        }

        [MenuItem("Idle Game/Connect Unity MCP")]
        public static async void Connect()
        {
            if (Application.isBatchMode) return;
            EditorPrefs.SetBool("MCPForUnity.UseHttpTransport", true);
            EditorPrefs.SetString("MCPForUnity.HttpUrl", "http://127.0.0.1:8080");
            EditorPrefs.SetBool("MCPForUnity.TelemetryDisabled", true);
            if (!MCPServiceLocator.Bridge.IsRunning)
            {
                bool connected = await MCPServiceLocator.Bridge.StartAsync();
                Debug.Log("Idle Game MCP connection: " + connected);
            }
        }
    }
}
