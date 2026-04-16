#!/usr/bin/env python3
"""
ILIAGPT.IO — Professional Capability Test Runner
=================================================

Executes all 18 capability test suites, generates a multi-format report
(terminal, JSON, HTML matrix), and returns a non-zero exit code on failure.

Usage:
    python3 run_all_capabilities.py [OPTIONS]

Options:
    --verbose, -v    Show full pytest output per capability
    --cap N          Run only capability N (1-18)
    --html           Generate interactive HTML report
    --junit          Generate JUnit XML output for CI
    --smoke          Run only @pytest.mark.smoke tests
    --parallel       Run capabilities in parallel (faster, less output)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

THIS_DIR = Path(__file__).parent
REPORTS_DIR = THIS_DIR / "reports"
REPORTS_DIR.mkdir(exist_ok=True)

# ── Capability Registry ──────────────────────────────────────────────────────

CAPABILITIES = {
    1:  ("Generacion de Archivos Excel",         "test_cap_01_excel.py",              "file_generation"),
    2:  ("Generacion de Archivos PowerPoint",    "test_cap_02_powerpoint.py",         "file_generation"),
    3:  ("Generacion de Documentos Word",        "test_cap_03_word.py",               "file_generation"),
    4:  ("Creacion y Manipulacion de PDF",       "test_cap_04_pdf.py",                "file_generation"),
    5:  ("Otros Formatos de Salida",             "test_cap_05_other_formats.py",      "file_generation"),
    6:  ("Gestion de Archivos Locales",          "test_cap_06_file_management.py",    "file_management"),
    7:  ("Analisis de Datos y Data Science",     "test_cap_07_data_science.py",       "data_science"),
    8:  ("Sintesis e Investigacion",             "test_cap_08_synthesis.py",          "research"),
    9:  ("Conversion entre Formatos",            "test_cap_09_conversion.py",         "conversion"),
    10: ("Automatizacion de Navegador",          "test_cap_10_browser.py",            "automation"),
    11: ("Computer Use",                         "test_cap_11_computer_use.py",       "automation"),
    12: ("Tareas Programadas y Recurrentes",     "test_cap_12_scheduling.py",         "scheduling"),
    13: ("Dispatch desde Movil",                 "test_cap_13_dispatch.py",           "dispatch"),
    14: ("Conectores e Integraciones MCP",       "test_cap_14_connectors.py",         "connectors"),
    15: ("Plugins y Personalizacion",            "test_cap_15_plugins.py",            "plugins"),
    16: ("Ejecucion de Codigo",                  "test_cap_16_code_execution.py",     "code_exec"),
    17: ("Sub-Agentes y Tareas Complejas",       "test_cap_17_subagents.py",          "agents"),
    18: ("Seguridad, Enterprise y Dominios",     "test_cap_18_security_enterprise.py","security"),
}

# ── Test Execution ───────────────────────────────────────────────────────────

def run_capability(cap_num: int, *, verbose: bool = False, junit: bool = False, smoke: bool = False) -> dict:
    """Run a single capability's test file and parse results."""
    name, filename, category = CAPABILITIES[cap_num]
    filepath = THIS_DIR / filename
    if not filepath.exists():
        return {"cap": cap_num, "name": name, "category": category,
                "passed": 0, "failed": 0, "errors": 0, "skipped": 0,
                "status": "MISSING", "duration_s": 0.0}

    cmd = [sys.executable, "-m", "pytest", str(filepath),
           "-q", "--tb=short", "--disable-warnings", "--maxfail=200"]
    if verbose:
        cmd.append("-v")
    if junit:
        xml_path = REPORTS_DIR / f"junit_cap{cap_num:02d}.xml"
        cmd.extend([f"--junitxml={xml_path}"])
    if smoke:
        cmd.extend(["-m", "smoke"])

    start = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              cwd=str(THIS_DIR), timeout=300)
    except subprocess.TimeoutExpired:
        return {"cap": cap_num, "name": name, "category": category,
                "passed": 0, "failed": 0, "errors": 1, "skipped": 0,
                "status": "TIMEOUT", "duration_s": 300.0}
    elapsed = time.time() - start

    output = proc.stdout + proc.stderr
    passed = failed = errors = skipped = 0
    for line in output.split("\n"):
        m_p = re.search(r"(\d+) passed", line)
        m_f = re.search(r"(\d+) failed", line)
        m_e = re.search(r"(\d+) error", line)
        m_s = re.search(r"(\d+) skipped", line)
        if m_p: passed = int(m_p.group(1))
        if m_f: failed = int(m_f.group(1))
        if m_e: errors = int(m_e.group(1))
        if m_s: skipped = int(m_s.group(1))

    status = "PASS" if proc.returncode == 0 and (passed > 0 or skipped > 0) else "FAIL"
    return {
        "cap": cap_num, "name": name, "category": category, "file": filename,
        "passed": passed, "failed": failed, "errors": errors, "skipped": skipped,
        "status": status, "duration_s": round(elapsed, 2), "returncode": proc.returncode,
    }

