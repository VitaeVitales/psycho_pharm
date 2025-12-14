from datetime import datetime, timedelta
import json
import hashlib
import random
from typing import List, Optional

from flask_socketio import SocketIO

from ..models import db, Settings, ActiveSession, Submission


# ---------------------------
# Helpers
# ---------------------------

def _stable_shuffle(n: int, seed_str: str) -> List[int]:
    """Детерминированная перестановка 0..n-1 по seed_str."""
    digest = hashlib.sha256(seed_str.encode("utf-8")).hexdigest()
    seed = int(digest[:16], 16)
    rng = random.Random(seed)
    idx = list(range(n))
    rng.shuffle(idx)
    return idx


# ---------------------------
# Student start
# ---------------------------

def start_session(data: dict, socketio: SocketIO) -> tuple[dict, int]:
    """
    Старт диктанта студентом.
    Возвращает ticket (уже перемешанный под конкретного студента).
    """
    code = (data.get("code") or "").strip()

    settings = Settings.query.first()
    if settings is None or (settings.code or "").strip() != code:
        return {"error": "Неверный код"}, 400

    student_name = (data.get("studentName") or "").strip()
    if not student_name:
        return {"error": "Укажите ФИО"}, 400
    group = (data.get("group") or "").strip() or None

    now = datetime.utcnow()

    active = ActiveSession.query.filter_by(
        student_name=student_name,
        session_name=settings.session_name or "",
    ).first()

    if not active:
        active = ActiveSession(
            student_name=student_name,
            group=group,
            session_name=settings.session_name or "",
            start_time=now,
            last_activity=now,
            status="active",
        )
        db.session.add(active)
    else:
        active.status = "active"
        active.last_activity = now

    db.session.commit()

    # ticket хранится в settings.drugs как list[dict] [{drug_id, dictated_ru, dictated_kind}]
    raw = json.loads(settings.drugs) if settings.drugs else []
    ticket: list = []
    if isinstance(raw, list) and raw:
        if isinstance(raw[0], dict):
            ticket = raw
        else:
            # fallback старого формата: просто строки
            ticket = [{"drug_id": str(i), "dictated_ru": str(x), "dictated_kind": "mnn"} for i, x in enumerate(raw)]

    n = len(ticket)
    seed_str = f"{settings.session_name}|{student_name}|{group}|{settings.code}|ticket_v1"
    order = _stable_shuffle(n, seed_str) if n > 0 else []
    ticket_shuffled = [ticket[i] for i in order] if n > 0 else []

    response = {
        "sessionName": settings.session_name,
        "duration": settings.duration or 0,
        "indicationKey": settings.indication_key,
        "indicationSets": json.loads(settings.indication_sets) if settings.indication_sets else {},
        "ticket": ticket_shuffled,
    }

    room = settings.session_name or None
    socketio.emit("active_updated", {}, room=room)
    return response, 200


def update_activity(student_name: str, session_name: str, socketio: SocketIO) -> None:
    if not student_name or not session_name:
        return
    active = ActiveSession.query.filter_by(
        student_name=student_name,
        session_name=session_name,
    ).first()
    if not active:
        return
    active.status = "active"
    active.last_activity = datetime.utcnow()
    db.session.commit()
    socketio.emit("active_updated", {}, room=session_name)


def check_stale_sessions() -> None:
    """Помечаем active как stale, если нет активности > 60 сек."""
    now = datetime.utcnow()
    stale = ActiveSession.query.filter(
        ActiveSession.status == "active",
        ActiveSession.last_activity < now - timedelta(seconds=60),
    ).all()
    if not stale:
        return
    for s in stale:
        s.status = "stale"
    db.session.commit()


# ---------------------------
# Submission helpers (нужны routes_submit.py)
# ---------------------------

def close_active_session(student_name: str, session_name: str) -> None:
    """Удаляем запись из ActiveSession после сдачи."""
    if not student_name:
        return
    active = ActiveSession.query.filter_by(
        student_name=student_name,
        session_name=session_name or "",
    ).first()
    if active:
        db.session.delete(active)
        db.session.commit()


def create_submission_record(data: dict, score: float | None, score_details: dict) -> Submission:
    """
    Создаёт запись Submission и сохраняет в БД.
    """
    from ..utils.timeparse import parse_iso_time

    submission = Submission(
        session_name=data.get("sessionName"),
        student_name=data.get("studentName"),
        group=data.get("group"),
        start_time=parse_iso_time(data.get("startTime")),
        end_time=parse_iso_time(data.get("endTime")),
        warnings=json.dumps(data.get("warnings", []), ensure_ascii=False),
        answers=json.dumps(data.get("answers", {}), ensure_ascii=False),
        auto_submitted=bool(data.get("autoSubmitted")),
        score=score,
        score_details=json.dumps(score_details or {}, ensure_ascii=False),
    )
    db.session.add(submission)
    db.session.commit()
    return submission


def notify_submission(submission: Submission, socketio: SocketIO) -> None:
    """
    WS уведомления админке:
    - student_finished
    - submission_created
    - active_updated
    """
    room = submission.session_name or None

    socketio.emit(
        "student_finished",
        {
            "studentName": submission.student_name,
            "group": submission.group,
            "sessionName": submission.session_name,
            "score": submission.score,
        },
        room=room,
    )

    socketio.emit(
        "submission_created",
        {
            "id": submission.id,
            "sessionName": submission.session_name,
            "studentName": submission.student_name,
            "group": submission.group,
            "startTime": submission.start_time.isoformat() if submission.start_time else None,
            "endTime": submission.end_time.isoformat() if submission.end_time else None,
            "autoSubmitted": submission.auto_submitted,
            "score": submission.score,
        },
        room=room,
    )

    socketio.emit("active_updated", {}, room=room)


