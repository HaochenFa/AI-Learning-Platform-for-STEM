from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.schemas import (
    ClassCreateRequest,
    ClassCreateResult,
    ClassJoinRequest,
    ClassJoinResult,
)


@dataclass
class ClassDomainError(RuntimeError):
    message: str
    code: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


def create_class(settings: Settings, request: ClassCreateRequest) -> ClassCreateResult:
    _require_supabase_credentials(settings)
    timeout_seconds = max(5, settings.ai_request_timeout_ms / 1000)
    base_url = _supabase_base_url(settings)
    with httpx.Client(timeout=timeout_seconds) as client:
        account_type = _load_account_type(client, settings, request.user_id)
        if account_type != "teacher":
            raise ClassDomainError(
                message="Only teacher accounts can create classes.",
                code="forbidden_account_type",
                status_code=403,
            )

        classes_url = f"{base_url}/rest/v1/classes"
        create_response = client.post(
            classes_url,
            headers={
                **_service_headers(settings),
                "Prefer": "return=representation",
            },
            json={
                "owner_id": request.user_id,
                "title": request.title,
                "subject": request.subject,
                "level": request.level,
                "description": request.description,
                "join_code": request.join_code,
            },
        )
        create_payload = _safe_json(create_response)
        if create_response.status_code >= 400:
            if _is_unique_violation(create_payload):
                raise ClassDomainError(
                    message="Join code already exists.",
                    code="join_code_conflict",
                    status_code=409,
                )
            message = _extract_error_message(
                create_payload) or "Failed to create class."
            raise RuntimeError(message)

        class_id = _extract_first_id(create_payload)
        if not class_id:
            raise RuntimeError(
                "Supabase create class response did not include class id.")

        enrollments_url = f"{base_url}/rest/v1/enrollments?on_conflict=class_id,user_id"
        enrollment_response = client.post(
            enrollments_url,
            headers={
                **_service_headers(settings),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json={
                "class_id": class_id,
                "user_id": request.user_id,
                "role": "teacher",
            },
        )
        if enrollment_response.status_code >= 400:
            _rollback_created_class(client, settings, class_id)
            enrollment_payload = _safe_json(enrollment_response)
            message = _extract_error_message(
                enrollment_payload) or "Failed to create class enrollment."
            raise RuntimeError(message)

        return ClassCreateResult(class_id=class_id)


def join_class(settings: Settings, request: ClassJoinRequest) -> ClassJoinResult:
    _require_supabase_credentials(settings)
    timeout_seconds = max(5, settings.ai_request_timeout_ms / 1000)
    base_url = _supabase_base_url(settings)
    with httpx.Client(timeout=timeout_seconds) as client:
        account_type = _load_account_type(client, settings, request.user_id)
        if account_type != "student":
            raise ClassDomainError(
                message="Only student accounts can join classes via join code.",
                code="forbidden_account_type",
                status_code=403,
            )

        normalized_join_code = request.join_code.strip().upper()
        if not normalized_join_code:
            raise ClassDomainError(
                message="Invalid join code.",
                code="class_not_found",
                status_code=404,
            )

        encoded_join_code = quote(normalized_join_code, safe="")
        classes_lookup_url = (
            f"{base_url}/rest/v1/classes"
            f"?select=id&join_code=eq.{encoded_join_code}&limit=1"
        )
        class_lookup_response = client.get(
            classes_lookup_url,
            headers=_service_headers(settings),
        )
        class_lookup_payload = _safe_json(class_lookup_response)
        if class_lookup_response.status_code >= 400:
            message = _extract_error_message(
                class_lookup_payload) or "Failed to lookup class by join code."
            raise RuntimeError(message)

        class_id = _extract_first_id(class_lookup_payload)
        if not class_id:
            raise ClassDomainError(
                message="Invalid join code.",
                code="class_not_found",
                status_code=404,
            )

        enrollments_url = f"{base_url}/rest/v1/enrollments?on_conflict=class_id,user_id"
        enrollment_response = client.post(
            enrollments_url,
            headers={
                **_service_headers(settings),
                "Prefer": "resolution=ignore-duplicates,return=minimal",
            },
            json={
                "class_id": class_id,
                "user_id": request.user_id,
                "role": "student",
            },
        )
        if enrollment_response.status_code >= 400:
            enrollment_payload = _safe_json(enrollment_response)
            message = _extract_error_message(
                enrollment_payload) or "Failed to join class."
            raise RuntimeError(message)

        return ClassJoinResult(class_id=class_id)


def _require_supabase_credentials(settings: Settings) -> None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "Supabase service credentials are not configured on Python backend.")


def _supabase_base_url(settings: Settings) -> str:
    if not settings.supabase_url:
        raise RuntimeError(
            "Supabase service URL is not configured on Python backend.")
    return settings.supabase_url.rstrip("/")


def _load_account_type(client: httpx.Client, settings: Settings, user_id: str) -> str:
    base_url = _supabase_base_url(settings)
    profile_url = (
        f"{base_url}/rest/v1/profiles"
        f"?select=account_type&id=eq.{quote(user_id, safe='')}&limit=1"
    )
    response = client.get(
        profile_url,
        headers=_service_headers(settings),
    )
    payload = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(
            payload) or "Failed to load user profile."
        raise RuntimeError(message)

    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            account_type = first.get("account_type")
            if isinstance(account_type, str) and account_type.strip():
                return account_type.strip()

    raise ClassDomainError(
        message="Profile with account_type is required before class actions.",
        code="profile_missing",
        status_code=400,
    )


def _rollback_created_class(client: httpx.Client, settings: Settings, class_id: str) -> None:
    base_url = _supabase_base_url(settings)
    delete_url = f"{base_url}/rest/v1/classes?id=eq.{quote(class_id, safe='')}"
    try:
        client.delete(
            delete_url,
            headers=_service_headers(settings),
        )
    except Exception:
        return


def _extract_first_id(payload: Any) -> str | None:
    if not isinstance(payload, list) or not payload:
        return None
    first = payload[0]
    if not isinstance(first, dict):
        return None
    value = first.get("id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _service_headers(settings: Settings) -> dict[str, str]:
    return {
        "apikey": settings.supabase_service_role_key or "",
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {}


def _extract_error_message(payload: Any) -> str | None:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        details = payload.get("details")
        if isinstance(details, str) and details.strip():
            return details.strip()
    return None


def _is_unique_violation(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    code = payload.get("code")
    if code == "23505":
        return True

    message = _extract_error_message(payload)
    if not message:
        return False
    normalized = message.lower()
    return "duplicate key" in normalized or "unique constraint" in normalized
