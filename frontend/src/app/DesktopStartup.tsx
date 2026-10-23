import { useEffect, useState, type PropsWithChildren } from "react";
import { startBackend } from "../desktop";

export function DesktopStartup({children}: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    startBackend().then(() => { if (active) setReady(true); }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [attempt]);
  if (ready) return children;
  return <main style={{maxWidth:520, margin:"15vh auto", padding:24}} aria-live="polite">
    <h1>Gentum Finance</h1>
    {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Try again</button></> : <p role="status">Opening your local finance workspace…</p>}
  </main>;
}
