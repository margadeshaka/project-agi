# SPDX-License-Identifier: Apache-2.0
"""Knowledge base — list / upload. Stub for P3 phase gate."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Request, UploadFile

router = APIRouter(tags=["kb"])


@router.get("/kb")
async def list_kb(request: Request) -> dict[str, Any]:
    return {
        "pack": request.state.pack.slug,
        "articles": [],
    }


@router.post("/kb")
async def upload_kb(
    request: Request,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    content = await file.read()
    return {
        "pack": request.state.pack.slug,
        "filename": file.filename,
        "size_bytes": len(content),
        "indexed": False,
        "correlation_id": request.state.correlation_id,
    }
