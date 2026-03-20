from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.classes import ClassDomainError, _require_supabase_credentials, _safe_json, _service_headers, _supabase_base_url
from app.config import Settings, get_settings
from app.providers import generate_with_fallback
from app.canvas import _strip_fence, CHART_SPEC_SCHEMA
from app.schemas import ApiEnvelope, ApiError, DataQueryRequest, GenerateRequest

logger = logging.getLogger(__name__)

analytics_router = APIRouter(prefix="/v1/analytics")

INSIGHTS_CACHE_TTL_SECONDS = 3600  # 1 hour

BLOOM_LEVELS_ORDERED = ["remember", "understand", "apply", "analyze", "evaluate", "create"]

ANALYTICS_SYSTEM_PROMPT = """You are an educational analytics assistant. You will receive aggregated, anonymized
learning data for a class. Generate insights in valid JSON. No markdown, no prose —
only the JSON object specified.

Schema: {
  "executive_summary": string,
  "key_findings": string[],
  "interventions": [{"type": string, "topic_id": string, "topic_title": string, "reason": string, "suggested_action": string}],
  "student_summaries": [{"student_id": string, "summary": string}]
}

Rules:
- executive_summary: 2-3 sentences, plain English, pedagogically grounded
- key_findings: 3-5 bullets, specific and quantified
- interventions: max 3, most impactful first, type must be "generate_quiz", be specific about what to assign
- student_summaries: one entry per student in the input data; summary is 1 sentence describing their specific pattern (e.g., "struggling with apply-level objectives, minimal chat engagement")
- Do not invent data not present in the input"""


class ClassInsightsRequest(BaseModel):
    user_id: str
    class_id: str
    force_refresh: bool = False


def compute_risk_level(avg_score: float, completion_rate: float) -> str:
    """Compute at-risk level per plan thresholds."""
    if avg_score < 0.60 and completion_rate < 0.50:
        return "high"
    if avg_score < 0.70 or completion_rate < 0.50:
        return "medium"
    return "low"


def compute_topic_status(avg_score: float) -> str:
    if avg_score < 0.60:
        return "critical"
    if avg_score <= 0.75:
        return "warning"
    return "good"


def format_display_name(display_name: str | None) -> str:
    """Format display_name as 'First L.' — first word + last-word initial + period."""
    if not display_name or not display_name.strip():
        return "Unknown"
    parts = display_name.strip().split()
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


def _get_cached_snapshot(client: httpx.Client, settings: Settings, class_id: str) -> dict[str, Any] | None:
    """Return cached snapshot if it exists and is less than 1 hour old, else None."""
    base_url = _supabase_base_url(settings)
    url = (
        f"{base_url}/rest/v1/class_insights_snapshots"
        f"?select=payload,generated_at&class_id=eq.{quote(class_id, safe='')}&limit=1"
    )
    response = client.get(url, headers=_service_headers(settings))
    rows = _safe_json(response)
    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    if not isinstance(row, dict):
        return None
    generated_at_str = row.get("generated_at")
    if not isinstance(generated_at_str, str):
        return None
    try:
        generated_at = datetime.fromisoformat(generated_at_str.replace("Z", "+00:00"))
    except ValueError:
        return None
    if datetime.now(UTC) - generated_at > timedelta(seconds=INSIGHTS_CACHE_TTL_SECONDS):
        return None
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return None
    return payload


