import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CategoryColor } from "./CategoryColor";
import { execute } from "./client";
vi.mock("./client", () => ({ execute: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const category = { id: "food", name: "Food", color: "#123456" };
it("saves the selected RGB color for the category", async () => {
  vi.mocked(execute).mockResolvedValue("Saved");
  render(<CategoryColor category={category} />);
  const input = screen.getByLabelText("Color for Food");
  expect(input).toHaveValue("#123456");
  fireEvent.change(input, { target: { value: "#abcdef" } });
  await waitFor(() => expect(execute).toHaveBeenCalledWith("categoryColor", { id: "food", color: "#abcdef" }));
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue("#abcdef");
});
it("restores the saved color and reports a save failure", async () => {
  vi.mocked(execute).mockRejectedValue(new Error("Unable to save"));
  render(<CategoryColor category={category} />);
  const input = screen.getByLabelText("Color for Food");
  fireEvent.change(input, { target: { value: "#abcdef" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save");
  expect(input).toHaveValue("#123456");
  expect(input).toBeEnabled();
});
