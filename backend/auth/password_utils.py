"""
Password hashing and verification using bcrypt directly.
"""

import bcrypt


def hash_password(plain: str) -> str:
    if isinstance(plain, str):
        plain = plain.encode("utf-8")
    return bcrypt.hashpw(plain, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if isinstance(plain, str):
        plain = plain.encode("utf-8")
    if isinstance(hashed, str):
        hashed = hashed.encode("utf-8")
    return bcrypt.checkpw(plain, hashed)