# ── Terminal Report ──────────────────────────────────────────────────────────

ANSI_GREEN  = "\033[92m"
ANSI_RED    = "\033[91m"
ANSI_YELLOW = "\033[93m"
ANSI_BOLD   = "\033[1m"
ANSI_DIM    = "\033[2m"
ANSI_RESET  = "\033[0m"

def terminal_report(results: list[dict]) -> str:
    total_p = sum(r["passed"] for r in results)
    total_f = sum(r["failed"] for r in results)
    total_e = sum(r["errors"] for r in results)
    total_s = sum(r["skipped"] for r in results)
    total   = total_p + total_f + total_e
    caps_ok = sum(1 for r in results if r["status"] == "PASS")
    dur     = sum(r["duration_s"] for r in results)

    W = 98
    lines = [
        "",
        f"{ANSI_BOLD}{'=' * W}{ANSI_RESET}",
        f"{ANSI_BOLD}  ILIAGPT.IO  —  Capability Validation Matrix{ANSI_RESET}",
        f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  |  Duration: {dur:.1f}s",
        f"{'=' * W}",
        "",
        f"  {ANSI_BOLD}Summary{ANSI_RESET}",
        f"  Capabilities : {caps_ok}/{len(results)} passing",
        f"  Tests        : {total_p:,} passed  /  {total_f:,} failed  /  {total_e:,} errors  /  {total_s:,} skipped",
        f"  Total        : {total:,} tests",
        "",
    ]

    hdr = f"  {'#':>3}  {'Status':>8}  {'Passed':>7}  {'Failed':>7}  {'Time':>7}  {'Category':<15}  {'Capability'}"
    sep = f"  {'─' * (W - 4)}"
    lines.append(sep)
    lines.append(hdr)
    lines.append(sep)

    for r in results:
        if r["status"] == "PASS":
            badge = f"{ANSI_GREEN}  PASS  {ANSI_RESET}"
        elif r["status"] == "TIMEOUT":
            badge = f"{ANSI_YELLOW}TIMEOUT {ANSI_RESET}"
        else:
            badge = f"{ANSI_RED}  FAIL  {ANSI_RESET}"
        line = f"  {r['cap']:>3}  {badge}  {r['passed']:>7}  {r['failed']:>7}  {r['duration_s']:>6.1f}s  {r.get('category',''):<15}  {r['name']}"
        lines.append(line)

    lines.append(sep)

    failures = [r for r in results if r["status"] != "PASS"]
    if failures:
        lines.append(f"\n  {ANSI_RED}{ANSI_BOLD}Failed Capabilities:{ANSI_RESET}")
        for r in failures:
            lines.append(f"    {ANSI_RED}✗{ANSI_RESET} CAP-{r['cap']:02d} {r['name']}: {r['failed']} failed, {r['errors']} errors")
    else:
        lines.append(f"\n  {ANSI_GREEN}{ANSI_BOLD}All 18 capabilities passing.{ANSI_RESET}")

    lines.extend(["", f"{'=' * W}", ""])
    return "\n".join(lines)

# ── HTML Report ──────────────────────────────────────────────────────────────

