import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Budgets } from "./Budgets";
import { execute, graphql, type Snapshot } from "./client";
vi.mock("./client", () => ({ execute: vi.fn(), graphql: vi.fn() }));
const budget = { id: "b", name: "Everyday", amount: "10000", spent: "9000", remaining: "1000", currency: "EUR", categoryIds: "food,travel", accountIds: "a", frequency: "monthly", planStartDate: "2026-10-01", startDate: "2026-10-01", endDate: "2026-10-31", active: "true", alert: "true", entryIds: "e1,e2" };
const data: Snapshot = { accounts: [{ id: "a", name: "Wallet", currency: "EUR" }, { id: "b", name: "Bank", currency: "EUR" }, {id: "usd", name: "Dollar", currency: "USD"}], categories: [{id:"food",name:"Food",kind:"EXPENSE"},{id:"travel",name:"Travel",kind:"EXPENSE"},{id:"salary",name:"Salary",kind:"INCOME"}], entries: [], budgets: [budget], recurring: [], totals: [] };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(execute).mockResolvedValue("Saved");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable:true,value:function(this: HTMLDialogElement) {this.open = true;}});
});
it("creates a multi-category multi-account budget with exact cents and currency scope", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<Budgets data={{...data,budgets:[]}} month="2026-10" refresh={refresh} />);
  await userEvent.click(screen.getByRole("button", {name:"Create budget"}));
  await userEvent.type(screen.getByLabelText("Name"), "Daily life");
  await userEvent.type(screen.getByLabelText("Limit"), "90071992547409.93");
  await userEvent.click(screen.getByLabelText("Food")); await userEvent.click(screen.getByLabelText("Travel"));
  await userEvent.click(screen.getByLabelText("Wallet")); await userEvent.click(screen.getByLabelText("Bank"));
  expect(screen.queryByLabelText("Dollar")).not.toBeInTheDocument(); expect(screen.queryByLabelText("Salary")).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Period"), "weekly");
  await userEvent.click(screen.getByRole("button", {name:"Save budget"}));
  expect(execute).toHaveBeenCalledWith("saveBudget", expect.objectContaining({name:"Daily life",amount:"9007199254740993",categoryIds:"food,travel",accountIds:"a,b",frequency:"weekly",date:"2026-10-01",alert:"true"}));
  expect(refresh).toHaveBeenCalledOnce();
});
it("requires valid one-time dates and a positive limit", async () => {
  render(<Budgets data={data} month="2026-10" refresh={vi.fn()} />);
  await userEvent.click(screen.getByRole("button",{name:"Create budget"}));
  await userEvent.type(screen.getByLabelText("Name"),"Trip"); await userEvent.type(screen.getByLabelText("Limit"),"0");
  await userEvent.selectOptions(screen.getByLabelText("Period"),"once");
  await userEvent.type(screen.getByLabelText("End date"),"2026-09-30");
  await userEvent.click(screen.getByRole("button",{name:"Save budget"}));
  expect(screen.getByRole("alert")).toHaveTextContent("greater than zero");
  await userEvent.clear(screen.getByLabelText("Limit")); await userEvent.type(screen.getByLabelText("Limit"),"100");
  await userEvent.click(screen.getByRole("button",{name:"Save budget"}));
  expect(screen.getByRole("alert")).toHaveTextContent("End date must"); expect(execute).not.toHaveBeenCalled();
});
it("warns on overlap without adding totals, and shows the highest in-app threshold", () => {
  render(<Budgets data={{...data,budgets:[budget,{...budget,id:"b2",name:"All spending",categoryIds:"",accountIds:"",spent:"10500"}]}} month="2026-10" refresh={vi.fn()} />);
  expect(screen.getByRole("note")).toHaveTextContent("same expense can count");
  expect(screen.getByText("90% of limit reached")).toBeVisible(); expect(screen.getByText("Limit reached")).toBeVisible();
  expect(screen.getByText(/exceeded/)).toHaveTextContent("5.00 exceeded");
});
it("paginates matching transactions and excludes unrelated expenses", async () => {
  vi.mocked(graphql).mockResolvedValueOnce({entryHistory:{entries:[{id:"e1",date:"2026-10-01",description:"Lunch",amount:"100",currency:"EUR"},{id:"other",description:"Unrelated",amount:"100",currency:"EUR"}],nextCursor:"next"}})
    .mockResolvedValueOnce({entryHistory:{entries:[{id:"e2",date:"2026-10-02",description:"Bus",amount:"100",currency:"EUR"}],nextCursor:""}});
  render(<Budgets data={data} month="2026-10" refresh={vi.fn()} />);
  await userEvent.click(screen.getByRole("button",{name:"Transactions"}));
  expect(await screen.findByText("Bus")).toBeVisible(); expect(screen.getByText("Lunch")).toBeVisible(); expect(screen.queryByText("Unrelated")).not.toBeInTheDocument();
  expect(graphql).toHaveBeenLastCalledWith(expect.any(String),{start:"2026-10-01",end:"2026-10-31",after:"next"});
  await userEvent.click(screen.getByRole("button",{name:"Close"}));
  expect(screen.getByRole("button",{name:"Transactions"})).toHaveFocus();
});
it("edits a future period while preserving the anchor, and confirms stop and delete", async () => {
  render(<Budgets data={data} month="2026-10" refresh={vi.fn().mockResolvedValue(undefined)} />);
  await userEvent.click(screen.getByRole("button",{name:"Edit"}));
  await userEvent.selectOptions(screen.getByLabelText("Apply changes"),"2026-11-01");
  await userEvent.click(screen.getByRole("button",{name:"Save budget"}));
  expect(execute).toHaveBeenCalledWith("saveBudget",expect.objectContaining({id:"b",date:"2026-10-01",effectiveDate:"2026-11-01"}));
  await userEvent.click(screen.getByRole("button",{name:"Stop"}));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Stop budget"}));
  expect(execute).toHaveBeenCalledWith("stopBudget",{id:"b",date:"2026-10-31"});
  await userEvent.click(screen.getByRole("button",{name:"Delete"}));
  expect(screen.getByRole("dialog")).toHaveTextContent("transactions will stay");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Delete budget"}));
  await waitFor(() => expect(execute).toHaveBeenCalledWith("deleteBudget",{id:"b"}));
});
it("retains edits and reports a failed save", async () => {
  vi.mocked(execute).mockRejectedValue(new Error("Save unavailable"));
  render(<Budgets data={data} month="2026-10" refresh={vi.fn()} />);
  await userEvent.click(screen.getByRole("button",{name:"Edit"}));
  await userEvent.click(screen.getByRole("button",{name:"Save budget"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable"); expect(screen.getByLabelText("Name")).toHaveValue("Everyday");
});
it("creates a one-time all-expense all-account budget without alerts", async () => {
  render(<Budgets data={{...data,budgets:[]}} month="2026-10" refresh={vi.fn().mockResolvedValue(undefined)} />);
  await userEvent.click(screen.getByRole("button",{name:"Create budget"}));
  await userEvent.type(screen.getByLabelText("Name"),"Holiday"); await userEvent.type(screen.getByLabelText("Limit"),"500");
  await userEvent.selectOptions(screen.getByLabelText("Period"),"once");
  await userEvent.type(screen.getByLabelText("End date"),"2026-10-15");
  await userEvent.click(screen.getByLabelText("Show in-app alerts at 75%, 90% and 100%"));
  await userEvent.click(screen.getByRole("button",{name:"Save budget"}));
  expect(execute).toHaveBeenCalledWith("saveBudget",expect.objectContaining({frequency:"once",endDate:"2026-10-15",categoryIds:"",accountIds:"",amount:"50000",alert:"false"}));
});
it("warns for parent and child category overlap while honoring disabled alerts", () => {
  render(<Budgets data={{...data,categories:[...data.categories,{id:"lunch",name:"Lunch",kind:"EXPENSE",parentId:"food"}],budgets:[{...budget,spent:"7500",categoryIds:"food"},{...budget,id:"other",name:"Lunch limit",categoryIds:"lunch",spent:"10000",alert:"false"}]}} month="2026-10" refresh={vi.fn()} />);
  expect(screen.getByRole("note")).toBeVisible(); expect(screen.getByText("75% of limit reached")).toBeVisible(); expect(screen.queryByText("Limit reached")).not.toBeInTheDocument();
});
it("uses the backend next date for future changes and prevents editing older visible revisions", async () => {
  render(<Budgets data={{...data,budgets:[{...budget,seriesId:"series",effectiveDate:"2026-10-01"},{...budget,id:"new",name:"Revised",seriesId:"series",effectiveDate:"2026-10-15",startDate:"2026-10-15",endDate:"2026-10-31",nextDate:"2026-11-01"}]}} month="2026-10" refresh={vi.fn().mockResolvedValue(undefined)} />);
  expect(screen.getAllByRole("button",{name:"Edit"})[0]).toBeDisabled();
  await userEvent.click(screen.getAllByRole("button",{name:"Edit"})[1]);
  expect(screen.getByLabelText("Start date")).toHaveAttribute("readonly"); expect(screen.getByLabelText("Period")).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText("Apply changes"),"2026-11-01");
  await userEvent.click(screen.getByRole("button",{name:"Save budget"}));
  expect(execute).toHaveBeenCalledWith("saveBudget",expect.objectContaining({id:"new",date:"2026-10-01",effectiveDate:"2026-11-01"}));
});
it("caps a future period's duration and distinguishes one-time plans from stopped renewals", () => {
  render(<Budgets data={{...data,budgets:[{...budget,frequency:"once",active:"false",startDate:"2099-10-01",endDate:"2099-10-31",latestVersion:"false"}]}} month="2099-10" refresh={vi.fn()} />);
  expect(screen.getByText("Starts 2099-10-01 · 31-day period")).toBeVisible();
  expect(screen.queryByText(/Stopped/)).not.toBeInTheDocument(); expect(screen.getByRole("button",{name:"Edit"})).toBeDisabled();
});

it("renders wide period aggregates without weakening transaction limits", () => {
  render(<Budgets data={{...data,budgets:[{...budget,amount:"100",spent:"10000000000000000000",remaining:"-9999999999999999900"}]}} month="2026-10" refresh={vi.fn()} />);
  expect(screen.getByText(/10000000000000000000% used/)).toBeVisible();
  expect(screen.getByText(/exceeded$/)).toBeVisible();
});
