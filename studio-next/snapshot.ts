// Reads the live PassportMap and ListingGate and writes the data the static
// frontend renders: ../frontend/map.js (a plain <script>, so the page also
// works opened straight from disk).
//
//   npx tsx snapshot.ts [passportmap address] [listinggate address]
import * as fs from "fs";
import { readClient, safeJson, EXPLORER } from "./lib";

const PM = process.argv[2] ?? "0x170E181A241F8D5909E72d17e2f9D3D027fcA747";
const GATE = process.argv[3] ?? "0x75e6846612A26a4D76BE0766b5ED7b8141c18D68";

async function main() {
  const r = readClient();
  // Studio Next's RPC allows 30 requests a minute: pace reads under it.
  const view = async (address: string, fn: string, args: unknown[] = []) => {
    await new Promise((res) => setTimeout(res, 2200));
    return JSON.parse(safeJson(await r.readContract({ address, functionName: fn, args })));
  };

  const config = await view(GATE, "get_config");
  const firms = [];
  for (const f of await view(PM, "list_firms")) {
    const history = await view(PM, "get_history", [f.firm_id, 10]);
    // The full facts of each snapshot are large and the page doesn't render them.
    const slim = history.map(({ facts, llm, ...rest }: any) => ({ ...rest, register_rows: facts?.register_rows }));
    firms.push({ ...(await view(PM, "get_firm", [f.firm_id])), history: slim });
  }
  const proof = fs.existsSync("live_proof.json") ? JSON.parse(fs.readFileSync("live_proof.json", "utf-8")) : [];
  const txs = proof.filter((p: any) => p.tx && p.step === "gate")
    .map((p: any) => ({ call: p.call, args: p.args, tx: p.tx, result: p.result, revert: p.revert ?? "" }));

  const data = {
    snapshot_at: new Date().toISOString(),
    chain: "GenLayer Studio Next (chain 61997)",
    explorer: EXPLORER,
    passport: { address: PM, rules: await view(PM, "get_rules"), state: await view(PM, "get_state") },
    gate: { address: GATE, config, listings: await view(GATE, "get_listings", [0, 50]), settlements: await view(GATE, "get_settlements", [0, 50]) },
    firms,
    txs,
  };
  fs.mkdirSync("../frontend", { recursive: true });
  fs.writeFileSync("../frontend/map.js", "// Written by studio-next/snapshot.ts - a snapshot of the live contracts.\nwindow.MAP = " + JSON.stringify(data) + ";\n");
  console.log(`wrote ../frontend/map.js: ${firms.length} firms, ${data.gate.listings.length} listings, ${data.gate.settlements.length} settlements`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