def html_report(results: list[dict]) -> str:
    total_p = sum(r["passed"] for r in results)
    total_f = sum(r["failed"] for r in results)
    total   = total_p + total_f + sum(r["errors"] for r in results)
    caps_ok = sum(1 for r in results if r["status"] == "PASS")
    pct     = (total_p / total * 100) if total else 0

    rows_html = ""
    for r in results:
        cls = "pass" if r["status"] == "PASS" else "fail"
        badge = r["status"]
        rows_html += f"""
        <tr class="{cls}">
          <td>CAP-{r['cap']:02d}</td>
          <td><span class="badge {cls}">{badge}</span></td>
          <td>{r['passed']}</td>
          <td>{r['failed']}</td>
          <td>{r['errors']}</td>
          <td>{r['duration_s']:.1f}s</td>
          <td>{r.get('category','')}</td>
          <td>{r['name']}</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>ILIAGPT.IO — Capability Validation Matrix</title>
<style>
  :root {{ --bg: #0d1117; --card: #161b22; --border: #30363d; --text: #e6edf3;
           --green: #3fb950; --red: #f85149; --yellow: #d29922; --blue: #58a6ff; }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
          background: var(--bg); color: var(--text); padding: 2rem; }}
  .header {{ text-align: center; margin-bottom: 2rem; }}
  .header h1 {{ font-size: 1.8rem; margin-bottom: 0.5rem; }}
  .header .subtitle {{ color: #8b949e; font-size: 0.9rem; }}
  .summary {{ display: flex; gap: 1rem; justify-content: center; margin: 1.5rem 0; flex-wrap: wrap; }}
  .stat {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px;
           padding: 1rem 1.5rem; text-align: center; min-width: 140px; }}
  .stat .value {{ font-size: 2rem; font-weight: bold; }}
  .stat .label {{ color: #8b949e; font-size: 0.8rem; text-transform: uppercase; }}
  .stat.ok .value {{ color: var(--green); }}
  .stat.err .value {{ color: var(--red); }}
  .progress {{ width: 100%; max-width: 600px; margin: 1rem auto; height: 8px;
               background: var(--border); border-radius: 4px; overflow: hidden; }}
  .progress .bar {{ height: 100%; background: var(--green); border-radius: 4px;
                    transition: width 0.6s ease; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 1.5rem;
           background: var(--card); border-radius: 8px; overflow: hidden; }}
  th {{ background: #21262d; padding: 0.75rem 1rem; text-align: left;
       font-size: 0.8rem; text-transform: uppercase; color: #8b949e;
       border-bottom: 2px solid var(--border); }}
  td {{ padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.9rem; }}
  tr.fail td {{ background: rgba(248, 81, 73, 0.08); }}
  .badge {{ padding: 2px 10px; border-radius: 12px; font-size: 0.75rem;
            font-weight: 600; text-transform: uppercase; }}
  .badge.pass {{ background: rgba(63, 185, 80, 0.2); color: var(--green); }}
  .badge.fail {{ background: rgba(248, 81, 73, 0.2); color: var(--red); }}
  .footer {{ text-align: center; margin-top: 2rem; color: #484f58; font-size: 0.8rem; }}
</style>
</head>
<body>
  <div class="header">
    <h1>ILIAGPT.IO — Capability Validation Matrix</h1>
    <div class="subtitle">Generated {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | {total:,} tests across 18 capabilities</div>
  </div>
  <div class="summary">
    <div class="stat {'ok' if caps_ok == len(results) else 'err'}">
      <div class="value">{caps_ok}/{len(results)}</div><div class="label">Capabilities</div>
    </div>
    <div class="stat ok"><div class="value">{total_p:,}</div><div class="label">Passed</div></div>
    <div class="stat {'err' if total_f else 'ok'}"><div class="value">{total_f:,}</div><div class="label">Failed</div></div>
    <div class="stat ok"><div class="value">{pct:.1f}%</div><div class="label">Pass Rate</div></div>
  </div>
  <div class="progress"><div class="bar" style="width:{pct:.1f}%"></div></div>
  <table>
    <thead>
      <tr><th>ID</th><th>Status</th><th>Passed</th><th>Failed</th><th>Errors</th><th>Time</th><th>Category</th><th>Capability</th></tr>
    </thead>
    <tbody>{rows_html}
    </tbody>
  </table>
  <div class="footer">ILIAGPT.IO Capability Test Suite v2.0 — Deterministic offline validation</div>
</body>
</html>"""

# ── Plain-text report (no ANSI) ─────────────────────────────────────────────

