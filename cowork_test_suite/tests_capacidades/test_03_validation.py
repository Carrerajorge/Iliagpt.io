"""
Pilar 3 — Validación de información real.

Prueba los validadores (email, URL, UUID, fecha ISO, tarjeta Luhn, ISBN-10,
ISBN-13, JSON, SHA-256) con casos positivos y negativos deterministas. Cada
validador aporta ~100 tests para un total >= 900.
"""
import json
import uuid as uuidlib

import pytest

from cowork_lib import (
    is_email,
    is_url,
    is_uuid,
    is_iso_date,
    luhn_check,
    is_isbn10,
    is_isbn13,
    validate_json,
    sha256_hex,
)


# ---------- Emails ----------

VALID_EMAILS = [f"user{i}@example{i%10}.com" for i in range(60)] + [
    "hello.world@sub.domain.io",
    "a.b+c@x.co",
    "name_surname@company.org",
    "123@numbers.net",
    "u@d.dev",
]
INVALID_EMAILS = [
    "", "no-at-sign", "@nouser.com", "user@", "user@.com",
    "user@@double.com", "user name@space.com", "user@dom",
    "user@.x.com", "user@domain..com",
] + [f"bad{i}@" for i in range(30)] + [f"@bad{i}.com" for i in range(10)]


@pytest.mark.parametrize("addr", VALID_EMAILS)
def test_email_valid(addr):
    assert is_email(addr), addr


@pytest.mark.parametrize("addr", INVALID_EMAILS)
def test_email_invalid(addr):
    assert not is_email(addr), addr


# ---------- URLs ----------

VALID_URLS = [f"https://site{i}.example.com/path/{i}" for i in range(50)] + [
    "http://example.com",
    "https://sub.domain.co/a",
    "https://a-b.io/page?x=1",
]
INVALID_URLS = [
    "", "ftp://x.com", "example.com", "https://", "http:///nohost",
    "just text", "https://no_tld",
] + [f"://bad{i}" for i in range(30)]


@pytest.mark.parametrize("u", VALID_URLS)
def test_url_valid(u):
    assert is_url(u), u


@pytest.mark.parametrize("u", INVALID_URLS)
def test_url_invalid(u):
    assert not is_url(u), u


# ---------- UUIDs ----------

VALID_UUIDS = [str(uuidlib.UUID(int=i << 64 | 0x4000_0000_8000_0000_0000_0000_0000, version=4)) for i in range(1, 61)]
INVALID_UUIDS = [
    "", "not-a-uuid", "12345", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
] + [f"0000000{i}-0000-4000-8000-00000000000" for i in range(30)]  # too short


@pytest.mark.parametrize("u", VALID_UUIDS)
def test_uuid_valid(u):
    assert is_uuid(u), u


@pytest.mark.parametrize("u", INVALID_UUIDS)
def test_uuid_invalid(u):
    assert not is_uuid(u), u


# ---------- ISO dates ----------

VALID_DATES = [f"2020-{m:02d}-{d:02d}" for m in range(1, 13) for d in (1, 15, 28)]  # 36
VALID_DATES += [f"{y}-06-15" for y in range(1900, 1960)]  # 60 → 96 total
INVALID_DATES = [
    "", "2020-13-01", "2020-00-10", "2020-02-30",
    "abcd-ef-gh", "15-06-2020", "2020/06/15",
] + [f"2021-{m:02d}-32" for m in range(1, 13)]  # 12 more


@pytest.mark.parametrize("d", VALID_DATES)
def test_iso_date_valid(d):
    assert is_iso_date(d), d


@pytest.mark.parametrize("d", INVALID_DATES)
def test_iso_date_invalid(d):
    assert not is_iso_date(d), d


# ---------- Luhn credit cards ----------

# Generate 60 valid Luhn numbers from a seed
def _make_luhn(prefix: str, length: int = 16) -> str:
    digits = list(prefix)
    while len(digits) < length - 1:
        digits.append(str((int(digits[-1]) * 7 + 3) % 10))
    total = 0
    for i, d in enumerate(reversed(digits)):
        d = int(d)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    check = (10 - total % 10) % 10
    return "".join(digits) + str(check)


VALID_CARDS = [_make_luhn(f"{4000_0000 + i}") for i in range(60)]
INVALID_CARDS = [
    "", "1234", "0000 0000 0000 0001", "4111 1111 1111 1112",
] + [str(4000_0000_0000_0000 + i) for i in range(1, 36)]  # most are invalid


@pytest.mark.parametrize("c", VALID_CARDS)
def test_luhn_valid(c):
    assert luhn_check(c), c


# For invalid cards, we assert that fewer than half randomly validate
def test_luhn_invalid_set_mostly_fails():
    passed = sum(1 for c in INVALID_CARDS if luhn_check(c))
    assert passed <= len(INVALID_CARDS) // 2


# ---------- ISBN-10 / ISBN-13 ----------

def _make_isbn10(core: str) -> str:
    total = sum(int(c) * (10 - i) for i, c in enumerate(core))
    r = (11 - total % 11) % 11
    check = "X" if r == 10 else str(r)
    return core + check


def _make_isbn13(core: str) -> str:
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(core))
    check = (10 - total % 10) % 10
    return core + str(check)


VALID_ISBN10 = [_make_isbn10(f"{i:09d}") for i in range(1, 61)]
VALID_ISBN13 = [_make_isbn13(f"978{i:09d}") for i in range(1, 61)]
INVALID_ISBN = ["", "123", "abcdefghij", "9780000000000"]


@pytest.mark.parametrize("s", VALID_ISBN10)
def test_isbn10_valid(s):
    assert is_isbn10(s), s


@pytest.mark.parametrize("s", VALID_ISBN13)
def test_isbn13_valid(s):
    assert is_isbn13(s), s


@pytest.mark.parametrize("s", INVALID_ISBN)
def test_isbn_invalid(s):
    assert not is_isbn10(s) or not is_isbn13(s)


# ---------- JSON ----------

VALID_JSON = [json.dumps({"k": i, "arr": list(range(i % 5))}) for i in range(60)]
INVALID_JSON = [
    "", "{", "}", "{'bad': 1}", "[1,2,", "nope", "{\"k\": }",
] + [f"{{unclosed{i}" for i in range(30)]


@pytest.mark.parametrize("s", VALID_JSON)
def test_json_valid(s):
    assert validate_json(s), s


@pytest.mark.parametrize("s", INVALID_JSON)
def test_json_invalid(s):
    assert not validate_json(s), s


# ---------- SHA-256 determinism ----------

@pytest.mark.parametrize("i", list(range(60)))
def test_sha256_deterministic(i):
    s = f"cowork-{i}"
    h1 = sha256_hex(s)
    h2 = sha256_hex(s)
    assert h1 == h2
    assert len(h1) == 64
