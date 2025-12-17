import json
import re
from flask import request, jsonify

from ..models import Settings
from ..extensions import db, socketio
from . import admin_bp

from ..models import ExamSession, SessionRoster
from ..utils.ident import normalize_name, generate_join_code


_CYR_RE = re.compile(r"[А-Яа-яЁё]")


def _norm_ru(s: str) -> str:
    s = str(s).strip().lower()
    s = s.replace("ё", "е")
    s = " ".join(s.split())
    return s


def _validate_ru_only_list(drugs: list) -> tuple[bool, str]:
    if not isinstance(drugs, list):
        return False, "drugs must be a list"
    for i, name in enumerate(drugs):
        if not isinstance(name, str):
            return False, f"drugs[{i}] must be a string"
        s = name.strip()
        if not s:
            return False, f"drugs[{i}] is empty"
        if re.search(r"[A-Za-z]", s):
            return False, f"drugs[{i}] contains латиницу (нельзя): {s}"
        if not _CYR_RE.search(s):
            return False, f"drugs[{i}] must contain Cyrillic letters: {s}"
    return True, ""


def _build_ru_index(answer_key: dict) -> tuple[dict[str, list[str]], dict[str, str]]:
    """
    Возвращает:
    - ru_to_ids: нормализованный RU токен -> list[drug_id] (может быть >1 если в таблице дубликаты)
    - kind_map: (drug_id + '|' + ru_token) -> 'mnn'|'trade'
    """
    ru_to_ids: dict[str, list[str]] = {}
    kind_map: dict[str, str] = {}

    for drug_id, item in answer_key.items():
        if not isinstance(item, dict):
            continue

        inn_ru = _norm_ru(item.get("inn_ru", ""))
        if inn_ru:
            ru_to_ids.setdefault(inn_ru, []).append(drug_id)
            kind_map[f"{drug_id}|{inn_ru}"] = "mnn"

        trade_ru = item.get("trade_names_ru", [])
        if isinstance(trade_ru, list):
            for t in trade_ru:
                tok = _norm_ru(t)
                if not tok:
                    continue
                ru_to_ids.setdefault(tok, []).append(drug_id)
                kind_map[f"{drug_id}|{tok}"] = "trade"

    return ru_to_ids, kind_map


def _resolve_ticket(drugs_ru: list[str], answer_key: dict) -> tuple[list[dict], list[str]]:
    """
    Возвращает:
    - ticket: list of {drug_id, dictated_ru, dictated_kind}
    - errors: list of strings
    """
    ru_to_ids, kind_map = _build_ru_index(answer_key)

    errors: list[str] = []
    ticket: list[dict] = []

    used_ids: set[str] = set()

    for raw in drugs_ru:
        tok = _norm_ru(raw)
        candidates = ru_to_ids.get(tok, [])

        if not candidates:
            errors.append(f"Не найдено в мастер-таблице: '{raw}'")
            continue

        # Если найдено несколько — считаем ошибкой (надо чистить дубликаты в таблице)
        uniq = sorted(set(candidates))
        if len(uniq) > 1:
            errors.append(f"Неоднозначно (несколько drug_id) для '{raw}': {', '.join(uniq)}")
            continue

        drug_id = uniq[0]
        if drug_id in used_ids:
            errors.append(f"Повтор одного и того же препарата (drug_id={drug_id}) для '{raw}'")
            continue

        dictated_kind = kind_map.get(f"{drug_id}|{tok}", "mnn")
        ticket.append({
            "drug_id": drug_id,
            "dictated_ru": raw.strip(),
            "dictated_kind": dictated_kind,
        })
        used_ids.add(drug_id)

    return ticket, errors


@admin_bp.route("/settings", methods=["GET"])
def get_settings():
    settings = Settings.query.first()
    if settings is None:
        return jsonify({})

    drugs_raw = json.loads(settings.drugs) if settings.drugs else []
    # В UI админа хотим видеть “как вводилось”: dictated_ru по строкам
    if isinstance(drugs_raw, list) and drugs_raw and isinstance(drugs_raw[0], dict):
        drugs_for_ui = [d.get("dictated_ru", "") for d in drugs_raw]
    else:
        drugs_for_ui = drugs_raw

    data = {
        "drugs": drugs_for_ui,
        "duration": settings.duration,
        "code": settings.code,
        "sessionName": settings.session_name,
        "indicationKey": settings.indication_key,
        "indicationSets": json.loads(settings.indication_sets) if settings.indication_sets else {},
    }
    return jsonify(data)


