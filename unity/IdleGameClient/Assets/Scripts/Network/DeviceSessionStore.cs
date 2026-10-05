using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace IdleGame.Network
{
    public sealed class DeviceSessionStore
    {
        private readonly string path;
        public bool Exists => File.Exists(path);

        public DeviceSessionStore(string path = null)
        { this.path = path ?? Path.Combine(Application.persistentDataPath, "login-session.bin"); }

        public void Write(JObject data)
        {
            byte[] bytes = Protect(Encoding.UTF8.GetBytes(data.ToString()), true);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temporary = path + ".tmp";
            File.WriteAllBytes(temporary, bytes);
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }

        public JObject Read()
        {
            if (!Exists) return null;
            try
            {
                using var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(
                    Encoding.UTF8.GetString(Protect(File.ReadAllBytes(path), false))))
                    { DateParseHandling = Newtonsoft.Json.DateParseHandling.None };
                return JObject.Load(reader);
            }
            catch (Exception error) when (error is CryptographicException || error is Newtonsoft.Json.JsonException ||
                error is ArgumentException || error is IOException)
            { Clear(); return null; }
        }

        public void Clear()
        {
            if (File.Exists(path)) File.Delete(path);
            if (File.Exists(path + ".tmp")) File.Delete(path + ".tmp");
        }

        private static byte[] Protect(byte[] bytes, bool encrypt)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            const string alias = "CoreForge.DeviceLogin";
            using var keyStoreClass = new AndroidJavaClass("java.security.KeyStore");
            using var keyStore = keyStoreClass.CallStatic<AndroidJavaObject>("getInstance", "AndroidKeyStore");
            keyStore.Call("load", new object[] { null, null });
            if (!keyStore.Call<bool>("containsAlias", alias))
            {
                if (!encrypt) throw new CryptographicException("Device login key is missing.");
                using var builder = new AndroidJavaObject("android.security.keystore.KeyGenParameterSpec$Builder", alias, 3);
                using var modes = builder.Call<AndroidJavaObject>("setBlockModes", new object[] { new[] { "GCM" } });
                using var padding = builder.Call<AndroidJavaObject>("setEncryptionPaddings", new object[] { new[] { "NoPadding" } });
                using var spec = builder.Call<AndroidJavaObject>("build");
                using var generatorClass = new AndroidJavaClass("javax.crypto.KeyGenerator");
                using var generator = generatorClass.CallStatic<AndroidJavaObject>("getInstance", "AES", "AndroidKeyStore");
                generator.Call("init", spec);
                using var generated = generator.Call<AndroidJavaObject>("generateKey");
            }
            using var key = keyStore.Call<AndroidJavaObject>("getKey", alias, null);
            using var cipherClass = new AndroidJavaClass("javax.crypto.Cipher");
            using var cipher = cipherClass.CallStatic<AndroidJavaObject>("getInstance", "AES/GCM/NoPadding");
            if (encrypt)
            {
                cipher.Call("init", 1, key);
                byte[] iv = cipher.Call<byte[]>("getIV");
                byte[] encrypted = cipher.Call<byte[]>("doFinal", bytes);
                var result = new byte[1 + iv.Length + encrypted.Length];
                result[0] = (byte)iv.Length;
                Buffer.BlockCopy(iv, 0, result, 1, iv.Length);
                Buffer.BlockCopy(encrypted, 0, result, 1 + iv.Length, encrypted.Length);
                return result;
            }
            if (bytes.Length < 30 || bytes[0] == 0 || bytes[0] > 32 || bytes.Length <= bytes[0] + 17)
                throw new CryptographicException("Invalid device login data.");
            var nonce = new byte[bytes[0]];
            var payload = new byte[bytes.Length - 1 - nonce.Length];
            Buffer.BlockCopy(bytes, 1, nonce, 0, nonce.Length);
            Buffer.BlockCopy(bytes, 1 + nonce.Length, payload, 0, payload.Length);
            using var parameters = new AndroidJavaObject("javax.crypto.spec.GCMParameterSpec", 128, nonce);
            cipher.Call("init", 2, key, parameters);
            try { return cipher.Call<byte[]>("doFinal", payload); }
            catch (AndroidJavaException error) { throw new CryptographicException("Device login data cannot be decrypted.", error); }
#elif UNITY_EDITOR_WIN || UNITY_STANDALONE_WIN
            var input = new DataBlob { Length = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) };
            var output = new DataBlob();
            try
            {
                Marshal.Copy(bytes, 0, input.Data, bytes.Length);
                bool success = encrypt ? CryptProtectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output) :
                    CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
                if (!success) throw new CryptographicException(Marshal.GetLastWin32Error());
                var result = new byte[output.Length];
                Marshal.Copy(output.Data, result, 0, result.Length);
                return result;
            }
            finally
            {
                Marshal.FreeHGlobal(input.Data);
                if (output.Data != IntPtr.Zero) LocalFree(output.Data);
            }
#else
            throw new PlatformNotSupportedException("Device login storage supports Windows and Android.");
#endif
        }

#if UNITY_EDITOR_WIN || UNITY_STANDALONE_WIN
        [StructLayout(LayoutKind.Sequential)]
        private struct DataBlob { public int Length; public IntPtr Data; }
        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CryptProtectData(ref DataBlob input, string description, IntPtr entropy,
            IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern bool CryptUnprotectData(ref DataBlob input, IntPtr description, IntPtr entropy,
            IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr pointer);
#endif
    }
}
