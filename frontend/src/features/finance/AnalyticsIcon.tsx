import { SvgIcon } from "./SvgIcon";
import plusIcon from "../../assets/icons/plus.svg";
import lineIcon from "../../assets/icons/chart-line.svg";
import barIcon from "../../assets/icons/chart-bar.svg";
import pieIcon from "../../assets/icons/chart-pie.svg";
import transferIcon from "../../assets/icons/transfer.svg";
export function AnalyticsIcon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const value = name.toLowerCase();
  const icon = /spent|line|wealth/.test(value) ? lineIcon
    : /income|bar/.test(value) ? barIcon
    : /cash flow|transfer/.test(value) ? transferIcon
    : /pie/.test(value) ? pieIcon
    : null;
  if (icon) return <SvgIcon src={icon} className={className} />;
  let shape = null;
  if (/salary|interest|refund|cash|account/.test(value))
    shape = (
      <>
        <ellipse cx="9" cy="6" rx="5" ry="3" />
        <path d="M4 6v7c0 4 10 4 10 0V6M4 10c2 3 8 3 10 0M16 14v7m-3-3h6" />
      </>
    );
  else if (/transport|travel/.test(value))
    shape = (
      <>
        <rect x="5" y="3" width="14" height="15" rx="3" />
        <path d="M5 11h14M8 18v3m8-3v3M8 15h1m6 0h1" />
      </>
    );
  else if (/grocer|food/.test(value))
    shape = (
      <>
        <path d="m4 9 2 11h12l2-11ZM8 9l4-6 4 6M9 12v5m6-5v5" />
      </>
    );
  else if (/shop/.test(value))
    shape = (
      <>
        <path d="M5 8h14l1 13H4ZM9 8V6a3 3 0 0 1 6 0v2" />
      </>
    );
  else if (/rent|home|mortgage/.test(value))
    shape = (
      <>
        <path d="m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7" />
      </>
    );
  else if (/dining|restaurant/.test(value))
    shape = (
      <>
        <path d="M5 3v7m4-7v7M3 3v5a4 4 0 0 0 8 0V3M7 12v9M19 3c-4 3-4 9 0 9V3Zm0 9v9" />
      </>
    );
  else if (/health/.test(value))
    shape = (
      <>
        <path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5Z" />
      </>
    );
  else if (/service|work/.test(value))
    shape = (
      <>
        <rect x="3" y="7" width="18" height="14" rx="3" />
        <path d="M8 7V3h8v4M3 12h18M12 11v4" />
      </>
    );
  else if (/bill|utility/.test(value))
    shape = <path d="m14 2-9 12h6l-1 8 9-13h-6Z" />;
  if (!shape) return <SvgIcon src={plusIcon} className={className} />;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}
