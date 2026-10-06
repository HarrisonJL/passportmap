import { createClient, createAccount, chains } from "genlayer-js";

// This app targets GenLayer Studio Next (chain 61997), where the contracts in
// this repo are deployed. Writes need genlayer-js v2's explicit fees (see
// estimateAndAttachFees); reads need none.
export const chain: any = (chains as any).studioDevnet;
export const RPC_URL: string = chain.rpcUrls.default.http[0];
export const EXPLORER = "https://explorer-studio-dev.genlayer.com";
export const CHAIN_ID_HEX = `0x${chain.id.toString(16)}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** viem wraps the useful text (a 429's "Rate limit exceeded", a revert's reason) in `details` and `cause`; flatten it. */
export function errorText(e: any): string {
  const parts: string[] = [];
  for (let x = e, i = 0; x && i < 6; x = x.cause, i++) {
    for (const v of [x.details, x.shortMessage, x.message, x.code === -32029 ? "Rate limit exceeded" : ""]) {
      if (typeof v === "string" && v && !parts.some((p) => p.includes(v) || v.includes(p))) parts.push(v);
    }
  }
  const specific = parts.filter((p) => !/^An unknown RPC error occurred\.?$/.test(p));
  return String((specific.length ? specific : parts)[0] ? (specific.length ? specific : parts).join(" — ") : e);
}

// --- Reads --------------------------------------------------------------------

// The Studio Next RPC allows 30 requests a minute per client. Every read goes
// through one pacing queue that stays under it, and the window is kept in
// localStorage so a reload or a second tab shares it instead of starting from
// zero. A page that needs a few dozen reads slows down instead of failing.
const WINDOW_MS = 60_000;
const MAX_CALLS = 24;
const STAMP_KEY = "genlayer-read-stamps";
let memoryStamps: number[] = [];
const loadStamps = (): number[] => {
  try { return JSON.parse(localStorage.getItem(STAMP_KEY) ?? "[]").filter((n: unknown) => typeof n === "number"); }
  catch { return []; }
};
const saveStamps = (s: number[]) => { memoryStamps = s; try { localStorage.setItem(STAMP_KEY, JSON.stringify(s)); } catch { /* memory only */ } };
const liveStamps = (now: number) => {
  const live = (xs: number[]) => xs.filter((t) => t <= now && now - t < WINDOW_MS).sort((a, b) => a - b);
  const stored = live(loadStamps()), kept = live(memoryStamps);
  return stored.length >= kept.length ? stored : kept; // storage is shared across tabs; memory covers it being unavailable
};

type ThrottleListener = (secondsToWait: number) => void;
const throttleListeners = new Set<ThrottleListener>();
/** Called with the seconds a read is about to wait for the rate-limit window (0 when it proceeds). */
export function onThrottle(cb: ThrottleListener): () => void {
  throttleListeners.add(cb);
  return () => { throttleListeners.delete(cb); };
}
const announce = (sec: number) => throttleListeners.forEach((cb) => cb(sec));

async function slot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    const s = liveStamps(now);
    if (s.length < MAX_CALLS) {
      saveStamps([...s, now]);
      announce(0);
      return;
    }
    const wait = WINDOW_MS - (now - s[0]) + 50;
    announce(Math.ceil(wait / 1000));
    await sleep(wait);
  }
}
/** The server said 429: whatever we thought we had left, the window is full. */
const markWindowFull = () => { const now = Date.now(); saveStamps(Array.from({ length: MAX_CALLS }, () => now)); };

// The server also runs only 8 contract executions at once, shared by everyone,
// so reads go two at a time and a "busy" answer is retried rather than shown.
const MAX_IN_FLIGHT = 2;
let inFlight = 0;
const waiting: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) { inFlight++; return; }
  await new Promise<void>((resolve) => waiting.push(resolve));
}
function release(): void {
  const next = waiting.shift();
  if (next) next(); else inFlight--;
}
const TRANSIENT = /rate limit|fetch failed|timeout|busy|execution slots|retry later|not supported|network|failed to fetch/i;

let _read: any;
const readClient = () => (_read ??= createClient({ chain }));

/** genlayer-js returns dicts as Map and ints as bigint: make it plain JSON-ish. */
export function plain(v: any): any {
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), plain(x)]));
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "bigint") return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

async function attemptRead(address: string, functionName: string, args: unknown[]): Promise<any> {
  await acquire();
  try {
    await slot();
    return plain(await readClient().readContract({ address: address as `0x${string}`, functionName, args } as any));
  } finally {
    release();
  }
}

export async function view(address: string, functionName: string, args: unknown[] = []): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptRead(address, functionName, args);
    } catch (e: any) {
      const msg = errorText(e);
      if (attempt >= 6 || !TRANSIENT.test(msg)) throw e;
      if (/rate limit|429/i.test(msg)) markWindowFull(); // the next slot() waits the window out
      else await sleep(2500 * attempt);
    }
  }
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  await slot();
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "RPC error");
  return j.result;
}

export async function balanceOf(address: string): Promise<number> {
  const hex = (await rpc("eth_getBalance", [address, "latest"])) as string;
  return Number(BigInt(hex) / 10n ** 15n) / 1000; // GEN, three decimals
}

/** Studio Next's faucet: 100 test GEN, no sign-up. Testnet only. */
export async function fundAccount(address: string): Promise<void> {
  await rpc("sim_fundAccount", [address, 100000000000000000000]);
}

// --- Accounts -----------------------------------------------------------------

export type Signer = { kind: "wallet" | "temporary"; address: `0x${string}`; account?: any };

type EthereumProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

async function ensureCorrectChain(p: EthereumProvider): Promise<void> {
  const current = (await p.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === CHAIN_ID_HEX.toLowerCase()) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (err: any) {
    // 4902: the wallet has never heard of this chain - add it (which also switches).
    if (err?.code !== 4902) throw err;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX, chainName: chain.name, rpcUrls: chain.rpcUrls.default.http,
                 nativeCurrency: chain.nativeCurrency, blockExplorerUrls: [EXPLORER] }],
    });
  }
}

export async function connectWallet(): Promise<Signer> {
  const p = window.ethereum;
  if (!p) throw new Error("No browser wallet found. Install MetaMask, or use a temporary account below.");
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("The wallet returned no account.");
  await ensureCorrectChain(p);
  return { kind: "wallet", address: accounts[0] as `0x${string}` };
}

const KEY = "genlayer-temporary-account";
function randomKey(): `0x${string}` {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
/** A throwaway account whose key lives only in this browser (localStorage). Testnet only: never put value in it. */
export function temporaryAccount(): Signer {
  let key = "";
  try { key = localStorage.getItem(KEY) ?? ""; } catch { /* storage unavailable: a fresh key per load */ }
  if (!/^0x[0-9a-f]{64}$/.test(key)) {
    key = randomKey();
    try { localStorage.setItem(KEY, key); } catch { /* ignore */ }
  }
  const account = createAccount(key as `0x${string}`);
  return { kind: "temporary", address: account.address as `0x${string}`, account };
}
export function forgetTemporaryAccount(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function writeClient(signer: Signer): any {
  return signer.kind === "wallet"
    ? createClient({ chain, account: signer.address, provider: window.ethereum } as any)
    : createClient({ chain, account: signer.account } as any);
}

/** Studio Next rejects writes unless fees are attached explicitly. */
export async function estimateAndAttachFees(client: any) {
  const f = await client.estimateTransactionFees({});
  return { distribution: f.distribution, feeValue: f.feeValue };
}

export const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
export const addressLink = (a: string) => `${EXPLORER}/address/${a}`;
export const txLink = (h: string) => `${EXPLORER}/tx/${h}`;
