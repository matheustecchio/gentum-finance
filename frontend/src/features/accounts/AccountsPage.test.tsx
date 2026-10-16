import { MockedProvider } from "@apollo/client/testing";
import { render, screen } from "@testing-library/react";
import { AccountsPage } from "./AccountsPage";
import { ACCOUNTS_QUERY } from "./accounts.graphql";

describe("AccountsPage", () => {
  it("renders accounts returned by GraphQL", async () => {
    render(
      <MockedProvider
        mocks={[{
          request: { query: ACCOUNTS_QUERY },
          result: {
            data: {
              accounts: [{
                id: "20a22e38-88f9-4505-b198-7cf5ad146f4c",
                name: "Rainy day fund",
                type: "SAVINGS",
                currency: "EUR",
                initialBalance: "125000",
                archived: false,
              }, {
                id: "df914c2c-b9d1-49ab-bda8-a477366b2165",
                name: "Precision boundary",
                type: "CURRENT",
                currency: "EUR",
                initialBalance: "9223372036854775807",
                archived: false,
              }],
            },
          },
        }]}
      >
        <AccountsPage />
      </MockedProvider>,
    );

    expect(await screen.findByText("Rainy day fund")).toBeInTheDocument();
    expect(screen.getByText("Savings · EUR")).toBeInTheDocument();
    expect(screen.getByText(/1,250\.00/)).toBeInTheDocument();
    expect(screen.getByText((content, element) => (
      element?.tagName === "STRONG"
      && content.replace(/\D/g, "") === "9223372036854775807"
    ))).toBeInTheDocument();
  });
});
