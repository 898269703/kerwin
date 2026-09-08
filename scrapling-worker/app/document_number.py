from __future__ import annotations

import re
import unicodedata


_PATTERN = re.compile(r"([\u4e00-\u9fffA-Za-z]{1,24})〔(19\d{2}|20\d{2})〕(\d{1,6})号")
_PREFIX_NOISE = re.compile(r"^(关于印发|关于发布|关于|印发|发布)")


def extract_document_number(text: str) -> str | None:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = normalized.replace("【", "〔").replace("[", "〔").replace("】", "〕").replace("]", "〕")
    normalized = re.sub(r"\s+", "", normalized)
    match = _PATTERN.search(normalized)
    if not match:
        return None
    prefix, year, number = match.groups()
    prefix = _PREFIX_NOISE.sub("", prefix)
    return f"{prefix}〔{year}〕{number}号"
