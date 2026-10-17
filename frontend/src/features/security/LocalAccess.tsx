import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { request } from "../finance/client";

interface AccessStatus {
  setupRequired: boolean;
  existingProfilesAvailable: boolean;
  pinEnabled: boolean;
  unlocked: boolean;
}
interface AccessContext {
  status: AccessStatus;
  refresh: () => Promise<void>;
  lock: () => Promise<void>;
  showRecovery: (code: string) => void;
}
const Context = createContext<AccessContext | null>(null);
export function useLocalAccess() {
  const value = useContext(Context);
  if (!value) throw new Error("Local access is unavailable");
  return value;
}
const signalChange = () => {
  try {
    localStorage.setItem(
      "gentum:access-change",
      `${Date.now()}-${Math.random()}`,
    );
  } catch {
    // Storage may be blocked. Other tabs still recheck access when focused.
  }
};

function PINField({ name, label }: { name: string; label: string }) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="password"
        inputMode="numeric"
        pattern="[0-9]{4}"
        minLength={4}
        maxLength={4}
        autoComplete="off"
        required
      />
    </label>
  );
}
export function RecoveryNotice({
  code,
  onDone,
}: {
  code: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <section className="panel">
      <h2>Save your recovery code</h2>
      <p>
        This code lets you replace a forgotten PIN without deleting your wallet.
        Store it somewhere safe, separate from this computer. If you lose both
        your PIN and this code, this version has no supported recovery flow.
      </p>
      <p>
        <code className="recovery-code">{code}</code>
      </p>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setMessage("Recovery code copied");
            } catch {
              setMessage("Select the code above and copy it manually.");
            }
          }}
        >
          Copy recovery code
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob(
                [
                  `Gentum Finance recovery code\n\n${code}\n\nKeep this private. It can reset your local PIN.\n`,
                ],
                { type: "text/plain" },
              ),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "gentum-recovery-code.txt";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Save recovery code
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      <p>Only the new code works. Previous recovery codes are invalid.</p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        I have saved my recovery code
      </label>
      <button type="button" disabled={!saved} onClick={onDone}>
        Continue to wallet
      </button>
    </section>
  );
}
function AccessScreen({
  status,
  refresh,
  showRecovery,
}: {
  status: AccessStatus;
  refresh: () => Promise<void>;
  showRecovery: (code: string) => void;
}) {
  const [usePIN, setUsePIN] = useState(false);
  const [existingProfile, setExistingProfile] = useState(false);
  const [recover, setRecover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if ((status.setupRequired && usePIN) || recover) {
        if (values.pin !== values.confirmPin)
          throw new Error("PINs do not match");
      }
      const result = await request<{ recoveryCode?: string }>(
        status.setupRequired
          ? "/auth/setup"
          : recover
            ? "/auth/recover"
            : "/auth/unlock",
        {
          ...(status.setupRequired
            ? {
                mode: usePIN ? "pin" : "open",
                source: existingProfile ? "existing" : "new",
                email: values.email,
                password: values.password,
              }
            : {}),
          pin: values.pin,
          ...(recover ? { recoveryCode: values.recoveryCode } : {}),
        },
      );
      signalChange();
      if (result.recoveryCode) showRecovery(result.recoveryCode);
      else await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open wallet");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <div className="auth-intro">
        <span className="eyebrow">GENTUM FINANCE</span>
        <h1>
          Your money.
          <br />
          On your machine.
        </h1>
        <p>Free, local financial tracking. No online account required.</p>
      </div>
      <div>
        <form className="panel" onSubmit={submit}>
          <h2>
            {status.setupRequired
              ? "Set up your local wallet"
              : recover
                ? "Reset your PIN"
                : "Unlock your wallet"}
          </h2>
          {status.setupRequired && status.existingProfilesAvailable && (
            <fieldset className="wallet-source">
              <legend>Choose your wallet</legend>
              <p>
                Profiles from an earlier version exist on this computer. You can
                start fresh without their credentials. Their data will remain
                stored separately.
              </p>
              <label className="check-label">
                <input
                  type="radio"
                  name="walletSource"
                  checked={!existingProfile}
                  onChange={() => setExistingProfile(false)}
                />
                Create a new wallet
              </label>
              <label className="check-label">
                <input
                  type="radio"
                  name="walletSource"
                  checked={existingProfile}
                  onChange={() => setExistingProfile(true)}
                />
                Use an existing profile
              </label>
            </fieldset>
          )}
          {status.setupRequired && existingProfile && (
            <>
              <p>
                Enter your existing local profile credentials once to keep its
                data. Other profiles remain stored separately.
              </p>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  maxLength={320}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Existing password
                <input
                  type="password"
                  name="password"
                  maxLength={256}
                  autoComplete="current-password"
                  required
                />
              </label>
            </>
          )}
          {status.setupRequired && (
            <>
              <p>Choose how you want to open Gentum on this computer.</p>
              <label className="check-label">
                <input
                  type="radio"
                  name="protection"
                  checked={!usePIN}
                  onChange={() => setUsePIN(false)}
                />
                Use without a PIN
              </label>
              <label className="check-label">
                <input
                  type="radio"
                  name="protection"
                  checked={usePIN}
                  onChange={() => setUsePIN(true)}
                />
                Protect with a PIN
              </label>
            </>
          )}
          {recover && (
            <label>
              Recovery code
              <input
                name="recoveryCode"
                autoComplete="off"
                maxLength={100}
                required
              />
            </label>
          )}
          {(!status.setupRequired || usePIN) && (
            <div className="form-grid">
              <PINField
                name="pin"
                label={recover ? "New PIN" : "PIN (4 digits)"}
              />
              {(status.setupRequired || recover) && (
                <PINField name="confirmPin" label="Confirm PIN" />
              )}
            </div>
          )}
          {(usePIN || !status.setupRequired) && (
            <p className="muted">
              The PIN blocks casual access to the app. It does not encrypt your
              database or protect it from someone who controls this computer.
            </p>
          )}
          {recover && (
            <p>
              Your data stays in place. You will receive a new recovery code. If
              you lose both codes, there is no online recovery.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy} type="submit">
            {busy
              ? "Opening…"
              : status.setupRequired
                ? "Open local wallet"
                : recover
                  ? "Reset PIN"
                  : "Unlock"}
          </button>
          {!status.setupRequired && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRecover(!recover);
                setError("");
              }}
            >
              {recover ? "Back to PIN" : "Forgot your PIN?"}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
export function LocalAccess({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccessStatus>();
  const [recovery, showRecovery] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next = await request<AccessStatus>("/auth/status");
      if (!next.setupRequired && !next.pinEnabled && !next.unlocked) {
        await request("/auth/open", {});
        next.unlocked = true;
      }
      setStatus(next);
      setError("");
    } catch (e) {
      setStatus(undefined);
      setError(e instanceof Error ? e.message : "Unable to open local wallet");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const check = () => {
      void refresh();
    };
    const storage = (e: StorageEvent) => {
      if (e.key === "gentum:access-change") check();
    };
    window.addEventListener("gentum:unauthorized", check);
    window.addEventListener("focus", check);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("gentum:unauthorized", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", storage);
    };
  }, [refresh]);
  if (recovery)
    return (
      <main className="auth-shell">
        <RecoveryNotice
          code={recovery}
          onDone={() => {
            void refresh().then(() => showRecovery(""));
          }}
        />
      </main>
    );
  if (error)
    return (
      <main>
        <p className="error" role="alert">
          {error}
        </p>
        <button onClick={() => void refresh()}>Try again</button>
      </main>
    );
  if (!status)
    return (
      <p className="loading" role="status">
        Opening your wallet…
      </p>
    );
  if (!status.unlocked)
    return (
      <AccessScreen
        status={status}
        refresh={refresh}
        showRecovery={showRecovery}
      />
    );
  return (
    <Context.Provider
      value={{
        status,
        refresh,
        showRecovery,
        lock: async () => {
          await request("/auth/lock", {});
          setStatus({ ...status, unlocked: false });
          signalChange();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function AccessSettings() {
  const { status, refresh, showRecovery } = useLocalAccess();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [disable, setDisable] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (!disable && values.pin !== values.confirmPin)
        throw new Error("PINs do not match");
      const result = await request<{ recoveryCode?: string }>(
        disable ? "/auth/disable-pin" : "/auth/pin",
        { currentPin: values.currentPin, pin: values.pin },
      );
      form.reset();
      signalChange();
      if (result.recoveryCode) showRecovery(result.recoveryCode);
      else {
        await refresh();
        setNotice("PIN disabled. This computer opens your wallet directly.");
        setDisable(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update PIN");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Local access</h2>
      <p>
        {status.pinEnabled
          ? "Your wallet is protected by a PIN."
          : "This computer opens your wallet without a PIN."}
      </p>
      <p>
        The PIN is an app lock, not database encryption. Anyone with control of
        this computer can still access the stored data.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          {status.pinEnabled && (
            <PINField name="currentPin" label="Current PIN" />
          )}
          {!disable && (
            <>
              <PINField
                name="pin"
                label={status.pinEnabled ? "New PIN" : "PIN (4 digits)"}
              />
              <PINField name="confirmPin" label="Confirm PIN" />
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy
            ? "Saving…"
            : disable
              ? "Disable PIN"
              : status.pinEnabled
                ? "Change PIN"
                : "Enable PIN"}
        </button>
        {status.pinEnabled && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setDisable(!disable);
              setError("");
            }}
          >
            {disable ? "Keep PIN enabled" : "Use without a PIN"}
          </button>
        )}
      </form>
    </section>
  );
}
