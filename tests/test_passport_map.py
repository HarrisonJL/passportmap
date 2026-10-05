"""
Tests for PassportMap using genlayer-test's Direct Mode.

Inputs are the REAL, unmodified ESMA interim MiCA register (tests/fixtures/
CASPS.csv and NCASP.csv, captured 24 September 2026 - see PROVENANCE.md)
and real GLEIF records, exactly as LicenceCheck v1's tests use them. The
register's own quirks are the test cases: Bybit's passport list lacks Malta,
OKX's home state (MT) is missing from its own list, AMINA's list says "SL"
where Slovenia is "SI", HPB is authorised in Croatia only. The few synthetic
cases (a passport added or removed, a future-dated register) edit one cell
of the real file, never invent one - and are marked where used.

Layers:
1. Registration and the rules.
2. The map on real firms - one snapshot, a verdict for every EU/EEA state.
3. Differential: for every real case, every state's verdict equals what
   LicenceCheck v1 (tests/reference/licence_check_v1.py, byte-identical to
   the deployed v1 source) gives for that (firm, services, state).
4. The register's snapshot date, and the diff history.
5. get_coverage / covers, including register staleness.
6. Consensus boundary via direct_vm.run_validator.
"""

import csv
import json
import pathlib
import re
import sys

import pytest

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
CASPS_URL = "https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv"
NCASP_URL = "https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv"
GLEIF = "https://api.gleif.org/api/v1/lei-records/"
NOW = "2026-09-30T12:00:00Z"
LLM_PATTERN = "interim MiCA register of"

BYBIT = "5299005V5GBSN2A4C303"  # AT; 29-state passport list without Malta
BITPANDA_LISTED = "5493007WZ7IFULIL8G21"  # RETIRED at GLEIF
HPB = "529900D5G4V6THXC5P79"  # HR only; comment: limited solely to one fund
BLUE_EMI = "254900XFMACGD0L7AI73"  # comment: own e-money token only
NORTHCRYPTO = "743700CHRVVP342JOA67"  # comment: administrative
DECUBATE = "894500ZVOL3A9LO8LN34"  # withdrawn 26/03/2026
COINBASE_LU = "984500F14CA4571AAC11"  # website written "https.//coinbase.com"
TESCO = "2138002P5RNKC5W2JZ46"  # real LEI, not a CASP
ETORO = "213800GIFQMSV7HROS23"  # Greece written "EL"
OKX = "54930069NLWEIGLHXU42"  # home MT missing from its passport list
AMINA = "5299005I4LYIFW7GKB54"  # Slovenia written "SL"
SCHEICH = "54930079HJ1JTMKTW637"  # letters shifted against descriptions

STATES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
          "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"]


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_bytes().decode("utf-8")


def _mock(direct_vm, url: str, body: str, status: int = 200) -> None:
    direct_vm.mock_web(re.escape(url) + "$", {"method": "GET", "status": status, "body": body})


def _serve(direct_vm, lei: str, casps=None, ncasp=None, gleif=None, casps_status=200, ncasp_status=200,
           gleif_status=200) -> None:
    _mock(direct_vm, CASPS_URL, casps if casps is not None else _fixture("CASPS.csv"), casps_status)
    _mock(direct_vm, NCASP_URL, ncasp if ncasp is not None else _fixture("NCASP.csv"), ncasp_status)
    if gleif is None and gleif_status == 200:
        gleif = _fixture(f"gleif_{lei}.json")
    _mock(direct_vm, GLEIF + lei, gleif if gleif is not None else "{}", gleif_status)


def _reader(direct_vm, entries: list) -> None:
    direct_vm.mock_llm(LLM_PATTERN, json.dumps({"entries": entries}))


def _entry(i: int, services: dict, restricts=False, evidence=None) -> dict:
    return {"entry": i, "services": services, "restricts": restricts, "evidence": evidence}


def _warp(direct_vm, timestamp: str) -> None:
    # genlayer-test 0.29.2's warp() refreshes only sender/origin in the SDK's
    # already-imported gl.message_raw, never its datetime - so after deploy
    # it alone never moves the clock the contract reads. Live GenVM hands
    # every call a fresh timestamp (confirmed on Studio Next - CONTRACT.md).
    direct_vm.warp(timestamp)
    gl = sys.modules.get("genlayer.gl")
    if gl is not None and getattr(gl, "message_raw", None) is not None:
        gl.message_raw["datetime"] = timestamp


def _deploy(direct_vm, direct_deploy, direct_owner, path="contracts/passport_map.py"):
    direct_vm.warp(NOW)
    direct_vm.sender = direct_owner
    contract = direct_deploy(path)
    _warp(direct_vm, NOW)
    return contract


def _snap(pm, direct_vm, firm_id: str, lei: str, llm_entries=None, **serve) -> dict:
    direct_vm.clear_mocks()
    _serve(direct_vm, lei, **serve)
    if llm_entries is not None:
        _reader(direct_vm, llm_entries)
    pm.snapshot(firm_id)
    return pm.latest_snapshot(firm_id)