@admin_bp.route("/settings", methods=["POST"])
def save_settings():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON"}), 400

    settings = Settings.query.first()
    if settings is None:
        settings = Settings()

    # подгружаем ключ для сопоставления
    answer_key = {}
    if settings.answer_key:
        try:
            answer_key = json.loads(settings.answer_key)
        except Exception:
            answer_key = {}

    if "drugs" in data:
        drugs_ru = data["drugs"]
        ok, msg = _validate_ru_only_list(drugs_ru)
        if not ok:
            return jsonify({"error": msg}), 400

        # Сопоставляем RU -> drug_id, иначе не сохраняем
        ticket, errors = _resolve_ticket(drugs_ru, answer_key)
        if errors:
            return jsonify({
                "error": "Список препаратов не сохранён: есть проблемы сопоставления",
                "details": errors
            }), 400

        settings.drugs = json.dumps(ticket, ensure_ascii=False)

    if "duration" in data:
        settings.duration = data["duration"]

    if "code" in data:
        settings.code = data["code"]

    if "sessionName" in data:
        settings.session_name = data["sessionName"]

    if "indicationKey" in data:
        settings.indication_key = data["indicationKey"]

    if "indicationSets" in data:
        try:
            settings.indication_sets = json.dumps(data["indicationSets"], ensure_ascii=False)
        except Exception:
            return jsonify({"error": "Invalid value for indicationSets"}), 400

    db.session.add(settings)
    db.session.commit()

    payload = {
        "drugs": data.get("drugs", []),
        "duration": settings.duration,
        "sessionName": settings.session_name,
        "indicationKey": settings.indication_key,
        "indicationSets": json.loads(settings.indication_sets) if settings.indication_sets else {},
    }
    room = settings.session_name or None
    socketio.emit("settings_updated", payload, room=room) if room else socketio.emit("settings_updated", payload)

    return jsonify({"status": "ok"})

@admin_bp.route("/exam_sessions", methods=["POST"])
def create_exam_session():
    data = request.get_json(silent=True) or {}

    session_name = data.get("session_name", "").strip()
    if not session_name:
        return jsonify({"error": "session_name is required"}), 400

    join_code = data.get("join_code") or generate_join_code()

    session = ExamSession(
        session_name=session_name,
        join_code=join_code,
        is_open=True,
    )

    try:
        db.session.add(session)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to create session", "details": str(e)}), 400

    return jsonify({
        "id": session.id,
        "session_name": session.session_name,
        "join_code": session.join_code,
        "is_open": session.is_open,
    })
@admin_bp.route("/exam_sessions", methods=["GET"])



def list_exam_sessions():
    sessions = ExamSession.query.order_by(ExamSession.created_at.desc()).all()
    return jsonify([
        {
            "id": s.id,
            "session_name": s.session_name,
            "join_code": s.join_code,
            "is_open": s.is_open,
            "created_at": s.created_at.isoformat(),
        }
        for s in sessions
    ])
@admin_bp.route("/exam_sessions/<int:session_id>/roster", methods=["POST"])
def upload_session_roster(session_id: int):
    session = ExamSession.query.get(session_id)
    if session is None:
        return jsonify({"error": "Session not found"}), 404

    data = request.get_json(silent=True) or {}
    names = data.get("names")

    if not isinstance(names, list) or not names:
        return jsonify({"error": "names must be a non-empty list"}), 400

    # очищаем старый roster
    SessionRoster.query.filter_by(session_id=session.id).delete()

    added = 0
    for raw in names:
        if not isinstance(raw, str) or not raw.strip():
            continue

        key = normalize_name(raw)

        db.session.add(SessionRoster(
            session_id=session.id,
            full_name_raw=raw.strip(),
            full_name_key=key,
        ))
        added += 1

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Failed to save roster", "details": str(e)}), 400

    return jsonify({
        "session_id": session.id,
        "added": added,
    })


