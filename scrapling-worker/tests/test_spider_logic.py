from app.spider import classify_link, should_accept_pdf_candidate, should_follow


def test_pdf_links_are_candidates():
    kind = classify_link("https://www.w3.org/TR/REC-html40/html40.pdf", "HTML 4.0 PDF")
    assert kind == "pdf"


def test_extensionless_chinese_attachment_link_is_pdf_candidate():
    kind = classify_link("https://example.com/api/get?id=123", "附件下载")
    assert kind == "pdf"


def test_direct_external_pdf_can_be_downloaded_but_not_recursively_followed():
    external_pdf = "https://cdn.example.net/files/policy.pdf"
    assert should_accept_pdf_candidate(external_pdf, "政策附件")
    assert not should_follow(
        external_pdf,
        allowed_hosts={"www.example.com"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )


def test_html_links_are_followed_within_depth():
    assert should_follow(
        "https://www.w3.org/TR/REC-html40/",
        allowed_hosts={"www.w3.org"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )


def test_external_or_too_deep_links_are_not_followed():
    assert not should_follow(
        "https://example.com/page",
        allowed_hosts={"www.w3.org"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )
    assert not should_follow(
        "https://www.w3.org/deep/page",
        allowed_hosts={"www.w3.org"},
        depth=5,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[],
    )


def test_exclude_patterns_win():
    assert not should_follow(
        "https://www.w3.org/private/page",
        allowed_hosts={"www.w3.org"},
        depth=1,
        max_depth=4,
        include_patterns=[],
        exclude_patterns=[r"/private/"],
    )
