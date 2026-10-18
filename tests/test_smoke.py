from app.main import app
from app.schemas.api import Login
from app.core.security import hash_password, verify_password, issue_token
import jwt
from app.core.config import get_settings
from uuid import uuid4


def test_routes_and_security_primitives():
    paths = app.openapi()['paths']
    assert '/api/v1/work-items' in paths
    assert '/api/v1/dashboard/attention' in paths
    encoded = hash_password('correct-password-123')
    assert verify_password('correct-password-123', encoded)
    assert not verify_password('incorrect', encoded)
    user_id = uuid4()
    payload = jwt.decode(issue_token(user_id), get_settings().jwt_secret, algorithms=[get_settings().jwt_algorithm])
    assert payload['sub'] == str(user_id)


def test_email_normalization():
    assert Login(email=' Person@Example.Com ', password='x').email == 'person@example.com'
