"""A third domain schema used to verify the resource/Agent extension boundary."""

from pydantic import Field

from nexusos.prd.schemas_base import StrictModel


class NotePayload(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=20000)
