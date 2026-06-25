"""
Pydantic request models — validated at the router layer.
"""

from typing import Any, Optional
from pydantic import BaseModel, EmailStr, field_validator


class ChatRequest(BaseModel):
    message: str
    conversation_id: str
    history: Optional[list[dict[str, Any]]] = None
    page: int = 1
    dashboard_context: str = ""


class LoginRequest(BaseModel):
    username: str               # accepts email or username
    password: str
    remember_me: bool = False   # True → 30-day refresh token, False → 1-day


class SignupRequest(BaseModel):
    name: str
    username: str
    email: EmailStr
    password: str
    remember_me: bool = False

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("password must be at least 6 characters")
        return v


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    identifier: str     # email or username
    old_password: str   # must verify current password before allowing change
    new_password: str


class HistorySyncRequest(BaseModel):
    conversations: dict[str, Any]


class AssignOrgRequest(BaseModel):
    target_user_id: str     # id of the user to update
    org_id: str             # org slug/name to assign (e.g. "acme-corp")
    is_admin: bool = False  # grant admin rights for org document management
