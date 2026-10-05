# Test fixture provenance

Captured 2026-09-30 by `scripts/build_fixtures.py`.

## ESMA interim MiCA register (source: European Securities and Markets Authority)

- `CASPS.csv` - https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv (Last-Modified: Thu, 24 Sep 2026 06:44:41 GMT)
- `NCASP.csv` - https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv (Last-Modified: Thu, 24 Sep 2026 06:45:10 GMT)

Reproduced unmodified, with acknowledgement of the source. Regulatory data about
companies only - no personal data.

## GLEIF (https://api.gleif.org/api/v1/lei-records/<lei>)

- `5299005V5GBSN2A4C303` - Bybit EU GmbH (AT) - authorised, no comment
- `5493007WZ7IFULIL8G21` - Bitpanda GmbH (AT) - the LEI ESMA lists; RETIRED at GLEIF, with a successor
- `98450086582EV2FFC109` - Bitpanda GmbH - its current LEI, which ESMA's register does not list
- `529900D5G4V6THXC5P79` - Hrvatska postanska banka (HR) - comment limits services to one fund
- `254900XFMACGD0L7AI73` - UAB BLUE EMI LT (LT) - comment limits services to its own e-money token
- `743700CHRVVP342JOA67` - NorthCrypto Oy (FI) - comment is administrative only
- `894500ZVOL3A9LO8LN34` - Decubate B.V. (NL) - authorisation withdrawn 26/03/2026
- `984500F14CA4571AAC11` - Coinbase Luxembourg S.A. (LU) - register website typo 'https.//coinbase.com'
- `2138002P5RNKC5W2JZ46` - TESCO PLC - a real, current LEI that is not a CASP
- `213800GIFQMSV7HROS23` - eToro (Europe) Ltd (CY) - passports Greece as 'EL', not 'GR'
- `54930069NLWEIGLHXU42` - OKX Europe Limited (MT) - home state Malta missing from its own passport list
- `5299005I4LYIFW7GKB54` - AMINA (Austria) AG (AT) - passport list says 'SL' where Slovenia is 'SI'
- `54930079HJ1JTMKTW637` - Bankhaus Scheich (DE) - service letters shifted against their descriptions
- `213800V83W83UL8WR118` - Ronin EM Ltd (CY) - services described in prose, no letters at all
