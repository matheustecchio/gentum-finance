import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export type FlowSelection = {
  element: SVGRectElement;
  value: string;
  series: "income" | "expense" | "net";
};

// A portal keeps the tooltip above the bar without clipping in the scroll viewport.
export function FlowTooltip({
  selection,
  id,
  layoutKey,
}: {
  selection: FlowSelection;
  id: string;
  layoutKey: string;
}) {
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
  }>();
  const [tooltip, setTooltip] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const bar = selection.element.getBoundingClientRect();
      const viewport = selection.element
        .closest(".flow-viewport")
        ?.getBoundingClientRect();
      const leftEdge = Math.max(8, viewport?.left ?? 8);
      const rightEdge = Math.min(
        window.innerWidth - 8,
        viewport?.right ?? window.innerWidth - 8,
      );
      if (
        bar.right <= leftEdge ||
        bar.left >= rightEdge ||
        bar.bottom < 0 ||
        bar.top > window.innerHeight
      ) {
        setBox(undefined);
        return;
      }
      const width = Math.min(240, rightEdge - leftEdge);
      const tooltipBox = tooltip?.getBoundingClientRect();
      const visibleWidth = Math.min(width, tooltipBox?.width ?? width);
      const height = tooltipBox?.height ?? 0;
      setBox({
        left: Math.max(
          leftEdge,
          Math.min(
            bar.left + bar.width / 2 - visibleWidth / 2,
            rightEdge - visibleWidth,
          ),
        ),
        top: Math.max(4, bar.top - height - 8),
        width,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    if (tooltip) observer?.observe(tooltip);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [selection, tooltip, layoutKey]);
  return createPortal(
    <div
      ref={setTooltip}
      id={id}
      role="tooltip"
      className={`flow-tooltip flow-tooltip-${selection.series}`}
      style={{
        position: "fixed",
        visibility: box ? "visible" : "hidden",
        left: box?.left,
        top: box?.top,
        width: "max-content",
        maxWidth: box?.width,
      }}
    >
      {selection.value}
    </div>,
    document.body,
  );
}
