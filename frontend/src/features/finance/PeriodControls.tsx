import { useEffect, useId, useRef, useState } from "react";

export type Period = "week" | "month" | "quarter" | "halfYear" | "year" | "fiveYears" | "all" | "custom";
export interface DateRange { start: string; end: string }
export function validRange(start: string, end: string, today: string) {
  const real = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  return real(start) && real(end) && start >= "1900-01-01" && start <= end && end <= today;
}
const options = [["week", "Week"], ["month", "Month"], ["quarter", "Quarter"], ["halfYear", "Semester"], ["year", "Year"], ["fiveYears", "5 years"], ["all", "All"]] as const;
export function PeriodControls({ period, custom, today, onPeriod, onCustom, weekEnd, onWeekEnd }: {
  period: Period; custom: DateRange; today: string; onPeriod: (period: Period) => void;
  onCustom: (range: DateRange) => void; weekEnd?: number; onWeekEnd?: (day: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const close = () => setOpen(false);
  return <div className="analytics-toolbar">
    <div className="period-options" role="group" aria-label="Grouping">
      {options.map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => onPeriod(value)}>{label}</button>)}
      {onWeekEnd && <button className="week-settings" aria-label="Week settings" aria-expanded={settings} onClick={() => setSettings(v => !v)} title="Week settings">⚙</button>}
      <button ref={trigger} aria-pressed={period === "custom"} aria-haspopup="dialog" onClick={() => setOpen(true)}>Custom</button>
    </div>
    {settings && onWeekEnd && <div className="week-settings-panel"><label>Week ends on<select value={weekEnd} onChange={e => onWeekEnd(Number(e.target.value))}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label></div>}
    {open && <CustomDates value={custom} today={today} onClose={close} onApply={range => { onCustom(range); close(); }} />}
  </div>;
}
export function CustomDates({ value, today, onClose, onApply }: { value: DateRange; today: string; onClose: () => void; onApply: (range: DateRange) => void }) {
  const [draft, setDraft] = useState(value);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const valid = validRange(draft.start, draft.end, today);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="period-dialog" aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); if (valid) onApply(draft); }}>
      <h2 id={id}>Custom date range</h2>
      <div className="period-dates">
        <label>Start date<input autoFocus required type="date" min="1900-01-01" max={draft.end || today} value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
        <label>End date<input required type="date" min={draft.start || "1900-01-01"} max={today} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
      </div>
      {!valid && <p role="alert">Choose valid dates, ending today or earlier.</p>}
      <div className="dialog-footer"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={!valid}>Apply</button></div>
    </form>
  </dialog>;
}
