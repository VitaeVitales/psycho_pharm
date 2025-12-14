from flask import request, jsonify

from . import student_bp
from ..extensions import socketio
from ..services.session import start_session as service_start_session


@student_bp.route("/start", methods=["POST"])
def start_session():
    """HTTP-обёртка над сервисом start_session()."""

    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON"}), 400

    response, status = service_start_session(data, socketio)
    return jsonify(response), status