def _verdicts(snap: dict) -> dict:
    return {s: v["verdict"] for s, v in snap["states"].items()}


def _states_with(snap: dict, verdict: str) -> list:
    return sorted(s for s, v in snap["states"].items() if v["verdict"] == verdict)


def _edit_row(casps: str, lei: str, old: str, new: str) -> str:
    """Edit one cell's text in the real register row carrying this LEI."""
    lines = casps.split("\r\n")
    hits = [i for i, line in enumerate(lines) if lei in line]
    assert len(hits) == 1, f"expected exactly one physical line for {lei}"
    assert old in lines[hits[0]], f"row for {lei} no longer contains {old!r}"
    lines[hits[0]] = lines[hits[0]].replace(old, new, 1)
    return "\r\n".join(lines)


# --- 1. Registration and the rules --------------------------------------------


def test_initial_state_rules_and_catalogue(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    assert pm.get_state() == {"firm_count": 0, "snapshot_count": 0}
    assert pm.get_rules()["states"] == STATES and len(STATES) == 30
    assert sorted(pm.service_catalogue()) == list("abcdefghij")
    assert pm.get_map("nope") == {} and pm.list_firms() == []


def test_register_normalises_every_input(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit-1", BYBIT.lower(), "C, a", "https://www.Bybit.eu/en/", "Bybit EU")
    f = pm.get_firm("bybit-1")
    assert (f["lei"], f["services"], f["website"], f["snapshot_count"]) == (BYBIT, "ac", "bybit.eu", 0)
    assert pm.get_sources("bybit-1") == [CASPS_URL, NCASP_URL, GLEIF + BYBIT]
    assert pm.get_map("bybit-1") == {} and pm.get_history("bybit-1", 10) == []
    assert pm.latest_snapshot("bybit-1") == {"firm_id": "bybit-1", "states": {}}
    assert pm.list_firms() == [{"firm_id": "bybit-1", "label": "Bybit EU", "lei": BYBIT, "services": "ac",
                                "snapshot_count": 0}]


@pytest.mark.parametrize("field,value", [
    ("firm_id", ""), ("firm_id", "x" * 33), ("firm_id", "has space"), ("firm_id", "a/b"),
    ("lei", BYBIT[:-1] + ("1" if BYBIT[-1] != "1" else "2")),  # one-digit typo: checksum fails
    ("lei", "5299005V5GBSN2A4C30"),  # 19 characters
    ("services", ""), ("services", "k"), ("services", "a;b"), ("services", ", ,"),
    ("website", "not a host"), ("website", "https://" + "a" * 210 + ".eu"),
    ("label", ""), ("label", "x" * 101),
])
def test_register_rejects_malformed_input(direct_vm, direct_deploy, direct_owner, field, value):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    args = {"firm_id": "f1", "lei": BYBIT, "services": "a", "website": "", "label": "x"}
    args[field] = value
    with pytest.raises(Exception):
        pm.register_firm(*args.values())


def test_register_rejects_duplicates_and_snapshot_rejects_unknown(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("f1", BYBIT, "a", "", "x")
    with pytest.raises(Exception, match="already registered"):
        pm.register_firm("f1", OKX, "b", "", "y")
    with pytest.raises(Exception, match="unknown firm_id"):
        pm.snapshot("nope")


# --- 2. The map on real firms ----------------------------------------------------


def test_bybit_is_authorised_everywhere_it_passported_except_malta(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, "a,c", "https://www.bybit.eu", "Bybit EU")
    s = _snap(pm, direct_vm, "bybit", BYBIT, [_entry(0, {"a": True, "c": True})])
    assert _states_with(s, "AUTHORISED") == sorted(set(STATES) - {"MT"})
    assert s["states"]["MT"] == {"verdict": "NOT_AUTHORISED", "reasons": ["service_not_covered:a", "service_not_covered:c"]}
    assert s["states"]["DE"] == {"verdict": "AUTHORISED", "reasons": []}
    assert s["entity_name"] == "Bybit EU GmbH" and s["restriction_evidence"] == ""
    assert s["previous_id"] is None and s["diff"] == {"baseline": True}
    assert pm.get_map("bybit") == _verdicts(s)
    assert sum(1 for v in pm.get_map("bybit").values() if v == "AUTHORISED") == 29


def test_okx_home_state_counts_even_when_missing_from_its_own_list_and_el_is_greece(
        direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("okx", OKX, "b", "", "OKX Europe")
    s = _snap(pm, direct_vm, "okx", OKX, [_entry(0, {"b": True})])
    assert s["states"]["MT"]["verdict"] == "AUTHORISED"  # home state, absent from the passport list
    assert s["states"]["GR"]["verdict"] == "AUTHORISED"  # listed as "EL"
    assert _states_with(s, "AUTHORISED") == sorted(STATES)  # all 30


def test_amina_slovenia_written_sl_is_unverified_not_guessed(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("amina", AMINA, "a", "", "AMINA")
    s = _snap(pm, direct_vm, "amina", AMINA, [_entry(0, {"a": True})])
    assert s["states"]["SI"] == {"verdict": "UNVERIFIED", "reasons": ["service_ambiguous:a"]}
    assert s["states"]["DE"]["verdict"] == "AUTHORISED"
    assert _states_with(s, "UNVERIFIED") == ["SI"]


def test_hpb_is_restricted_in_its_home_state_and_nowhere_else(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("hpb", HPB, "a", "", "HPB")
    quote = "limited solely to a Passive Digital Assets (PDA) AIF"
    s = _snap(pm, direct_vm, "hpb", HPB, [_entry(0, {"a": True}, restricts=True, evidence=quote)])
    assert _states_with(s, "AUTHORISED_RESTRICTED") == ["HR"]
    assert _states_with(s, "NOT_AUTHORISED") == sorted(set(STATES) - {"HR"})
    assert s["restriction_evidence"] == quote


@pytest.mark.parametrize("lei, services, verdict, serve", [
    (DECUBATE, "f", "WITHDRAWN", {}),
    (TESCO, "a", "NOT_LISTED", {}),
])
def test_a_firm_that_is_not_authorised_anywhere_is_the_same_in_every_state(
        direct_vm, direct_deploy, direct_owner, lei, services, verdict, serve):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("f", lei, services, "", "x")
    s = _snap(pm, direct_vm, "f", lei, **serve)  # no LLM mock: nothing live to read
    assert set(_verdicts(s).values()) == {verdict} and len(s["states"]) == 30


def test_a_retired_lei_is_unverified_in_every_state_and_names_the_successor(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bp", BITPANDA_LISTED, "a", "", "Bitpanda")
    s = _snap(pm, direct_vm, "bp", BITPANDA_LISTED, [_entry(0, {"a": True})])
    assert set(_verdicts(s).values()) == {"UNVERIFIED"}
    assert "successor_98450086582EV2FFC109" in s["states"]["DE"]["reasons"][0]


def test_a_look_alike_website_blocks_the_whole_map(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("clone", BYBIT, "a", "https://fakebybit.eu", "look-alike")
    s = _snap(pm, direct_vm, "clone", BYBIT, [_entry(0, {"a": True})])
    # The website doesn't match the register for ANY state, so every state is
    # unverified - except Malta, where "not passported" is the more severe finding.
    assert _states_with(s, "UNVERIFIED") == sorted(set(STATES) - {"MT"})
    assert s["states"]["MT"]["verdict"] == "NOT_AUTHORISED"
    assert s["states"]["DE"]["reasons"] == ["website_not_in_register"]


def test_coinbase_luxembourg_with_a_malformed_website_in_the_register(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("cb", COINBASE_LU, "a", "https://www.coinbase.com", "Coinbase LU")
    s = _snap(pm, direct_vm, "cb", COINBASE_LU, [_entry(0, {"a": True})])
    assert s["states"]["LU"]["verdict"] == "AUTHORISED" and s["facts"]["website_listed"] is True


def test_a_map_records_that_it_covers_every_state_not_one(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, "a", "", "Bybit EU")
    s = _snap(pm, direct_vm, "bybit", BYBIT, [_entry(0, {"a": True})])
    assert s["facts"]["member_state"] == "ALL"
    assert list(s["states"]) == sorted(STATES)  # JSON keys sorted; all 30 present


# --- 3. Differential: every state equals LicenceCheck v1 ---------------------------

NORTHCRYPTO_ADMIN = [_entry(0, {"a": True})]
HPB_QUOTE = "limited solely to a Passive Digital Assets (PDA) AIF"
BLUE_QUOTE = "in relation to own issued EMT called BLUEUR"
DIFFERENTIAL_CASES = {
    "bybit custody+fiat with website": (BYBIT, "ac", "https://www.bybit.eu", [_entry(0, {"a": True, "c": True})], {}),
    "bybit trading platform (LLM says absent)": (BYBIT, "b", "", [_entry(0, {"b": False})], {}),
    "bybit LLM claims a service the text lacks": (BYBIT, "b", "", [_entry(0, {"b": True})], {}),
    "okx trading platform": (OKX, "b", "", [_entry(0, {"b": True})], {}),
    "etoro custody (Greece as EL)": (ETORO, "a", "", [_entry(0, {"a": True})], {}),
    "amina custody (Slovenia as SL)": (AMINA, "a", "", [_entry(0, {"a": True})], {}),
    "hpb restricted": (HPB, "a", "", [_entry(0, {"a": True}, restricts=True, evidence=HPB_QUOTE)], {}),
    "hpb restriction without a real quote": (HPB, "a", "",
                                              [_entry(0, {"a": True}, restricts=True, evidence="institutional only")], {}),
    "blue emi restricted": (BLUE_EMI, "a", "", [_entry(0, {"a": True}, restricts=True, evidence=BLUE_QUOTE)], {}),
    "northcrypto administrative comment": (NORTHCRYPTO, "a", "", NORTHCRYPTO_ADMIN, {}),
    "scheich portfolio management (letters shifted)": (SCHEICH, "i", "", [_entry(0, {"i": True})], {}),
    "bitpanda under the retired LEI": (BITPANDA_LISTED, "a", "", [_entry(0, {"a": True})], {}),
    "decubate withdrawn": (DECUBATE, "f", "", None, {}),
    "tesco not a CASP": (TESCO, "a", "", None, {}),
    "bybit LEI from a look-alike site": (BYBIT, "a", "https://fakebybit.eu", [_entry(0, {"a": True})], {}),
    "bybit LEI from an ESMA-warned site": (BYBIT, "a", "https://www.bank-bit.com", [_entry(0, {"a": True})], {}),
    "coinbase luxembourg": (COINBASE_LU, "a", "https://www.coinbase.com", [_entry(0, {"a": True})], {}),
    "warning list unavailable": (BYBIT, "a", "", [_entry(0, {"a": True})], {"ncasp": "err", "ncasp_status": 500}),
    "gleif unknown": (BYBIT, "a", "", [_entry(0, {"a": True})], {"gleif_status": 404}),
    "register unreachable": (BYBIT, "a", "", None, {"casps": "err", "casps_status": 503}),
}


# SYNTHETIC edits of one real row (marked as such): a withdrawal date still in
# the future, one that has passed, an unparseable one, and a passport list
# with Germany removed.
_REAL_CASPS = _fixture("CASPS.csv")
EDITED_REGISTER_CASES = {
    "SYNTHETIC withdrawal scheduled for 31/12/2026": (
        BYBIT, "a", "", [_entry(0, {"a": True})],
        {"casps": _edit_row(_REAL_CASPS, BYBIT, ",28/05/2025,,", ",28/05/2025,31/12/2026,")}),
    "SYNTHETIC withdrawn on 01/09/2026": (
        BYBIT, "a", "", [_entry(0, {"a": True})],
        {"casps": _edit_row(_REAL_CASPS, BYBIT, ",28/05/2025,,", ",28/05/2025,01/09/2026,")}),
    "SYNTHETIC unparseable end date": (
        BYBIT, "a", "", [_entry(0, {"a": True})],
        {"casps": _edit_row(_REAL_CASPS, BYBIT, ",28/05/2025,,", ",28/05/2025,TBC,")}),
    "SYNTHETIC Germany dropped from the passport list": (
        BYBIT, "a", "", [_entry(0, {"a": True})], {"casps": _edit_row(_REAL_CASPS, BYBIT, "DE|", "")}),
}
def _gleif(registration_status: str, entity_status: str) -> str:
    doc = json.loads(_fixture(f"gleif_{BYBIT}.json"))
    doc["data"]["attributes"]["registration"]["status"] = registration_status
    doc["data"]["attributes"]["entity"]["status"] = entity_status
    return json.dumps(doc)


RONIN = "213800V83W83UL8WR118"  # entry with no letters at all, only prose
_BYBIT_ROW = next(line for line in _REAL_CASPS.split("\r\n") if BYBIT in line)
# More differential cases: v1's identity, truncation, reshaping and wording
# scenarios, each run against all 30 states. The edits are SYNTHETIC.
EDGE_CASES = {
    "gleif LAPSED but entity ACTIVE": (BYBIT, "a", "", [_entry(0, {"a": True})], {"gleif": _gleif("LAPSED", "ACTIVE")}),
    "gleif RETIRED with entity ACTIVE": (BYBIT, "a", "", [_entry(0, {"a": True})], {"gleif": _gleif("RETIRED", "ACTIVE")}),
    "gleif ANNULLED with entity ACTIVE": (BYBIT, "a", "", [_entry(0, {"a": True})], {"gleif": _gleif("ANNULLED", "ACTIVE")}),
    "gleif ISSUED but entity INACTIVE": (BYBIT, "a", "", [_entry(0, {"a": True})], {"gleif": _gleif("ISSUED", "INACTIVE")}),
    "gleif record for a different LEI": (BYBIT, "a", "", [_entry(0, {"a": True})],
                                          {"gleif": _fixture(f"gleif_{ETORO}.json")}),
    "SYNTHETIC eleven register rows for one LEI": (
        BYBIT, "a", "", [_entry(i, {"a": True}) for i in range(10)],
        {"casps": _REAL_CASPS.rstrip("\r\n") + "\r\n" + "\r\n".join([_BYBIT_ROW] * 10) + "\r\n"}),
    "SYNTHETIC reshaped register (a column renamed)": (
        BYBIT, "a", "", None, {"casps": _REAL_CASPS.replace("ac_serviceCode,", "ac_services,", 1)}),
    "malformed LLM answer can only withhold": (BYBIT, "a", "", [{"entry": 0, "services": {"a": "yes"}}], {}),
    "ronin: prose-only entry, services b c d": (RONIN, "bcd", "", [_entry(0, {"b": False, "c": True, "d": True})], {}),
    "SYNTHETIC ronin: crypto-for-fiat alone is not crypto-for-crypto": (
        RONIN, "cd", "", [_entry(0, {"c": True, "d": False})],
        {"casps": _edit_row(_REAL_CASPS, RONIN, "Exchange between crypto assets/ ", "")}),
}
ALL_CASES = {**DIFFERENTIAL_CASES, **EDITED_REGISTER_CASES, **EDGE_CASES}
REFERENCE = pathlib.Path(__file__).parent / "reference"


def _v1_expected() -> dict:
    return json.loads((REFERENCE / "v1_expected.json").read_text())


def _run_case(pm, direct_vm, lei, services, website, llm, serve):
    direct_vm.clear_mocks()
    _serve(direct_vm, lei, **serve)
    if llm is not None:
        _reader(direct_vm, llm)
    pm.register_firm("f", lei, services, website, "x")
    pm.snapshot("f")
    return pm.latest_snapshot("f")


def test_the_reference_is_the_licencecheck_v1_source_the_expectations_came_from():
    import hashlib
    expected = _v1_expected()
    assert expected["reference_sha256"] == hashlib.sha256((REFERENCE / "licence_check_v1.py").read_bytes()).hexdigest()
    assert expected["register_sha256"] == hashlib.sha256((FIXTURES / "CASPS.csv").read_bytes()).hexdigest()
    assert sorted(expected["cases"]) == sorted(ALL_CASES) and expected["states"] == STATES


@pytest.mark.parametrize("name", list(ALL_CASES))
def test_every_states_verdict_equals_licencecheck_v1(direct_vm, direct_deploy, direct_owner, name):
    # tests/reference/v1_expected.json holds what LicenceCheck v1's own code
    # returned, for this firm and these services, once per state - generated
    # by tests/reference/generate_v1_expected.py (one contract per process:
    # genlayer-test's loader allows only one).
    lei, services, website, llm, serve = ALL_CASES[name]
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    snap = _run_case(pm, direct_vm, lei, services, website, llm, serve)
    assert snap["states"] == _v1_expected()["cases"][name]


# --- 4. The register's snapshot date, and the diff history ---------------------------


def _bybit(direct_vm, direct_deploy, direct_owner, services="a"):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, services, "", "Bybit EU")
    return pm


def _snap_bybit(pm, direct_vm, casps=None, services="a"):
    kw = {"casps": casps} if casps is not None else {}
    return _snap(pm, direct_vm, "bybit", BYBIT, [_entry(0, {"a": True, "c": True, "b": False})], **kw)


def test_the_snapshot_records_the_registers_own_date_and_ignores_a_future_one(direct_vm, direct_deploy, direct_owner):
    pm = _bybit(direct_vm, direct_deploy, direct_owner)
    s = _snap_bybit(pm, direct_vm)
    # The newest genuine "last update" in the file. One row (REGULAR FINANCE
    # SAS) is dated 11/09/2028 - a future date that must not count.
    assert s["register_as_of"] == "2026-09-22" == s["facts"]["register_as_of"]
    assert re.fullmatch(r"[0-9a-f]{64}", s["entries_digest"])
    assert s["checked_at"].startswith("2026-09-30T12:00:00")


def test_a_register_with_no_usable_date_records_none(direct_vm, direct_deploy, direct_owner):
    # SYNTHETIC: every row's "last update" set to a future date.
    rows = list(csv.reader([l for l in re.split(r"(?<=\n)", _REAL_CASPS.lstrip("﻿")) if l]))
    col = rows[0].index("ac_lastupdate")
    for r in rows[1:]:
        if len(r) > col:
            r[col] = "01/01/2099"
    out = []
    writer = csv.writer(_Sink(out), lineterminator="\r\n")
    writer.writerows(rows)
    pm = _bybit(direct_vm, direct_deploy, direct_owner)
    s = _snap_bybit(pm, direct_vm, casps="".join(out))
    assert s["register_as_of"] == "" and s["states"]["DE"]["verdict"] == "AUTHORISED"


class _Sink:
    def __init__(self, parts):
        self.parts = parts

    def write(self, text):
        self.parts.append(text)


def test_inserting_an_unrelated_row_moves_row_numbers_but_not_the_digest(direct_vm, direct_deploy, direct_owner):
    pm = _bybit(direct_vm, direct_deploy, direct_owner)
    first = _snap_bybit(pm, direct_vm)
    lines = _REAL_CASPS.split("\r\n")
    shifted = "\r\n".join(lines[:1] + [lines[1]] + lines[1:])  # SYNTHETIC: one more row above Bybit's
    second = _snap_bybit(pm, direct_vm, casps=shifted)
    assert second["facts"]["entries"][0]["row"] == first["facts"]["entries"][0]["row"] + 1
    assert second["entries_digest"] == first["entries_digest"]
    assert second["diff"]["register_entries_changed"] is False


def test_the_first_snapshot_is_a_baseline_and_an_identical_one_is_unchanged(direct_vm, direct_deploy, direct_owner):
    pm = _bybit(direct_vm, direct_deploy, direct_owner)
    first = _snap_bybit(pm, direct_vm)
    assert first["diff"] == {"baseline": True} and first["previous_id"] is None
    second = _snap_bybit(pm, direct_vm)
    assert second["previous_id"] == 0
    assert second["diff"] == {
        "baseline": False, "register_as_of": ["2026-09-22", "2026-09-22"], "register_entries_changed": False,
        "authorised_count": [29, 29], "gained": [], "lost": [], "changed": {}}


def test_a_passport_added_then_removed_shows_as_gained_then_lost(direct_vm, direct_deploy, direct_owner):
    pm = _bybit(direct_vm, direct_deploy, direct_owner)
    _snap_bybit(pm, direct_vm)
    with_malta = _edit_row(_REAL_CASPS, BYBIT, "DE|", "DE|MT|")  # SYNTHETIC
    s = _snap_bybit(pm, direct_vm, casps=with_malta)
    assert s["diff"]["gained"] == ["MT"] and s["diff"]["lost"] == [] and s["diff"]["authorised_count"] == [29, 30]
    assert s["diff"]["changed"] == {}  # a gain is listed once, as a gain
    assert s["diff"]["register_entries_changed"] is True
    assert s["states"]["MT"]["verdict"] == "AUTHORISED"
    no_germany = _edit_row(_REAL_CASPS, BYBIT, "DE|", "")  # SYNTHETIC: DE gone, and MT is back to unlisted
    s = _snap_bybit(pm, direct_vm, casps=no_germany)
    assert s["diff"]["lost"] == ["DE", "MT"] and s["diff"]["gained"] == [] and s["diff"]["authorised_count"] == [30, 28]
    assert s["diff"]["changed"] == {}  # ... and a loss once, as a loss


def test_other_verdict_changes_are_recorded_per_state(direct_vm, direct_deploy, direct_owner):
    pm = _bybit(direct_vm, direct_deploy, direct_owner)
    unparseable = _edit_row(_REAL_CASPS, BYBIT, ",28/05/2025,,", ",28/05/2025,TBC,")  # SYNTHETIC
    first = _snap_bybit(pm, direct_vm, casps=unparseable)
    assert first["states"]["DE"]["verdict"] == "UNVERIFIED"
    withdrawn = _edit_row(_REAL_CASPS, BYBIT, ",28/05/2025,,", ",28/05/2025,01/09/2026,")  # SYNTHETIC
    s = _snap_bybit(pm, direct_vm, casps=withdrawn)
    assert s["diff"]["gained"] == [] and s["diff"]["lost"] == []
    assert s["diff"]["changed"]["DE"] == ["UNVERIFIED", "WITHDRAWN"]
    assert s["diff"]["changed"]["MT"] == ["NOT_AUTHORISED", "WITHDRAWN"] and len(s["diff"]["changed"]) == 30
    assert s["diff"]["register_entries_changed"] is True  # the end date moved


def test_a_newer_register_date_alone_is_not_a_change_to_the_firm(direct_vm, direct_deploy, direct_owner):
    pm = _bybit(direct_vm, direct_deploy, direct_owner)
    _snap_bybit(pm, direct_vm)
    other = _edit_row(_REAL_CASPS, HPB, re.search(r"\d\d/\d\d/2026(?=,?\"?\r?$)", _REAL_CASPS.split("\r\n")[
        next(i for i, l in enumerate(_REAL_CASPS.split("\r\n")) if HPB in l)]).group(0), "29/09/2026")  # SYNTHETIC
    s = _snap_bybit(pm, direct_vm, casps=other)
    assert s["diff"]["register_as_of"] == ["2026-09-22", "2026-09-29"]
    assert s["diff"]["register_entries_changed"] is False and s["diff"]["gained"] == s["diff"]["lost"] == []


def test_a_regulator_comment_changing_alone_is_a_change_to_the_firms_entries(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("nc", NORTHCRYPTO, "a", "", "NorthCrypto")
    _snap(pm, direct_vm, "nc", NORTHCRYPTO, [_entry(0, {"a": True})])
    edited = _edit_row(_REAL_CASPS, NORTHCRYPTO, "Passporting information updated",
                       "Passporting information updated and scope reviewed")  # SYNTHETIC: only the comment differs
    s = _snap(pm, direct_vm, "nc", NORTHCRYPTO, [_entry(0, {"a": True})], casps=edited)
    assert s["diff"]["register_entries_changed"] is True
    assert s["diff"]["gained"] == s["diff"]["lost"] == [] and s["diff"]["changed"] == {}


def test_history_walks_one_firms_own_chain_among_others(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, "a", "", "Bybit EU")
    pm.register_firm("hpb", HPB, "a", "", "HPB")
    for firm, lei in (("bybit", BYBIT), ("hpb", HPB), ("bybit", BYBIT), ("hpb", HPB), ("bybit", BYBIT)):
        _snap(pm, direct_vm, firm, lei, [_entry(0, {"a": True})])
    history = pm.get_history("bybit", 10)
    assert [h["snapshot_id"] for h in history] == [4, 2, 0] and [h["previous_id"] for h in history] == [2, 0, None]
    assert {h["firm_id"] for h in history} == {"bybit"}
    assert [h["snapshot_id"] for h in pm.get_history("hpb", 10)] == [3, 1]
    assert [h["snapshot_id"] for h in pm.get_history("bybit", 2)] == [4, 2] and pm.get_history("bybit", 0) == []
    assert [s["snapshot_id"] for s in pm.get_snapshots(0, 10)] == [4, 3, 2, 1, 0]
    assert pm.get_snapshot(0)["firm_id"] == "bybit" and pm.get_state() == {"firm_count": 2, "snapshot_count": 5}
    with pytest.raises(Exception, match="unknown snapshot_id"):
        pm.get_snapshot(9)
    with pytest.raises(Exception, match="unknown firm_id"):
        pm.get_history("nope", 5)


# --- 5. get_coverage / covers -------------------------------------------------------


def _cov(pm, firm, state, age=3600, register_days=30):
    return pm.get_coverage(firm, state, age, register_days)


def test_coverage_reasons_in_order(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, "a", "", "Bybit EU")
    assert _cov(pm, "bybit", "DE") == {"firm_id": "bybit", "state": "DE", "covered": False, "reason": "NO_SNAPSHOT"}
    assert _cov(pm, "nope", "DE")["reason"] == "NO_SNAPSHOT"
    with pytest.raises(Exception, match="EU/EEA"):
        _cov(pm, "bybit", "US")
    _snap(pm, direct_vm, "bybit", BYBIT, [_entry(0, {"a": True})])
    c = _cov(pm, "bybit", "de")  # normalised
    assert c["covered"] is True and c["reason"] == "COVERED" and c["state"] == "DE"
    assert (c["snapshot_id"], c["register_as_of"], c["register_age_days"], c["verdict"]) == (0, "2026-09-22", 8, "AUTHORISED")
    assert pm.covers("bybit", "EL", 3600, 30) is True  # "EL" is Greece
    m = _cov(pm, "bybit", "MT")
    assert m["covered"] is False and m["reason"] == "VERDICT_NOT_AUTHORISED" and pm.covers("bybit", "MT", 10**9, 10**9) is False

    # The register's own date: 8 days old today.
    assert _cov(pm, "bybit", "DE", register_days=8)["reason"] == "COVERED"
    assert _cov(pm, "bybit", "DE", register_days=7)["reason"] == "STALE_REGISTER"
    # The check's age.
    _warp(direct_vm, "2026-09-30T14:00:00Z")
    assert _cov(pm, "bybit", "DE", age=3600)["reason"] == "STALE_CHECK"
    assert _cov(pm, "bybit", "DE", age=7201)["reason"] == "COVERED"
    # A failed verdict outranks staleness; a stale register outranks a stale check.
    assert _cov(pm, "bybit", "MT", age=1, register_days=0)["reason"] == "VERDICT_NOT_AUTHORISED"
    assert _cov(pm, "bybit", "DE", age=1, register_days=0)["reason"] == "STALE_REGISTER"


def test_a_restricted_authorisation_is_never_covered(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("hpb", HPB, "a", "", "HPB")
    _snap(pm, direct_vm, "hpb", HPB, [_entry(0, {"a": True}, restricts=True, evidence=HPB_QUOTE)])
    c = _cov(pm, "hpb", "HR", register_days=30)
    assert c["covered"] is False and c["reason"] == "VERDICT_AUTHORISED_RESTRICTED"  # a contract can't judge a scope limit


def test_coverage_follows_the_latest_snapshot(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, "a", "", "Bybit EU")
    _snap(pm, direct_vm, "bybit", BYBIT, [_entry(0, {"a": True})])
    assert pm.covers("bybit", "DE", 3600, 30) is True
    withdrawn = _edit_row(_REAL_CASPS, BYBIT, ",28/05/2025,,", ",28/05/2025,01/09/2026,")  # SYNTHETIC
    _snap(pm, direct_vm, "bybit", BYBIT, casps=withdrawn)
    c = _cov(pm, "bybit", "DE")
    assert c["covered"] is False and c["reason"] == "VERDICT_WITHDRAWN" and c["snapshot_id"] == 1


def test_a_register_with_no_date_is_not_trusted(direct_vm, direct_deploy, direct_owner):
    rows = list(csv.reader([l for l in re.split(r"(?<=\n)", _REAL_CASPS.lstrip("﻿")) if l]))
    col = rows[0].index("ac_lastupdate")
    for r in rows[1:]:
        if len(r) > col:
            r[col] = "01/01/2099"  # SYNTHETIC
    out = []
    csv.writer(_Sink(out), lineterminator="\r\n").writerows(rows)
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, "a", "", "Bybit EU")
    _snap(pm, direct_vm, "bybit", BYBIT, [_entry(0, {"a": True})], casps="".join(out))
    c = _cov(pm, "bybit", "DE", register_days=10**6)
    assert c["covered"] is False and c["reason"] == "REGISTER_DATE_UNKNOWN" and c["register_age_days"] == -1


# --- 6. Consensus boundary ------------------------------------------------------------


def _leader(direct_vm) -> dict:
    stored, _l, _v = direct_vm._captured_validators[-1]
    return json.loads(stored)


def _honest_hpb(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("hpb", HPB, "a", "", "HPB")
    _snap(pm, direct_vm, "hpb", HPB, [_entry(0, {"a": True}, restricts=True, evidence=HPB_QUOTE)])
    return pm


def test_validator_accepts_an_honest_leader(direct_vm, direct_deploy, direct_owner):
    _honest_hpb(direct_vm, direct_deploy, direct_owner)
    assert direct_vm.run_validator() is True


def test_validator_rejects_forged_register_facts_even_with_an_honest_reading(direct_vm, direct_deploy, direct_owner):
    _honest_hpb(direct_vm, direct_deploy, direct_owner)
    for tamper in (lambda f: f["entries"][0]["countries"].append("MT"),       # a passport that isn't there
                   lambda f: f["entries"][0].update(status="WITHDRAWN"),
                   lambda f: f.update(register_as_of="2026-09-29"),            # a fresher register than it read
                   lambda f: f["warnings"].append({"name": "HPB", "authority": "ESMA", "decision_date": "x",
                                                   "matched_on": "lei"})):  # a warning that was never issued
        leader = _leader(direct_vm)
        tamper(leader["facts"])
        assert direct_vm.run_validator(leader_result=json.dumps(leader)) is False


def test_validator_rejects_an_llm_reading_that_grants_what_its_own_does_not(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("bybit", BYBIT, "b", "", "Bybit EU")
    _snap(pm, direct_vm, "bybit", BYBIT, [_entry(0, {"b": False})])
    leader = _leader(direct_vm)
    leader["llm"][0]["services"]["b"] = True
    assert direct_vm.run_validator(leader_result=json.dumps(leader)) is False


def test_validator_rejects_a_hidden_restriction_and_a_fabricated_quote(direct_vm, direct_deploy, direct_owner):
    _honest_hpb(direct_vm, direct_deploy, direct_owner)
    hidden = _leader(direct_vm)
    hidden["llm"][0].update(restricts=False, evidence=None)
    assert direct_vm.run_validator(leader_result=json.dumps(hidden)) is False
    fabricated = _leader(direct_vm)
    fabricated["llm"][0]["evidence"] = "limited to institutional clients in Croatia"
    assert direct_vm.run_validator(leader_result=json.dumps(fabricated)) is False


def test_validator_rejects_an_invented_restriction_its_own_reader_does_not_share(direct_vm, direct_deploy,
                                                                                direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("nc", NORTHCRYPTO, "a", "", "NorthCrypto")
    _snap(pm, direct_vm, "nc", NORTHCRYPTO, [_entry(0, {"a": True})])  # an administrative comment: no restriction
    assert direct_vm.run_validator() is True
    leader = _leader(direct_vm)
    leader["llm"][0].update(restricts=True, evidence=None)
    assert direct_vm.run_validator(leader_result=json.dumps(leader)) is False


def test_validator_rejects_llm_output_where_none_was_needed(direct_vm, direct_deploy, direct_owner):
    pm = _deploy(direct_vm, direct_deploy, direct_owner)
    pm.register_firm("tesco", TESCO, "a", "", "Tesco")
    _snap(pm, direct_vm, "tesco", TESCO)
    assert direct_vm.run_validator() is True
    leader = _leader(direct_vm)
    leader["llm"] = [{"row": 1, "services": {"a": True}, "restricts": False, "evidence": None}]
    assert direct_vm.run_validator(leader_result=json.dumps(leader)) is False


def test_validator_rejects_misaligned_malformed_and_error_results(direct_vm, direct_deploy, direct_owner):
    _honest_hpb(direct_vm, direct_deploy, direct_owner)
    honest = _leader(direct_vm)
    for bad in ({**honest, "llm": []},                                   # a reading dropped
                {**honest, "llm": honest["llm"] + honest["llm"]},        # one invented
                {**honest, "llm": [dict(honest["llm"][0], row=999)]},    # for a different row
                {**honest, "llm": "no"}, {"facts": honest["facts"]}, [], "x"):
        assert direct_vm.run_validator(leader_result=json.dumps(bad)) is False
    assert direct_vm.run_validator(leader_result="not json") is False
    assert direct_vm.run_validator(leader_error=Exception("fetch failed")) is False


def test_a_leader_cannot_supply_the_map(direct_vm, direct_deploy, direct_owner):
    # The validator ignores everything but the facts and readings, and the
    # contract computes the map from those after consensus: a forged "states"
    # alongside honest evidence changes nothing about what is recorded.
    pm = _honest_hpb(direct_vm, direct_deploy, direct_owner)
    leader = _leader(direct_vm)
    leader["states"] = {s: {"verdict": "AUTHORISED", "reasons": []} for s in STATES}
    assert direct_vm.run_validator(leader_result=json.dumps(leader)) is True
    assert _states_with(pm.latest_snapshot("hpb"), "AUTHORISED") == []  # the recorded map is HPB's real one
