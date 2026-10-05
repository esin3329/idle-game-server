using System;
using UnityEngine;
using UnityEngine.EventSystems;

namespace IdleGame
{
    public sealed class BattleArenaInput : MonoBehaviour, IPointerDownHandler, IPointerUpHandler,
        IBeginDragHandler, IDragHandler, IEndDragHandler
    {
        public Action<Vector2> MoveTarget;
        public Action Release;

        public void OnPointerDown(PointerEventData data) => SetTarget(data);
        public void OnBeginDrag(PointerEventData data) => SetTarget(data);
        public void OnDrag(PointerEventData data) => SetTarget(data);
        public void OnPointerUp(PointerEventData data) => Release?.Invoke();
        public void OnEndDrag(PointerEventData data) => Release?.Invoke();

        private void SetTarget(PointerEventData data)
        {
            if (RectTransformUtility.ScreenPointToLocalPointInRectangle((RectTransform)transform,
                data.position, data.pressEventCamera, out var point)) MoveTarget?.Invoke(point);
        }
    }
}
