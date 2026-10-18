from uuid import UUID
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.core.errors import error
from app.db.session import get_db
from app.models import User

bearer = HTTPBearer(auto_error=False)

def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if credentials is None or credentials.scheme.lower() != 'bearer':
        raise error(401, 'unauthorized', 'Authentication required')
    try:
        payload = jwt.decode(credentials.credentials, get_settings().jwt_secret, algorithms=[get_settings().jwt_algorithm], options={'require': ['sub', 'iat', 'exp']})
        user = db.get(User, UUID(payload['sub']))
    except (jwt.PyJWTError, ValueError, KeyError):
        raise error(401, 'unauthorized', 'Invalid token') from None
    if not user or not user.active:
        raise error(401, 'unauthorized', 'Invalid token')
    return user
