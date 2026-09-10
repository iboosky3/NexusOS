"""Keep embedded image bytes out of text model requests and retain document media."""

import hashlib
import re

DATA_IMAGE = re.compile(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}")
IMAGE = re.compile(r"!\[[^\]\n]*\]\([^\s)]+(?:\s+\"[^\"]*\")?\)")
FLOW = re.compile(r"(?m)^```nexus-flow\s*\n[\s\S]*?^```[ \t]*$")


class MediaReferences:
    def __init__(self) -> None:
        self.images: dict[str, str] = {}

    def protect(self, text: str) -> str:
        def replace(match: re.Match[str]) -> str:
            data = match.group()
            ref = "/nexus-assets/" + hashlib.sha256(data.encode()).hexdigest()
            self.images[ref] = data
            return ref

        return DATA_IMAGE.sub(replace, text)

    def restore(self, text: str, original: str = "") -> str:
        for ref, data in self.images.items():
            text = text.replace(ref, data)
        # Text-only models cannot interpret image pixels. Keep omitted media accessible;
        # users can remove it explicitly in the editor before starting another revision.
        missing = []
        for match in IMAGE.finditer(original):
            block = match.group()
            url = block.split("](", 1)[1].split()[0].rstrip(")")
            if url not in text:
                missing.append(block)
        if not FLOW.search(text):
            missing.extend(match.group() for match in FLOW.finditer(original))
        if missing:
            text += "\n\n## 保留的配图与流程图\n\n" + "\n\n".join(dict.fromkeys(missing))
        if len(text) > 200000:
            raise ValueError("包含配图的正文超过 200,000 字符")
        return text
