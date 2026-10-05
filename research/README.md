# Pre-build connectivity research (Studio Next, 2026-09-30)

Before writing either contract, two throwaway probe contracts were deployed on Studio Next to check — on the real network, not by assumption — which data sources GenVM's fetchers can reach, what they return, and how the runtime behaves. The design of LicenceCheck and its sibling EntityStanding follows directly from these results. The probes are **not** submissions: their validators accept any successful leader result, which is fine for measuring connectivity and wrong for anything else.

## Probe 1 — `connectivity_probe_studio_next.py`

Contract [`0xE635d9F3a273DEE16b58C24Fd8C2c614476D1774`](https://explorer-studio-dev.genlayer.com/address/0xE635d9F3a273DEE16b58C24Fd8C2c614476D1774) (deploy [`0x6786d29e…`](https://explorer-studio-dev.genlayer.com/tx/0x6786d29e7af4450d194b1b1c4789bb380aef1ac6599851bf56f674cb1af6eb86)).

| Call | Source | Result on Studio Next | Same source fetched locally |
|---|---|---|---|
| [`web.get`](https://explorer-studio-dev.genlayer.com/tx/0x967831fb53d0d04aa2e0ac1ea4d076018e89fa1d7d082e14cbaff93d5989e071) | Companies House overview, 00445790 | 200, 36,866 bytes, `id="company-status"` present | 36,866 bytes |
| [`web.get`](https://explorer-studio-dev.genlayer.com/tx/0x9200e83ce486158f417252f169ba0197e5df37217c01d81f80f422cb0eb51dd9) | Companies House filing history, 12369751 | 200, 65,480 bytes | 65,480 bytes |
| [`web.get`](https://explorer-studio-dev.genlayer.com/tx/0xf570bec8c6881cc89ee5d8c9e6863e38d9ecbe2eec05890d389089ce16b77c10) | ESMA `CASPS.csv` | 200, 173,795 bytes, `text/csv` | 173,795 bytes |
| [`web.get`](https://explorer-studio-dev.genlayer.com/tx/0x9b9e69774e889a706538fbec921605751a05d7872eee616c2a22255b7f0aeb84) | ESMA `NCASP.csv` | 200, 27,052 bytes | 27,052 bytes |
| [`web.get`](https://explorer-studio-dev.genlayer.com/tx/0xb4d4ee651b22b5ebe8e2fa6799142e70dff3cc05325654a7fa78dab807e2fe1b) | GLEIF API, one LEI record | 200, 3,085 bytes | 3,085 bytes |
| [`web.render`](https://explorer-studio-dev.genlayer.com/tx/0x959a6be0c14810b51221ae4f27c727f5713d85d23bcf306e374cb39a0dd912be) | Companies House overview (text mode) | 1,855 chars of text — IDs and structure lost | — |
| [`web.render`](https://explorer-studio-dev.genlayer.com/tx/0x02f0da2d25b61f6a3dbe847c6f9cf8d7bbe3566fb7ec84196df2352992ca4b2c) | FCA Financial Services Register firm page, 6 s wait | **`NondetException('WEBPAGE_LOAD_FAILED')`** | JS-only Salesforce app |

What this decided:
- **Raw `web.get`, not `web.render`**, for every source — it works on Studio Next (no earlier project in this account had used it), and returned every page at exactly the byte length a local fetch got - stable enough for validators to agree on exact parsed facts. Rendered text throws away the element IDs a deterministic parser needs.
- **The FCA register can't be read** by GenVM: its public site is a JavaScript application that fails to load in the renderer (above), and its API requires a private key that can't be embedded in a public contract. LicenceCheck covers MiCA (EU/EEA) and documents this instead of pretending.

## Probe 2 — `runtime_probe_studio_next.py`

Contract [`0x81A8062ED2D9E174Ed9fA2B95e818Ffe3FB6018d`](https://explorer-studio-dev.genlayer.com/address/0x81A8062ED2D9E174Ed9fA2B95e818Ffe3FB6018d) (deploy [`0x7c04e029…`](https://explorer-studio-dev.genlayer.com/tx/0x7c04e029a692f294a84e42234a958aec0917a6ce885766ae555c9470251a1c97)).

- [`parse_csv`](https://explorer-studio-dev.genlayer.com/tx/0x80de233066c74a3e7519866ff43edd7e200abb457acd8ce6d30038de626c8a2a): `csv`, `re` and `html` all work inside GenVM; the real 174 KB register parses to 363 rows × 16 columns; ISO 17442 mod-97 on a real LEI evaluates to 1.
- `now_view()` read twice, 15 s apart (none of this account's transactions in between), returned `…13:14:21Z` then `…13:14:36Z` against a local clock of `13:14:35Z`: **a view call's timestamp tracks the current time**, so freshness-gated consumer views (`is_authorised(…, max_age_seconds)`) are accurate when read directly, not just inside a transaction.
