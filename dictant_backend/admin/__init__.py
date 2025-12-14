from flask import Blueprint

# Все админские маршруты живут здесь
admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

# Импортируем модули, чтобы их view-функции зарегистрировались в blueprint
# routes_exports оставляем импортом (для совместимости), но экспортные URL обслуживает admin_exports_bp
from . import routes_settings, routes_uploads, routes_history, routes_active, routes_exports  # noqa: F401,E402

