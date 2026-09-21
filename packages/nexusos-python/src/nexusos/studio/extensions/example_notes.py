"""Example plugin registration without PRD or prototype behavior."""

from nexusos.studio.example_notes import NotePayload
from nexusos.studio.plugin_contract import AgentCapability, DomainPlugin

plugin = DomainPlugin(
    id="nexus.example-notes",
    resource_type="nexus.note",
    payload_model=NotePayload,
    actions=(AgentCapability("revise", ("structured_writing",)),),
    instruction="你是便签整理 Agent。根据用户指令整理便签，保留原始事实。",
    default_enabled=False,
)
