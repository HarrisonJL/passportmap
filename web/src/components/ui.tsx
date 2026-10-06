import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  addressLink, balanceOf, connectWallet, errorText, forgetTemporaryAccount, fundAccount, short, temporaryAccount, txLink, type Signer,
} from "../lib/genlayer";
import { STATUS_COPY } from "../lib/lifecycle";
import type { TxState } from "../lib/useTransaction";

export function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "none" | "info"; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section>
      <div className="sectionhead"><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

/** Connect a wallet (MetaMask) or use a throwaway in-browser account; fund it from Studio Next's faucet. */
export function AccountPanel({ signer, onSigner }: { signer: Signer | null; onSigner: (s: Signer | null) => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async (s: Signer | null) => {
    if (!s) return setBalance(null);
    try { setBalance(await balanceOf(s.address)); } catch { setBalance(null); }
  }, []);
  useEffect(() => { void refresh(signer); }, [signer, refresh]);

  async function act(f: () => Promise<void>) {
    setBusy(true); setError("");
    try { await f(); } catch (e: any) { setError(errorText(e)); } finally { setBusy(false); }
  }

  if (!signer) {
    return (
      <div className="panel account">
        <div>
          <b>Sign in to send transactions.</b>
          <div className="sm">Reading is open to everyone. Writing needs an account on GenLayer Studio Next (a testnet).</div>
        </div>
        <div className="actions">
          <button disabled={busy} onClick={() => act(async () => onSigner(await connectWallet()))}>Connect wallet</button>
          <button className="secondary" disabled={busy} onClick={() => act(async () => onSigner(temporaryAccount()))}>
            Use a temporary account
          </button>
        </div>
        {error && <div className="err">{error}</div>}
      </div>
    );
  }
  return (
    <div className="panel account">
      <div>
        <b>{signer.kind === "wallet" ? "Wallet" : "Temporary account"}</b>{" "}
        <a className="mono" href={addressLink(signer.address)} target="_blank" rel="noreferrer">{short(signer.address)}</a>
        <div className="sm">
          Balance: {balance === null ? "…" : `${balance} GEN`}
          {signer.kind === "temporary" && " · the key lives only in this browser; testnet only, never put value in it"}
        </div>
      </div>
      <div className="actions">
        <button className="secondary" disabled={busy} onClick={() => act(async () => { await fundAccount(signer.address); await refresh(signer); })}>
          Get 100 test GEN
        </button>
        <button className="secondary" disabled={busy} onClick={() => { if (signer.kind === "temporary") forgetTemporaryAccount(); onSigner(null); }}>
          {signer.kind === "temporary" ? "Forget this account" : "Disconnect"}
        </button>
      </div>
      {error && <div className="err">{error}</div>}
    </div>
  );
}

type TxPanelProps = { state: TxState; onReset: () => void; children?: (bound: any) => ReactNode };

/**
 * The live lifecycle of the current write. The page is long and the buttons that start a write
 * are far from this panel, so it scrolls into view when a write begins; otherwise a click on a
 * card halfway down the page appears to do nothing.
 */
export function TxPanel(props: TxPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const started = props.state.stage === "submitting";
  useEffect(() => {
    if (started) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [started]);
  return <div ref={ref}><TxBody {...props} /></div>;
}

function TxBody({ state, onReset, children }: TxPanelProps) {
  if (state.stage === "idle") return null;
  const link = "hash" in state && state.hash ? (
    <a className="mono" href={txLink(state.hash)} target="_blank" rel="noreferrer">{state.hash.slice(0, 10)}…</a>
  ) : null;
  if (state.stage === "submitting") {
    return <div className="panel tx"><b>{state.label}</b><div className="sm">Preparing the transaction. A wallet will ask you to approve it; a temporary account signs on its own…</div></div>;
  }
  if (state.stage === "waiting") {
    const p = state.progress;
    const votes = p?.votes ?? [];
    return (
      <div className="panel tx">
        <div className="row"><b>{state.label}</b><span>{link}</span></div>
        <div className="status"><Pill tone="info">{p?.statusName ?? "PENDING"}</Pill>
          <span className="sm">{STATUS_COPY[p?.statusName ?? "PENDING"]}</span></div>
        {votes.length > 0 && (
          <div className="votes" aria-label="Validator votes">
            {votes.map((v, i) => <span key={i} className={`vote ${v.toLowerCase()}`} title={v}>{v === "AGREE" ? "✓" : v === "IDLE" ? "·" : "✗"}</span>)}
            <span className="sm">{votes.filter((v) => v === "AGREE").length} agree · {votes.filter((v) => v === "IDLE").length} idle</span>
          </div>
        )}
      </div>
    );
  }
  if (state.stage === "failed") {
    return (
      <div className="panel tx failed" role="alert">
        <div className="row"><b>{state.label}: not completed</b><span>{link}</span></div>
        <div>{state.error}</div>
        <div className="actions"><button className="secondary" onClick={onReset}>Dismiss</button></div>
      </div>
    );
  }
  const votes = state.progress?.votes ?? [];
  return (
    <div className="panel tx done">
      <div className="row"><b>{state.label}: accepted by consensus</b><span>{link}</span></div>
      {votes.length > 0 && <div className="sm">{votes.filter((v) => v === "AGREE").length} validators agreed; the result below is the record this transaction created.</div>}
      {children?.(state.bound)}
      <div className="actions"><button className="secondary" onClick={onReset}>Dismiss</button></div>
    </div>
  );
}
