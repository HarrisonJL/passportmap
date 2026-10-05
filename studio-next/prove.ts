// Reproducible live proof for PassportMap + ListingGate. Every step's tx hash,
// result and the contract's recorded output are appended to live_proof.json -
// the source for CONTRACT.md's tables.
//
//   npx tsx prove.ts <passportmap> <listinggate> <step>
//   steps: register | snapshot | resnap | gate | read
import * as fs from "fs";
import { client, readClient, write, safeJson } from "./lib";

// [firm_id, LEI, services, website, label, what it shows]
const FIRMS: [string, string, string, string, string][] = [
  ["bybit-custody", "5299005V5GBSN2A4C303", "a,c", "https://www.bybit.eu", "Bybit EU: custody and fiat exchange"],
  ["okx-trading", "54930069NLWEIGLHXU42", "b", "", "OKX Europe: trading platform (home state Malta missing from its own list; Greece written EL)"],
  ["hpb-custody", "529900D5G4V6THXC5P79", "a", "", "HPB: custody, limited solely to one fund"],
  ["amina-custody", "5299005I4LYIFW7GKB54", "a", "", "AMINA: custody (Slovenia written SL)"],
  ["etoro-custody", "213800GIFQMSV7HROS23", "a", "", "eToro: custody (Greece written EL)"],
  ["decubate-placing", "894500ZVOL3A9LO8LN34", "f", "", "Decubate: placing (authorisation withdrawn)"],
  ["bitpanda-old", "5493007WZ7IFULIL8G21", "a", "", "Bitpanda under the LEI ESMA lists (retired at GLEIF)"],
  ["tesco", "2138002P5RNKC5W2JZ46", "a", "", "Tesco PLC: a real LEI that is not a CASP"],
  ["bybit-lookalike", "5299005V5GBSN2A4C303", "a", "https://fakebybit.eu", "Bybit's LEI quoted by a look-alike site"],
  ["bybit-unchecked", "5299005V5GBSN2A4C303", "b", "", "Registered, never snapshotted"],
];
const SNAPSHOT = FIRMS.map((f) => f[0]).filter((id) => id !== "bybit-unchecked");

function log(entry: Record<string, unknown>) {
  const all = fs.existsSync("live_proof.json") ? JSON.parse(fs.readFileSync("live_proof.json", "utf-8")) : [];
  all.push(entry);
  fs.writeFileSync("live_proof.json", JSON.stringify(all, null, 1));
}

