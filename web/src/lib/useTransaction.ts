import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, type Signer } from "./genlayer";
import { classify, sendTransaction, type Progress } from "./lifecycle";

export type TxState =
  | { stage: "idle" }
  | { stage: "submitting"; label: string }
  | { stage: "waiting"; label: string; hash: string; progress: Progress | null }
  | { stage: "done"; label: string; hash: string; progress: Progress | null; bound: any }
  | { stage: "failed"; label: string; hash?: string; error: string; kind: "rejected" | "consensus" | "other" };

/**
 * One write at a time, through its whole lifecycle. `bind` runs only after the
 * transaction was ACCEPTED/FINALIZED without reverting, and must return the
 * record THIS transaction created (by comparing contract state before and
 * after, and the sender): never "the latest record". If it can't, the result is
 * an error, not a guess.
 */
export function useTransaction() {
  const [state, setState] = useState<TxState>({ stage: "idle" });
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const run = useCallback(async (signer: Signer, address: string, fn: string, args: unknown[], label: string,
                                 rejectionHint: string, bind: () => Promise<any>): Promise<any | null> => {
    cancelled.current = false;
    setState({ stage: "submitting", label });
    let hash = "";
    let progress: Progress | null = null;
    try {
      const sent = await sendTransaction(
        signer, address, fn, args,
        (h) => { hash = h; setState({ stage: "waiting", label, hash: h, progress: null }); },
        (p) => { progress = p; setState({ stage: "waiting", label, hash, progress: p }); },
        () => cancelled.current,
      );
      const outcome = classify(sent.tx, rejectionHint);
      if (!outcome.ok) {
        setState({ stage: "failed", label, hash, error: outcome.message, kind: outcome.kind });
        return null;
      }
      let bound: any;
      try {
        bound = await bind();
      } catch (e: any) {
        setState({ stage: "failed", label, hash, kind: "other",
                   error: `The transaction was accepted, but its result could not be matched to this call (${String(e?.message ?? e)}). Check the transaction in the explorer.` });
        return null;
      }
      setState({ stage: "done", label, hash, progress, bound });
      return bound;
    } catch (e: any) {
      if (String(e?.message) === "cancelled") return null;
      setState({ stage: "failed", label, hash: hash || undefined, kind: "other",
                 error: errorText(e) });
      return null;
    }
  }, []);

  /** A failure before anything was sent (a read the call depends on), shown in the same panel. */
  const fail = useCallback((label: string, e: unknown) => {
    setState({ stage: "failed", label, kind: "other", error: errorText(e) });
  }, []);

  return { state, run, fail, reset: () => setState({ stage: "idle" }) };
}
