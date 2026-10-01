"""Unit tests for the instrument-logo resolver (app/services/logo_service.py).

Covers the three parts that silently corrupt or expose if they break:
symbol validation (path-traversal guard), SVG safety, and the TradingView
exact-match rule (a fuzzy hit is a different company → wrong logo).
"""

from app.services import logo_service as ls


# ── symbol validation (path-traversal guard) ──────────────────────────────
def test_symbol_validation_accepts_real_symbols():
    for s in ("RELIANCE", "M&M", "BAJAJ-AUTO", "NIFTY", "TATA_MOTORS", "X"):
        assert ls.is_valid_symbol(s), s


def test_symbol_validation_rejects_bad():
    for s in (
        "../etc/passwd",   # traversal
        "a/b",             # slash
        "RELIANCE.svg",    # dot
        "NSE:RELIANCE",    # colon
        "nifty",           # lowercase
        "has space",
        "",
        "A" * 25,          # too long (>24)
    ):
        assert not ls.is_valid_symbol(s), s


# ── SVG safety ────────────────────────────────────────────────────────────
def test_is_safe_svg_accepts_tradingview_file_with_leading_comment():
    body = b"<!-- by TradingView -->\n<svg xmlns='http://www.w3.org/2000/svg'><circle/></svg>"
    assert ls.is_safe_svg(body)


def test_is_safe_svg_accepts_xml_prolog():
    body = b"<?xml version='1.0'?>\n<svg><rect/></svg>"
    assert ls.is_safe_svg(body)


def test_is_safe_svg_rejects_script():
    assert not ls.is_safe_svg(b"<svg><script>alert(1)</script></svg>")


def test_is_safe_svg_rejects_event_handler_and_foreignobject():
    assert not ls.is_safe_svg(b"<svg onload='x()'><rect/></svg>")
    assert not ls.is_safe_svg(b"<svg><foreignObject><body/></foreignObject></svg>")


def test_is_safe_svg_rejects_oversized_and_empty():
    assert not ls.is_safe_svg(b"")
    assert not ls.is_safe_svg(b"<svg>" + b"x" * (200 * 1024 + 1) + b"</svg>")


def test_is_safe_svg_rejects_non_svg_root():
    assert not ls.is_safe_svg(b"<html><svg/></html>")
    assert not ls.is_safe_svg(b"not an svg at all")


# ── TradingView exact-match rule ──────────────────────────────────────────
def test_parse_tv_logoid_takes_exact_match_not_fuzzy():
    payload = {
        "symbols": [
            {"symbol": "RELIANCEPP", "logoid": "wrong-company"},
            {"symbol": "RELIANCE", "logoid": "right-company"},
        ]
    }
    assert ls.parse_tv_logoid(payload, "RELIANCE") == "right-company"


def test_parse_tv_logoid_strips_em_tags():
    payload = {"symbols": [{"symbol": "<em>RELIANCE</em>", "logoid": "right"}]}
    assert ls.parse_tv_logoid(payload, "RELIANCE") == "right"


def test_parse_tv_logoid_none_when_no_exact_match():
    payload = {"symbols": [{"symbol": "RELIANCEPP", "logoid": "wrong"}]}
    assert ls.parse_tv_logoid(payload, "RELIANCE") is None


def test_parse_tv_logoid_reads_nested_logo_field():
    payload = {"symbols": [{"symbol": "TCS", "logo": {"logoid": "tcs-id"}}]}
    assert ls.parse_tv_logoid(payload, "TCS") == "tcs-id"


def test_parse_tv_logoid_empty_payload():
    assert ls.parse_tv_logoid({}, "ANY") is None


# ── index map: known traps return no stock fallback ───────────────────────
def test_index_map_marks_ambiguous_as_none():
    # MIDCPNIFTY fuzzy-resolves to finnifty's logo on TradingView; BANKEX only
    # hits a generic sector icon. Both must be explicit None (→ initials).
    assert ls.INDEX_LOGOIDS["MIDCPNIFTY"] is None
    assert ls.INDEX_LOGOIDS["BANKEX"] is None
    assert ls.INDEX_LOGOIDS["NIFTY"] == "indices/nifty-50"