function revertMessage(tx: any): string {
  const found: string[] = [];
  const walk = (o: any) => {
    if (typeof o === "string") {
      const m = o.match(/(listing [^\n"]*refused[^\n"]*|settlement of [^\n"]*blocked[^\n"]*|asset not listed|only the owner[^\n"]*)/);
      if (m) found.push(m[0]);
    } else if (o && typeof o === "object") Object.values(o).forEach(walk);
  };
  walk(tx);
  return found[0] ?? "";
}

async function main() {
  const [pm, gate, step, only] = process.argv.slice(2);
  const c = client();
  const r = readClient();
  const votes = (tx: any) => tx.last_round?.validator_votes_name ?? [];
  // Studio Next's RPC allows 30 requests a minute: pace reads under it.
  const view = async (address: string, fn: string, args: unknown[] = []) => {
    await new Promise((res) => setTimeout(res, 2200));
    return JSON.parse(safeJson(await r.readContract({ address, functionName: fn, args })));
  };
  const count = (map: Record<string, string>) => {
    const out: Record<string, number> = {};
    for (const v of Object.values(map)) out[v] = (out[v] ?? 0) + 1;
    return out;
  };

  if (step === "register") {
    const have = new Set((await view(pm, "list_firms")).map((f: any) => f.firm_id));
    for (const [id, lei, services, website, label] of FIRMS) {
      if (have.has(id)) continue; // idempotent after a transient RPC error
      const { hash, tx } = await write(c, pm, "register_firm", [id, lei, services, website, label]);
      log({ step: "register", firm_id: id, tx: hash, result: tx.txExecutionResultName, votes: votes(tx) });
    }
  } else if (step === "snapshot" || step === "resnap") {
    const ids = only ? [only] : step === "resnap" ? ["bybit-custody", "hpb-custody"] : SNAPSHOT;
    for (const id of ids) {
      const { hash, tx } = await write(c, pm, "snapshot", [id]);
      const s = await view(pm, "latest_snapshot", [id]);
      const map = await view(pm, "get_map", [id]);
      log({ step, firm_id: id, tx: hash, result: tx.txExecutionResultName, votes: votes(tx), snapshot: s });
      console.log(`  ${id}: ${safeJson(count(map))} register ${s.register_as_of} previous=${s.previous_id} diff=${safeJson(s.diff)}`);
    }
  } else if (step === "gate") {
    const calls: [string, unknown[]][] = [
      ["list_asset", ["bybit-custody", "ETH", "DE"]],   // covered: allowed
      ["list_asset", ["etoro-custody", "SOL", "EL"]],   // Greece, written EL: allowed
      ["list_asset", ["bybit-custody", "ETH", "MT"]],   // Bybit never passported to Malta: refused
      ["list_asset", ["hpb-custody", "ETH", "HR"]],     // authorised but restricted: refused
      ["list_asset", ["hpb-custody", "ETH", "DE"]],     // not passported to Germany: refused
      ["list_asset", ["amina-custody", "BTC", "SI"]],   // Slovenia written SL: unverified, refused
      ["list_asset", ["decubate-placing", "ETH", "NL"]], // withdrawn: refused
      ["list_asset", ["bybit-unchecked", "ETH", "DE"]], // never snapshotted: refused
      ["settle", ["bybit-custody", "ETH", "DE", 2500]], // listed and covered now: allowed
      ["settle", ["bybit-custody", "ETH", "FR", 100]],  // never listed in France: refused
    ];
    // Resumable: skips calls already in the log, and stops cleanly before a
    // foreground command's time limit would cut it off mid-transaction.
    const done = new Set(JSON.parse(fs.existsSync("live_proof.json") ? fs.readFileSync("live_proof.json", "utf-8") : "[]")
      .filter((e: any) => e.step === "gate").map((e: any) => e.call + JSON.stringify(e.args)));
    const started = Date.now();
    for (const [fn, args] of calls) {
      if (done.has(fn + JSON.stringify(args))) continue;
      if (Date.now() - started > 330_000) { console.log("  (time budget reached - run this step again to continue)"); break; }
      const { hash, tx } = await write(c, gate, fn, args);
      const message = tx.txExecutionResultName === "FINISHED_WITH_ERROR" ? revertMessage(tx) : "";
      log({ step: "gate", call: fn, args, tx: hash, result: tx.txExecutionResultName, votes: votes(tx), revert: message });
      console.log(`  ${fn}(${args.join(", ")}) -> ${tx.txExecutionResultName} ${message}`);
    }
  } else if (step === "read") {
    const read = new Set(JSON.parse(fs.existsSync("live_proof.json") ? fs.readFileSync("live_proof.json", "utf-8") : "[]")
      .filter((e: any) => e.step === "read").map((e: any) => e.firm_id));
    for (const [id] of FIRMS) {
      if (read.has(id)) continue; // resumable
      const map = await view(pm, "get_map", [id]);
      const cov = await view(pm, "get_coverage", [id, "DE", 86400, 14]);
      const tight = await view(pm, "get_coverage", [id, "DE", 86400, 1]);
      log({ step: "read", firm_id: id, map_counts: count(map), coverage_DE: cov, coverage_DE_register_1_day: tight });
      console.log(`  ${id}: ${safeJson(count(map))} | DE ${cov.reason} (register age ${cov.register_age_days}d) | with a 1-day register limit: ${tight.reason}`);
    }
    console.log("  listings:", safeJson((await view(gate, "get_listings", [0, 20])).map((l: any) => `${l.firm_id}/${l.asset}/${l.state} settled ${l.settled}`)));
    console.log("  config:", safeJson(await view(gate, "get_config")));
    const h = await view(pm, "get_history", ["bybit-custody", 10]);
    if (!JSON.parse(fs.readFileSync("live_proof.json", "utf-8")).some((e: any) => e.step === "history")) log({ step: "history", firm_id: "bybit-custody", ids: h.map((x: any) => x.snapshot_id), previous: h.map((x: any) => x.previous_id) });
    console.log(`  history bybit-custody: ids ${safeJson(h.map((x: any) => x.snapshot_id))}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
