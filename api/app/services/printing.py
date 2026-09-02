"""CUPS printer discovery and dispatch via the lp/lpstat command line."""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..config import settings

_JOB_ID_RE = re.compile(r"request id is (\S+)")


@dataclass(frozen=True)
class Printer:
    name: str
    status: str
    is_default: bool = False


class PrintingError(RuntimeError):
    pass


def _run(cmd: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def printing_available() -> bool:
    return settings.printing_enabled and shutil.which(settings.lp_binary) is not None


def list_printers() -> list[Printer]:
    """Parse `lpstat -p` plus `lpstat -d`. Returns [] when CUPS is unavailable."""
    if shutil.which(settings.lpstat_binary) is None:
        return []

    default_name = ""
    res_default = _run([settings.lpstat_binary, "-d"])
    if res_default.returncode == 0:
        parts = res_default.stdout.strip().rsplit(":", 1)
        if len(parts) == 2:
            default_name = parts[1].strip()

    res = _run([settings.lpstat_binary, "-p"])
    if res.returncode != 0:
        return []

    printers: list[Printer] = []
    for line in res.stdout.splitlines():
        line = line.strip()
        if not line.startswith("printer "):
            continue
        rest = line[len("printer ") :]
        name, _, status_text = rest.partition(" ")
        status = "idle"
        lowered = status_text.lower()
        if "disabled" in lowered:
            status = "disabled"
        elif "printing" in lowered:
            status = "printing"
        printers.append(Printer(name=name, status=status, is_default=(name == default_name)))
    return printers


def send_to_printer(file_path: Path, printer_name: str | None, copies: int = 1) -> str:
    """Submit a file to CUPS. Returns the CUPS job id."""
    if not settings.printing_enabled:
        raise PrintingError("Printing is disabled (PRINTFLOW_PRINTING_ENABLED=false)")
    if shutil.which(settings.lp_binary) is None:
        raise PrintingError(f"`{settings.lp_binary}` not found on PATH — CUPS is not available")
    if not file_path.exists():
        raise PrintingError(f"File to print does not exist: {file_path}")

    cmd = [settings.lp_binary]
    if printer_name:
        cmd += ["-d", printer_name]
    if copies > 1:
        cmd += ["-n", str(copies)]
    cmd.append(str(file_path))

    res = _run(cmd, timeout=60)
    if res.returncode != 0:
        raise PrintingError((res.stderr or res.stdout or "lp failed").strip())

    match = _JOB_ID_RE.search(res.stdout)
    return match.group(1) if match else res.stdout.strip()
