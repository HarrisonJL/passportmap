# PassportMap: deployment and live proof

Everything below is on GenLayer Studio Next (chain 61997), produced by `studio-next/prove.ts` on 2026-10-05 and logged in full (every recorded snapshot, every vote) in [`studio-next/live_proof.json`](studio-next/live_proof.json). Explorer: `https://explorer-studio-dev.genlayer.com/tx/<hash>`.

## Deployments

| Contract | Address | Deploy tx |
|---|---|---|
| PassportMap | `0x170E181A241F8D5909E72d17e2f9D3D027fcA747` | `0x5d3a5a88407a1576436cfa0670c8ba828ac606cbccbd52122f490d4c252b4f19` |
| ListingGate (`max_age_seconds` 86400, `max_register_age_days` 14) | `0x75e6846612A26a4D76BE0766b5ED7b8141c18D68` | `0x0ee65f8a67a5edb4214392ce215e3cc019f8442bb5768b666db02657b1db1742` |

Checked against the live runner with `getContractSchemaForCode` before deploying (`studio-next/check_schema.ts`): PassportMap 15 methods (13 view, 2 write), ListingGate 6 (4 view, 2 write).

### Verify the deployed source matches this repo

```bash
cd studio-next && npm ci
npx tsx verify_code.ts 0x170E181A241F8D5909E72d17e2f9D3D027fcA747 passport_map_studio_next.py
npx tsx verify_code.ts 0x75e6846612A26a4D76BE0766b5ED7b8141c18D68 listing_gate_studio_next.py
```

| File | SHA-256 | On-chain |
|---|---|---|
| `contracts/passport_map_studio_next.py` | `d9157c8292b665afe43412ad0caedb4a8b5412a5fddab5e3c077f02b3226aa9b` | identical |
| `contracts/listing_gate_studio_next.py` | `022e15c3cdfd1021abe5136ea8d4031d293bd25eff3cf9e1ee8fa98ae8de3fc1` | identical |
| `contracts/passport_map.py` (tested source) | `ecda89ad7633140cc1b6cd001b83f60c010be9f869d27464cddd310589e898eb` | ported mechanically |
| `contracts/listing_gate.py` (tested source) | `1dc188e74c1d33bf7e8c82597aeaff50c94a67b906bfc507d8e6c5edfbeb9ef0` | ported mechanically |

**The reference is the deployed LicenceCheck v1.** `tests/reference/licence_check_v1.py` is byte-identical to the `licencecheck` repo's `contracts/licence_check.py`. Ported with `scripts/port_to_studio_next.py` (and its header's file name restored to `contracts/licence_check.py`), it is SHA-256 `648832c871eafed4ebd202bdac9a36af3c4fd83d41dd07b6a78b29c9e3f721c9`, identical to the code on-chain at LicenceCheck's address `0x301740e01AB6b7538B9078D9ec98914540b4B91F`. So the differential tests compare PassportMap with the very source that is deployed.

## Live proof

Ten real firms registered on the map. Every transaction below reached consensus with every voting validator agreeing (3 of the 5 seats vote per round on Studio Next; the rest are `IDLE`). All checks ran against ESMA's live register, which was dated **2026-09-29**, newer than the 22 September register the test fixtures were captured from; the results for these firms are the same.

### 1. Registration

