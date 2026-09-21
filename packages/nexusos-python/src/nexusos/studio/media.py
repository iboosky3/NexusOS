"""Validate screenshot bytes before making an immutable artifact reference."""

import base64
import binascii
import io
import warnings

from PIL import Image, UnidentifiedImageError

FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}


def screenshot_bytes(value: str) -> tuple[str, bytes]:
    try:
        header, encoded = value.split(";base64,", 1)
        mime = header.removeprefix("data:")
        if not header.startswith("data:") or mime not in FORMATS or len(encoded) > 140000:
            raise ValueError("SCREENSHOT_INVALID")
        binary = base64.b64decode(encoded, validate=True)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(binary)) as image:
                width, height = image.size
                if (
                    image.format != FORMATS[mime]
                    or not 1 <= width <= 4096
                    or not 1 <= height <= 8192
                    or width * height > 16000000
                    or getattr(image, "n_frames", 1) != 1
                ):
                    raise ValueError("SCREENSHOT_INVALID")
                image.verify()
            # Verify structural integrity and force decoding to reject truncated pixel data.
            with Image.open(io.BytesIO(binary)) as image:
                image.load()
        return mime, binary
    except (
        ValueError,
        OSError,
        SyntaxError,
        binascii.Error,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise ValueError("SCREENSHOT_INVALID：截图格式、内容或尺寸无效") from error
