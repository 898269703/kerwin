import ipaddress
import pytest

from app.url_policy import is_private_address, validate_allowed_url
from app.pdf_store import verify_pdf_bytes, storage_key_for_hash


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
