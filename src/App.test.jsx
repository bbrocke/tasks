// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Planner } from "./App";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  supabase: { from: vi.fn() },
  supabaseConfigError: null,
}));

const lists = [
  { id: "work", name: "Work", color: "#665F50", tape: "#EDEAE2" },
  { id: "home", name: "Home", color: "#665F50", tape: "#EDEAE2" },
];
const task = { id: 1, list_id: "work", text: "Read chapter", done: false, recur: "custom", streak: 0 };
const secondTask = { ...task, id: 2, text: "Review notes", recur: null };
const user = { id: "owner-id", email: "owner@example.test" };
const App = () => <Planner user={user} />;
let writes;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockDatabase({ listResult = Promise.resolve({ data: lists }), taskResult = Promise.resolve({ data: [task, secondTask] }) } = {}) {
  supabase.from.mockImplementation((table) => ({
    select: () => ({ eq: () => ({ order: () => table === "lists" ? listResult : taskResult }) }),
    ...Object.fromEntries(["insert", "update", "delete"].map((operation) => [operation, (payload) => {
      const pending = deferred();
      const call = { operation, payload, ...pending };
      const query = {
        eq: (column, value) => { call.filter = [column, value]; return query; },
        select: (columns) => { call.columns = columns; return query; },
        single: () => { writes.push(call); return pending.promise; },
      };
      return query;
    }])),
  }));
}

async function openWork() {
  render(<App />);
  await screen.findByRole("heading", { name: "Work" });
}

async function navigateTo(name) {
  fireEvent.click(screen.getByTitle(name));
  await screen.findByRole("heading", { name });
}

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  window.history.replaceState(null, "", "#/work");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mockDatabase();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("list navigation", () => {
  it("preserves a saved list link through delayed loading in StrictMode", async () => {
    const initial = deferred();
    mockDatabase({ listResult: initial.promise });
    render(<StrictMode><App /></StrictMode>);
    expect(window.location.hash).toBe("#/work");
    expect(screen.getByText("Loading your spread…")).toBeTruthy();
    await act(async () => initial.resolve({ data: lists }));
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(window.location.hash).toBe("#/work");
  });

  it.each(["#/missing", "#/%E0%A4%A"])("safely falls back for %s", async (hash) => {
    window.history.replaceState(null, "", hash);
    render(<App />);
    await screen.findByRole("heading", { name: "This week's spread" });
    expect(window.location.hash).toBe("#/dashboard");
  });

  it("does not discard the saved link when loading fails", async () => {
    mockDatabase({ listResult: Promise.resolve({ error: new Error("Offline") }) });
    render(<App />);
    await screen.findByRole("alert");
    expect(window.location.hash).toBe("#/work");
  });

  it("handles encoded IDs and normalizes numeric list IDs", async () => {
    const specialLists = [{ ...lists[0], id: "work / study" }, { ...lists[1], id: 42 }];
    window.history.replaceState(null, "", "#/work%20%2F%20study");
    mockDatabase({ listResult: Promise.resolve({ data: specialLists }) });
    await openWork();
    await navigateTo("Home");
    expect(window.location.hash).toBe("#/42");
  });

  it("follows browser back and forward between lists", async () => {
    await openWork();
    await navigateTo("Home");
    act(() => window.history.back());
    await screen.findByRole("heading", { name: "Work" });
    act(() => window.history.forward());
    await screen.findByRole("heading", { name: "Home" });
  });
});

