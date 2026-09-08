import hashlib
import ipaddress
import pytest

from app.url_policy import is_private_address, validate_allowed_url
from app.pdf_store import DownloadedPdf, persist_pdf, storage_key_for_hash, verify_pdf_bytes


def test_private_ipv4_and_ipv6_are_rejected():
    assert is_private_address(ipaddress.ip_address("127.0.0.1"))
    assert is_private_address(ipaddress.ip_address("10.0.0.1"))
    assert is_private_address(ipaddress.ip_address("::1"))
    assert is_private_address(ipaddress.ip_address("fe80::1"))


def test_host_must_be_in_allowlist():
    with pytest.raises(ValueError, match="allowed"):
        validate_allowed_url("https://evil.example/file.pdf", {"www.w3.org"}, resolved_ips=["93.184.216.34"])


def test_public_allowed_url_is_accepted():
    parsed = validate_allowed_url("https://www.w3.org/TR/REC-html40/html40.pdf", {"www.w3.org"}, resolved_ips=["104.18.23.19"])
    assert parsed.hostname == "www.w3.org"


def test_pdf_magic_is_required():
    verify_pdf_bytes(b"%PDF-1.7\nhello")
    with pytest.raises(ValueError, match="PDF"):
        verify_pdf_bytes(b"<html>not a pdf</html>")


def test_storage_key_is_content_addressed():
    sha = "49e01b35fa91aa9592ecef9dae362ddb60e217d21e59646bb19b52f806a8bbe0"
    assert storage_key_for_hash(sha) == f"pdfs/49/e0/{sha}.pdf"


class FakeRepo:
    def __init__(self):
        self.blob = None

    async def upsert_document_by_hash(self, **kwargs):
        return {"document": {"id": "doc-1", "storageKey": kwargs["storage_key"]}, "duplicate": False}

    async def upsert_document_blob(self, document_id, sha256, content):
        self.blob = content

    async def upsert_document_source(self, **kwargs):
        return None


@pytest.mark.asyncio
async def test_first_persist_is_not_reported_as_duplicate(tmp_path):
    content = b"%PDF-1.7\nfirst"
    digest = hashlib.sha256(content).hexdigest()
    repo = FakeRepo()
    result = await persist_pdf(
        repo=repo,
        downloaded=DownloadedPdf(
            final_url="https://www.w3.org/a.pdf",
            status_code=200,
            content=content,
            sha256=digest,
            byte_size=len(content),
            http_filename="a.pdf",
        ),
        data_dir=str(tmp_path),
        referrer_url="https://www.w3.org/",
        anchor_text="A PDF",
    )
    assert result["duplicate"] is False
    assert repo.blob == content
