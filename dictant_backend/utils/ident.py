import re
import secrets
import string


def normalize_name(full_name: str) -> str:
    """
    Normalize a human-entered full name to a stable lookup key.

    Minimal and safe normalization:
    - strip
    - collapse whitespace
    - lowercase
    """
    if full_name is None:
        return ""
    s = full_name.strip()
    s = re.sub(r"\s+", " ", s)
    return s.lower()


def generate_join_code(length: int = 10) -> str:
    """
    Generate a join code for an exam session.
    Uses URL-safe characters (letters+digits) to be phone-friendly.
    """
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))
