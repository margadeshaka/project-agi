# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.rag`` — retrieval-augmented generation primitives.

Defines the :class:`VectorStore` protocol every backend implements, plus
:class:`RAGAPI` — the use-case-facing search surface. Default backend is
:class:`MemoryVectorStore` (in-process; suitable for tests and tiny demos).
Real backends (``qdrant``, ``pgvector``, ``mongo_atlas``) are stubbed for
Phase 3.

Tenant overlay (``bm.tenant_id`` from OTel baggage) is fail-closed — a
missing tenant id raises :class:`MissingTenantContextError` unless the
caller explicitly opts into a cross-tenant index.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


class MissingTenantContextError(RuntimeError):
    """``RAGAPI.search()`` was called without ``bm.tenant_id`` in baggage."""


@dataclass(frozen=True)
class Document:
    """One document upserted into a vector store."""

    id: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RetrievedDoc:
    """One retrieval hit. ``score`` semantics are backend-specific."""

    id: str
    text: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class VectorStore(Protocol):
    """Protocol every vector backend implements.

    Backends do **not** see tenant context — that's overlaid by
    :class:`RAGAPI` in the filter dict. Backends are pure storage adapters.
    """

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDoc]: ...

    async def upsert(self, docs: list[Document]) -> None: ...


class MemoryVectorStore:
    """In-memory store using naive substring scoring — dev / test default.

    Not suitable for production; ships so the SDK has a working default
    without any external dependency. Phase 3 swaps in proper embeddings.
    """

    def __init__(self) -> None:
        self._docs: list[Document] = []

    async def upsert(self, docs: list[Document]) -> None:
        # Simple replace-by-id semantics.
        by_id = {d.id: d for d in self._docs}
        for d in docs:
            by_id[d.id] = d
        self._docs = list(by_id.values())

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDoc]:
        q = query.lower()
        results: list[RetrievedDoc] = []
        for d in self._docs:
            if filters and not all(d.metadata.get(k) == v for k, v in filters.items()):
                continue
            score = float(d.text.lower().count(q))
            if score > 0:
                results.append(
                    RetrievedDoc(id=d.id, text=d.text, score=score, metadata=dict(d.metadata))
                )
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]


class QdrantVectorStore:
    """Qdrant-backed store. Stubbed; wired in Phase 3 with ``qdrant-client``."""

    def __init__(self, *, url: str, collection: str, api_key: str | None = None) -> None:
        self._url = url
        self._collection = collection
        self._api_key = api_key

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDoc]:
        raise NotImplementedError("TODO: wire qdrant_client.AsyncQdrantClient in Phase 3.")

    async def upsert(self, docs: list[Document]) -> None:
        raise NotImplementedError("TODO: wire qdrant_client.AsyncQdrantClient in Phase 3.")


class PgVectorStore:
    """pgvector-backed store. Stubbed; wired in Phase 3 with ``asyncpg``."""

    def __init__(self, *, dsn: str, table: str) -> None:
        self._dsn = dsn
        self._table = table

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDoc]:
        raise NotImplementedError("TODO: wire pgvector via asyncpg in Phase 3.")

    async def upsert(self, docs: list[Document]) -> None:
        raise NotImplementedError("TODO: wire pgvector via asyncpg in Phase 3.")


class MongoAtlasVectorStore:
    """Mongo Atlas Search store. Stubbed; wired in Phase 3 with ``motor``."""

    def __init__(self, *, uri: str, db: str, collection: str, index: str) -> None:
        self._uri = uri
        self._db = db
        self._collection = collection
        self._index = index

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDoc]:
        raise NotImplementedError("TODO: wire $vectorSearch + motor in Phase 3.")

    async def upsert(self, docs: list[Document]) -> None:
        raise NotImplementedError("TODO: wire motor upsert in Phase 3.")


class RAGAPI:
    """Use-case-facing RAG surface.

    Construction-time wiring picks one :class:`VectorStore` per index name
    (mapped from ``rag_indexes:`` in operator config); ``search()`` overlays
    the active tenant id from OTel baggage onto the filter dict.
    """

    def __init__(
        self,
        stores: dict[str, VectorStore] | None = None,
        *,
        default_index: str = "default",
    ) -> None:
        self._stores: dict[str, VectorStore] = stores or {"default": MemoryVectorStore()}
        self._default_index = default_index

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        index: str | None = None,
        filters: dict[str, Any] | None = None,
        cross_tenant: bool = False,
        tenant_id: str | None = None,
    ) -> list[RetrievedDoc]:
        """Search the named index with fail-closed tenant overlay.

        Resolves ``tenant_id`` from OTel baggage when not passed explicitly.
        Raises :class:`MissingTenantContextError` if neither is present and
        ``cross_tenant`` is False.
        """
        idx_name = index or self._default_index
        store = self._stores.get(idx_name)
        if store is None:
            raise KeyError(f"No vector index bound for {idx_name!r}")
        merged_filters: dict[str, Any] = dict(filters or {})
        if not cross_tenant:
            resolved_tenant = tenant_id or _tenant_from_baggage()
            if resolved_tenant is None:
                raise MissingTenantContextError(
                    "RAGAPI.search() needs bm.tenant_id baggage or explicit tenant_id; "
                    "pass cross_tenant=True only for genuinely shared indexes."
                )
            merged_filters.setdefault("tenant_id", resolved_tenant)
        return await store.search(query, top_k=top_k, filters=merged_filters)


def _tenant_from_baggage() -> str | None:
    """Read ``bm.tenant_id`` from OTel baggage. Returns ``None`` if absent."""
    try:
        from opentelemetry import baggage  # type: ignore[import-not-found]
    except Exception:
        return None
    value = baggage.get_baggage("bm.tenant_id")
    return value if isinstance(value, str) else None


__all__ = [
    "Document",
    "MemoryVectorStore",
    "MissingTenantContextError",
    "MongoAtlasVectorStore",
    "PgVectorStore",
    "QdrantVectorStore",
    "RAGAPI",
    "RetrievedDoc",
    "VectorStore",
]
