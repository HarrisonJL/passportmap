import { estimateAndAttachFees, writeClient, type Signer } from "./genlayer";

// genlayer-js's own status numbering (not exported from its entry point;
// confirmed against live Studio Next transactions).
export const STATUS_NAMES: Record<string, string> = {
  "0": "UNINITIALIZED", "1": "PENDING", "2": "PROPOSING", "3": "COMMITTING", "4": "REVEALING", "5": "ACCEPTED",
  "6": "UNDETERMINED", "7": "FINALIZED", "8": "CANCELED", "9": "APPEAL_REVEALING", "10": "APPEAL_COMMITTING",
  "11": "READY_TO_FINALIZE", "12": "VALIDATORS_TIMEOUT", "13": "LEADER_TIMEOUT",
};
// ACCEPTED, UNDETERMINED, FINALIZED, CANCELED and the two timeouts.
const DECIDED = new Set(["5", "6", "7", "8", "12", "13"]);

export const STATUS_COPY: Record<string, string> = {
  UNINITIALIZED: "Submitting…",
  PENDING: "Waiting for the network to pick up the transaction…",
  PROPOSING: "A leader validator is being assigned…",
  COMMITTING: "Validators are independently reading the sources and committing their results. This is the real work and can take a minute.",
  REVEALING: "Validators are revealing their results…",
  ACCEPTED: "Consensus reached.",
  UNDETERMINED: "Validators couldn't reach a clear majority. Nothing was recorded; retry.",
  FINALIZED: "Confirmed final.",
  CANCELED: "The transaction was canceled. Nothing was recorded.",
  APPEAL_REVEALING: "Under appeal: a larger committee is revealing results…",
  APPEAL_COMMITTING: "Under appeal: a larger committee is voting…",
  READY_TO_FINALIZE: "Consensus reached, wrapping up…",
  VALIDATORS_TIMEOUT: "Validators timed out. Nothing was recorded; retry.",
  LEADER_TIMEOUT: "The leader timed out. Nothing was recorded; retry.",
};

export type Progress = { statusName: string; validators: string[]; votes: string[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls a transaction's real status until it is decided. It never trusts
 * genlayer-js's default wait (30 s, far too short once every validator has to
 * fetch live data), reports every status it sees, and only returns a
 * transaction in a decided status.
 */
// Checks normally decide within a couple of minutes. A transaction that is still
// undecided after this is reported as such: it may yet complete, so nothing is
// shown as its result, and the explorer link stays on the panel.
const GIVE_UP_MS = 12 * 60_000;

export async function pollTransaction(client: any, hash: string, onUpdate: (p: Progress) => void,
                                      cancelled: () => boolean): Promise<any> {
  const started = Date.now();
  while (!cancelled()) {
    if (Date.now() - started > GIVE_UP_MS) {
      throw new Error(`Still not decided after ${GIVE_UP_MS / 60_000} minutes. It may yet complete: follow it on the explorer. Nothing is shown as its result.`);
    }
    try {
      const tx = await client.getTransaction({ hash });
      if (tx) {
        const n = String(tx.status);
        onUpdate({ statusName: STATUS_NAMES[n] ?? n, validators: tx.last_round?.round_validators ?? [],
                   votes: tx.last_round?.validator_votes_name ?? [] });
        if (DECIDED.has(n)) return tx;
      }
    } catch {
      // not indexed yet right after submission, or a transient RPC hiccup: keep polling
    }
    await sleep(4000);
  }
  throw new Error("cancelled");
}

export type Outcome =
  | { ok: true; tx: any }
  | { ok: false; kind: "rejected" | "consensus"; message: string };

/** The contract's own revert message, wherever the node put it. */
export function revertMessage(tx: any): string {
  const found: string[] = [];
  const walk = (o: any, depth = 0) => {
    if (depth > 8) return;
    if (typeof o === "string") {
      const m = o.match(/([A-Za-z0-9_' ,.:()/\-]{0,80}(?:not registered|already registered|must be|must name|attest first|not an approval|already revoked|a batch holds|once per batch|unknown firm_id|checksum failed|refused|blocked)[A-Za-z0-9_' ,.:()/\-]{0,100})/);
      if (m) found.push(m[1].trim());
    } else if (o && typeof o === "object") Object.values(o).forEach((x) => walk(x, depth + 1));
  };
  walk(tx);
  return found[0] ?? "";
}

/**
 * Only an ACCEPTED or FINALIZED transaction whose execution did not revert is a
 * success. A deterministic revert (FINISHED_WITH_ERROR: every validator agrees
 * the call fails) is a contract rejection; every other decided status is
 * consensus trouble. Neither ever leaves a stale result on screen.
 */
export function classify(tx: any, rejectionHint: string): Outcome {
  const n = String(tx.status);
  const name = STATUS_NAMES[n] ?? n;
  if (tx?.txExecutionResultName === "FINISHED_WITH_ERROR") {
    const msg = revertMessage(tx);
    return { ok: false, kind: "rejected", message: `The contract rejected this call: ${msg || rejectionHint}` };
  }
  if (n === "5" || n === "7") return { ok: true, tx };
  return { ok: false, kind: "consensus", message: STATUS_COPY[name] ?? `Not accepted (status ${name}).` };
}

/** Sign and send one write, then wait for the network to decide it. */
export async function sendTransaction(signer: Signer, address: string, functionName: string, args: unknown[],
                                      onSubmitted: (hash: string) => void, onUpdate: (p: Progress) => void,
                                      cancelled: () => boolean): Promise<{ hash: string; tx: any }> {
  const client = writeClient(signer);
  const fees = await estimateAndAttachFees(client);
  const hash: string = await client.writeContract({ address, functionName, args, fees, value: 0n });
  onSubmitted(hash);
  const tx = await pollTransaction(client, hash, onUpdate, cancelled);
  return { hash, tx };
}
