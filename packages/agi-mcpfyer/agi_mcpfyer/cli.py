# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""`agi-mcpfyer` CLI — build and inspect MCP tool bundles.

    agi-mcpfyer build <spec> --out <dir> [--source-api NAME] [--no-skip-meta]
    agi-mcpfyer inspect <bundle-dir>

`<spec>` is a URL (http/https) or a filesystem path. The fetcher figures
out YAML vs JSON. Output bundle is a directory containing `manifest.json`
and `tools.json`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from agi_mcpfyer.bundle import MCPBundle
from agi_mcpfyer.generator import build_bundle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="agi-mcpfyer", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    build = sub.add_parser("build", help="generate an MCP bundle from an OpenAPI spec")
    build.add_argument("spec", help="URL or filesystem path to the OpenAPI 3.x document")
    build.add_argument("--out", required=True, help="output directory for the bundle")
    build.add_argument("--source-api", default="", help="logical name for the upstream API")
    build.add_argument(
        "--no-skip-meta",
        action="store_true",
        help="include /healthz, /readyz, etc. (default: skip)",
    )
    build.add_argument("--timeout", type=float, default=10.0, help="fetch timeout in seconds")

    inspect = sub.add_parser("inspect", help="print bundle summary")
    inspect.add_argument("bundle", help="path to a bundle directory")

    args = parser.parse_args(argv)

    if args.cmd == "build":
        return _cmd_build(args)
    if args.cmd == "inspect":
        return _cmd_inspect(args)
    parser.error(f"unknown command {args.cmd!r}")
    return 2


def _cmd_build(args: argparse.Namespace) -> int:
    bundle = asyncio.run(
        build_bundle(
            source=args.spec,
            source_api=args.source_api,
            skip_meta_paths=not args.no_skip_meta,
            timeout_s=args.timeout,
        )
    )
    out_dir = bundle.to_disk(args.out)
    summary = bundle.summary()
    print(f"wrote bundle to {out_dir}")
    print(json.dumps(summary, indent=2))
    return 0


def _cmd_inspect(args: argparse.Namespace) -> int:
    bundle = MCPBundle.from_disk(Path(args.bundle))
    print(json.dumps(bundle.summary(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
