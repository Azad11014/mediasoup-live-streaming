from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO
from app.models.models import Base
# Import configurations and routes
from app.routes.api import register_api_routes
from app.routes.webrtc import register_webrtc_routes
from app.socket.events import register_socket_events
from config import Config

def create_app():
    """Initialize the Flask application"""
    # Create Flask app
    app = Flask(__name__)
    CORS(app)  # Enable CORS for all routes
    
    # Create SocketIO instance
    socketio = SocketIO(app, cors_allowed_origins="*")
    
    # Initialize database tables if they don't exist
    Base.metadata.create_all(Config.engine)
    
    # Register routes and socket events
    register_api_routes(app)
    register_webrtc_routes(app, socketio)
    register_socket_events(socketio)
    
    return app, socketio

