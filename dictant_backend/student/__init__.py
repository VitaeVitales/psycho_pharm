from flask import Blueprint

student_bp = Blueprint("student", __name__, url_prefix="/sessions")

# Автоматически импортируем модули (регистрируют view-функции)
from . import routes_start, routes_submit, ws_events  # noqa: F401,E402

