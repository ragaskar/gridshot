"""Bin-tool endpoints — private, per-bin copies of tool geometry forked out
of the Tool Library (see gridshot/core/bintools.py)."""

from ._builder import RouteSpec, build_domain_router

ROUTES: tuple[RouteSpec, ...] = (
    ("POST", "/api/bin-tools/{tool_id}/duplicate", "bin_tools_duplicate"),
)


def build_router(owner):
    return build_domain_router(owner, tag="bin-tools", specs=ROUTES)
