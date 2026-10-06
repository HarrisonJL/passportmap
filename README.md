# PassportMap

**Where in the EU/EEA is this crypto-asset firm authorised under MiCA for the services it needs?** A GenLayer Intelligent Contract that reads ESMA's interim MiCA register once and publishes a verdict for **each of 30 states**, records the register's own snapshot date, diffs every snapshot against the firm's previous one, and a consumer contract that lists assets only where the venue is covered.

| | |
|---|---|
| Network | GenLayer Studio Next (chain 61997) |
| PassportMap | [`0x170E181A241F8D5909E72d17e2f9D3D027fcA747`](https://explorer-studio-dev.genlayer.com/address/0x170E181A241F8D5909E72d17e2f9D3D027fcA747) |
| ListingGate (consumer) | [`0x75e6846612A26a4D76BE0766b5ED7b8141c18D68`](https://explorer-studio-dev.genlayer.com/address/0x75e6846612A26a4D76BE0766b5ED7b8141c18D68) |
| Live proof | [CONTRACT.md](CONTRACT.md): ten real firms, nine maps of 30 states each, a diff chain, ten gate calls, every transaction unanimous |
| Tests | 97 Direct Mode tests; every state's verdict checked against LicenceCheck v1 on 34 cases (1,020 verdicts); 59/59 safety mutations killed |
| Live app | [`web/`](web): a React app that reads the live contracts (firms × states heat map, a tile map per firm, diff history, the gate's ledger) and sends real register / snapshot transactions (see "Frontend") |

## What this builds on, and what it adds

PassportMap is **LicenceCheck v2**. [LicenceCheck](https://github.com/HarrisonJL/licencecheck) (deployed at `0x301740e01AB6b7538B9078D9ec98914540b4B91F`) answers one question: *is this firm authorised for these services in this one state?* A treasury that needs to know **where** a counterparty can operate would have to register 30 inquiries and pay for 30 checks. PassportMap reads the register once and answers for every state.

It does not re-derive v1's core. Every line from the constants down to the storage classes (the register and GLEIF parsers, the deterministic service matcher, the LLM reader, `_evaluate`, `_decide`, the fetch helpers: 580 lines) is v1's code, byte for byte; the only edit is one added import (`hashlib`). That core is:

- **Primary sources only**, and the contract builds the URLs: ESMA's `CASPS.csv`, its non-compliant-entity list `NCASP.csv`, and the GLEIF record.
- **The two-reader rule.** A service counts only if a deterministic phrase matcher **and** an LLM both say the entry lists it. Disagreement is `UNVERIFIED`.
- **The LLM can only make things stricter.** A regulator comment that limits an authorisation moves it down to `AUTHORISED_RESTRICTED`, with a verbatim quote, or to `UNVERIFIED` without one.
- **Identity**: GLEIF must say the LEI is current; a website, if given, must be the register's; the ESMA warning list is screened.
- **Fail-closed `UNVERIFIED`**.

What v2 adds:

| New | What it does |
|---|---|
| **`snapshot(firm)`** | One consensus round, **a verdict for each of the 30 EU/EEA states**. The per-state verdict is v1's own `_decide`, called once per state, so it is exactly what LicenceCheck gives for that (firm, services, state). The tests prove that for all 30 states on 34 cases. |
| **The register's snapshot date** | Every snapshot records ESMA's newest "last update" in the file (a future-dated row is ignored), so a consumer can refuse a stale **register**, not just a stale check. |
| **Diff history** | Each snapshot is diffed on-chain against the firm's previous one: states **gained**, states **lost**, other per-state verdict changes, whether the firm's register entries changed at all, and the register date before and after. `get_history` walks the firm's own chain. |
| **`get_coverage` / `covers`** | Whether a firm covers a state right now, and why not: `NO_SNAPSHOT`, `VERDICT_<X>`, `REGISTER_DATE_UNKNOWN`, `STALE_REGISTER`, `STALE_CHECK`, `COVERED`. |
| **`get_map`** | The latest `{state: verdict}` at a glance. |

The v1 methods that took a member state (`register_inquiry`, `attest`, `is_authorised`) are replaced: a firm here has all of them.

## How a map is made

1. **Register** a firm: LEI (checksum-verified on-chain), MiCA service letters `a`-`j`, an optional website. Permissionless and immutable.
2. **Snapshot.** Every validator fetches the three sources and derives identical facts, including the exact register text the LLM reads. The LLM reads each live entry once.
3. **Thirty verdicts.** After consensus, the contract computes `{state: {verdict, reasons}}` for all 30 states from the agreed facts and readings. The leader never supplies a map.
4. **Diff** against the firm's previous snapshot, from the stored maps.

The states are the EU-27 and the three EEA EFTA states (IS, LI, NO): the register is EEA-wide, so the map has 30 tiles, not 27. ESMA writes Greece as `EL`; `EL` and `GR` are the same state throughout.

A state's verdict is the most severe finding that applies to it (v1's rule): a firm whose website doesn't match the register is `UNVERIFIED` in every state, except where it isn't passported at all, which is the more severe `NOT_AUTHORISED` (live: `bybit-lookalike`, Malta).

### Verdicts, most severe first (per state)

`WARNING_LISTED`, `NOT_LISTED`, `WITHDRAWN`, `NOT_AUTHORISED`, `UNVERIFIED`, `AUTHORISED_RESTRICTED`, `AUTHORISED`. `covers()` is true only for `AUTHORISED` in a fresh check of a recent register: a contract can't judge a regulator's scope limit, so `AUTHORISED_RESTRICTED` is not covered.

## Equivalence principle

A custom leader/validator pair (`gl.vm.run_nondet`), unchanged from v1:

- **Deterministic facts: exact agreement.** Each validator re-fetches ESMA's two files and GLEIF and recomputes every fact: the matched entries (including the exact text the LLM reads), passport lists, warning-list hits, GLEIF status, the register's date. Any difference rejects the leader.
- **The LLM reader: decision-level agreement.** The same yes/no per requested service, and the same restriction outcome, including whether the leader's quote really is in the comment.
- **The map is never taken from the leader.** It, the diff and the register date are computed after consensus.

The consensus-boundary tests show validators rejecting: forged register facts (a passport that isn't there, a withdrawn entry, a fresher register date, a warning that was never issued), an LLM reading that grants what the validator's own doesn't, a hidden restriction, a fabricated quote, an invented restriction, LLM output where none was needed, and misaligned or malformed results. A leader that tries to smuggle in a map of its own changes nothing that is recorded.

## Using it from another contract

`contracts/listing_gate.py` is a deployed, working example. An asset can only be **listed** on a venue for a state while PassportMap covers the venue there, and a **settlement** is only recorded if the venue is covered *at the time of settlement*. A listing is a record, never a standing permission:

```python
passport = gl.contract.get_at(self.passport_address)
coverage = passport.view().get_coverage(firm_id, state, self.max_age_seconds, self.max_register_age_days)
if not coverage["covered"]:
    raise gl.vm.UserError(f"settlement blocked: PassportMap says {coverage['reason']}")
```

Live: ETH was listed via Bybit EU in Germany and SOL via eToro in Greece (written `EL`), and a settlement was recorded. Listings were refused for Malta (Bybit is not passported there), for HPB in Croatia (authorised but restricted), for HPB in Germany, for AMINA in Slovenia (the register says `SL`), for a withdrawn firm, and for a firm never snapshotted. A settlement for an asset never listed in France reverted (CONTRACT.md).

| Method | |
|---|---|
| `register_firm(firm_id, lei, services, website, label)` | Permissionless, immutable. `services` like `"a,c"`; `website` may be `""`. |
| `snapshot(firm_id)` | Permissionless: a fresh read, a verdict for every state. |
| `get_coverage(firm_id, state, max_age_seconds, max_register_age_days)` / `covers(...)` | The consumer views. |
| `get_map` / `latest_snapshot` / `get_snapshot(s)` / `get_history(firm_id, n)` | The map, its diff, and the firm's chain. |
| `get_firm` / `list_firms` / `get_sources` / `service_catalogue` / `get_rules` / `get_state` | |

## Testing

```bash
python3 -m venv .venv && .venv/bin/pip install genlayer-test==0.29.2 genvm-linter==0.11.0 pytest
.venv/bin/pytest tests -q                     # 97 tests
python3 scripts/mutation_check.py             # 59/59 mutations killed
.venv/bin/genvm-lint check contracts/passport_map.py
```

- **The real register, unmodified.** `tests/fixtures/` holds ESMA's `CASPS.csv` and `NCASP.csv` as captured on 24 September 2026 and real GLEIF records (`tests/fixtures/PROVENANCE.md`). Bybit's passport list lacks Malta; OKX's home state (Malta) is missing from its own list; AMINA's says `SL` where Slovenia is `SI`; HPB is Croatia-only. Edge cases are made by editing one cell of the real file and are marked `SYNTHETIC` wherever used.
- **Differential against LicenceCheck v1: 34 cases × 30 states = 1,020 verdicts.** `tests/reference/licence_check_v1.py` is v1's source (byte-identical to the `licencecheck` repo's, and its mechanical port is what is deployed at `0x301740e0…`: checked by SHA-256 against the chain). genlayer-test's loader allows one contract per process, so v1 can't run beside PassportMap. Instead `tests/reference/generate_v1_expected.py` runs v1's own code, per case and state, in its own process and writes `tests/reference/v1_expected.json`. `test_passport_map.py` checks PassportMap against that file, and fails if the file wasn't generated from this exact reference source and register. Regenerate with `pytest tests/reference/generate_v1_expected.py`; `git diff` shows whether v1's answers changed.
- **The new behaviour**: the register date (including a future-dated row and a register with no usable date), the digest of a firm's entries (insensitive to row numbers, sensitive to a passport, a comment or an end date), the diff (baseline, unchanged, gained and lost, other changes, a register date alone), the history across interleaved firms, `get_coverage`'s reasons in order including register staleness at the boundary, and the consensus boundary.
- **14 gate tests** for everything before ListingGate's cross-contract call. That call can't run in Direct Mode (no glsim hook), so it's proven live, with PassportMap's reason in each revert message.
- **Mutation check.** `tests/mutations.txt` lists 59 deliberate breakages: 33 of LicenceCheck's, still applicable to the shared code, and 26 for what's new. Each removes one safety property, and `scripts/mutation_check.py` confirms the suite catches every one. It runs each suite in its own process group with a timeout and restores the contract however it ends. A first run left nine survivors, which were v1 properties that v1's own suite covers and the differential cases didn't. Adding those scenarios as differential cases (a doctored GLEIF record, a truncated entry list, a reshaped register) killed them.
- `contracts/*.py` are the tested sources (GenVM v0.2.11); `contracts/*_studio_next.py` are mechanical ports (`scripts/port_to_studio_next.py`), and the on-chain code is byte-identical to them (`studio-next/verify_code.ts`).

## Frontend

`web/` is a Vite + React + TypeScript app. It shows a **heat map of every firm against all 30 states**, colour-coded by verdict; a **tile map of Europe** for the selected firm, where choosing a state shows its verdict and reasons; that firm's **snapshot history with each diff**; a coverage checker that asks the contract itself (`get_coverage`) with limits you choose; and the ListingGate ledger. It is also a client: a visitor can register a firm and take a fresh snapshot of one, and each is a real transaction on the deployed contract.

- **Accounts.** Connect a wallet (MetaMask, which the app adds the Studio Next network to), or use a temporary in-browser account and fund it from the network's faucet. The temporary key lives only in that browser and is for the testnet only.
- **The whole transaction lifecycle is shown, not just the send.** The panel follows the transaction as the network does (pending, a leader proposing, validators committing) with each validator's vote. Only `ACCEPTED` and `FINALIZED` count as success. `CANCELED`, `UNDETERMINED` and a timeout are shown as failures, and a call the contract rejected (`FINISHED_WITH_ERROR`) is shown as a rejection with the contract's own reason (for example `website must be a hostname or URL`), never as success. The register form also checks what the contract checks (the LEI's ISO 17442 checksum, the firm id, the service letters) so a call that would be refused is not paid for.
- **The result shown is the record that transaction created.** Before a snapshot it reads the contract's snapshot count, and afterwards shows only a snapshot at or past it, of that firm, from this sender; if it cannot find one it says so instead of showing the latest.
- **State comes from the contract, not the page.** The countdowns (is the register still recent enough for the gate, is the check still fresh enough) are computed in the browser against the clock from the contract's own configuration, and "is this firm covered" is `get_coverage`'s answer. A load brackets its reads with the contract's counters and re-reads if a transaction landed halfway through, so the page never mixes two moments.
- **The public RPC allows 30 requests a minute and eight concurrent executions.** Reads are paced under that (two in flight, the window kept in `localStorage` so reloads and tabs share it), a `429` is waited out rather than shown as an error, and the last good snapshot is painted at once, labelled as a past read, while the live read runs.

```bash
cd web && npm install && npm run dev      # http://localhost:5173
npm run build                             # type-check + production build into dist/
```

One snapshot was taken from the app after the recorded live proof (CONTRACT.md): snapshot #12 of `etoro-custody`, chained to #4, from a throwaway browser account, unanimous, "no change in any state" (the register is unchanged). It is in the contract's state, not in `studio-next/live_proof.json`, which is the scripted run. The counts only grow: anyone using the app adds snapshots, so `get_state` will read higher than the live-proof table.

## Known limitations

- **A passport list is what ESMA's register says, not where a firm trades.** It is an authorisation notification, not evidence of activity, and a map is only as complete as the register. It is not legal advice.
- **The diff is between snapshots, not dated changes.** It says what changed since the firm's previous snapshot, not when. **Live, the register did not change between snapshots** (dated 29 September throughout), so the diff chain shows `no change`. Gained and lost states, the entries digest and a moving register date are exercised on real rows with synthetic edits in the tests, and the docs don't claim otherwise.
- **Services are fixed per firm.** A firm registered for `a` is not mapped for `b`: register another firm id (the tests and live proof do this: `bybit-custody` and `bybit-unchecked`).
- **Fixed sources.** ESMA's file URLs are immutable in the contract, so if ESMA moves them reads fail closed (`UNVERIFIED`) and the contract is redeployed. More than 10 register rows for one LEI is `UNVERIFIED`, never a silent truncation.
- **Validators read the register at slightly different moments.** If ESMA updates the files mid-check, validators disagree and the round rotates rather than recording a mixed reading.
- **The live maps show six of the seven per-state verdicts** (`AUTHORISED`, `AUTHORISED_RESTRICTED`, `UNVERIFIED`, `NOT_AUTHORISED`, `WITHDRAWN`, `NOT_LISTED`). `WARNING_LISTED` is proven in the differential tests (a website on ESMA's warning list, 30 states) but wasn't run live.
- **Availability is never traded for safety.** Anyone can pay for a fresh check, and the latest check wins. If a source is momentarily unreachable, that check records `UNVERIFIED` (or fails and records nothing), and consumers fail closed until the next good check. A griefer can make a good verdict temporarily unavailable, never a bad one look good, and the next check restores it.
- **The register's date is its newest entry update, not its publication date.** `register_as_of` is ESMA's newest "last update" in the file. A quiet week with no entry changes can therefore read as `STALE_REGISTER` for a strict `max_register_age_days`: fail-closed, never fail-open.
- **Prompt injection and ids.** As LicenceCheck: the LLM reads firm- and regulator-written text framed as untrusted data and can only withhold or restrict a grant. `firm_id`s are first-come, so read `get_firm` and pin the parameters you expect. `ListingGate` is owner-only and takes the owner's chosen firm and state, to show the gate.

## Repository layout

```
contracts/passport_map.py                tested source (GenVM v0.2.11)
contracts/passport_map_studio_next.py    deployed port (Studio Next)
contracts/listing_gate*.py               consumer contract + port
tests/                                   Direct Mode tests, real ESMA/GLEIF fixtures, mutations.txt
tests/reference/                         LicenceCheck v1's source, and its recorded per-state answers
scripts/                                 port, mutation check
studio-next/                             deploy, schema check, live proof (prove.ts, live_proof.json), verify_code.ts
web/                                     live app (React): reads the contracts, sends register / snapshot transactions
research/                                LicenceCheck v1's connectivity probes (why plain HTTP fetches of ESMA and GLEIF work on Studio Next)
```
