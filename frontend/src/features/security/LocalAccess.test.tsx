import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocalAccess, AccessSettings, useLocalAccess } from "./LocalAccess";
const recovery = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567";
afterEach(() => vi.unstubAllGlobals());
function Ledger() {
  const { lock } = useLocalAccess();
  return (
    <>
      <h1>Ledger ready</h1>
      <button onClick={() => void lock()}>Lock now</button>
      <AccessSettings />
    </>
  );
}
function fixture(
  initial: {
    setupRequired?: boolean;
    pinEnabled?: boolean;
    unlocked?: boolean;
  } = {},
) {
  const status = {
    setupRequired: false,
    legacyRequired: false,
    pinEnabled: true,
    unlocked: false,
    ...initial,
  };
  const calls = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/auth/status") return new Response(JSON.stringify(status));
    const values = JSON.parse(String(init?.body ?? "{}"));
    if (url === "/auth/lock") {
      status.unlocked = false;
      return new Response("{}");
    }
    if (url === "/auth/unlock" && values.pin !== "0123")
      return new Response("Invalid PIN or recovery credentials", {
        status: 401,
      });
    status.unlocked = true;
    status.setupRequired = false;
    if (url === "/auth/setup") status.pinEnabled = values.mode === "pin";
    if (url === "/auth/pin") status.pinEnabled = true;
    if (url === "/auth/disable-pin") status.pinEnabled = false;
    return new Response(
      JSON.stringify(
        (url === "/auth/setup" && status.pinEnabled) ||
          url === "/auth/pin" ||
          url === "/auth/recover"
          ? { recoveryCode: recovery }
          : {},
      ),
    );
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}
it("opens a configured unprotected ledger automatically", async () => {
  const calls = fixture({ pinEnabled: false });
  render(
    <LocalAccess>
      <h1>Ledger ready</h1>
    </LocalAccess>,
  );
  await screen.findByRole("heading", { name: "Ledger ready" });
  expect(calls).toHaveBeenCalledWith(
    "/auth/open",
    expect.objectContaining({ method: "POST" }),
  );
});
it("requires PIN confirmation and recovery acknowledgement before entering", async () => {
  const calls = fixture({ setupRequired: true, pinEnabled: false });
  render(
    <LocalAccess>
      <h1>Ledger ready</h1>
    </LocalAccess>,
  );
  await userEvent.click(await screen.findByLabelText("Protect with a PIN"));
  await userEvent.type(screen.getByLabelText("PIN (4 digits)"), "0123");
  await userEvent.type(screen.getByLabelText("Confirm PIN"), "9999");
  await userEvent.click(
    screen.getByRole("button", { name: "Open local ledger" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "PINs do not match",
  );
  expect(
    calls.mock.calls.filter(([url]) => url === "/auth/setup"),
  ).toHaveLength(0);
  await userEvent.clear(screen.getByLabelText("Confirm PIN"));
  await userEvent.type(screen.getByLabelText("Confirm PIN"), "0123");
  await userEvent.click(
    screen.getByRole("button", { name: "Open local ledger" }),
  );
  await screen.findByText(recovery);
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByText(recovery)).toBeInTheDocument());
  expect(
    screen.getByRole("button", { name: "Continue to ledger" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("heading", { name: "Ledger ready" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("I have saved my recovery code"));
  await userEvent.click(
    screen.getByRole("button", { name: "Continue to ledger" }),
  );
  await screen.findByRole("heading", { name: "Ledger ready" });
});
it("rejects a wrong PIN, unlocks a leading-zero PIN and clears ledger on lock", async () => {
  fixture();
  render(
    <LocalAccess>
      <Ledger />
    </LocalAccess>,
  );
  const field = await screen.findByLabelText("PIN (4 digits)");
  await userEvent.type(field, "9999");
  await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid PIN");
  await userEvent.clear(screen.getByLabelText("PIN (4 digits)"));
  await userEvent.type(screen.getByLabelText("PIN (4 digits)"), "0123");
  await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("heading", { name: "Ledger ready" });
  await userEvent.click(screen.getByRole("button", { name: "Lock now" }));
  await screen.findByRole("heading", { name: "Unlock your ledger" });
  expect(
    screen.queryByRole("heading", { name: "Ledger ready" }),
  ).not.toBeInTheDocument();
});
it("resets a forgotten PIN with recovery and displays the replacement code", async () => {
  const calls = fixture();
  render(
    <LocalAccess>
      <h1>Ledger ready</h1>
    </LocalAccess>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Forgot your PIN?" }),
  );
  await userEvent.type(screen.getByLabelText("Recovery code"), recovery);
  await userEvent.type(screen.getByLabelText("New PIN"), "5678");
  await userEvent.type(screen.getByLabelText("Confirm PIN"), "5678");
  await userEvent.click(screen.getByRole("button", { name: "Reset PIN" }));
  await screen.findByText(recovery);
  expect(calls).toHaveBeenCalledWith(
    "/auth/recover",
    expect.objectContaining({
      body: JSON.stringify({ pin: "5678", recoveryCode: recovery }),
    }),
  );
});
it("requires the current PIN when disabling protection", async () => {
  const calls = fixture({ unlocked: true });
  render(
    <LocalAccess>
      <AccessSettings />
    </LocalAccess>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Use without a PIN" }),
  );
  await userEvent.type(screen.getByLabelText("Current PIN"), "0123");
  await userEvent.click(screen.getByRole("button", { name: "Disable PIN" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith(
      "/auth/disable-pin",
      expect.objectContaining({ body: JSON.stringify({ currentPin: "0123" }) }),
    ),
  );
  await screen.findByText("This computer opens your ledger without a PIN.");
});

it("sets up direct access without credentials or a recovery code", async () => {
  const calls = fixture({ setupRequired: true, pinEnabled: false });
  render(
    <LocalAccess>
      <h1>Ledger ready</h1>
    </LocalAccess>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Open local ledger" }),
  );
  await screen.findByRole("heading", { name: "Ledger ready" });
  expect(calls).toHaveBeenCalledWith(
    "/auth/setup",
    expect.objectContaining({ body: JSON.stringify({ mode: "open" }) }),
  );
  expect(screen.queryByText("Save your recovery code")).not.toBeInTheDocument();
});
