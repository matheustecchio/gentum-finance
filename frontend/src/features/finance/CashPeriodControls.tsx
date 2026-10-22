import { useEffect, useRef, useState } from "react";
import { CustomDates, type DateRange, type Period } from "./PeriodControls";
const primary = [
  ["week", "1W", "Week"],
  ["month", "1M", "Month"],
  ["halfYear", "6M", "Semester"],
  ["year", "1Y", "Year"],
] as const;
export function CashPeriodControls({
  period,
  custom,
  today,
  weekStart,
  onPeriod,
  onCustom,
  onWeekStart,
  label = "Cash flow",
}: {
  label?: string;
  period: Period;
  custom: DateRange;
  today: string;
  weekStart: number;
  onPeriod: (value: Period) => void;
  onCustom: (value: DateRange) => void;
  onWeekStart: (value: number) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasModal = useRef(false);
  useEffect(() => {
    if (!modal && wasModal.current) trigger.current?.focus();
    wasModal.current = modal;
  }, [modal]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);
  const selected = primary.findIndex(([value]) => value === period);
  return (
    <div
      className="cash-period-controls"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menu) {
          e.preventDefault();
          setMenu(false);
          trigger.current?.focus();
        }
      }}
    >
      <div
        className="cash-segments"
        role="group"
        aria-label={`${label} period`}
      >
        <span
          className="cash-segment-indicator"
          aria-hidden="true"
          style={{
            transform: `translateX(${Math.max(0, selected) * 100}%)`,
            opacity: selected < 0 ? 0 : 1,
          }}
        />
        {primary.map(([value, label, name]) => (
          <button
            key={value}
            aria-label={name}
            aria-pressed={period === value}
            onClick={() => {
              setMenu(false);
              onPeriod(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        ref={trigger}
        className={`cash-more ${selected < 0 ? "is-active" : ""}`}
        aria-label={`More ${label.toLowerCase()} periods`}
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
      >
        •••
      </button>
      {menu && (
        <div
          className="cash-period-menu"
          role="group"
          aria-label={`Additional ${label.toLowerCase()} periods`}
        >
          {(
            [
              ["quarter", "Quarter"],
              ["fiveYears", "5 years"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={period === value}
              onClick={() => {
                onPeriod(value);
                setMenu(false);
              }}
            >
              {label}
            </button>
          ))}
          <button
            aria-haspopup="dialog"
            aria-pressed={period === "custom"}
            onClick={() => {
              setMenu(false);
              setModal(true);
            }}
          >
            Custom
          </button>
          <label>
            Week starts on
            <select
              value={weekStart}
              onChange={(e) => onWeekStart(Number(e.target.value))}
            >
              <option value="1">Monday</option>
              <option value="0">Sunday</option>
            </select>
          </label>
        </div>
      )}
      {modal && (
        <CustomDates
          value={custom}
          today={today}
          onClose={() => setModal(false)}
          onApply={(range) => {
            onCustom(range);
            setModal(false);
          }}
        />
      )}
    </div>
  );
}
