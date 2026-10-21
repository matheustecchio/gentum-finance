import { expect, test } from "@playwright/test";
for (const width of [1280, 390]) {
 test(`Period selection supports keyboard, exact values and retry at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  await page.clock.install({time:new Date("2026-10-21T12:00:00Z")});
  let fail=false;
  await page.route("**/auth/status",r=>r.fulfill({json:{setupRequired:false,unlocked:true,pinEnabled:false}}));
  await page.route("**/graphql",r=>{
   const body=r.request().postDataJSON();
   if(body.query.includes("flowHistory("))return r.fulfill({json:{data:{flowHistory:{buckets:[{start:"2026-10-12",end:"2026-10-18"},{start:"2026-10-19",end:"2026-10-21"}],flows:[{month:"2026-10-19",currency:"EUR",income:"9007199254740993",expense:"0",net:"9007199254740993"}],hasEarlier:false}}}});
   if(body.query.includes("categorySpending("))return r.fulfill({json:fail?{errors:[{message:"Categories offline"}]}:{data:{categorySpending:{breakdown:[]}}}});
   return r.fulfill({json:{data:{overview:{currency:"EUR",today:"2026-10-21",wealth:[],flows:[],change30:"",rateError:""},financeSummary:{accounts:[{currency:"EUR"}],categories:[],entries:[],totals:[],budgets:[],recurring:[]}}}});
  });
  await page.goto("/");
  const current=page.getByRole("button",{name:"Select 19–21 Oct 2026 in EUR",exact:true});
  await current.focus();await expect(page.getByRole("tooltip")).toHaveText("€90,071,992,547,409.93");await current.press("Escape");await expect(page.getByRole("tooltip")).toHaveCount(0);
  fail=true;const old=page.getByRole("button",{name:"Select 12–18 Oct 2026 in EUR",exact:true});await old.focus();await old.press("Enter");await expect(page.getByRole("alert")).toContainText("Categories offline");await expect(page.getByRole("heading",{name:"Categories",exact:true})).toHaveCount(0);
  fail=false;await page.getByRole("button",{name:"Retry categories"}).click();await expect(page.getByText("No spending in this period.")).toBeVisible();
 });
}