def plain_report(results: list[dict]) -> str:
    total_p = sum(r["passed"] for r in results)
    total_f = sum(r["failed"] for r in results)
    total_e = sum(r["errors"] for r in results)
    total   = total_p + total_f + total_e
    caps_ok = sum(1 for r in results if r["status"] == "PASS")
    dur     = sum(r["duration_s"] for r in results)

    W = 98
    lines = [
        "=" * W,
        "  ILIAGPT.IO  —  Capability Validation Matrix",
        f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  |  Duration: {dur:.1f}s",
        "=" * W,
        "",
        f"  Capabilities : {caps_ok}/{len(results)} passing",
        f"  Tests        : {total_p:,} passed  /  {total_f:,} failed  /  {total_e:,} errors",
        f"  Total        : {total:,} tests",
        "",
    ]
    hdr = f"  {'#':>3}  {'Status':>8}  {'Passed':>7}  {'Failed':>7}  {'Time':>7}  {'Category':<15}  {'Capability'}"
    sep = "  " + "-" * (W - 4)
    lines += [sep, hdr, sep]
    for r in results:
        lines.append(f"  {r['cap']:>3}  {r['status']:>8}  {r['passed']:>7}  {r['failed']:>7}  {r['duration_s']:>6.1f}s  {r.get('category',''):<15}  {r['name']}")
    lines.append(sep)
    if all(r["status"] == "PASS" for r in results):
        lines.append("\n  ALL 18 CAPABILITIES PASSING")
    lines.extend(["", "=" * W])
    return "\n".join(lines)

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="ILIAGPT.IO — Professional Capability Test Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose pytest output")
    parser.add_argument("--cap", type=int, help="Run only capability N (1-18)")
    parser.add_argument("--html", action="store_true", help="Generate HTML report")
    parser.add_argument("--junit", action="store_true", help="Generate JUnit XML per capability")
    parser.add_argument("--smoke", action="store_true", help="Run only smoke-marked tests")
    parser.add_argument("--parallel", action="store_true", help="Run capabilities in parallel")
    args = parser.parse_args()

    caps = [args.cap] if args.cap else list(CAPABILITIES.keys())

    print(f"\n{'=' * 60}")
    print(f"  ILIAGPT.IO Capability Test Runner")
    print(f"  Running {len(caps)} capability suite(s)...")
    print(f"{'=' * 60}\n")

    results: list[dict] = []

    if args.parallel and len(caps) > 1:
        with ProcessPoolExecutor(max_workers=min(6, len(caps))) as pool:
            futures = {pool.submit(run_capability, c, verbose=args.verbose, junit=args.junit, smoke=args.smoke): c for c in caps}
            for future in as_completed(futures):
                r = future.result()
                results.append(r)
                icon = f"{ANSI_GREEN}PASS{ANSI_RESET}" if r["status"] == "PASS" else f"{ANSI_RED}FAIL{ANSI_RESET}"
                print(f"  [{r['cap']:>2}/18] {icon}  {r['passed']:>4}p / {r['failed']}f  {r['duration_s']:>5.1f}s  {r['name']}")
        results.sort(key=lambda r: r["cap"])
    else:
        for c in caps:
            name = CAPABILITIES[c][0]
            print(f"  [{c:>2}/18] {name}...", end=" ", flush=True)
            r = run_capability(c, verbose=args.verbose, junit=args.junit, smoke=args.smoke)
            results.append(r)
            icon = f"{ANSI_GREEN}PASS{ANSI_RESET}" if r["status"] == "PASS" else f"{ANSI_RED}FAIL{ANSI_RESET}"
            print(f"{icon}  ({r['passed']}p/{r['failed']}f in {r['duration_s']:.1f}s)")

    # Terminal report
    print(terminal_report(results))

    # Save plain-text report
    txt_path = REPORTS_DIR / "CAPABILITY_REPORT.txt"
    txt_path.write_text(plain_report(results))

    # Save JSON results
    json_path = REPORTS_DIR / "capability_results.json"
    json_data = {
        "meta": {
            "generated_at": datetime.now().isoformat(),
            "python_version": sys.version,
            "platform": sys.platform,
        },
        "summary": {
            "capabilities_passing": sum(1 for r in results if r["status"] == "PASS"),
            "capabilities_total": len(results),
            "tests_passed": sum(r["passed"] for r in results),
            "tests_failed": sum(r["failed"] for r in results),
            "tests_errors": sum(r["errors"] for r in results),
            "total_duration_s": sum(r["duration_s"] for r in results),
        },
        "capabilities": results,
    }
    json_path.write_text(json.dumps(json_data, indent=2, default=str))

    # HTML report
    if args.html:
        html_path = REPORTS_DIR / "capability_matrix.html"
        html_path.write_text(html_report(results))
        print(f"  HTML report  : {html_path}")

    print(f"  Text report  : {txt_path}")
    print(f"  JSON results : {json_path}")
    print()

    sys.exit(0 if all(r["status"] == "PASS" for r in results) else 1)


if __name__ == "__main__":
    main()
