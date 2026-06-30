from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
TEST_ROOT = ROOT / "scratch" / "tests"
SMOKE_TEST_ROOT = TEST_ROOT / "smoke"
QUALITY_QUESTION_TEST = TEST_ROOT / "test_quality_dashboard_questions.py"
DEFAULT_TEST_PATHS = [TEST_ROOT]
MIN_TESTS = 100


def _env() -> dict[str, str]:
    env = os.environ.copy()
    pythonpath = str(BACKEND)
    if env.get("PYTHONPATH"):
        pythonpath = pythonpath + os.pathsep + env["PYTHONPATH"]
    env["PYTHONPATH"] = pythonpath
    return env


def _run_pytest(args: list[str]) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, "-m", "pytest", *args]
    return subprocess.run(
        command,
        cwd=ROOT,
        env=_env(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def _collect_count(test_paths: list[Path], include_smoke: bool) -> tuple[int, str]:
    args = ["--collect-only", "-q", *(str(path) for path in test_paths)]
    if not include_smoke:
        args.extend(["--ignore", str(SMOKE_TEST_ROOT)])

    result = _run_pytest(args)
    output = result.stdout or ""
    if result.returncode != 0:
        print(output, end="")
        raise SystemExit(result.returncode)

    count = sum(1 for line in output.splitlines() if "::" in line.strip())
    return count, output


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the automated offline test suite.")
    parser.add_argument(
        "--include-smoke",
        action="store_true",
        help="Also run smoke tests that may require external services and credentials.",
    )
    parser.add_argument(
        "--min-tests",
        type=int,
        default=MIN_TESTS,
        help=f"Minimum number of collected tests required before execution (default: {MIN_TESTS}).",
    )
    parser.add_argument(
        "--quality-only",
        action="store_true",
        help="Run only the quality-control dashboard question automation tests.",
    )
    parsed = parser.parse_args()

    test_paths = [QUALITY_QUESTION_TEST] if parsed.quality_only else DEFAULT_TEST_PATHS

    count, collect_output = _collect_count(test_paths, parsed.include_smoke)
    print(f"Collected {count} automated test cases.")
    if count < parsed.min_tests:
        print(collect_output, end="")
        print(
            f"\nERROR: Expected at least {parsed.min_tests} tests, but pytest collected {count}.",
            file=sys.stderr,
        )
        return 1

    args = ["-q", *(str(path) for path in test_paths)]
    if not parsed.include_smoke:
        args.extend(["--ignore", str(SMOKE_TEST_ROOT)])

    result = _run_pytest(args)
    print(result.stdout or "", end="")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
