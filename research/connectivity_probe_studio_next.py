# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

# Throwaway connectivity probe - not a submission. Records what GenVM's
# fetchers actually return for each candidate data source.

import genlayer as gl
from genlayer.types import *
from genlayer.storage import DynArray
import json


class Probe(gl.contract.Contract):
    results: DynArray[str]

    def __init__(self) -> None:
        pass

    @gl.public.write
    def probe_get(self, url: str) -> None:
        def leader_fn() -> str:
            try:
                r = gl.nondet.web.get(url)
                body = r.body or b""
                text = body.decode("utf-8", "replace")
                return json.dumps({
                    "mode": "get", "url": url, "status": r.status, "len": len(body),
                    "head": text[:400], "tail": text[-300:],
                    "has_status_id": 'id="company-status"' in text,
                    "has_overdue": "overdue" in text,
                    "ctype": str(r.headers.get("content-type", b""))[:80],
                })
            except Exception as e:
                return json.dumps({"mode": "get", "url": url, "error": repr(e)[:600]})

        def validator_fn(leaders_res) -> bool:
            return isinstance(leaders_res, gl.vm.Return)

        self.results.append(gl.vm.run_nondet(leader_fn, validator_fn))

    @gl.public.write
    def probe_render(self, url: str, wait: str) -> None:
        def leader_fn() -> str:
            try:
                text = gl.nondet.web.render(url, mode="text", wait_after_loaded=wait or None)
                return json.dumps({
                    "mode": "render", "url": url, "len": len(text),
                    "head": text[:600], "tail": text[-300:],
                })
            except Exception as e:
                return json.dumps({"mode": "render", "url": url, "error": repr(e)[:600]})

        def validator_fn(leaders_res) -> bool:
            return isinstance(leaders_res, gl.vm.Return)

        self.results.append(gl.vm.run_nondet(leader_fn, validator_fn))

    @gl.public.view
    def get_results(self) -> list:
        return [r for r in self.results]
