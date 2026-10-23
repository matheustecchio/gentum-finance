import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
import { desktopFetch, saveExport, startBackend } from "./desktop";

describe("desktop boundary", () => {
  beforeEach(() => { vi.stubEnv("MODE", "production"); native.isTauri.mockReturnValue(true); native.invoke.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("uses private native IPC for JSON requests", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    native.invoke.mockResolvedValue({status:200,headers:{"content-type":"application/json"},body:'{"ok":true}'});
    const response = await desktopFetch("/graphql", {method:"POST", headers:{"Content-Type":"application/json"},body:'{"query":"query{status}"}'});
    expect(await response.json()).toEqual({ok:true});
    expect(native.invoke).toHaveBeenCalledWith("backend_request", {request:{method:"POST",path:"/graphql",headers:{"content-type":"application/json"},body:'{"query":"query{status}"}'}});
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects plain browser startup and requests without network fallback", async () => {
    native.isTauri.mockReturnValue(false);
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(startBackend()).rejects.toThrow("installed desktop application");
    await expect(desktopFetch("/graphql")).rejects.toThrow("installed desktop application");
    expect(native.invoke).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it("preserves response status for authentication handling", async () => {
    native.invoke.mockResolvedValue({status:401,headers:{},body:"Locked"});
    const response = await desktopFetch("/auth/status");
    expect(response.status).toBe(401); expect(response.ok).toBe(false); expect(await response.text()).toBe("Locked");
  });
  it("does not submit an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(desktopFetch("/graphql", {signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it("saves exports through the native dialog command", async () => {
    await saveExport("gentum-transactions.zip", new Uint8Array([80,75,3,4]));
    expect(native.invoke).toHaveBeenCalledWith("save_export", {filename:"gentum-transactions.zip",data:"UEsDBA=="});
  });
  it("allows explicitly built test fixtures to inject fetch", async () => {
    vi.stubEnv("MODE", "test"); native.isTauri.mockReturnValue(false);
    const network = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", network);
    await startBackend(); await desktopFetch("/auth/status");
    expect(network).toHaveBeenCalledWith("/auth/status", undefined);
  });
});
