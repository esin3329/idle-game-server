using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace IdleGame.Editor
{
    public sealed class CombatSheetImporter : AssetPostprocessor
    {
        [MenuItem("Idle Game/Verify Combat Assets")]
        public static void Verify()
        {
            string[] paths = { "Art/EnemySheet", "Art/CombatEffects", "Art/RuinsSheet" };
            int[] counts = { 64, 10, 23 };
            for (int i = 0; i < paths.Length; i++)
            {
                var sprites = Resources.LoadAll<Sprite>(paths[i]);
                if (sprites.Length != counts[i])
                    throw new System.InvalidOperationException($"{paths[i]}: expected {counts[i]} sprites, got {sprites.Length}");
                foreach (var sprite in sprites)
                    if (sprite.texture.filterMode != FilterMode.Point || sprite.rect.width <= 0 || sprite.rect.height <= 0 ||
                        sprite.rect.xMin < 0 || sprite.rect.yMin < 0 ||
                        sprite.rect.xMax > sprite.texture.width || sprite.rect.yMax > sprite.texture.height)
                        throw new System.InvalidOperationException("Invalid combat sprite: " + sprite.name);
            }
            Debug.Log("Combat asset check passed: 97 sprites. Rendering and animation still require play-mode review.");
        }

        private void OnPreprocessTexture()
        {
            var frames = new List<SpriteMetaData>();
            int height = 1024;
            if (assetPath == "Assets/Resources/Art/EnemySheet.png")
            {
                string[] kinds = { "Guard", "Rifle", "Armored", "MachineGun" };
                string[] states = { "idle", "walk", "attack", "death" };
                int[] rows = { 397, 486, 584, 684 };
                for (int kind = 0; kind < kinds.Length; kind++)
                    for (int state = 0; state < states.Length; state++)
                        for (int frame = 0; frame < 4; frame++)
                            frames.Add(Frame($"enemy-{kinds[kind]}-{states[state]}-{frame}",
                                kind * 384 + 96 + frame * 74, rows[state], 74, 84, height));
            }
            else if (assetPath == "Assets/Resources/Art/RuinsSheet.png")
            {
                for (int row = 0; row < 4; row++)
                    for (int col = 0; col < 5; col++)
                        frames.Add(Frame($"ground-{row * 5 + col}", 22 + col * 167,
                            25 + row * 166, 156, 156, height));
                frames.Add(Frame("ruin-rubble", 859, 20, 186, 132, height));
                frames.Add(Frame("ruin-crates", 1171, 689, 94, 99, height));
                frames.Add(Frame("ruin-barrel", 1131, 616, 64, 99, height));
            }
            else if (assetPath == "Assets/Resources/Art/CombatEffects.png")
            {
                height = 887;
                frames.Add(Frame("fx-rifle", 395, 66, 61, 37, height));
                frames.Add(Frame("fx-machine", 395, 119, 58, 35, height));
                frames.Add(Frame("fx-pellet", 397, 175, 34, 32, height));
                int[] muzzleX = { 392, 549, 706 };
                int[] hitX = { 393, 549, 710, 815 };
                for (int frame = 0; frame < muzzleX.Length; frame++)
                    frames.Add(Frame($"fx-muzzle-{frame}", muzzleX[frame], 305, 132, 70, height));
                for (int frame = 0; frame < hitX.Length; frame++)
                    frames.Add(Frame($"fx-metal-{frame}", hitX[frame], 527, frame < 2 ? 135 : 95, 67, height));
            }
            else return;
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
            importer.spritesheet = frames.ToArray();
#pragma warning restore CS0618
        }

        private static SpriteMetaData Frame(string name, int x, int y, int width, int height, int sheetHeight)
        {
            return new SpriteMetaData { name = name, rect = new Rect(x, sheetHeight - y - height, width, height),
                alignment = (int)SpriteAlignment.Center, pivot = new Vector2(.5f, .5f) };
        }
    }
}
