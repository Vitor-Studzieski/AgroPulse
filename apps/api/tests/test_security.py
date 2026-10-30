import jwt
import pytest
from pydantic import ValidationError

from app.models import Polygon
from app.security import create_token, decode_token, hash_password, verify_password


def test_password_roundtrip():
    hashed = hash_password("segredo123")
    assert verify_password("segredo123", hashed)
    assert not verify_password("outra-senha", hashed)


def test_token_roundtrip():
    payload = decode_token(create_token("abc", "produtor"))
    assert payload["sub"] == "abc"
    assert payload["role"] == "produtor"


def test_token_with_wrong_signature_is_rejected():
    forged = jwt.encode({"sub": "abc"}, "outra-chave", algorithm="HS256")
    with pytest.raises(jwt.PyJWTError):
        decode_token(forged)


def test_open_polygon_is_rejected():
    with pytest.raises(ValidationError):
        Polygon(coordinates=[[[0, 0], [1, 0], [1, 1], [0, 1]]])
