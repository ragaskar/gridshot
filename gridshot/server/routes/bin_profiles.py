"""Bin Profiles CRUD and preview endpoints — named style presets."""

from ._builder import RouteSpec, build_domain_router

ROUTES: tuple[RouteSpec, ...] = (
    ("GET", "/api/bin-profiles", "bin_profiles_list"),
    ("POST", "/api/bin-profiles", "bin_profiles_create"),
    ("GET", "/api/bin-profiles/{profile_id}", "bin_profiles_get"),
    ("PATCH", "/api/bin-profiles/{profile_id}", "bin_profiles_update"),
    ("DELETE", "/api/bin-profiles/{profile_id}", "bin_profiles_delete"),
    ("GET", "/api/bin-profiles/{profile_id}/preview", "bin_profiles_preview_photo"),
    ("POST", "/api/bin-profiles/{profile_id}/preview", "bin_profiles_preview_upload"),
    ("POST", "/api/bin-profiles/preview.glb", "bin_profiles_preview_glb"),
)


def build_router(owner):
    return build_domain_router(owner, tag="bin-profiles", specs=ROUTES)
