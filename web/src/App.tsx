import { useCallback, useEffect, useState } from "react";
import { AccountPanel, Pill, Section, TxPanel } from "./components/ui";
import { addressLink, errorText, onThrottle, short, type Signer } from "./lib/genlayer";
import { duration, fmtTime } from "./lib/format";
import {
  GATE, PM, TILE, VERDICTS, VERDICT_NAME, boundFirm, boundSnapshot, cachedMap, countBefore, coverage, firmDetail,
  loadMap, normalizeLei, parseServices, registerProblem, type Firm, type MapData, type Snapshot,
} from "./lib/pm";
import { useTransaction } from "./lib/useTransaction";

const color = (v: string) => `var(--${v})`;
const latest = (f: Firm): Snapshot | null => f.history[0] ?? null;
const verdictOf = (f: Firm, s: string): string => latest(f)?.states[s]?.verdict ?? "NONE";
const authorisedCount = (f: Firm, states: string[]) => states.filter((s) => verdictOf(f, s) === "AUTHORISED").length;
const dayDiff = (iso: string) => Math.floor((Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 864e5);

function diffText(h: Snapshot): string {
  const d = h.diff ?? {};
  if (d.baseline) return "first snapshot";
  const gained: string[] = d.gained ?? [], lost: string[] = d.lost ?? [];
  const changed = Object.keys(d.changed ?? {});
  if (!gained.length && !lost.length && !changed.length) return "no change in any state";
  return [gained.length ? `gained ${gained.join(", ")}` : "", lost.length ? `lost ${lost.join(", ")}` : "",
          changed.length ? `${changed.length} other verdict change(s)` : ""].filter(Boolean).join(" · ");
}

const COVERAGE_TEXT: Record<string, string> = {
  COVERED: "Authorised for the firm's registered services in this state, by a fresh check of a recent register.",
  NO_SNAPSHOT: "The firm has never been snapshotted, so there is nothing to rely on.",
  REGISTER_DATE_UNKNOWN: "The register's own date couldn't be read, so its age can't be judged.",
  STALE_REGISTER: "ESMA's register, as last read, is older than the limit given.",
  STALE_CHECK: "The firm was last checked longer ago than the limit given.",
};
const coverageText = (reason: string) =>
  COVERAGE_TEXT[reason] ?? (reason.startsWith("VERDICT_") ? `The latest snapshot's verdict for this state is ${VERDICT_NAME[reason.slice(8)] ?? reason.slice(8)}, not Authorised.` : reason);

function SnapshotResult({ s, states }: { s: Snapshot; states: string[] }) {
  const n = states.filter((c) => s.states[c]?.verdict === "AUTHORISED").length;
  return (
    <div className="result">
      <b>{s.entity_name || s.firm_id}</b> <Pill tone="info">snapshot #{s.snapshot_id}</Pill>{" "}
      <span className="sm">{n} of {states.length} states authorised · register dated {s.register_as_of || "unknown"} · {diffText(s)}</span>
    </div>
  );
}

function Heat({ firms, states, selected, onSelect }: { firms: Firm[]; states: string[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="panel">
      <div className="legend">
        {VERDICTS.map(([v, n]) => <span key={v}><i style={{ background: color(v) }} />{n}</span>)}
        <span><i style={{ background: "var(--NONE)" }} />Not checked</span>
      </div>
      <div className="scroll">
        <table className="heat">
          <thead>
            <tr><th className="firm">Firm · services</th>{states.map((s) => <th key={s}>{s}</th>)}<th /></tr>
          </thead>
          <tbody>
            {firms.map((f) => (
              <tr key={f.firm_id}>
                <td className="firm">
                  <button aria-pressed={f.firm_id === selected} title={f.label} onClick={() => onSelect(f.firm_id)}>{f.label}</button>{" "}
                  <span className="sm">· {f.services}</span>
                </td>
                {states.map((s) => (
                  <td key={s}>
                    <span className="cell" role="img" aria-label={`${f.firm_id} ${s}: ${VERDICT_NAME[verdictOf(f, s)] ?? "not checked"}`}
                          title={`${f.firm_id} · ${s} · ${VERDICT_NAME[verdictOf(f, s)] ?? "not checked"}`} style={{ background: color(verdictOf(f, s)) }} />
                  </td>
                ))}
                <td className="num">{latest(f) ? `${authorisedCount(f, states)}/${states.length}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TileMap({ firm, states, selState, onSelect }: { firm: Firm; states: string[]; selState: string; onSelect: (s: string) => void }) {
  const at: Record<number, string> = {};
  const loose: string[] = [];
  for (const s of states) { const t = TILE[s]; if (t) at[t[1] * 9 + t[0]] = s; else loose.push(s); }
  const cell = (s: string) => (
    <button key={s} className="tile" aria-pressed={s === selState} style={{ background: color(verdictOf(firm, s)) }}
            title={`${s}: ${VERDICT_NAME[verdictOf(firm, s)] ?? "not checked"}`} onClick={() => onSelect(s)}>{s}</button>
  );
  return (
    <>
      <div className="tilegrid" role="group" aria-label={firm.label}>
        {Array.from({ length: 63 }, (_, i) => (at[i] ? cell(at[i]) : <span key={i} />))}
      </div>
      {loose.length > 0 && <div className="loose">{loose.map(cell)}</div>}
    </>
  );
}

export default function App() {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [data, setData] = useState<MapData | null>(() => cachedMap());
  const [stale, setStale] = useState(() => cachedMap() !== null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitSec, setWaitSec] = useState(0);
  useEffect(() => onThrottle(setWaitSec), []);
  const tx = useTransaction();
  const busy = tx.state.stage === "submitting" || tx.state.stage === "waiting";

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await loadMap()); setStale(false); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const [selected, setSelected] = useState("");
  const [selState, setSelState] = useState("");
  const firms = (data?.firms ?? []).slice().sort((a, b) => authorisedCount(b, data?.states ?? []) - authorisedCount(a, data?.states ?? []) || a.firm_id.localeCompare(b.firm_id));
  const firm = firms.find((f) => f.firm_id === selected) ?? firms[0] ?? null;
  const snap = firm ? latest(firm) : null;
  const states = data?.states ?? [];
  const state = snap ? (snap.states[selState] ? selState : (states.find((s) => verdictOf(firm!, s) !== "AUTHORISED") ?? states[0] ?? "")) : "";

  const [detail, setDetail] = useState<any>(null);
  useEffect(() => {
    setDetail(null);
    if (!firm) return;
    let live = true;
    firmDetail(firm.firm_id).then((d) => { if (live) setDetail(d); }).catch(() => { /* optional detail */ });
    return () => { live = false; };
  }, [firm?.firm_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function takeSnapshot(firmId: string) {
    if (!signer) return;
    const label = `Snapshot ${firmId}`;
    let before: number;
    try { before = await countBefore(); } catch (e) { return tx.fail(label, e); }
    const ok = await tx.run(signer, PM, "snapshot", [firmId], label, "that firm isn't registered.", () => boundSnapshot(before, signer, firmId));
    if (ok) { setSelected(firmId); void refresh(); }
  }

  const [firmId, setFirmId] = useState("");
  const [lei, setLei] = useState("");
  const [services, setServices] = useState("");
  const [website, setWebsite] = useState("");
  const [label, setLabel] = useState("");
  const problem = registerProblem(firmId.trim(), lei, services, label, data?.firms ?? []);
  async function register() {
    if (!signer || problem) return;
    const id = firmId.trim();
    const ok = await tx.run(signer, PM, "register_firm", [id, normalizeLei(lei), parseServices(services), website.trim(), label.trim()],
      `Register ${id}`, "that firm id is already registered, or an input is invalid.", () => boundFirm(signer, id));
    if (ok) { setFirmId(""); setLei(""); setServices(""); setWebsite(""); setLabel(""); setSelected(id); void refresh(); }
  }

  // The coverage checker: ask the contract itself, with limits the caller chooses.
  const cfg = data?.gate.config;
  const [covFirm, setCovFirm] = useState("");
  const [covState, setCovState] = useState("");
  const [covHours, setCovHours] = useState("");
  const [covDays, setCovDays] = useState("");
  const [cov, setCov] = useState<any>(null);
  const [covBusy, setCovBusy] = useState(false);
  const [covError, setCovError] = useState("");
  const cFirm = covFirm || firm?.firm_id || "";
  const cState = covState || state || states[0] || "";
  const cHours = covHours || (cfg ? String(Number(cfg.max_age_seconds) / 3600) : "24");
  const cDays = covDays || (cfg ? String(cfg.max_register_age_days) : "14");
  async function ask() {
    setCov(null); setCovError(""); setCovBusy(true);
    try { setCov(await coverage(cFirm, cState, Math.round(Number(cHours) * 3600), Math.round(Number(cDays)))); }
    catch (e) { setCovError(errorText(e)); } finally { setCovBusy(false); }
  }
  const covInputsOk = cFirm !== "" && cState !== "" && Number(cHours) > 0 && Number(cDays) > 0 && Number.isFinite(Number(cHours)) && Number.isFinite(Number(cDays));

  const newest = firms.map(latest).filter((s): s is Snapshot => !!s).map((s) => s.register_as_of).filter(Boolean).sort().pop();
  const age = snap?.register_as_of ? dayDiff(snap.register_as_of) : null;
  const maxRegDays = cfg ? Number(cfg.max_register_age_days) : null;
  const maxAgeSec = cfg ? Number(cfg.max_age_seconds) : null;
  const checkAgeMs = snap ? Date.now() - new Date(snap.checked_at).getTime() : null;

  return (
    <main>
      <div className="top">
        <div>
          <h1>PassportMap</h1>
          <p className="sub">Where in the EU/EEA is a crypto-asset firm authorised under MiCA for the services it needs? One read of ESMA's register, a verdict for each of {states.length || 30} states, checked by a committee of validators.</p>
        </div>
        <div className="meta">GenLayer Studio Next (chain 61997)<br />
          PassportMap <a className="mono" href={addressLink(PM)} target="_blank" rel="noreferrer">{short(PM)}</a> · ListingGate{" "}
          <a className="mono" href={addressLink(GATE)} target="_blank" rel="noreferrer">{short(GATE)}</a><br />
          {data
            ? stale
              ? `Showing the last read, from ${data.loadedAt.toLocaleString()}${loading ? " · reading the chain now…" : ""}`
              : `Read live from the chain at ${data.loadedAt.toLocaleTimeString()}`
            : loading ? "Reading the chain…" : ""}{" "}
          <button className="link" onClick={() => void refresh()} disabled={loading}>Refresh</button>
          {loading && waitSec > 0 && <><br />Pacing reads to the public RPC's 30-a-minute limit (about {waitSec}s)…</>}</div>
      </div>

      <AccountPanel signer={signer} onSigner={setSigner} />
      <TxPanel state={tx.state} onReset={tx.reset}>
        {(bound) => bound?.snapshot_id !== undefined
          ? <SnapshotResult s={bound as Snapshot} states={states} />
          : <div className="result"><b>{bound?.firm_id}</b> registered by this account for services {String(bound?.services ?? "").split("").join(", ")}. Take a snapshot to map it.</div>}
      </TxPanel>

      {data && (
        <div className="stats">
          <div className="stat"><b>{data.state.firm_count}</b><span>firms registered</span></div>
          <div className="stat"><b>{data.state.snapshot_count}</b><span>snapshots on-chain</span></div>
          <div className="stat"><b>{newest ?? "—"}</b><span>newest register date read</span></div>
          <div className="stat"><b>{data.gate.config.listing_count}</b><span>listings the gate allowed</span></div>
          <div className="stat"><b>{data.gate.config.settlement_count}</b><span>settlements the gate allowed</span></div>
        </div>
      )}

      <Section title="How a map is made">
        <div className="rules">
          <div><b>1 · One read</b><span>ESMA's register, its warning list and GLEIF are read once, by every validator. A deterministic reader and an LLM must both say a service is held.</span></div>
          <div><b>2 · A verdict per state</b><span>Each state's verdict is what LicenceCheck gives for that firm, those services and that state, computed in the contract from the agreed facts, never taken from the leader.</span></div>
          <div><b>3 · The register's own date</b><span>Every snapshot records ESMA's newest "last update" and diffs against the firm's previous snapshot: states gained, lost, or changed.</span></div>
          <div><b>4 · The gate</b><span>A listing needs coverage in that state, a fresh check and a recent register. Ask the contract itself below.</span></div>
        </div>
      </Section>

      <Section title={`Coverage heat map · all firms × all states`} aside={<span className="sm">live from PassportMap</span>}>
        {error && <div className="err">Couldn't read the chain: {error}</div>}
        {!data && !error && <p className="sub">Reading the chain…</p>}
        {data && firms.length > 0 && <Heat firms={firms} states={states} selected={firm?.firm_id ?? ""} onSelect={(id) => { setSelected(id); setSelState(""); }} />}
      </Section>

      {firm && (
        <Section title="One firm's map">
          <div className="panel two">
            <div>
              <div className="firmhead">
                <div className="name">{snap ? snap.entity_name || firm.label : firm.label}</div>
                <div className="sm">
                  {firm.label} · services {firm.services.split("").map((l) => `${l}${data?.services[l] ? ` (${data.services[l].split(" ").slice(0, 4).join(" ")}…)` : ""}`).join(", ")} · LEI <span className="mono">{firm.lei}</span>
                  {detail?.website && ` · site ${detail.website}`}
                  {detail?.registrant && <> · registered by <a className="mono" href={addressLink(detail.registrant)} target="_blank" rel="noreferrer">{short(detail.registrant)}</a></>}
                </div>
                <div className="sm" style={{ marginTop: 4 }}>
                  {snap
                    ? <>{authorisedCount(firm, states)} of {states.length} states authorised · register dated <b>{snap.register_as_of || "unknown"}</b>
                        {age !== null && maxRegDays !== null && <> ({age} day{age === 1 ? "" : "s"} old; the gate refuses a register older than {maxRegDays} days: <b>{age > maxRegDays ? "would refuse now" : "would accept"}</b>)</>}
                        {checkAgeMs !== null && maxAgeSec !== null && <> · checked {duration(checkAgeMs)} ago; the gate needs a check within {duration(maxAgeSec * 1000)}: <b>{checkAgeMs / 1000 > maxAgeSec ? "would refuse now" : "would accept"}</b></>}</>
                    : "Registered, never snapshotted: the gate refuses it (NO_SNAPSHOT)."}
                </div>
              </div>
              {snap && <div style={{ marginTop: 14 }}><TileMap firm={firm} states={states} selState={state} onSelect={setSelState} /></div>}
              {snap && state && (
                <div className="detail">
                  <b>{state}</b> <span className="pill" style={{ background: color(verdictOf(firm, state)), color: "var(--tileink)" }}>{VERDICT_NAME[verdictOf(firm, state)]}</span>
                  <div className="why">{snap.states[state].reasons.length ? `Why: ${snap.states[state].reasons.join(", ")}` : "Every requested service is covered here by both readers; identity current; no warning."}</div>
                </div>
              )}
              <div className="actions" style={{ marginTop: 14 }}>
                <button disabled={!signer || busy} onClick={() => void takeSnapshot(firm.firm_id)}
                        title={signer ? "" : "Sign in above to send a transaction"}>Take a fresh snapshot</button>
                <span className="sm">One transaction: validators read ESMA's register and GLEIF; usually under a minute or two.</span>
              </div>
            </div>
            <div>
              <div className="sm">Snapshot history</div>
              {firm.history.length === 0 && <p className="sub">No snapshots yet.</p>}
              <div className="chain">
                {firm.history.map((h) => (
                  <div key={h.snapshot_id}>
                    <b>#{h.snapshot_id}</b> <span className="when">{fmtTime(h.checked_at)} · register {h.register_as_of || "date unknown"}</span><br />
                    {diffText(h)}{h.diff?.baseline ? "" : h.diff?.register_entries_changed ? " · the firm's register entries changed" : " · the firm's register entries identical"}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="Ask the contract: is this firm covered?" aside={<span className="sm">a read, no transaction</span>}>
        <div className="panel form">
          <div className="sm">This is the call a downstream contract makes (<span className="mono">get_coverage</span>): the first reason that applies is returned. The limits below default to ListingGate's.</div>
          <div className="formrow">
            <label>Firm<select value={cFirm} onChange={(e) => setCovFirm(e.target.value)}>{firms.map((f) => <option key={f.firm_id} value={f.firm_id}>{f.firm_id}</option>)}</select></label>
            <label>State<select value={cState} onChange={(e) => setCovState(e.target.value)}>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>Max check age (hours)<input inputMode="decimal" value={cHours} onChange={(e) => setCovHours(e.target.value)} /></label>
            <label>Max register age (days)<input inputMode="numeric" value={cDays} onChange={(e) => setCovDays(e.target.value)} /></label>
          </div>
          <div className="actions">
            <button disabled={covBusy || !covInputsOk} onClick={() => void ask()}>{covBusy ? "Asking…" : "Ask the contract"}</button>
          </div>
          {covError && <div className="err">{covError}</div>}
          {cov && (
            <div className="result">
              <Pill tone={cov.covered ? "ok" : "bad"}>{cov.covered ? "COVERED" : "NOT COVERED"}</Pill> <b>{cov.firm_id}</b> in <b>{cov.state}</b>: <span className="mono">{cov.reason}</span>
              <div className="sm">{coverageText(cov.reason)}{cov.checked_at ? ` Snapshot #${cov.snapshot_id}, checked ${fmtTime(cov.checked_at)}, register dated ${cov.register_as_of || "unknown"} (${cov.register_age_days} days old).` : ""}</div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Register a firm">
        <div className="panel form">
          <div className="formrow">
            <label>Firm id<input value={firmId} onChange={(e) => setFirmId(e.target.value)} placeholder="my-exchange" maxLength={32} /></label>
            <label>LEI (20 characters)<input value={lei} onChange={(e) => setLei(e.target.value)} placeholder="5299005I4LYIFW7GKB54" /></label>
            <label>Services (MiCA letters a-j)<input value={services} onChange={(e) => setServices(e.target.value)} placeholder="a,c" /></label>
          </div>
          <div className="formrow">
            <label>Website (optional)<input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.eu" /></label>
            <label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Example Exchange: custody" maxLength={100} /></label>
          </div>
          <div className="actions">
            <button disabled={!signer || busy || problem !== ""} onClick={() => void register()}>Register</button>
            {problem && (firmId || lei || services || label) && <span className="sm">{problem}</span>}
          </div>
          <div className="sm">Registration is permissionless and immutable (the LEI, the services and the website can never be changed under a consumer). Services: {Object.entries(data?.services ?? {}).map(([l, t]) => `${l} ${t.replace(/^providing /, "").replace(/ on behalf of clients/, "")}`).join("; ")}.</div>
        </div>
      </Section>

      <Section title="ListingGate ledger" aside={<span className="sm">owner-only writes, so read-only here</span>}>
        {data && (
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Listing</th><th>State</th><th>Snapshot</th><th>Register</th><th>Settled</th></tr></thead>
              <tbody>
                {data.gate.listings.map((l: any) => (
                  <tr key={`${l.firm_id}|${l.asset}|${l.state}`}>
                    <td>{l.asset} via <span className="mono">{l.firm_id}</span></td><td>{l.state}</td><td className="num">#{l.snapshot_id}</td>
                    <td className="num">{l.register_as_of}</td><td>{Number(l.settled).toLocaleString()}</td>
                  </tr>
                ))}
                {data.gate.listings.length === 0 && <tr><td colSpan={5}>No listings yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="sm">The gate lists an asset only where PassportMap says the firm is covered right now, and re-checks at the moment of every settlement. Listing and settling are owner-only by design (the gate demonstrates a consumer); every refused call, with PassportMap's reason, is in the repository's CONTRACT.md.</p>
      </Section>

      <footer>
        <p>A map says what ESMA's interim register said when it was read, and that a committee of validators agreed. It is not legal advice, and does not show whether a firm is actually trading in a state. Source, tests and every transaction: <a href="https://github.com/HarrisonJL/passportmap" target="_blank" rel="noreferrer">github.com/HarrisonJL/passportmap</a>.</p>
      </footer>
    </main>
  );
}
