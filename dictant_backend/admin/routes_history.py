import json
from flask import jsonify

from ..models import Submission
from . import admin_bp


@admin_bp.route("/sessions", methods=["GET"])
def list_submissions():
    """История всех отправленных диктантов."""
    submissions = Submission.query.order_by(Submission.start_time.desc()).all()
    results = []
    for sub in submissions:
        results.append(
            {
                "id": sub.id,
                "sessionName": sub.session_name,
                "studentName": sub.student_name,
                "group": sub.group,
                "startTime": sub.start_time.isoformat() if sub.start_time else None,
                "endTime": sub.end_time.isoformat() if sub.end_time else None,
                "warnings": json.loads(sub.warnings) if sub.warnings else [],
                "autoSubmitted": sub.auto_submitted,
                "score": sub.score,
            }
        )
    return jsonify(results)