def _upsert_snapshot(client: httpx.Client, settings: Settings, class_id: str, payload: dict[str, Any]) -> None:
    base_url = _supabase_base_url(settings)
    url = f"{base_url}/rest/v1/class_insights_snapshots?on_conflict=class_id"
    response = client.post(
        url,
        headers={
            **_service_headers(settings),
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={
            "class_id": class_id,
            "generated_at": datetime.now(UTC).isoformat(),
            "payload": payload,
        },
    )
    if response.status_code >= 400:
        error_payload = _safe_json(response)
        logger.warning(
            "Failed to upsert insights snapshot for class %s: %s",
            class_id,
            error_payload,
        )


def _check_teacher_enrollment(client: httpx.Client, settings: Settings, user_id: str, class_id: str) -> None:
    """Raise ClassDomainError(403) if user_id is not teacher/TA of class_id."""
    base_url = _supabase_base_url(settings)
    url = (
        f"{base_url}/rest/v1/enrollments"
        f"?select=role&class_id=eq.{quote(class_id, safe='')}&user_id=eq.{quote(user_id, safe='')}&limit=1"
    )
    response = client.get(url, headers=_service_headers(settings))
    rows = _safe_json(response)
    if not isinstance(rows, list) or not rows:
        raise ClassDomainError(
            message="You are not enrolled in this class or do not have access.",
            code="forbidden",
            status_code=403,
        )
    row = rows[0]
    role = row.get("role") if isinstance(row, dict) else None
    if role not in ("teacher", "ta"):
        raise ClassDomainError(
            message="Only teachers and TAs can access class insights.",
            code="forbidden",
            status_code=403,
        )


def _generate_insights_payload(
    settings: Settings,
    class_id: str,
) -> dict[str, Any]:
    """Synchronous aggregation + LLM synthesis. Returns the full insights payload dict."""
    _require_supabase_credentials(settings)
    timeout_seconds = max(30, settings.ai_request_timeout_ms / 1000)
    base_url = _supabase_base_url(settings)

    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        # --- 1. Fetch enrolled students ---
        enrolled_url = (
            f"{base_url}/rest/v1/enrollments"
            f"?select=user_id,role&class_id=eq.{quote(class_id, safe='')}&role=eq.student"
        )
        enrolled_resp = client.get(enrolled_url, headers=_service_headers(settings))
        enrolled_rows = _safe_json(enrolled_resp)
        student_ids: list[str] = []
        if isinstance(enrolled_rows, list):
            student_ids = [r["user_id"] for r in enrolled_rows if isinstance(r, dict) and isinstance(r.get("user_id"), str)]

        # --- 2. Fetch published blueprint for this class ---
        blueprint_url = (
            f"{base_url}/rest/v1/blueprints"
            f"?select=id&class_id=eq.{quote(class_id, safe='')}&status=eq.published&order=version.desc&limit=1"
        )
        bp_resp = client.get(blueprint_url, headers=_service_headers(settings))
        bp_rows = _safe_json(bp_resp)
        blueprint_id: str | None = None
        if isinstance(bp_rows, list) and bp_rows:
            blueprint_id = bp_rows[0].get("id") if isinstance(bp_rows[0], dict) else None

        # --- 3. Fetch topics + objectives ---
        topics_by_id: dict[str, dict[str, Any]] = {}
        bloom_levels_by_topic: dict[str, list[str]] = defaultdict(list)

        if blueprint_id:
            topics_url = (
                f"{base_url}/rest/v1/topics"
                f"?select=id,title&blueprint_id=eq.{quote(blueprint_id, safe='')}"
            )
            topics_resp = client.get(topics_url, headers=_service_headers(settings))
            topics_rows = _safe_json(topics_resp)
            if isinstance(topics_rows, list):
                for t in topics_rows:
                    if isinstance(t, dict) and isinstance(t.get("id"), str):
                        topics_by_id[t["id"]] = {"title": t.get("title", ""), "id": t["id"]}

            if topics_by_id:
                topic_ids_param = ",".join(quote(tid, safe="") for tid in topics_by_id)
                objectives_url = (
                    f"{base_url}/rest/v1/objectives"
                    f"?select=topic_id,level&topic_id=in.({topic_ids_param})"
                )
                obj_resp = client.get(objectives_url, headers=_service_headers(settings))
                obj_rows = _safe_json(obj_resp)
                if isinstance(obj_rows, list):
                    for obj in obj_rows:
                        if isinstance(obj, dict) and isinstance(obj.get("topic_id"), str):
                            lvl = obj.get("level")
                            if isinstance(lvl, str) and lvl.strip():
                                bloom_levels_by_topic[obj["topic_id"]].append(lvl.strip().lower())

        # --- 4. Fetch published quiz activities ---
        activities_url = (
            f"{base_url}/rest/v1/activities"
            f"?select=id,topic_id,title&class_id=eq.{quote(class_id, safe='')}&type=eq.quiz&status=eq.published"
        )
        acts_resp = client.get(activities_url, headers=_service_headers(settings))
        acts_rows = _safe_json(acts_resp)
        activities_by_id: dict[str, dict[str, Any]] = {}
        if isinstance(acts_rows, list):
            for a in acts_rows:
                if isinstance(a, dict) and isinstance(a.get("id"), str):
                    activities_by_id[a["id"]] = {
                        "id": a["id"],
                        "topic_id": a.get("topic_id"),  # may be None
                        "title": a.get("title", ""),
                    }

        # --- 5. Empty state check ---
        if not activities_by_id:
            return _build_empty_payload()

        # --- 6. Fetch assignments for published activities ---
        activity_ids = list(activities_by_id.keys())
        activity_ids_param = ",".join(quote(aid, safe="") for aid in activity_ids)
        assignments_url = (
            f"{base_url}/rest/v1/assignments"
            f"?select=id,activity_id&class_id=eq.{quote(class_id, safe='')}&activity_id=in.({activity_ids_param})"
        )
        assigns_resp = client.get(assignments_url, headers=_service_headers(settings))
        assigns_rows = _safe_json(assigns_resp)
        assignment_to_activity: dict[str, str] = {}
        if isinstance(assigns_rows, list):
            for a in assigns_rows:
                if isinstance(a, dict) and isinstance(a.get("id"), str) and isinstance(a.get("activity_id"), str):
                    assignment_to_activity[a["id"]] = a["activity_id"]

        # --- 7. Fetch submissions ---
        submissions: list[dict[str, Any]] = []
        if assignment_to_activity:
            assignment_ids_param = ",".join(quote(aid, safe="") for aid in assignment_to_activity)
            subs_url = (
                f"{base_url}/rest/v1/submissions"
                f"?select=assignment_id,student_id,score&assignment_id=in.({assignment_ids_param})"
            )
            subs_resp = client.get(subs_url, headers=_service_headers(settings))
            subs_rows = _safe_json(subs_resp)
            if isinstance(subs_rows, list):
                submissions = [r for r in subs_rows if isinstance(r, dict)]

        if not submissions:
            return _build_empty_payload()

        # --- 8. Fetch assignment_recipients for completion rate ---
        recipients: list[dict[str, Any]] = []
        if assignment_to_activity:
            assignment_ids_param = ",".join(quote(aid, safe="") for aid in assignment_to_activity)
            recipients_url = (
                f"{base_url}/rest/v1/assignment_recipients"
                f"?select=assignment_id,student_id,status&assignment_id=in.({assignment_ids_param})"
            )
            rec_resp = client.get(recipients_url, headers=_service_headers(settings))
            rec_rows = _safe_json(rec_resp)
            if isinstance(rec_rows, list):
                recipients = [r for r in rec_rows if isinstance(r, dict)]

        # --- 9. Fetch chat message counts per student ---
        chat_counts: dict[str, int] = defaultdict(int)
        if student_ids:
            student_ids_param = ",".join(quote(sid, safe="") for sid in student_ids)
            # Count messages authored by each student in this class
            chat_url = (
                f"{base_url}/rest/v1/class_chat_messages"
                f"?select=author_user_id&class_id=eq.{quote(class_id, safe='')}"
                f"&author_user_id=in.({student_ids_param})&author_kind=in.(student,teacher)"
            )
            chat_resp = client.get(chat_url, headers=_service_headers(settings))
            chat_rows = _safe_json(chat_resp)
            if isinstance(chat_rows, list):
                for row in chat_rows:
                    if isinstance(row, dict) and isinstance(row.get("author_user_id"), str):
                        chat_counts[row["author_user_id"]] += 1

        # --- 10. Fetch display_names for enrolled students ---
        display_names: dict[str, str] = {}
        if student_ids:
            student_ids_param = ",".join(quote(sid, safe="") for sid in student_ids)
            profiles_url = (
                f"{base_url}/rest/v1/profiles"
                f"?select=id,display_name&id=in.({student_ids_param})"
            )
            profiles_resp = client.get(profiles_url, headers=_service_headers(settings))
            profiles_rows = _safe_json(profiles_resp)
            if isinstance(profiles_rows, list):
                for p in profiles_rows:
                    if isinstance(p, dict) and isinstance(p.get("id"), str):
                        display_names[p["id"]] = format_display_name(p.get("display_name"))

        # --- 11. Aggregate per-student, per-activity, per-topic ---
        # Submissions indexed by (assignment_id, student_id) → list of scores
        sub_scores: dict[tuple[str, str], list[float]] = defaultdict(list)
        for sub in submissions:
            aid = sub.get("assignment_id")
            sid = sub.get("student_id")
            score = sub.get("score")
            if isinstance(aid, str) and isinstance(sid, str) and isinstance(score, (int, float)):
                sub_scores[(aid, sid)].append(float(score))

        # Completion per student: count assignments that have a recipient row
        # status "submitted" or "reviewed" = complete
        completion_by_student: dict[str, dict[str, str]] = defaultdict(dict)
        for rec in recipients:
            aid = rec.get("assignment_id")
            sid = rec.get("student_id")
            status = rec.get("status")
            if isinstance(aid, str) and isinstance(sid, str) and isinstance(status, str):
                completion_by_student[sid][aid] = status

        # Build per-student data
        # Track total assignments assigned to determine denominator
        all_assignment_ids = set(assignment_to_activity.keys())

        students_data: list[dict[str, Any]] = []
        all_scores: list[float] = []

        for student_id in student_ids:
            student_assignment_scores: dict[str, list[float]] = defaultdict(list)
            activity_breakdown: list[dict[str, Any]] = []

            for assignment_id, activity_id in assignment_to_activity.items():
                scores = sub_scores.get((assignment_id, student_id), [])
                best = max(scores) if scores else None
                activity_info = activities_by_id.get(activity_id, {})
                activity_breakdown.append({
                    "activity_id": activity_id,
                    "title": activity_info.get("title", ""),
                    "score": best if best is not None else 0.0,
                    "attempts": len(scores),
                })
                if best is not None:
                    student_assignment_scores[assignment_id] = [best]
                    all_scores.append(best)

            # Student avg score (only over attempted assignments)
            attempted_scores = [s for slist in student_assignment_scores.values() for s in slist]
            avg_score = sum(attempted_scores) / len(attempted_scores) if attempted_scores else 0.0

            # Completion rate
            assigned_count = len(all_assignment_ids)
            completed_count = sum(
                1 for aid in all_assignment_ids
                if completion_by_student.get(student_id, {}).get(aid) in ("submitted", "reviewed")
            )
            completion_rate = completed_count / assigned_count if assigned_count > 0 else 0.0

            risk_level = compute_risk_level(avg_score, completion_rate)

            students_data.append({
                "student_id": student_id,
                "display_name": display_names.get(student_id, "Unknown"),
                "avg_score": round(avg_score, 4),
                "completion_rate": round(completion_rate, 4),
                "chat_message_count": chat_counts.get(student_id, 0),
                "risk_level": risk_level,
                "activity_breakdown": activity_breakdown,
                "ai_mini_summary": None,  # populated after LLM call
            })

        # --- 12. Topic-level aggregations ---
        topic_scores: dict[str, list[float]] = defaultdict(list)
        topic_attempt_counts: dict[str, int] = defaultdict(int)

        for assignment_id, activity_id in assignment_to_activity.items():
            activity_info = activities_by_id.get(activity_id, {})
            topic_id = activity_info.get("topic_id")
            if not topic_id:
                continue
            for (aid, _), scores in sub_scores.items():
                if aid == assignment_id and scores:
                    topic_scores[topic_id].extend(scores)
                    topic_attempt_counts[topic_id] += len(scores)

        topics_output: list[dict[str, Any]] = []
        for topic_id, topic_info in topics_by_id.items():
            scores = topic_scores.get(topic_id, [])
            if not scores:
                continue
            avg = sum(scores) / len(scores)
            topics_output.append({
                "topic_id": topic_id,
                "title": topic_info.get("title", ""),
                "bloom_levels": list(set(bloom_levels_by_topic.get(topic_id, []))),
                "avg_score": round(avg, 4),
                "attempt_count": topic_attempt_counts.get(topic_id, 0),
                "status": compute_topic_status(avg),
            })

        # --- 13. Bloom breakdown ---
        bloom_scores: dict[str, list[float]] = defaultdict(list)
        for topic_id, topic_info in topics_by_id.items():
            scores = topic_scores.get(topic_id, [])
            if not scores:
                continue
            avg = sum(scores) / len(scores)
            for level in bloom_levels_by_topic.get(topic_id, []):
                if level in BLOOM_LEVELS_ORDERED:
                    bloom_scores[level].append(avg)

        bloom_breakdown: dict[str, float | None] = {}
        for level in BLOOM_LEVELS_ORDERED:
            level_scores = bloom_scores.get(level, [])
            bloom_breakdown[level] = round(sum(level_scores) / len(level_scores), 4) if level_scores else None

        # --- 14. Class summary ---
        overall_avg = sum(all_scores) / len(all_scores) if all_scores else 0.0
        all_completion_rates = [s["completion_rate"] for s in students_data]
        overall_completion = sum(all_completion_rates) / len(all_completion_rates) if all_completion_rates else 0.0
        at_risk_count = sum(1 for s in students_data if s["risk_level"] in ("high", "medium"))
        avg_chat_messages = (
            sum(chat_counts.get(sid, 0) for sid in student_ids) / len(student_ids)
            if student_ids else 0.0
        )

        class_summary = {
            "student_count": len(student_ids),
            "avg_score": round(overall_avg, 4),
            "completion_rate": round(overall_completion, 4),
            "at_risk_count": at_risk_count,
            "avg_chat_messages": round(avg_chat_messages, 2),
            "is_empty": False,
        }

        # --- 15. LLM synthesis ---
        ai_narrative: dict[str, Any] | None = None
        try:
            stats_for_llm = {
                "class_summary": class_summary,
                "topics": topics_output,
                "bloom_breakdown": bloom_breakdown,
                "students": [
                    {
                        "student_id": s["student_id"],
                        "avg_score": s["avg_score"],
                        "completion_rate": s["completion_rate"],
                        "chat_message_count": s["chat_message_count"],
                        "risk_level": s["risk_level"],
                    }
                    for s in students_data
                ],
            }
            user_prompt = f"Class learning data:\n{json.dumps(stats_for_llm, indent=2)}"
            llm_request = GenerateRequest(
                system=ANALYTICS_SYSTEM_PROMPT,
                user=user_prompt,
                temperature=0.3,
                max_tokens=2000,
                timeout_ms=60000,
            )
            llm_result = generate_with_fallback(settings, llm_request)
            raw_content = llm_result.content.strip()
            # Strip markdown code fences if present
            if raw_content.startswith("```"):
                lines = raw_content.split("\n")
                raw_content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
            parsed = json.loads(raw_content)
            ai_narrative = {
                "executive_summary": parsed.get("executive_summary", ""),
                "key_findings": parsed.get("key_findings", []),
                "interventions": parsed.get("interventions", []),
            }
            # Map student summaries back to students
            student_summaries_by_id = {
                entry["student_id"]: entry.get("summary", "")
                for entry in parsed.get("student_summaries", [])
                if isinstance(entry, dict) and isinstance(entry.get("student_id"), str)
            }
            for student in students_data:
                student["ai_mini_summary"] = student_summaries_by_id.get(student["student_id"])
        except Exception as exc:
            logger.warning("LLM call failed for class insights %s: %s", class_id, exc)
            ai_narrative = None

        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "class_summary": class_summary,
            "topics": topics_output,
            "bloom_breakdown": bloom_breakdown,
            "students": students_data,
            "ai_narrative": ai_narrative,
        }


