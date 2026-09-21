"""Isolated real API for browser tests; never uses user data or a paid model."""

import json
import tempfile
from pathlib import Path

import uvicorn
from nexusos.api import create_app
from nexusos.core.models import TokenUsage
from nexusos.models import ModelResponse
from nexusos.prd.store import PrdStore


class BrowserGateway:
    async def complete(self, request):
        return ModelResponse(
            json.dumps(
                {"brief": {"title": "浏览器验收 PRD"}, "content": "# Agent 草稿\n等待人工确认。"}
            ),
            "test",
            request.model,
            TokenUsage(1, 1),
            "stop",
        )


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="nexus-studio-browser-") as directory:
        app = create_app(
            root=Path(__file__).resolve().parents[1],
            prd_store=PrdStore(Path(directory) / "test.sqlite"),
            model_gateway=BrowserGateway(),
            model_name="browser-test",
        )
        uvicorn.run(app, host="127.0.0.1", port=18123)
