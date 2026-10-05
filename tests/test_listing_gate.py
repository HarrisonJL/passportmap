"""
Direct Mode tests for ListingGate.

Direct Mode can't simulate cross-contract calls without a "glsim" hook (the
same documented limitation as this account's earlier consumers), so the
calls to PassportMap's get_coverage() are proven live instead: allowed and
refused listings and settlements, with PassportMap's reason in each revert
message (CONTRACT.md). What is tested here is every check that runs before
that call.
"""

import pytest

PASSPORT = "0x" + "55" * 20  # never actually called in these tests


def _deploy(direct_vm, direct_deploy, owner, max_age=86400, register_days=14):
    direct_vm.sender = owner
    return direct_deploy("contracts/listing_gate.py", PASSPORT, max_age, register_days)


def test_config_and_empty_state(direct_vm, direct_deploy, direct_owner):
    g = _deploy(direct_vm, direct_deploy, direct_owner)
    cfg = g.get_config()
    assert cfg["max_age_seconds"] == 86400 and cfg["max_register_age_days"] == 14
    assert cfg["listing_count"] == 0 and cfg["settlement_count"] == 0
    assert cfg["passport_address"].lower() == PASSPORT
    assert g.get_listings(0, 10) == [] and g.get_settlements(0, 10) == []


@pytest.mark.parametrize("max_age, register_days", [(0, 14), (86400, 0)])
def test_invalid_configuration_is_rejected(direct_vm, direct_deploy, direct_owner, max_age, register_days):
    with pytest.raises(Exception):
        _deploy(direct_vm, direct_deploy, direct_owner, max_age, register_days)


def test_only_the_owner_can_list_or_settle(direct_vm, direct_deploy, direct_owner, direct_alice):
    g = _deploy(direct_vm, direct_deploy, direct_owner)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="only the owner can list"):
        g.list_asset("bybit", "ETH", "DE")
    with pytest.raises(Exception, match="only the owner can settle"):
        g.settle("bybit", "ETH", "DE", 100)


@pytest.mark.parametrize("call, message", [
    (lambda g: g.list_asset("bybit", "", "DE"), "asset must be"),
    (lambda g: g.list_asset("bybit", "ETH/USD", "DE"), "asset must be"),
    (lambda g: g.list_asset("bybit", "A" * 13, "DE"), "asset must be"),
    (lambda g: g.list_asset("bybit", "ETH", "US"), "EU/EEA"),
    (lambda g: g.list_asset("bybit", "ETH", ""), "EU/EEA"),
    (lambda g: g.settle("bybit", "ETH", "US", 1), "EU/EEA"),
    (lambda g: g.settle("bybit", "ETH", "DE", 0), "amount must be positive"),
    (lambda g: g.settle("bybit", "ETH", "DE", 100), "asset not listed"),
    (lambda g: g.get_listing("bybit", "ETH", "DE"), "asset not listed"),
])
def test_invalid_calls_are_rejected_before_any_cross_contract_call(direct_vm, direct_deploy, direct_owner,
                                                                  call, message):
    g = _deploy(direct_vm, direct_deploy, direct_owner)
    with pytest.raises(Exception, match=message):
        call(g)


def test_list_asset_reaches_passportmap_which_direct_mode_cannot_simulate(direct_vm, direct_deploy, direct_owner):
    # Documented, not silently skipped: a valid list_asset() - lower-case
    # asset, "EL" for Greece - goes on to gl.get_contract_at(...).view()
    # .get_coverage(...), which needs glsim.
    g = _deploy(direct_vm, direct_deploy, direct_owner)
    with pytest.raises(Exception) as excinfo:
        g.list_asset("bybit", "eth", "el")
    assert "asset must be" not in str(excinfo.value) and "EU/EEA" not in str(excinfo.value)
    assert g.get_config()["listing_count"] == 0
