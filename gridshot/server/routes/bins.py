"""Bin Library CRUD and export endpoints — saved combine-editor arrangements."""

from ._builder import RouteSpec, build_domain_router

ROUTES: tuple[RouteSpec, ...] = (
    ("POST", "/api/bins", "bins_save"),
    ("GET", "/api/bins", "bins_list"),
    ("PUT", "/api/bins/{bin_id}", "bins_overwrite"),
    ("PATCH", "/api/bins/{bin_id}", "bins_update"),
    ("DELETE", "/api/bins/{bin_id}", "bins_delete"),
    ("POST", "/api/bins/{bin_id}/export", "bins_export"),
    ("POST", "/api/bins/{bin_id}/export/slice", "bins_export_slice"),
)


def build_router(owner):
    return build_domain_router(owner, tag="bins", specs=ROUTES)
