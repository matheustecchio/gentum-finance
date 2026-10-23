import { invoke, isTauri } from "@tauri-apps/api/core";

export async function startBackend(): Promise<void> {
  if (import.meta.env.MODE === "test") return;
  if (!isTauri()) throw new Error("Open Gentum Finance from the installed desktop application.");
  await invoke("backend_start");
}

export const desktopFetch: typeof fetch = async (input, init) => {
  // Unit tests inject a fetch mock. Production never opens a network connection.
  if (import.meta.env.MODE === "test") return fetch(input, init);
  if (!isTauri()) throw new Error("Open Gentum Finance from the installed desktop application.");
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const response = await invoke<{status:number; headers:Record<string,string>; body:string}>("backend_request", {
    request: { method: init?.method ?? "GET", path: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body },
  });
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(response.body, {status:response.status, headers:response.headers});
};

export async function saveExport(filename: string, bytes: Uint8Array): Promise<void> {
  if (import.meta.env.MODE === "test") {
    const url = URL.createObjectURL(new Blob([bytes]));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const data = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  await invoke("save_export", {filename, data});
}
