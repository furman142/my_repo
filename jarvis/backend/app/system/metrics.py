"""Genuine local telemetry. Anything we cannot measure is reported as `unavailable`."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess  # noqa: S404 — fixed argv, no shell
import time
from typing import Any

import psutil

_BOOT = time.time()
psutil.cpu_percent(interval=None)  # prime the counter so the first real reading is meaningful


def _disk_root() -> str:
    if os.name == "nt":
        return os.environ.get("SystemDrive", "C:") + "\\"
    return "/"


def gpu_status() -> dict[str, Any]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"state": "unavailable", "reason": "nvidia-smi not found"}
    try:
        out = subprocess.run(  # noqa: S603
            [exe, "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, check=True,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError) as exc:
        return {"state": "unavailable", "reason": type(exc).__name__}
    gpus = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            continue

        def num(v: str) -> float | None:
            try:
                return float(v)
            except ValueError:
                return None

        gpus.append({
            "name": parts[0], "utilization_percent": num(parts[1]),
            "vram_used_mb": num(parts[2]), "vram_total_mb": num(parts[3]), "temperature_c": num(parts[4]),
        })
    return {"state": "ready" if gpus else "unavailable", "gpus": gpus}


def system_status(include_gpu: bool = True) -> dict[str, Any]:
    vm = psutil.virtual_memory()
    try:
        du = psutil.disk_usage(_disk_root())
        disk: dict[str, Any] = {"percent": du.percent, "free_gb": round(du.free / 1e9, 1),
                                "total_gb": round(du.total / 1e9, 1)}
    except OSError:
        disk = {"state": "unavailable"}
    return {
        "host": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "cpu_percent": psutil.cpu_percent(interval=None),
        "cpu_count": psutil.cpu_count(),
        "ram_percent": vm.percent,
        "ram_used_gb": round((vm.total - vm.available) / 1e9, 1),
        "ram_total_gb": round(vm.total / 1e9, 1),
        "disk": disk,
        "gpu": gpu_status() if include_gpu else {"state": "skipped"},
        "jarvis_uptime_s": int(time.time() - _BOOT),
    }
