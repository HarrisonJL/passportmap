"""
Captures the real ESMA register files and GLEIF records the tests run
against, so the contract is tested on the genuine, messy register - not a
tidied-up imitation of it.

- tests/fixtures/CASPS.csv  - ESMA interim MiCA register: authorised CASPs
- tests/fixtures/NCASP.csv  - ESMA interim MiCA register: non-compliant entities
- tests/fixtures/gleif_<LEI>.json - GLEIF level-1 records

ESMA content is reproduced with acknowledgement of the source, as ESMA's
legal notice permits. Both files contain only regulatory data about
companies (names, LEIs, authorities, services) - no personal data.

Usage (from the repo root):  python3 scripts/build_fixtures.py
"""

import datetime
import json
import pathlib
import urllib.error
import urllib.request

CASPS_URL = "https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv"
NCASP_URL = "https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv"
GLEIF = "https://api.gleif.org/api/v1/lei-records/"
OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures"

LEIS = {
    "5299005V5GBSN2A4C303": "Bybit EU GmbH (AT) - authorised, no comment",
    "5493007WZ7IFULIL8G21": "Bitpanda GmbH (AT) - the LEI ESMA lists; RETIRED at GLEIF, with a successor",
    "98450086582EV2FFC109": "Bitpanda GmbH - its current LEI, which ESMA's register does not list",
    "529900D5G4V6THXC5P79": "Hrvatska postanska banka (HR) - comment limits services to one fund",
    "254900XFMACGD0L7AI73": "UAB BLUE EMI LT (LT) - comment limits services to its own e-money token",
    "743700CHRVVP342JOA67": "NorthCrypto Oy (FI) - comment is administrative only",
    "894500ZVOL3A9LO8LN34": "Decubate B.V. (NL) - authorisation withdrawn 26/03/2026",
    "984500F14CA4571AAC11": "Coinbase Luxembourg S.A. (LU) - register website typo 'https.//coinbase.com'",
    "2138002P5RNKC5W2JZ46": "TESCO PLC - a real, current LEI that is not a CASP",
    "213800GIFQMSV7HROS23": "eToro (Europe) Ltd (CY) - passports Greece as 'EL', not 'GR'",
    "54930069NLWEIGLHXU42": "OKX Europe Limited (MT) - home state Malta missing from its own passport list",
    "5299005I4LYIFW7GKB54": "AMINA (Austria) AG (AT) - passport list says 'SL' where Slovenia is 'SI'",
    "54930079HJ1JTMKTW637": "Bankhaus Scheich (DE) - service letters shifted against their descriptions",
    "213800V83W83UL8WR118": "Ronin EM Ltd (CY) - services described in prose, no letters at all",
}


def fetch(url: str) -> tuple:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (fixture capture)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read(), resp.headers.get("last-modified", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), ""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    notes = []
    for name, url in (("CASPS.csv", CASPS_URL), ("NCASP.csv", NCASP_URL)):
        status, body, modified = fetch(url)
        assert status == 200, f"{url} -> {status}"
        (OUT / name).write_bytes(body)
        notes.append(f"- `{name}` - {url} (Last-Modified: {modified or 'n/a'})")
    for lei in LEIS:
        status, body, _ = fetch(GLEIF + lei)
        assert status == 200, f"GLEIF {lei} -> {status}"
        (OUT / f"gleif_{lei}.json").write_text(json.dumps(json.loads(body), indent=1))

    lines = [
        "# Test fixture provenance",
        "",
        f"Captured {datetime.date.today().isoformat()} by `scripts/build_fixtures.py`.",
        "",
        "## ESMA interim MiCA register (source: European Securities and Markets Authority)",
        "",
        *notes,
        "",
        "Reproduced unmodified, with acknowledgement of the source. Regulatory data about",
        "companies only - no personal data.",
        "",
        "## GLEIF (" + GLEIF + "<lei>)",
        "",
        *[f"- `{lei}` - {why}" for lei, why in LEIS.items()],
    ]
    (OUT / "PROVENANCE.md").write_text("\n".join(lines) + "\n")
    print(f"wrote fixtures to {OUT}")


if __name__ == "__main__":
    main()
