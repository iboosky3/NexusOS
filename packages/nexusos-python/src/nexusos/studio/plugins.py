"""The built-in assembly list; domain policies live with their plugins."""

from nexusos.studio.extensions.example_notes import plugin as notes
from nexusos.studio.extensions.grapes_designer import plugin as grapes
from nexusos.studio.extensions.prd_writer import plugin as prd
from nexusos.studio.extensions.prototype_designer import plugin as prototype
from nexusos.studio.plugin_contract import DomainPlugin

PLUGINS = (notes, prd, prototype, grapes)


def plugin_for(resource_type: str) -> DomainPlugin:
    for plugin in PLUGINS:
        if plugin.resource_type == resource_type:
            return plugin
    raise ValueError(f"Unknown resource type: {resource_type}")