| Firm | LEI · services | Tx |
|---|---|---|
| `bybit-custody`: Bybit EU: custody and fiat exchange | `5299005V5GBSN2A4C303` · a,c + site bybit.eu | [`0xd242bfe7…`](https://explorer-studio-dev.genlayer.com/tx/0xd242bfe7fa4cc44761a25c3a5b354cf19f5cb290485b8757d5503d84e540e4ca) |
| `okx-trading`: OKX Europe: trading platform | `54930069NLWEIGLHXU42` · b | [`0x4e186ad1…`](https://explorer-studio-dev.genlayer.com/tx/0x4e186ad12a51e5e2140ab3fea3cd2b50f3219880e5a5aec0a06d7dd5ff450df8) |
| `hpb-custody`: HPB: custody, limited solely to one fund | `529900D5G4V6THXC5P79` · a | [`0xf98f0394…`](https://explorer-studio-dev.genlayer.com/tx/0xf98f039402bc2f4c6782a72c0f63376a6299e7300f6ff6b934d47dfba9dc67fb) |
| `amina-custody`: AMINA: custody (Slovenia written SL) | `5299005I4LYIFW7GKB54` · a | [`0x1d6eda96…`](https://explorer-studio-dev.genlayer.com/tx/0x1d6eda96421da8a891b1c0120060dce57f256f316f1a939f9c950b0cccc9e9fe) |
| `etoro-custody`: eToro: custody (Greece written EL) | `213800GIFQMSV7HROS23` · a | [`0x80273084…`](https://explorer-studio-dev.genlayer.com/tx/0x80273084447f2a7a16f1d50901372967c3014217d228d21b5a2d2c2e5bbcafcc) |
| `decubate-placing`: Decubate: placing, withdrawn | `894500ZVOL3A9LO8LN34` · f | [`0x9a771442…`](https://explorer-studio-dev.genlayer.com/tx/0x9a7714426a2cb863a159c8ff7ad2e828bcec9f6af03df0c90b29a3a589aeaf78) |
| `bitpanda-old`: Bitpanda under the retired LEI | `5493007WZ7IFULIL8G21` · a | [`0x02a792fa…`](https://explorer-studio-dev.genlayer.com/tx/0x02a792fa7b2e56556abb3b86a0d776ec95d64f360e124eac417806809195ce1b) |
| `tesco`: Tesco PLC, not a CASP | `2138002P5RNKC5W2JZ46` · a | [`0x008142e1…`](https://explorer-studio-dev.genlayer.com/tx/0x008142e10fa20514935a94f31d9eef6ae075f78a3bc4f3c9ce1d574f82c58b2d) |
| `bybit-lookalike`: Bybit's LEI via a look-alike site | `5299005V5GBSN2A4C303` · a + site fakebybit.eu | [`0x56ba7592…`](https://explorer-studio-dev.genlayer.com/tx/0x56ba759287352cef0f482193aac3c12ef0cc3bd4b3576f4c95f735e03917dca0) |
| `bybit-unchecked`: registered, never snapshotted | `5299005V5GBSN2A4C303` · b | [`0x4f20f43e…`](https://explorer-studio-dev.genlayer.com/tx/0x4f20f43e23036afa7b235119916242403410750fddfd7b60499cd35da85b443d) |

### 2. One snapshot each: a verdict for every state in one consensus round

Register date read: **2026-09-29** for every firm.

| Firm | Tx | Agree | Map (states per verdict) |
|---|---|---|---|
| `bybit-custody` | [`0xee8c7be6…`](https://explorer-studio-dev.genlayer.com/tx/0xee8c7be6114efcb0a156ca3786707bc6c86bf0a04c20eab8d1997207c25aa339) | 3/3 | 29 AUTHORISED, 1 NOT_AUTHORISED |
| `okx-trading` | [`0xe54336d0…`](https://explorer-studio-dev.genlayer.com/tx/0xe54336d055938226dfc3cc266aadddc4e7aeffde82c4eacee5e610a1eb22ac96) | 3/3 | 30 AUTHORISED |
| `hpb-custody` | [`0xb1b75a99…`](https://explorer-studio-dev.genlayer.com/tx/0xb1b75a99a8d004760b18b9928a35d2e1139d2a92ab96e310a74d4330b64650c5) | 3/3 | 29 NOT_AUTHORISED, 1 AUTHORISED_RESTRICTED |
| `amina-custody` | [`0x3bae61a3…`](https://explorer-studio-dev.genlayer.com/tx/0x3bae61a35af2d515d2b0fcb161758de5ce08706f367a92eaaa23c84305a21d7a) | 3/3 | 29 AUTHORISED, 1 UNVERIFIED |
| `etoro-custody` | [`0xa1153706…`](https://explorer-studio-dev.genlayer.com/tx/0xa11537069d614a4604fb93386b94a2687d5514db6b2890186e77a51dd5493dae) | 3/3 | 30 AUTHORISED |
| `decubate-placing` | [`0x13b1487d…`](https://explorer-studio-dev.genlayer.com/tx/0x13b1487d3b1a1a2ffb13bfc451781b98cf84d1e453b0e90185f49842a0f7f585) | 3/3 | 30 WITHDRAWN |
| `bitpanda-old` | [`0xcc842e6b…`](https://explorer-studio-dev.genlayer.com/tx/0xcc842e6bea789e7d2e9cfe53cbafff73b42ed0225f25a353a8610fd0a4f467e7) | 3/3 | 30 UNVERIFIED |
| `tesco` | [`0x373f4f71…`](https://explorer-studio-dev.genlayer.com/tx/0x373f4f716b1aa83418bc28a737aaa91cc9b3bc79ced6235304da5dc3210fa542) | 3/3 | 30 NOT_LISTED |
| `bybit-lookalike` | [`0xc25e7415…`](https://explorer-studio-dev.genlayer.com/tx/0xc25e7415d70c52d6f99efe2a1765b3c9e3b325ef5047c3ed89d02c353732c06b) | 3/3 | 29 UNVERIFIED, 1 NOT_AUTHORISED |

The exceptions inside each map, from the recorded `states`:

- `bybit-custody`: **MT** `NOT_AUTHORISED` (service_not_covered:a, service_not_covered:c)
- `hpb-custody`: **HR** `AUTHORISED_RESTRICTED` (regulator_comment_restricts:row_230)
- `amina-custody`: **SI** `UNVERIFIED` (service_ambiguous:a)
- `bybit-lookalike`: **MT** `NOT_AUTHORISED` (service_not_covered:a, website_not_in_register)

### 3. The diff chain

| Firm | Tx | Snapshot | Diff against the previous snapshot | Agree |
|---|---|---|---|---|
| `bybit-custody` | [`0x5111df62…`](https://explorer-studio-dev.genlayer.com/tx/0x5111df6296a361898d1e57d751dfd02df9c3e1ea80af7dcd2403555182446c9a) | `#9` after `#0` | register `2026-09-29` → `2026-09-29`, entries changed: `false`, authorised states `29` → `29`, gained `[]`, lost `[]`, changed `{}` | 3/3 |
| `hpb-custody` | [`0x53d7df85…`](https://explorer-studio-dev.genlayer.com/tx/0x53d7df8587ca36397ee01c745aece8612f68db796be0ba70f18a6819b3c5e3f4) | `#11` after `#10` | register `2026-09-29` → `2026-09-29`, entries changed: `false`, authorised states `0` → `0`, gained `[]`, lost `[]`, changed `{}` | 3/3 |

`get_history("bybit-custody", 10)` → snapshot ids `[9, 0]`.

### 4. ListingGate

| Call | Tx | Result | Agree |
|---|---|---|---|
| `list_asset(bybit-custody, ETH, DE)` | [`0x16da5f4c…`](https://explorer-studio-dev.genlayer.com/tx/0x16da5f4caa654bf59d074cd54cc49d340b559167bbf5f6fe6b04ba498ba8ddd6) | ✓ recorded | 3/3 |
| `list_asset(etoro-custody, SOL, EL)` | [`0x767fbb99…`](https://explorer-studio-dev.genlayer.com/tx/0x767fbb9998073ddb1ab67eefb21daf24436552ee3aeb4d39521d1df8a71ec082) | ✓ recorded | 3/3 |
| `list_asset(bybit-custody, ETH, MT)` | [`0x96cdfdc0…`](https://explorer-studio-dev.genlayer.com/tx/0x96cdfdc0b3d6fe77e88a64f41855833aa54497bcbda4d9e55625916dcb923a52) | reverted: `listing ETH via bybit-custody in MT refused: PassportMap says VERDICT_NOT_AUTHORISED` | 3/3 |
| `list_asset(hpb-custody, ETH, HR)` | [`0x884b95de…`](https://explorer-studio-dev.genlayer.com/tx/0x884b95de5d506b419856489b0aacbdb378981d544393a447e53239e12c59af5f) | reverted: `listing ETH via hpb-custody in HR refused: PassportMap says VERDICT_AUTHORISED_RESTRICTED` | 3/3 |
| `list_asset(hpb-custody, ETH, DE)` | [`0x00f2a9b7…`](https://explorer-studio-dev.genlayer.com/tx/0x00f2a9b7e493c6d337ff21fcc38c5d4550d10165b10b18c35f2889a6a9d3dc58) | reverted: `listing ETH via hpb-custody in DE refused: PassportMap says VERDICT_NOT_AUTHORISED` | 3/3 |
| `list_asset(amina-custody, BTC, SI)` | [`0x61581078…`](https://explorer-studio-dev.genlayer.com/tx/0x6158107896a763fc74de76b1a702f851e2c26bd681337df79e094c33fcd12481) | reverted: `listing BTC via amina-custody in SI refused: PassportMap says VERDICT_UNVERIFIED` | 3/3 |
| `list_asset(decubate-placing, ETH, NL)` | [`0x6e6e7768…`](https://explorer-studio-dev.genlayer.com/tx/0x6e6e7768b361a5a0b53cc2017a9d540910e85c35132782d5bbe11e1788e653bc) | reverted: `listing ETH via decubate-placing in NL refused: PassportMap says VERDICT_WITHDRAWN` | 3/3 |
| `list_asset(bybit-unchecked, ETH, DE)` | [`0x32a9b139…`](https://explorer-studio-dev.genlayer.com/tx/0x32a9b139506df9e83f93209fee166efd0a86439b5bdd2311a2011f2fb3d5c0b0) | reverted: `listing ETH via bybit-unchecked in DE refused: PassportMap says NO_SNAPSHOT` | 3/3 |
| `settle(bybit-custody, ETH, DE, 2500)` | [`0x46a40f17…`](https://explorer-studio-dev.genlayer.com/tx/0x46a40f1763001e8275b0cec0591847a5ba224073b610bc902909c404a9f16b00) | ✓ recorded | 3/3 |
| `settle(bybit-custody, ETH, FR, 100)` | [`0x35b584f9…`](https://explorer-studio-dev.genlayer.com/tx/0x35b584f95215b761878cf266f5f87af58a37a6e2c9388679e9cc2a0d728c3609) | reverted: `asset not listed` | 3/3 |

### 5. Coverage reads, and the register's age

The register was dated 2026-09-29 and the reads ran on 2026-10-05, so it was 6 days old: inside the gate's 14-day limit, outside a 1-day limit.

| Firm | `get_coverage(…, "DE", 86400, 14)` | with `max_register_age_days = 1` |
|---|---|---|
| `bybit-custody` | `COVERED` | `STALE_REGISTER` |
| `okx-trading` | `COVERED` | `STALE_REGISTER` |
| `hpb-custody` | `VERDICT_NOT_AUTHORISED` | `VERDICT_NOT_AUTHORISED` |
| `amina-custody` | `COVERED` | `STALE_REGISTER` |
| `etoro-custody` | `COVERED` | `STALE_REGISTER` |
| `decubate-placing` | `VERDICT_WITHDRAWN` | `VERDICT_WITHDRAWN` |
| `bitpanda-old` | `VERDICT_UNVERIFIED` | `VERDICT_UNVERIFIED` |
| `tesco` | `VERDICT_NOT_LISTED` | `VERDICT_NOT_LISTED` |
| `bybit-lookalike` | `VERDICT_UNVERIFIED` | `VERDICT_UNVERIFIED` |
| `bybit-unchecked` | `NO_SNAPSHOT` | `NO_SNAPSHOT` |

## What the live run does and does not show

- **The diff chain shows no change.** ESMA's register did not change between a firm's snapshots (it stayed dated 2026-09-29), so the live diffs read `no change in any state`. States gained and lost, a changed entries digest and a moving register date are exercised with synthetic edits to real rows in `tests/test_passport_map.py`.
- **`WARNING_LISTED`** was not run live (it needs a firm quoted from a site on ESMA's warning list, which the differential tests cover: `bybit LEI from an ESMA-warned site`, 30 states).
- **The gate's cross-contract calls** can't run in genlayer-test's Direct Mode, so the allowed and refused listings and settlements above are their test.
- **`STALE_REGISTER` was shown live** by reading with a deliberately tight limit (table 5), not by waiting for ESMA to stop updating.

## One record the log is missing

HPB's chain is `#2 → #10 → #11`. An earlier run of the same script (moved to the background by its terminal) had already recorded snapshot `#10` on-chain before it could log it, so the log holds the transaction for `#11` but not `#10`. Both are on the chain; the explorer lists them under the PassportMap address.
