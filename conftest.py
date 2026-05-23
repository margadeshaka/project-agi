# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""Root conftest — pytest path resolution for the uv workspace.

Why this file exists
--------------------
``uv sync --all-packages`` generates editable installs as ``.pth`` files named
``_editable_impl_<package>.pth``. Python's ``site.py`` filters ``.pth`` files
whose names start with ``.`` or ``_``, treating them as hidden. Result:
``import agi_core``, ``import agi_mcpfyer``, ``import agi_runtime``, and
``import agi_auth`` all raise ``ModuleNotFoundError`` after a fresh sync, even
though the install ran successfully.

The fix is to prepend each workspace package's source directory to
``sys.path`` at pytest collection time. This file does that without modifying
``site.py`` and without an environment-variable workaround on contributor
machines.

If/when ``uv`` ships an option to disable the underscore prefix on editable
``.pth`` files, this file becomes a no-op and can be deleted.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent

# Order matters only for human readability — every entry resolves a distinct
# top-level package name.
_PACKAGES = (
    "packages/agi-sdk",
    "packages/agi-core",
    "packages/agi-mcpfyer",
    "distribution/agi-runtime",
    "distribution/agi-auth",
)

for _rel in _PACKAGES:
    _abs = _ROOT / _rel
    if _abs.is_dir():
        _abs_str = str(_abs)
        if _abs_str not in sys.path:
            sys.path.insert(0, _abs_str)
