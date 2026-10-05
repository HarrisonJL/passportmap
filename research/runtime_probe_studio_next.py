# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

# Throwaway probe #2 - stdlib availability inside GenVM and whether
# gl.message.datetime is populated in a view call.

import genlayer as gl
from genlayer.types import *
from genlayer.storage import DynArray
import json
import datetime


class Probe2(gl.contract.Contract):
    results: DynArray[str]
    deployed_at: str

    def __init__(self) -> None:
        self.deployed_at = gl.message.datetime

    @gl.public.view
    def now_view(self) -> str:
        return gl.message.datetime

    @gl.public.view
    def age_seconds_view(self) -> int:
        now = datetime.datetime.fromisoformat(gl.message.datetime)
        then = datetime.datetime.fromisoformat(self.deployed_at)
        return int((now - then).total_seconds())

    @gl.public.write
    def parse_csv(self, url: str) -> None:
        def leader_fn() -> str:
            import csv
            import io
            import re
            import html
            r = gl.nondet.web.get(url)
            text = r.body.decode("utf-8-sig")
            rows = list(csv.reader(io.StringIO(text)))
            return json.dumps({
                "rows": len(rows), "cols": len(rows[0]),
                "unescape": html.unescape("A &amp; B &#39;x&#39;"),
                "re": bool(re.fullmatch(r"[A-Z0-9]{18}[0-9]{2}", "5493007WZ7IFULIL8G21")),
                "mod97": int("".join(str(int(ch, 36)) for ch in "5493007WZ7IFULIL8G21")) % 97,
            })

        def validator_fn(leaders_res) -> bool:
            return isinstance(leaders_res, gl.vm.Return)

        self.results.append(gl.vm.run_nondet(leader_fn, validator_fn))

    @gl.public.view
    def get_results(self) -> list:
        return [r for r in self.results]
