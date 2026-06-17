from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .engine import RLDXEngine

__all__ = ["RLDXEngine", "create_engine"]


def create_engine():
    from .engine import create_engine as _create_engine

    return _create_engine()


def __getattr__(name: str):
    if name == "RLDXEngine":
        from .engine import RLDXEngine

        return RLDXEngine
    raise AttributeError(name)
