from app.spider import classify_link, should_follow


def test_pdf_links_are_candidates():
    kind = classify_link("https://www.w3.org/TR/REC-html40/html40.pdf", "HTML 4.0 PDF")
    assert kind == "pdf"


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
