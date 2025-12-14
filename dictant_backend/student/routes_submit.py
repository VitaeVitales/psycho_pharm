from flask import request, jsonify

from . import student_bp
from ..extensions import socketio
from ..services.session import (
    create_submission_record,
    close_active_session,
    notify_submission,
)
from ..utils.scoring import compute_score


def _remap_answers_to_key_order(answers: dict, drug_order: list) -> dict:
    """
    drug_order: список показанный_индекс -> исходный_индекс (как в ключе)
    Если answers ключуются "0..n-1" по показанному порядку, возвращаем dict,
    где ключи — исходные индексы.
    """
    if not isinstance(answers, dict) or not isinstance(drug_order, list):
        return answers

    n = len(drug_order)
    if n == 0:
        return answers

    shown_keys = {str(i) for i in range(n)}
    if set(map(str, answers.keys())) != shown_keys:
        # ответы уже, вероятно, в ключевом порядке или в другом формате
        return answers

    remapped = {}
    for shown_i in range(n):
        original_i = drug_order[shown_i]
        remapped[str(original_i)] = answers.get(str(shown_i), {})
    return remapped


@student_bp.route("/submit", methods=["POST"])
def submit():
    """HTTP-обёртка для приёма результатов диктанта."""
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON"}), 400

    answers = data.get("answers", {}) or {}
    session_name = data.get("sessionName")
    student_name = data.get("studentName")

    # 1) Подтягиваем ключ
    from ..models import Settings
    settings = Settings.query.first()
    answer_key = {}

    if settings and settings.answer_key:
        import json
        try:
            answer_key = json.loads(settings.answer_key)
        except Exception:
            answer_key = {}

    # 2) Если пришёл drugOrder — перемапим ответы в порядок ключа
    drug_order = data.get("drugOrder")
    if drug_order:
        answers = _remap_answers_to_key_order(answers, drug_order)
        data["answers"] = answers  # важно: сохраняем уже “в порядке ключа”

    # 3) Подсчёт баллов
    final_score, breakdown = compute_score(answers, answer_key)

    # 4) Создаём Submission + сохраняем в базу
    submission = create_submission_record(data, final_score, breakdown)

    # 5) Закрываем активную сессию (если была)
    close_active_session(student_name, session_name)

    # 6) WS-уведомления
    notify_submission(submission, socketio)

    return jsonify({"status": "ok", "score": final_score})