def _build_empty_payload() -> dict[str, Any]:
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "class_summary": {
            "student_count": 0,
            "avg_score": 0.0,
            "completion_rate": 0.0,
            "at_risk_count": 0,
            "avg_chat_messages": 0.0,
            "is_empty": True,
        },
        "topics": [],
        "bloom_breakdown": {level: None for level in BLOOM_LEVELS_ORDERED},
        "students": [],
        "ai_narrative": None,
    }


def get_class_insights(settings: Settings, request: ClassInsightsRequest) -> dict[str, Any]:
    """Main entry point for class insights. Handles caching and generation."""
    _require_supabase_credentials(settings)
    timeout_seconds = max(30, settings.ai_request_timeout_ms / 1000)

    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        _check_teacher_enrollment(client, settings, request.user_id, request.class_id)

        if not request.force_refresh:
            cached = _get_cached_snapshot(client, settings, request.class_id)
            if cached is not None:
                return cached

    # Generate fresh payload (uses its own httpx client internally)
    payload = _generate_insights_payload(settings, request.class_id)

    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        _upsert_snapshot(client, settings, request.class_id, payload)

    return payload


@analytics_router.post("/class-insights")
async def class_insights_route(request: Request, payload: ClassInsightsRequest):
    from app.main import _authorize_request

    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(get_class_insights, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ClassDomainError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="analytics_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )



DATA_QUERY_SYSTEM_PROMPT = f"""You are an educational analytics assistant. Given aggregated class data and a teacher's natural language question, generate a chart specification in JSON.

Return ONLY valid JSON matching this schema:
{CHART_SPEC_SCHEMA}

Rules:
- chartType: use bar for category comparisons, line for trends, pie for proportions, scatter for correlations
- data: 2-8 data points max, values should be meaningful numbers (scores as percentages 0-100, counts as integers)
- If the question cannot be answered from the available data, return a bar chart with a single data point {{"label":"No data available","value":0}}
- Do not invent data not present in the input"""


def generate_data_query_chart(settings: Settings, request: DataQueryRequest) -> dict:
    """Generate a chart spec from a natural language teacher query using available class insights data."""
    _require_supabase_credentials(settings)
    timeout_seconds = max(30, settings.ai_request_timeout_ms / 1000)
    base_url = _supabase_base_url(settings)

    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        _check_teacher_enrollment(client, settings, request.user_id, request.class_id)

        # Fetch topic performance data for this class
        blueprint_url = (
            f"{base_url}/rest/v1/blueprints"
            f"?select=id&class_id=eq.{quote(request.class_id, safe='')}&status=eq.published&order=version.desc&limit=1"
        )
        bp_resp = client.get(blueprint_url, headers=_service_headers(settings))
        bp_rows = _safe_json(bp_resp)
        blueprint_id = bp_rows[0].get("id") if isinstance(bp_rows, list) and bp_rows and isinstance(bp_rows[0], dict) else None

        topics_data: list[dict] = []
        if blueprint_id:
            topics_url = (
                f"{base_url}/rest/v1/topics"
                f"?select=id,title&blueprint_id=eq.{quote(blueprint_id, safe='')}&limit=100"
            )
            topics_resp = client.get(topics_url, headers=_service_headers(settings))
            topics_rows = _safe_json(topics_resp)
            if isinstance(topics_rows, list):
                for t in topics_rows:
                    if isinstance(t, dict) and isinstance(t.get("id"), str):
                        topics_data.append({"id": t["id"], "title": t.get("title", "")})

        # Fetch student scores summary
        enrolled_url = (
            f"{base_url}/rest/v1/enrollments"
            f"?select=user_id&class_id=eq.{quote(request.class_id, safe='')}&role=eq.student&limit=500"
        )
        enrolled_resp = client.get(enrolled_url, headers=_service_headers(settings))
        enrolled_rows = _safe_json(enrolled_resp)
        student_count = len(enrolled_rows) if isinstance(enrolled_rows, list) else 0

        # Fetch activities
        activities_url = (
            f"{base_url}/rest/v1/activities"
            f"?select=id,title,type&class_id=eq.{quote(request.class_id, safe='')}&status=eq.published&limit=100"
        )
        acts_resp = client.get(activities_url, headers=_service_headers(settings))
        acts_rows = _safe_json(acts_resp)
        activities: list[dict] = []
        if isinstance(acts_rows, list):
            activities = [{"id": a["id"], "title": a.get("title", ""), "type": a.get("type", "")} for a in acts_rows if isinstance(a, dict) and isinstance(a.get("id"), str)]

        # Try to use cached insights snapshot for richer numeric context
        rich_context: dict | None = None
        try:
            rich_context = _get_cached_snapshot(client, settings, request.class_id)
        except Exception as exc:
            logger.warning("Snapshot fetch failed for class %s: %s", request.class_id, exc)

    if rich_context and not rich_context.get("class_summary", {}).get("is_empty"):
        # Use the full insights snapshot for rich chart generation
        class_summary = rich_context.get("class_summary", {})
        topics_from_cache = rich_context.get("topics", [])
        students_from_cache = rich_context.get("students", [])
        bloom = rich_context.get("bloom_breakdown", {})

        data_context = {
            "class_summary": {
                "student_count": class_summary.get("student_count", 0),
                "avg_score_pct": round(class_summary.get("avg_score", 0) * 100, 1),
                "completion_rate_pct": round(class_summary.get("completion_rate", 0) * 100, 1),
                "at_risk_count": class_summary.get("at_risk_count", 0),
                "avg_chat_messages": class_summary.get("avg_chat_messages", 0),
            },
            "topics": [
                {
                    "title": t.get("title", ""),
                    "avg_score_pct": round(t.get("avg_score", 0) * 100, 1),
                    "attempt_count": t.get("attempt_count", 0),
                    "status": t.get("status", ""),
                }
                for t in topics_from_cache
            ],
            "students": [
                {
                    "name": s.get("display_name", ""),
                    "avg_score_pct": round(s.get("avg_score", 0) * 100, 1),
                    "completion_rate_pct": round(s.get("completion_rate", 0) * 100, 1),
                    "chat_message_count": s.get("chat_message_count", 0),
                    "risk_level": s.get("risk_level", ""),
                }
                for s in students_from_cache
            ],
            "bloom_breakdown": {
                level: (round(score * 100, 1) if score is not None else None)
                for level, score in bloom.items()
            },
        }
    else:
        # Fallback: lightweight context when no snapshot available
        data_context = {
            "student_count": student_count,
            "topics": [{"title": t["title"]} for t in topics_data],
            "activities": activities,
            "note": "No detailed score data available yet. Students may not have submitted any assignments.",
        }

    user_prompt = "\n".join([
        f"Teacher question: {request.query}",
        "",
        f"Available class data:\n{json.dumps(data_context, indent=2)}",
        "",
        "Generate a chart specification that answers the teacher's question using this data.",
    ])

    result = generate_with_fallback(
        settings,
        GenerateRequest(
            system=DATA_QUERY_SYSTEM_PROMPT,
            user=user_prompt,
            temperature=0.2,
            max_tokens=800,
            timeout_ms=20000,
        ),
    )

    raw = _strip_fence(result.content.strip())
    if not raw:
        raise RuntimeError("Data query chart generation returned an empty response.")

    try:
        spec = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Data query chart generation returned invalid JSON: {exc}") from exc

    if not isinstance(spec, dict) or spec.get("type") != "chart":
        raise RuntimeError(f"Data query chart generation returned unexpected type: {spec.get('type')}")

    return spec


@analytics_router.post("/data-query")
async def data_query_route(request: Request, payload: DataQueryRequest):
    from app.main import _authorize_request

    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized
    if actor_user_id:
        payload.user_id = actor_user_id

    try:
        spec = await run_in_threadpool(generate_data_query_chart, settings, payload)
        return ApiEnvelope(
            ok=True,
            data={"spec": spec},
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ClassDomainError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="data_query_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
