import { useState, type FormEvent } from "react";
import { toCents } from "../accounts/money";
import type { Row, Snapshot } from "./client";

export const budgetFrequencies = { monthly: "Monthly", weekly: "Weekly", yearly: "Yearly", once: "One time" };
export const ids = (value?: string) => (value || "").split(",").filter(Boolean);
export function nextBudgetDate(end: string) {
  const date = new Date(`${end}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
const decimal = (value: string) => `${BigInt(value) / 100n}.${(BigInt(value) % 100n).toString().padStart(2, "0")}`;

export function BudgetForm({ data, budget, month, busy, save, cancel }: {
  data: Snapshot; budget?: Row; month: string; busy: boolean;
  save: (input: Row) => Promise<boolean>; cancel: () => void;
}) {
  const [currency, setCurrency] = useState(budget?.currency || data.accounts[0]?.currency || "EUR");
  const [frequency, setFrequency] = useState(budget?.frequency || "monthly");
  const [categories, setCategories] = useState(ids(budget?.categoryIds ?? budget?.categoryId));
  const [accounts, setAccounts] = useState(ids(budget?.accountIds));
  const [error, setError] = useState("");
  const currencies = [...new Set([currency, ...data.accounts.map(a => a.currency)])];
  const selectableAccounts = data.accounts.filter(a => a.currency === currency);
  const toggle = (list: string[], id: string, checked: boolean) => checked ? [...list, id] : list.filter(item => item !== id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const amount = toCents(String(form.get("amount")));
      if (BigInt(amount) <= 0n) throw new Error("Enter a limit greater than zero.");
      const date = String(form.get("date"));
      const endDate = String(form.get("endDate") || "");
      if (frequency === "once" && endDate < date) throw new Error("End date must be on or after the start date.");
      const input: Row = { name: String(form.get("name")).trim(), currency, amount, date,
        frequency, endDate, categoryIds: categories.join(","), accountIds: accounts.join(","), alert: form.has("alert") ? "true" : "false" };
      if (budget) { input.id = budget.id; input.effectiveDate = String(form.get("effectiveDate")); }
      if (await save(input)) cancel();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save budget."); }
  }
  return <form className="panel budget-form" onSubmit={submit}>
    <h2>{budget ? "Edit budget" : "Create budget"}</h2>
    <div className="form-grid">
      <label>Name<input name="name" required maxLength={100} defaultValue={budget?.name || ""} autoFocus /></label>
      <label>Limit<input name="amount" inputMode="decimal" required defaultValue={budget ? decimal(budget.amount) : ""} placeholder="0.00" /></label>
      <label>Currency<select value={currency} disabled={!!budget} onChange={e => { setCurrency(e.target.value); setAccounts([]); }}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Period<select value={frequency} disabled={!!budget} onChange={e => setFrequency(e.target.value)}>{Object.entries(budgetFrequencies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Start date<input name="date" type="date" required readOnly={!!budget} defaultValue={budget?.planStartDate || budget?.startDate || `${month}-01`} /></label>
      {frequency === "once" && <label>End date<input name="endDate" type="date" required defaultValue={budget?.endDate} /></label>}
      {budget && <label>Apply changes<select name="effectiveDate" defaultValue={budget.startDate}><option value={budget.startDate}>This period</option>{budget.frequency !== "once" && budget.endDate && <option value={budget.nextDate || nextBudgetDate(budget.endDate)}>Next period</option>}</select></label>}
    </div>
    <fieldset><legend>Expense categories</legend><label className="budget-choice"><input type="checkbox" checked={categories.length === 0} onChange={() => setCategories([])} />All expense categories</label>
      <div className="budget-choices">{data.categories.filter(c => c.kind === "EXPENSE").map(c => <label className="budget-choice" key={c.id}><input type="checkbox" checked={categories.includes(c.id)} onChange={e => setCategories(toggle(categories, c.id, e.target.checked))} />{c.path || c.name}</label>)}</div>
    </fieldset>
    <fieldset><legend>Accounts in {currency}</legend><label className="budget-choice"><input type="checkbox" checked={accounts.length === 0} onChange={() => setAccounts([])} />All accounts in {currency}</label>
      <div className="budget-choices">{selectableAccounts.map(a => <label className="budget-choice" key={a.id}><input type="checkbox" checked={accounts.includes(a.id)} onChange={e => setAccounts(toggle(accounts, a.id, e.target.checked))} />{a.name}</label>)}</div>
    </fieldset>
    <label className="budget-choice"><input name="alert" type="checkbox" defaultChecked={budget?.alert !== "false"} />Show in-app alerts at 75%, 90% and 100%</label>
    <p className="muted">{frequency === "once" ? "This budget ends on its end date." : "Automatically renews each period until you stop it."} Only recorded expenses count.{budget ? " Create a new budget to use a different start date or recurrence." : ""}</p>
    {error && <p role="alert">{error}</p>}
    <div className="actions"><button disabled={busy} type="submit">{busy ? "Saving…" : "Save budget"}</button><button disabled={busy} type="button" className="secondary" onClick={cancel}>Cancel</button></div>
  </form>;
}
