from flask_socketio import join_room, leave_room

from ..extensions import socketio
from ..services.session import update_activity


@socketio.on("join_session")
def handle_join_session(data):
    session_name = data.get("sessionName")
    if session_name:
        join_room(session_name)


@socketio.on("leave_session")
def handle_leave_session(data):
    session_name = data.get("sessionName")
    if session_name:
        leave_room(session_name)


@socketio.on("student_activity")
def handle_student_activity(data):
    """Тонкая оболочка: всё делает сервис update_activity()."""
    name = data.get("studentName")
    session_name = data.get("sessionName")
    update_activity(name, session_name, socketio)




