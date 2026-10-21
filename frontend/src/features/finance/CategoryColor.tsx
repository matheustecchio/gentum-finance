import { useState } from "react";
import { execute, type Row } from "./client";

export function CategoryColor({ category }: { category: Row }) {
  const [color, setColor] = useState(category.color || "#467644");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="category-color-control">
      <input
        type="color"
        className="category-color"
        aria-label={`Color for ${category.path || category.name}`}
        value={color}
        disabled={busy}
        onChange={async (event) => {
          const next = event.currentTarget.value;
          const previous = color;
          setColor(next);
          setBusy(true);
          setError("");
          try {
            await execute("categoryColor", { id: category.id, color: next });
          } catch (error) {
            setColor(previous);
            setError(error instanceof Error ? error.message : "Unable to save color");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
