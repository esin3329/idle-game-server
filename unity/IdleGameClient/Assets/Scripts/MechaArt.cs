using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace IdleGame
{
    public static class MechaArt
    {
        public const string ResourcePath = "Art/MechaSheet";
        private static readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();

        public static Sprite Get(string name)
        {
            if (sprites.Count == 0)
                foreach (var path in new[] { ResourcePath, "Art/EnemySheet", "Art/CombatEffects", "Art/RuinsSheet" })
                    foreach (var sprite in Resources.LoadAll<Sprite>(path)) sprites[sprite.name] = sprite;
            if (!sprites.TryGetValue(name, out var result))
                throw new InvalidOperationException("Missing mecha sprite: " + name);
            return result;
        }

        public static void Apply(Image image, string name)
        {
            image.sprite = Get(name);
            image.color = Color.white;
            image.preserveAspect = true;
            image.raycastTarget = false;
        }
    }
}
