import type { CSSProperties } from "react";

export function SvgIcon({ src, className = "" }: { src: string; className?: string }) {
  return (
    <span
      className={`asset-icon ${className}`}
      style={{ "--icon-url": `url("${src}")` } as CSSProperties}
      aria-hidden="true"
    />
  );
}