describe("task saves", () => {
  it("blocks repeated toggles and deletion while a task is saving, then unlocks it", async () => {
    await openWork();
    const complete = screen.getByRole("button", { name: "Mark complete: Read chapter" });
    act(() => { complete.click(); complete.click(); });
    fireEvent.click(screen.getByRole("button", { name: "Delete task: Read chapter" }));
    expect(writes).toHaveLength(1);
    expect(writes[0].operation).toBe("update");
    expect(writes[0].filter).toEqual(["id", 1]);
    expect(screen.getByRole("button", { name: "Mark incomplete: Read chapter" }).disabled).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => writes[0].resolve({ data: { ...task, done: true, streak: 1 } }));
    const undo = screen.getByRole("button", { name: "Mark incomplete: Read chapter" });
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(writes).toHaveLength(2);
    expect(writes[1].payload).toEqual({ done: false, streak: 0 });
    await act(async () => writes[1].resolve({ data: task }));
  });

  it.each(["rejection", "zero rows"])("rolls back a failed update (%s) and permits retry", async (failure) => {
    await openWork();
    fireEvent.click(screen.getByRole("button", { name: "Mark complete: Read chapter" }));
    await act(async () => failure === "rejection"
      ? writes[0].reject(new Error("Offline"))
      : writes[0].resolve({ data: null, error: { code: "PGRST116" } }));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
    const retry = screen.getByRole("button", { name: "Mark complete: Read chapter" });
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    await act(async () => writes[1].resolve({ data: { ...task, done: true, streak: 1 } }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets separate tasks save independently and preserves an error when another save succeeds", async () => {
    await openWork();
    fireEvent.click(screen.getByRole("button", { name: "Mark complete: Read chapter" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark complete: Review notes" }));
    expect(writes).toHaveLength(2);
    await act(async () => writes[0].reject(new Error("Offline")));
    await act(async () => writes[1].resolve({ data: { ...secondTask, done: true } }));
    expect(screen.getByRole("button", { name: "Mark complete: Read chapter" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Mark incomplete: Review notes" }).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
  });

  it("keeps a task visible until deletion is confirmed and keeps it after a rejected deletion", async () => {
    await openWork();
    fireEvent.click(screen.getByRole("button", { name: "Delete task: Read chapter" }));
    expect(screen.getByText("Read chapter")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark complete: Read chapter" }).disabled).toBe(true);
    await act(async () => writes[0].resolve({ data: null, error: { code: "PGRST116" } }));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't delete");
    fireEvent.click(screen.getByRole("button", { name: "Delete task: Read chapter" }));
    expect(writes[1].columns).toBe("id");
    await act(async () => writes[1].resolve({ data: { id: 1 } }));
    expect(screen.queryByText("Read chapter")).toBeNull();
  });

  it("does not delete when confirmation is cancelled", async () => {
    await openWork();
    window.confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete task: Read chapter" }));
    expect(writes).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Mark complete: Read chapter" }).disabled).toBe(false);
  });

  it("prevents duplicate submissions and preserves the text and recurring option on failure", async () => {
    await openWork();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  New task  " } });
    fireEvent.click(screen.getByRole("button", { name: "Mark task as recurring" }));
    act(() => { fireEvent.submit(input.form); fireEvent.submit(input.form); });
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ text: "New task", recur: "custom", list_id: "work" });
    expect(input.disabled).toBe(true);
    await act(async () => writes[0].reject(new Error("Offline")));
    expect(input.value).toBe("  New task  ");
    expect(input.disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Mark task as recurring" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.submit(input.form);
    await act(async () => writes[1].resolve({ data: { ...task, id: 3, text: "New task" } }));
    expect(input.value).toBe("");
    expect(screen.getAllByText("New task")).toHaveLength(1);
  });

  it.each([true, false])("keeps drafts attached to their list while an add settles (success=%s)", async (success) => {
    await openWork();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Work draft" } });
    await navigateTo("Home");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Home draft" } });
    await navigateTo("Work");
    const input = screen.getByRole("textbox");
    expect(input.value).toBe("Work draft");
    fireEvent.submit(input.form);
    await navigateTo("Home");
    await act(async () => success
      ? writes[0].resolve({ data: { ...task, id: 3, text: "Work draft" } })
      : writes[0].reject(new Error("Offline")));
    expect(screen.getByRole("textbox").value).toBe("Home draft");
    await navigateTo("Work");
    expect(screen.getByRole("textbox").value).toBe(success ? "" : "Work draft");
  });
});
