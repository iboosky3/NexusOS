"""Command-line entry point for local NexusOS workflows."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Sequence

from nexusos.api import serialize_run_record
from nexusos.bootstrap import build_reference_orchestrator


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="nexus", description="运行 NexusOS 参考工作流")
    subcommands = parser.add_subparsers(dest="command", required=True)
    prd = subcommands.add_parser("prd", help="从产品构想生成 PRD")
    prd.add_argument("request", help="产品构想或需求描述")
    prd.add_argument("--output", type=Path, default=Path("artifacts"), help="产物目录")
    prd.add_argument("--json", action="store_true", help="输出完整 JSON 摘要")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "prd":
        return 2
    record = asyncio.run(build_reference_orchestrator().run(args.request))
    payload = serialize_run_record(record)
    run_directory = args.output / record.state.run_id
    run_directory.mkdir(parents=True, exist_ok=True)
    for artifact in record.state.artifacts:
        (run_directory / artifact.name).write_text(artifact.content, encoding="utf-8")
    (run_directory / "run.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    else:
        print(f"运行完成：{record.state.run_id}")
        print(f"评审分数：{record.state.review.overall_score if record.state.review else 'N/A'}")
        print(f"产物目录：{run_directory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
