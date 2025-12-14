from datetime import datetime, timedelta

from flask import jsonify

from ..models import ActiveSession
from ..extensions import db
from . import admin_bp


def _check_stale_sessions() -> None:
    """Переводит «зависшие» активные сессии в статус 'stale'."""
    now = datetime.utcnow()
    stale = ActiveSession.query.filter(
        ActiveSession.status == "active",
        ActiveSession.last_activity < now - timedelta(seconds=60),
    ).all()
    if not stale:
        return
    for st in stale:
        st.status = "stale"
    db.session.commit()


@admin_bp.route("/active", methods=["GET"])
def list_active_sessions():
    """Список текущих сессий (актив + stale)."""
    _check_stale_sessions()
    active = ActiveSession.query.order_by(ActiveSession.start_time.asc()).all()
    results = []
    for a in active:
        results.append(
            {
                "id": a.id,
                "studentName": a.student_name,
                "group": a.group,
                "sessionName": a.session_name,
                "startTime": a.start_time.isoformat(),
                "lastActivity": a.last_activity.isoformat(),
                "status": a.status,
            }
        )
    return jsonify(results)

