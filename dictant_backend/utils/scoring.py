from typing import Dict, Tuple, Any


def _norm(s: str) -> str:
    s = str(s).strip().lower()
    s = s.replace("–", "-")
    # схлопываем пробелы
    s = " ".join(s.split())
    # убираем хвостовые ;
    while s.endswith(";"):
        s = s[:-1].strip()
    return s


def _as_norm_set(values) -> set[str]:
    if not values:
        return set()
    out = set()
    if isinstance(values, list):
        for v in values:
            if v is None:
                continue
            nv = _norm(v)
            if nv:
                out.add(nv)
    elif isinstance(values, str):
        nv = _norm(values)
        if nv:
            out.add(nv)
    return out


def compute_score(answers: Dict[str, Any], answer_key: Dict[str, Any]) -> Tuple[float | None, Dict]:
    """
    Подсчёт итогового балла за тест.

    :param answers: ответы студента (dict)
    :param answer_key: правильные ответы (dict)
    :return: (итоговый балл 0–10, breakdown)
    """
    score_total = 0.0
    breakdown: Dict[str, Dict] = {}

    if not answers:
        return None, {}

    for drug_index, student_ans in answers.items():
        key = str(drug_index)
        correct = answer_key.get(key, {})

        details: Dict[str, Any] = {}
        category_points = 0.0
        category_count = 0

        # --- MNN (с учётом алиасов) ---
        mnn_correct = correct.get("mnn")
        mnn_aliases = correct.get("mnn_aliases") or []
        if mnn_correct is not None or mnn_aliases:
            category_count += 1
            student_mnn = student_ans.get("mnn", "")
            if isinstance(student_mnn, str):
                s = student_mnn.strip().lower()
                valid = {mnn_correct.strip().lower()} if isinstance(mnn_correct, str) else set()
                valid.update(
                    a.strip().lower()
                    for a in mnn_aliases
                    if isinstance(a, str) and a.strip()
                )
                if s and s in valid:
                    category_points += 1.0
                    details["mnn"] = 1.0
                else:
                    details["mnn"] = 0.0
            else:
                details["mnn"] = 0.0

        # --- tradeNames ---
        correct_trade = {t.strip().lower() for t in (correct.get("tradeNames") or []) if isinstance(t, str)}
        if correct_trade:
            category_count += 1
            student_trade = {
                t.strip().lower()
                for t in (student_ans.get("tradeNames") or [])
                if isinstance(t, str)
            }
            inter = correct_trade.intersection(student_trade)
            pts = len(inter) / len(correct_trade) if correct_trade else 0.0
            category_points += pts
            details["tradeNames"] = pts

        # --- forms ---
        correct_forms = {f.strip().lower() for f in (correct.get("forms") or []) if isinstance(f, str)}
        if correct_forms:
            category_count += 1
            student_forms = {
                f.strip().lower()
                for f in (student_ans.get("forms") or [])
                if isinstance(f, str)
            }
            inter = correct_forms.intersection(student_forms)
            pts = len(inter) / len(correct_forms)
            category_points += pts
            details["forms"] = pts

        # --- form dosages (НОВОЕ) ---
        # correct["form_dosages"] = {"tablets":[...], "ampoules":[...], ...}
        correct_fd = correct.get("form_dosages") or {}
        if isinstance(correct_fd, dict) and any(isinstance(v, list) and len(v) > 0 for v in correct_fd.values()):
            category_count += 1

            student_fd = student_ans.get("formDosages") or {}
            if not isinstance(student_fd, dict):
                student_fd = {}

            per_form: Dict[str, float] = {}
            forms_scored = 0
            sum_pts = 0.0

            for form_key, correct_list in correct_fd.items():
                if not isinstance(form_key, str):
                    continue
                if not isinstance(correct_list, list) or not correct_list:
                    continue

                correct_set = _as_norm_set(correct_list)
                if not correct_set:
                    continue

                student_list = student_fd.get(form_key, [])
                student_set = _as_norm_set(student_list)

                inter = correct_set.intersection(student_set)
                pts = (len(inter) / len(correct_set)) if correct_set else 0.0
                per_form[form_key] = pts
                sum_pts += pts
                forms_scored += 1

            final_pts = (sum_pts / forms_scored) if forms_scored > 0 else 0.0
            category_points += final_pts
            details["formDosages"] = {"total": final_pts, "perForm": per_form}

        # --- indications ---
        correct_inds = {i.strip().lower() for i in (correct.get("indications") or []) if isinstance(i, str)}
        if correct_inds:
            category_count += 1
            student_inds = {
                i.strip().lower()
                for i in (student_ans.get("indications") or [])
                if isinstance(i, str)
            }
            inter = correct_inds.intersection(student_inds)
            pts = len(inter) / len(correct_inds)
            category_points += pts
            details["indications"] = pts

        # --- doses (суточные) ---
        correct_doses = correct.get("doses") or {}
        if isinstance(correct_doses, dict) and correct_doses:
            # считаем min/avg/max как отдельные подпункты внутри одной категории
            category_count += 1

            student_doses = student_ans.get("doses") or {}
            if not isinstance(student_doses, dict):
                student_doses = {}

            dose_pts_sum = 0.0
            dose_cnt = 0
            per = {}

            for dtype in ("min", "avg", "max"):
                c = correct_doses.get(dtype)
                if not isinstance(c, dict):
                    continue
                c_main = c.get("main")
                if c_main is None:
                    continue

                dose_cnt += 1
                s = student_doses.get(dtype) if isinstance(student_doses.get(dtype), dict) else {}
                s_main = s.get("main") if isinstance(s, dict) else None

                # точное совпадение (пока)
                pts = 1.0 if (s_main is not None and float(s_main) == float(c_main)) else 0.0
                per[dtype] = pts
                dose_pts_sum += pts

            final_pts = (dose_pts_sum / dose_cnt) if dose_cnt else 0.0
            category_points += final_pts
            details["doses"] = {"total": final_pts, "per": per}

        # --- half-life ---
        correct_half = correct.get("halfLife") or {}
        if isinstance(correct_half, dict) and ("from" in correct_half or "to" in correct_half):
            category_count += 1
            s_half = student_ans.get("halfLife") or {}
            if not isinstance(s_half, dict):
                s_half = {}

            c_from = correct_half.get("from")
            c_to = correct_half.get("to")
            s_from = s_half.get("from")
            s_to = s_half.get("to")

            pts = 0.0
            if c_from is not None and c_to is not None and s_from is not None and s_to is not None:
                pts = 1.0 if (float(s_from) == float(c_from) and float(s_to) == float(c_to)) else 0.0
            details["halfLife"] = pts
            category_points += pts

        # --- elimination ---
        correct_elim = {e.strip().lower() for e in (correct.get("elimination") or []) if isinstance(e, str)}
        if correct_elim:
            category_count += 1
            student_elim = {
                e.strip().lower()
                for e in (student_ans.get("elimination") or [])
                if isinstance(e, str)
            }
            inter = correct_elim.intersection(student_elim)
            pts = len(inter) / len(correct_elim)
            category_points += pts
            details["elimination"] = pts

        drug_score = (category_points / category_count) if category_count else 0.0
        breakdown[key] = {"score": drug_score, "details": details}
        score_total += drug_score

    avg = score_total / len(answers) if answers else 0.0
    final_score_10 = round(avg * 10.0, 2)
    return final_score_10, breakdown

