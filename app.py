"""Entry point script for the dictation system.

This module is a thin wrapper around the actual application defined in
``dictant_backend.app``. It exists to provide a simple ``python app.py``
command for users who are unfamiliar with Flask application factories
and want to start the server directly. When executed, it creates the
Flask app using the factory defined in ``dictant_backend.app`` and
starts the development server on port 8000.
"""

from dictant_backend.app import create_app


if __name__ == '__main__':
    # Create the Flask application using the factory from the backend
    app = create_app()
    # Run the development server. In a production deployment, use
    # gunicorn or another WSGI server instead of ``app.run``.
    app.run(debug=True, host='0.0.0.0', port=8000)
