using UnityEditor;
using UnityEngine;

namespace IdleGame.Editor
{
    public sealed class MechaSheetImporter : AssetPostprocessor
    {
        private void OnPreprocessTexture()
        {
            if (assetPath != "Assets/Resources/Art/MechaSheet.png") return;
            var importer = (TextureImporter)assetImporter;
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Multiple;
            importer.filterMode = FilterMode.Point;
            importer.mipmapEnabled = false;
            importer.alphaIsTransparency = true;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.maxTextureSize = 2048;
            importer.spritePixelsPerUnit = 100;
            importer.wrapMode = TextureWrapMode.Clamp;
#pragma warning disable CS0618
            importer.spritesheet = new[]
            {
                Frame("front", 14, 38, 280, 315),
                Frame("side", 300, 38, 185, 315),
                Frame("back", 515, 42, 210, 312),
                Frame("isometric", 742, 76, 192, 276),
                Frame("size64", 982, 46, 111, 131),
                Frame("size48", 1126, 67, 88, 110),
                Frame("size32", 1245, 86, 85, 91),
                Frame("size24", 1350, 108, 75, 69),
                Frame("size16", 1442, 130, 64, 47),
                Frame("white", 972, 262, 101, 123),
                Frame("red", 1087, 261, 100, 124),
                Frame("blue", 1201, 261, 100, 124),
                Frame("green", 1307, 261, 104, 124),
                Frame("purple", 1419, 261, 104, 124),
                Frame("idle", 22, 471, 96, 98),
                Frame("walk1", 132, 471, 83, 98),
                Frame("walk2", 235, 471, 79, 98),
                Frame("walk3", 323, 471, 89, 98),
                Frame("walk4", 421, 471, 79, 98),
                Frame("run1", 516, 471, 91, 98),
                Frame("run2", 630, 471, 94, 98),
                Frame("run3", 741, 471, 98, 98),
                Frame("run4", 858, 471, 98, 98),
                Frame("shoot0", 995, 474, 125, 95),
                Frame("shoot1", 1123, 474, 136, 95),
                Frame("shoot2", 1258, 474, 140, 95),
                Frame("shoot3", 1392, 474, 144, 95),
                Frame("dash1", 16, 660, 116, 95),
                Frame("dash2", 158, 660, 115, 95),
                Frame("dash3", 284, 660, 95, 95),
                Frame("missileFire", 394, 660, 111, 95),
                Frame("missile1", 737, 651, 55, 40),
                Frame("missile2", 783, 687, 59, 41),
                Frame("explosion", 910, 650, 118, 110),
                Frame("slash1", 1046, 647, 228, 108),
                Frame("slash2", 1268, 658, 138, 97),
                Frame("slash3", 1402, 658, 134, 97),
                Frame("head", 22, 843, 73, 92),
                Frame("torso", 108, 835, 113, 113),
                Frame("arm", 224, 842, 70, 130),
                Frame("legs", 293, 826, 115, 157),
                Frame("backpack", 418, 835, 124, 131),
                Frame("rifle", 561, 840, 159, 58),
                Frame("blade", 732, 811, 64, 169),
                Frame("shield", 806, 826, 105, 147),
                Frame("impact", 1000, 843, 68, 66),
                Frame("jet", 1238, 875, 56, 85)
            };
#pragma warning restore CS0618
        }

        private static SpriteMetaData Frame(string name, int x, int y, int width, int height)
        {
            return new SpriteMetaData { name = name, rect = new Rect(x, 1024 - y - height, width, height),
                alignment = (int)SpriteAlignment.Center, pivot = new Vector2(.5f, .5f) };
        }
    }
}
