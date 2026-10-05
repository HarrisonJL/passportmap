"""
Generates tests/reference/v1_expected.json: what LicenceCheck v1's own code
(tests/reference/licence_check_v1.py) returns for each differential case,
once per EU/EEA state. Run on its own (genlayer-test's loader allows one
contract per process, so it can't share a run with PassportMap):

    .venv/bin/pytest tests/reference/generate_v1_expected.py -q

then `git diff tests/reference/v1_expected.json` shows whether v1's answers
changed. test_passport_map.py compares PassportMap with this file and checks
it was generated from this exact reference source and register.
"""

import hashlib
import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

from test_passport_map import ALL_CASES, FIXTURES, NOW, STATES, _deploy, _reader, _serve, _warp  # noqa: E402


def test_generate_v1_expected(direct_vm, direct_deploy, direct_owner):
    lc = _deploy(direct_vm, direct_deploy, direct_owner, "tests/reference/licence_check_v1.py")
    _warp(direct_vm, NOW)
    out = {}
    for name, (lei, services, website, llm, serve) in ALL_CASES.items():
        direct_vm.clear_mocks()
        _serve(direct_vm, lei, **serve)
        if llm is not None:
            _reader(direct_vm, llm)
        states = {}
        for state in STATES:
            iid = f"{abs(hash(name)) % 10**8}-{state}"
            lc.register_inquiry(iid, lei, services, state, website, "x")
            lc.attest(iid)
            c = lc.latest_check(iid)
            states[state] = {"verdict": c["verdict"], "reasons": c["reasons"]}
        out[name] = states
    doc = {
        "generated_by": "tests/reference/generate_v1_expected.py",
        "reference_sha256": hashlib.sha256((HERE / "licence_check_v1.py").read_bytes()).hexdigest(),
        "register_sha256": hashlib.sha256((FIXTURES / "CASPS.csv").read_bytes()).hexdigest(),
        "now": NOW,
        "states": STATES,
        "cases": out,
    }
    (HERE / "v1_expected.json").write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n")
    assert len(out) == len(ALL_CASES)
