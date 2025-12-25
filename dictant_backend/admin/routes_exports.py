# dictant_backend/admin/routes_exports.py

from . import admin_bp
import json
import csv
from io import BytesIO, StringIO
from datetime import datetime

try:
    import pandas as pd
except Exception:
    pd = None

from flask import Blueprint, jsonify, send_file, Response

from ..models import Submission, Settings


admin_exports_bp = Blueprint("admin_exports", __name__, url_prefix="/admin")


def _safe_json(val):
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    try:
        return json.dumps(val, ensure_ascii=False)
    except Exception:
        return str(val)


def _safe_obj(val):
    """Пытаемся распарсить JSON-строку в объект. Если уже объект — вернём как есть."""
    if val is None:
        return {}
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return {}
        try:
            return json.loads(s)
        except Exception:
            return {}
    return {}


def _get_submissions_ordered():
    """
    У твоей модели Submission нет created_at, поэтому сортируем безопасно.
    Приоритет:
      1) start_time (если поле существует)
      2) id (всегда есть)
    """
    if hasattr(Submission, "start_time"):
        return Submission.query.order_by(Submission.start_time.asc().nullslast(), Submission.id.asc()).all()
    return Submission.query.order_by(Submission.id.asc()).all()


def _flatten_submission(sub: Submission) -> dict:
    answers = _safe_obj(sub.answers)
    score_details = _safe_obj(sub.score_details)

    warnings_obj = _safe_obj(sub.warnings)
    warnings_count = len(warnings_obj) if isinstance(warnings_obj, list) else 0

    base = {
        "id": getattr(sub, "id", ""),
        "session_name": getattr(sub, "session_name", "") or "",
        "student_name": getattr(sub, "student_name", "") or "",
        "group": getattr(sub, "group", "") or "",
        "start_time": sub.start_time.isoformat() if getattr(sub, "start_time", None) else "",
        "end_time": sub.end_time.isoformat() if getattr(sub, "end_time", None) else "",
        "auto_submitted": bool(getattr(sub, "auto_submitted", False)),
        "warnings_count": warnings_count,
        "score": sub.score if getattr(sub, "score", None) is not None else "",
        # самое важное — сырой JSON
        "answers_json": _safe_json(getattr(sub, "answers", "")),
        "score_details_json": _safe_json(getattr(sub, "score_details", "")),
    }

    # разворачиваем ответы по препаратам (ключ = drug_id)
    if isinstance(answers, dict):
        for drug_id, a in answers.items():
            if not isinstance(a, dict):
                continue

            prefix = f"{drug_id}"

            base[f"{prefix}_dictated_type"] = a.get("dictatedType", "")
            base[f"{prefix}_mnn"] = a.get("mnn", "")
            base[f"{prefix}_trade_names"] = ", ".join(a.get("tradeNames", []) or [])

            base[f"{prefix}_forms"] = ", ".join(a.get("forms", []) or [])
            base[f"{prefix}_indications"] = ", ".join(a.get("indications", []) or [])
            base[f"{prefix}_elimination"] = ", ".join(a.get("elimination", []) or [])

            # дозировки форм выпуска
            form_dosages = a.get("formDosages", {}) or {}
            if isinstance(form_dosages, dict):
                for form_key, vals in form_dosages.items():
                    if isinstance(vals, list):
                        base[f"{prefix}_dosages_{form_key}"] = ", ".join([str(x) for x in vals])
                    else:
                        base[f"{prefix}_dosages_{form_key}"] = str(vals)

            # суточные дозы
            doses = a.get("doses", {}) or {}
            if isinstance(doses, dict):
                for dose_type, dv in doses.items():
                    if not isinstance(dv, dict):
                        continue
                    base[f"{prefix}_dose_{dose_type}_main"] = dv.get("main", "")
                    extras = dv.get("extras", {}) or {}
                    if isinstance(extras, dict):
                        for k, v in extras.items():
                            base[f"{prefix}_dose_{dose_type}_{k}"] = v

            # фармакокинетика
            hl = a.get("halfLife", {}) or {}
            if isinstance(hl, dict):
                base[f"{prefix}_half_life_from"] = hl.get("from", "")
                base[f"{prefix}_half_life_to"] = hl.get("to", "")

    # немного “верхних” полей из score_details (если есть)
    if isinstance(score_details, dict):
        if "maxScore" in score_details:
            base["score_max"] = score_details.get("maxScore", "")
        if "rawScore" in score_details:
            base["score_raw"] = score_details.get("rawScore", "")

    return base


@admin_exports_bp.route("/export", methods=["GET"])
def export_csv():
    submissions = _get_submissions_ordered()
    if not submissions:
        return jsonify({"error": "Нет данных для экспорта"}), 400

    rows = [_flatten_submission(s) for s in submissions]

    # динамический набор колонок
    all_keys = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                all_keys.append(k)

    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=all_keys)
    writer.writeheader()
    for r in rows:
        writer.writerow(r)

    out = buf.getvalue().encode("utf-8-sig")  # Excel дружит с кириллицей

    return Response(
        out,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=dictant_submissions.csv"},
    )


@admin_exports_bp.route("/export_excel", methods=["GET"])
def export_excel():
    submissions = _get_submissions_ordered()
    if not submissions:
        return jsonify({"error": "Нет данных для экспорта"}), 400

    rows = [_flatten_submission(s) for s in submissions]
    df = pd.DataFrame(rows)

    output = BytesIO()
    with pd.ExcelWriter(output, engine="xlsxwriter") as writer:
        df.to_excel(writer, index=False, sheet_name="Submissions")
    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name="dictant_submissions.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

@admin_bp.route("/master_export.json", methods=["GET"])
def export_master_json():
    settings = Settings.query.first()
    if settings is None or not settings.answer_key:
        return jsonify({"error": "Master table not loaded"}), 400

    try:
        answer_key = json.loads(settings.answer_key)
    except Exception as e:
        return jsonify({"error": f"Failed to parse answer_key JSON: {e}"}), 500

    content = json.dumps(answer_key, ensure_ascii=False, indent=2).encode("utf-8")
    buf = BytesIO(content)
    buf.seek(0)

    ts = datetime.now().strftime("%Y-%m-%d_%H-%M")
    filename = f"master_{ts}.json"

    return send_file(
        buf,
        mimetype="application/json; charset=utf-8",
        as_attachment=True,
        download_name=filename,
    )


@admin_bp.route("/master_export.xlsx", methods=["GET"])
def export_master_xlsx():
    if pd is None:
        return jsonify({"error": "pandas is required for xlsx export"}), 500

    settings = Settings.query.first()
    if settings is None or not settings.answer_key:
        return jsonify({"error": "Master table not loaded"}), 400

    try:
        answer_key = json.loads(settings.answer_key)
    except Exception as e:
        return jsonify({"error": f"Failed to parse answer_key JSON: {e}"}), 500

    rows = []
    for drug_id, item in (answer_key or {}).items():
        if isinstance(item, dict):
            row = {"drug_id": drug_id, **item}
        else:
            row = {"drug_id": drug_id, "value": item}
        rows.append(row)

    df = pd.DataFrame(rows)

    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="master")
    buf.seek(0)

    ts = datetime.now().strftime("%Y-%m-%d_%H-%M")
    filename = f"master_{ts}.xlsx"

    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )
