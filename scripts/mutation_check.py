"""
Mutation check: proves each safety property is actually pinned by a test.

tests/mutations.txt lists deliberate breakages of the contract - each one
removes or weakens exactly one safety property (identity binding, the
overdue check, fail-closed parsing, the validator's comparisons, ...).
For every mutation this script patches the contract, runs the full test
suite, and restores the original. A mutation the suite still passes is a
safety property no test protects; the script exits non-zero if any
survive.

Format of tests/mutations.txt: blocks separated by a line "===", each
    <name>
    ---
    <exact original text>
    ---
    <replacement text>

Usage (from the repo root):  python3 scripts/mutation_check.py
"""

import os
import pathlib
import signal
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
CONTRACT = REPO / "contracts" / "passport_map.py"
PYTEST = REPO / ".venv" / "bin" / "pytest"
TEST_TIMEOUT_SECONDS = 60


def main() -> int:
    original = CONTRACT.read_text()
    mutations = []
    for block in (REPO / "tests" / "mutations.txt").read_text().split("\n===\n"):
        name, old, new = block.split("\n---\n")
        assert old in original, f"mutation target not found in {CONTRACT.name}: {name.strip()}"
        mutations.append((name.strip(), old, new))

    # Restore the contract however this script ends - including being
    # terminated, which would otherwise leave a mutated contract behind.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    survivors = []
    try:
        for name, old, new in mutations:
            CONTRACT.write_text(original.replace(old, new, 1))
            # Own process group, killed whole on timeout: the test runner can
            # leave child processes holding its output pipe, which would
            # otherwise block this script past the timeout.
            proc = subprocess.Popen([str(PYTEST), "tests", "-q", "-x", "-p", "no:cacheprovider"], cwd=REPO,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            try:
                killed = proc.wait(timeout=TEST_TIMEOUT_SECONDS) != 0
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                killed = True  # a mutation that hangs the suite is not a surviving one
                name += "  (suite timed out)"
            print(("KILLED    " if killed else "SURVIVED  ") + name, flush=True)
            if not killed:
                survivors.append(name)
    finally:
        CONTRACT.write_text(original)

    print(f"\n{len(mutations) - len(survivors)}/{len(mutations)} mutations killed")
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main())
