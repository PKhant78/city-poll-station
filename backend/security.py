import hashlib
import secrets


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    return f'scrypt${salt.hex()}${digest.hex()}'


def verify_password(password, encoded):
    _, salt, expected = encoded.split('$')
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=64)
    return secrets.compare_digest(digest.hex(), expected)


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()
