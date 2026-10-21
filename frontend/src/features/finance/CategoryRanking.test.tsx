import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CategoryRanking, contrastText } from "./CategoryRanking";
import type { Snapshot } from "./client";
it("ranks exact cents separately by currency, uses saved colors and shows permanent amounts", () => {
 const snapshot: Snapshot={accounts:[],entries:[],totals:[],budgets:[],recurring:[],categories:[{id:"a",name:"Large",kind:"EXPENSE",color:"#ffcc00"},{id:"b",name:"Small",kind:"EXPENSE",color:"#102030"},{id:"c",name:"Other currency",kind:"EXPENSE",color:"#ffffff"}],breakdown:[{categoryId:"b",currency:"EUR",direct:"9007199254740992"},{categoryId:"a",currency:"EUR",direct:"9007199254740993"},{categoryId:"c",currency:"GBP",direct:"29"}]};
 render(<CategoryRanking snapshot={snapshot} period="Selected week"/>);
 const euro=screen.getByRole("list",{name:"Category spending in EUR"});
 expect([...euro.querySelectorAll("li")].map(e=>e.getAttribute("aria-label"))).toEqual(["Large: €90,071,992,547,409.93","Small: €90,071,992,547,409.92"]);
 expect(euro.querySelector(".category-rank-fill")).toHaveStyle({backgroundColor:"#ffcc00"});
 expect(euro.querySelector(".category-rank-amount")).toBeVisible();
 expect(euro.querySelector(".category-rank-amount")).toHaveTextContent("€90,071,992,547,409.93");
 expect(screen.getByRole("list",{name:"Category spending in GBP"})).toHaveTextContent("£0.29");
});
it("chooses readable amount text for light and dark saved colors",()=>{
 expect(contrastText("#ffffff")).toBe("#000000");
 expect(contrastText("#000000")).toBe("#ffffff");
 expect(contrastText("#ecc05b")).toBe("#000000");
});
