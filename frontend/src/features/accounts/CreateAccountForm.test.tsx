import { MockedProvider } from "@apollo/client/testing";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateAccountForm } from "./CreateAccountForm";
import { ACCOUNTS_QUERY, CREATE_ACCOUNT_MUTATION } from "./accounts.graphql";

it("sends exact integer cents and resets after successful creation", async () => {
  const created = vi.fn(() => ({ data: { createAccount: {
    id: "new-account", name: "Everyday", type: "CURRENT", currency: "EUR",
    initialBalance: "29", archived: false,
  } } }));
  render(<MockedProvider mocks={[
    { request: { query: CREATE_ACCOUNT_MUTATION, variables: { input: {
      name: "Everyday", type: "CURRENT", currency: "EUR", initialBalance: "29",
    } } }, result: created },
    { request: { query: ACCOUNTS_QUERY }, result: { data: { accounts: [] } } },
  ]}><CreateAccountForm /></MockedProvider>);
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Everyday" } });
  fireEvent.change(screen.getByLabelText("Initial balance"), { target: { value: "0.29" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByLabelText("Account name")).toHaveValue(""));
});

it("retains input and reports a failed mutation", async () => {
  render(<MockedProvider mocks={[
    { request: { query: CREATE_ACCOUNT_MUTATION, variables: { input: {
      name: "Everyday", type: "CURRENT", currency: "EUR", initialBalance: "100",
    } } }, error: new Error("Unavailable") },
  ]}><CreateAccountForm /></MockedProvider>);
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Everyday" } });
  fireEvent.change(screen.getByLabelText("Initial balance"), { target: { value: "1.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Account creation failed");
  expect(screen.getByLabelText("Initial balance")).toHaveValue("1.00");
});

it("rejects fractional cents before sending a mutation", async () => {
  render(<MockedProvider><CreateAccountForm /></MockedProvider>);
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Everyday" } });
  fireEvent.change(screen.getByLabelText("Initial balance"), { target: { value: "1.001" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByText("Use a number with up to two decimal places")).toBeInTheDocument();
});
