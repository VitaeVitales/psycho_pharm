import json
from flask import request, jsonify

from ..models import Settings
from ..extensions import db
from . import admin_bp

try:
    import pandas as pd  # type: ignore
except ImportError:
    pd = None


def _split_semicolon(v) -> list[str]:
    if v is None:
        return []
    if pd is not None and isinstance(v, float) and pd.isna(v):
        return []
    s = str(v).strip()
    if not s:
        return []
    s = s.replace(",", ";")
    parts = [p.strip() for p in s.split(";")]
    return [p for p in parts if p]


def _norm_ru(s: str) -> str:
    s = str(s).strip().lower()
    s = s.replace("ё", "е")
    s = " ".join(s.split())
    return s


def _split_dosages(v) -> list[str]:
    # дозировки в таблице лежат "10; 25;" или "25 mg – 2 ml;"
    return _split_semicolon(v)


def _convert_master_row(row: dict) -> dict:
    """
    Конвертация строки мастер-таблицы в структуру ключа.
    Ключ по drug_id, внутри сохраняем всё нужное для проверки.
    """
    drug_id = str(row.get("drug_id", "")).strip()
    if not drug_id:
        return {}

    # латиница
    inn_main = str(row.get("inn_main", "")).strip()
    inn_aliases = _split_semicolon(row.get("inn_aliases"))
    trade_names = _split_semicolon(row.get("trade_names"))

    # русские поля (НОВОЕ)
    inn_ru = _norm_ru(row.get("inn_ru", ""))
    trade_names_ru = [_norm_ru(x) for x in _split_semicolon(row.get("trade_names_ru"))]

    # формы: по колонкам form_*
    forms = []
    form_dosages: dict[str, list[str]] = {}

    form_map = {
        "form_tabs": "tablets",
        "form_caps": "capsules",
        "form_dragee": "dragee",
        "form_powder": "powder",
        "form_ampoules": "ampoules",
        "form_drops": "drops",
    }

    for col, form_key in form_map.items():
        doses = _split_dosages(row.get(col))
        if doses:
            forms.append(form_key)
            form_dosages[form_key] = doses

    # показания
    indications = _split_semicolon(row.get("indications"))

    # половина/элиминация
    half_life = str(row.get("half_life", "")).strip()
    elimination_routes = _split_semicolon(row.get("elimination_routes"))

    # дозы (оставляем как строки/числа — скоринг разберёт как у тебя уже сделано)
    def num(x):
        if x is None:
            return None
        if pd is not None and isinstance(x, float) and pd.isna(x):
            return None
        s = str(x).strip()
        return s if s else None

    doses_obj = {
        "main": {
            "min": num(row.get("dose_main_min")),
            "avg": num(row.get("dose_main_avg")),
            "max": num(row.get("dose_main_max")),
        },
        "outpatient": {
            "min": num(row.get("dose_outpatient_min")),
            "avg": num(row.get("dose_outpatient_avg")),
            "max": num(row.get("dose_outpatient_max")),
        },
        "inpatient": {
            "min": num(row.get("dose_inpatient_min")),
            "avg": num(row.get("dose_inpatient_avg")),
            "max": num(row.get("dose_inpatient_max")),
        },
        "children": {
            "min": num(row.get("dose_children_min")),
            "avg": num(row.get("dose_children_avg")),
            "max": num(row.get("dose_children_max")),
        },
        "elderly": {
            "min": num(row.get("dose_elderly_min")),
            "avg": num(row.get("dose_elderly_avg")),
            "max": num(row.get("dose_elderly_max")),
        },
        "notes": num(row.get("dose_notes")),
    }

    return {
        "drug_id": drug_id,
        "mnn": inn_main,
        "mnn_aliases": inn_aliases,
        "trade_names": trade_names,

        # русские поля для сопоставления списка админа
        "inn_ru": inn_ru,
        "trade_names_ru": trade_names_ru,

        "forms": forms,
        "form_dosages": form_dosages,
        "indications": indications,

        "half_life": half_life,
        "elimination": elimination_routes,

        "doses": doses_obj,
    }


@admin_bp.route("/upload_master", methods=["POST"])
def upload_master_table():
    """
    Загрузка мастер-таблицы (xlsx).
    Строим answer_key по drug_id.
    """
    if pd is None:
        return jsonify({"error": "pandas is required for xlsx uploads"}), 500

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400

    try:
        df = pd.read_excel(f)
    except Exception as e:
        return jsonify({"error": f"Failed to read Excel: {e}"}), 400

    df.columns = [str(c).strip() for c in df.columns]
    rows = df.to_dict(orient="records")

    answer_key: dict[str, dict] = {}
    skipped = 0

    for row in rows:
        item = _convert_master_row(row)
        if not item:
            skipped += 1
            continue
        answer_key[item["drug_id"]] = item

    settings = Settings.query.first()
    if settings is None:
        settings = Settings()

    settings.answer_key = json.dumps(answer_key, ensure_ascii=False)
    db.session.add(settings)
    db.session.commit()

    return jsonify({
        "status": "ok",
        "loaded": len(answer_key),
        "skipped": skipped,
        "note": "answer_key is keyed by drug_id",
    })



