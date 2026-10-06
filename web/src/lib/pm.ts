import { view, type Signer } from "./genlayer";

export const PM = "0x170E181A241F8D5909E72d17e2f9D3D027fcA747";
export const GATE = "0x75e6846612A26a4D76BE0766b5ED7b8141c18D68";

export type Verdict =
  | "AUTHORISED" | "AUTHORISED_RESTRICTED" | "UNVERIFIED" | "NOT_AUTHORISED" | "NOT_LISTED" | "WITHDRAWN" | "WARNING_LISTED";

export const VERDICTS: Array<[Verdict, string]> = [
  ["AUTHORISED", "Authorised"], ["AUTHORISED_RESTRICTED", "Authorised, restricted"], ["UNVERIFIED", "Unverified"],
  ["NOT_AUTHORISED", "Not authorised here"], ["NOT_LISTED", "Not listed"], ["WITHDRAWN", "Withdrawn"], ["WARNING_LISTED", "Warning-listed"],
];
export const VERDICT_NAME: Record<string, string> = Object.fromEntries(VERDICTS);

// A tile map of Europe: [column, row] per state. Layout only; the list of states
// itself is read from the contract (get_rules), and a state without a tile here
// still renders, in a row under the map.
export const TILE: Record<string, [number, number]> = {
  IS: [0, 0], NO: [3, 0], SE: [4, 0], FI: [5, 0], EE: [6, 0], IE: [1, 1], DK: [3, 1], LV: [6, 1], NL: [2, 2], DE: [3, 2], PL: [4, 2], LT: [5, 2],
  BE: [2, 3], LU: [3, 3], CZ: [4, 3], SK: [5, 3], FR: [2, 4], LI: [3, 4], AT: [4, 4], HU: [5, 4], RO: [6, 4], PT: [0, 5], ES: [1, 5], IT: [3, 5],
  SI: [4, 5], HR: [5, 5], BG: [6, 5], MT: [3, 6], GR: [6, 6], CY: [8, 6],
};

export type StateVerdict = { verdict: Verdict; reasons: string[] };
export type Snapshot = {
  snapshot_id: number; firm_id: string; states: Record<string, StateVerdict>; entity_name: string; restriction_evidence: string;
  register_as_of: string; diff: any; submitted_by: string; checked_at: string; previous_id: number | null; register_rows?: number;
};
export type Firm = { firm_id: string; label: string; lei: string; services: string; snapshot_count: number; history: Snapshot[] };
export type MapData = {
  state: { firm_count: number; snapshot_count: number };
  states: string[];
  services: Record<string, string>;
  firms: Firm[];
  gate: { config: any; listings: any[]; settlements: any[] };
  loadedAt: Date;
};

/** A snapshot's facts and LLM readings are large and the page does not render them. */
function slim(s: any): Snapshot {
  const { facts, llm, ...rest } = s;
  return { ...rest, register_rows: facts?.register_rows };
}

// --- Validation, mirroring the contract so a refused call is not paid for ----------

export function normalizeLei(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}
/** ISO 17442 / ISO 7064 MOD 97-10, exactly as the contract checks it. */
export function leiChecksumOk(lei: string): boolean {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) return false;
  const digits = [...lei].map((ch) => parseInt(ch, 36).toString()).join("");
  return BigInt(digits) % 97n === 1n;
}
export const isFirmId = (s: string) => /^[A-Za-z0-9_-]{1,32}$/.test(s);
export const parseServices = (raw: string): string => {
  if (!/^[A-Ja-j,\s]+$/.test(raw)) return "";
  return [...new Set(raw.toLowerCase().replace(/[^a-j]/g, ""))].sort().join("");
};

export function registerProblem(firmId: string, lei: string, services: string, label: string, existing: Firm[]): string {
  if (!isFirmId(firmId)) return "Firm id: 1-32 characters of A-Z, a-z, 0-9, _ or -.";
  if (existing.some((f) => f.firm_id === firmId)) return "That firm id is already registered.";
  if (!leiChecksumOk(normalizeLei(lei))) return "That is not a valid 20-character LEI (the checksum fails).";
  if (!parseServices(services)) return "Services: MiCA service letters a-j, for example a,c.";
  if (label.length < 1 || label.length > 100) return "Label: 1-100 characters.";
  return "";
}

// --- Reading ------------------------------------------------------------------------

const CACHE_KEY = `passportmap-snapshot-${PM.toLowerCase()}`;
export function cachedMap(): MapData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { ...d, loadedAt: new Date(d.loadedAt) };
  } catch { return null; }
}
function cacheMap(d: MapData): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* optional */ }
}

let inflight: Promise<MapData> | null = null;
/** One live read at a time: overlapping callers share it. */
export function loadMap(): Promise<MapData> {
  inflight ??= readMap().then((d) => { cacheMap(d); return d; }).finally(() => { inflight = null; });
  return inflight;
}

const PAGE = 50;
const MAX_PAGES = 4;

async function readPass(): Promise<MapData> {
  const [state, rules, services, firmRows, config, listings, settlements] = await Promise.all([
    view(PM, "get_state"), view(PM, "get_rules"), view(PM, "service_catalogue"), view(PM, "list_firms"),
    view(GATE, "get_config"), view(GATE, "get_listings", [0, PAGE]), view(GATE, "get_settlements", [0, PAGE]),
  ]);
  const firms: Firm[] = firmRows.map((f: any) => ({ ...f, history: [] as Snapshot[] }));
  const byId = new Map<string, Firm>(firms.map((f) => [f.firm_id, f]));
  // Snapshots come newest first across all firms; page until every firm that has
  // one has its latest two (or the pages run out).
  const done = () => firms.every((f) => f.history.length >= Math.min(2, f.snapshot_count));
  for (let page = 0; page < MAX_PAGES && !done(); page++) {
    const rows: any[] = await view(PM, "get_snapshots", [page * PAGE, PAGE]);
    for (const s of rows) byId.get(s.firm_id)?.history.push(slim(s));
    if (rows.length < PAGE) break;
  }
  return { state, states: rules.states, services, firms, gate: { config, listings, settlements }, loadedAt: new Date() };
}

const moved = (a: MapData["state"], b: MapData["state"]) => a.firm_count !== b.firm_count || a.snapshot_count !== b.snapshot_count;

/**
 * Reads are paced, so a transaction can land halfway through a load. The map's own
 * counters bracket the pass; if they moved, read again, so what is shown is one
 * consistent snapshot rather than a mix of two moments.
 */
async function readMap(): Promise<MapData> {
  for (let pass = 1; ; pass++) {
    const data = await readPass();
    const after = await view(PM, "get_state");
    if (!moved(data.state, after) || pass >= 3) return { ...data, state: after };
  }
}

/** One firm's registration record (the registrant and website are not in the list view). */
export const firmDetail = (firmId: string) => view(PM, "get_firm", [firmId]);

export async function coverage(firmId: string, state: string, maxAgeSeconds: number, maxRegisterAgeDays: number) {
  return view(PM, "get_coverage", [firmId, state, maxAgeSeconds, maxRegisterAgeDays]);
}

// --- Bind a transaction to the record IT created ----------------------------------------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The number of snapshots before the call: the new one is at or past it. */
export const countBefore = async (): Promise<number> => (await view(PM, "get_state")).snapshot_count;

export async function boundSnapshot(before: number, signer: Signer, firmId: string): Promise<Snapshot> {
  const recent: any[] = await view(PM, "get_history", [firmId, 5]);
  const hit = recent.find((s) => s.snapshot_id >= before && same(s.submitted_by, signer.address));
  if (!hit) throw new Error(`no new snapshot of ${firmId} from this account`);
  return slim(hit);
}

export async function boundFirm(signer: Signer, firmId: string): Promise<any> {
  const f = await view(PM, "get_firm", [firmId]);
  if (!same(f.registrant, signer.address)) throw new Error(`${firmId} is registered, but not by this account`);
  return f;
}
