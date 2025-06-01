import logging
from flask import request
from flask_socketio import emit, join_room, leave_room
from sqlalchemy.orm import Session as SQLSession
from config import Config
from app.models.models import User, Session
from datetime import datetime
import pytz
import requests

logger = logging.getLogger(__name__)

# Mediasoup server URL
MEDIASOUP_SERVER_URL = Config.MEDIASOUP_SERVER_URL

def register_socket_events(socketio):
    @socketio.on('connect')
    def handle_connect():
        logger.info(f"Client connected: {request.sid}")

    @socketio.on('disconnect')
    def handle_disconnect():
        logger.info(f"Client disconnected: {request.sid}")

    @socketio.on('join')
    def handle_join(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        join_room(session_id)
        join_room(user_id)
        
        logger.info(f"User {user_id} joined socket room {session_id}")
        
        with SQLSession(Config.engine) as db_session:
            user = db_session.query(User).filter_by(user_id=user_id).first()
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            
            if user and session:
                emit('user_joined', user.to_dict(), room=session_id, include_self=False)
                
                if session.is_livestreaming:
                    teacher = db_session.query(User).filter_by(user_id=session.teacher_id).first()
                    if teacher:
                        emit('livestream_active', {
                            'teacherId': session.teacher_id,
                            'teacherName': teacher.name
                        }, room=user_id)

    @socketio.on('leave')
    def handle_leave(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        leave_room(session_id)
        leave_room(user_id)
        
        logger.info(f"User {user_id} left socket room {session_id}")
        emit('user_left', {'userId': user_id}, room=session_id)

    @socketio.on('toggle_mute')
    def handle_toggle_mute(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        is_muted = data.get('isMuted')
        
        with SQLSession(Config.engine) as db_session:
            user = db_session.query(User).filter_by(user_id=user_id).first()
            if user:
                user.is_muted = is_muted
                db_session.commit()
                emit('user_mute_changed', {
                    'userId': user_id,
                    'isMuted': is_muted
                }, room=session_id)

    @socketio.on('toggle_video')
    def handle_toggle_video(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        video_enabled = data.get('videoEnabled')
        
        with SQLSession(Config.engine) as db_session:
            user = db_session.query(User).filter_by(user_id=user_id).first()
            if user:
                user.video_enabled = video_enabled
                db_session.commit()
                emit('user_video_changed', {
                    'userId': user_id,
                    'videoEnabled': video_enabled
                }, room=session_id)

    @socketio.on('raise_hand')
    def handle_raise_hand(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        is_raised = data.get('isRaised')
        
        with SQLSession(Config.engine) as db_session:
            user = db_session.query(User).filter_by(user_id=user_id).first()
            if user:
                user.hand_raised = is_raised
                db_session.commit()
                emit('hand_raise_changed', {
                    'userId': user_id,
                    'userName': user.name,
                    'isRaised': is_raised
                }, room=session_id)

    @socketio.on('send_message')
    def handle_send_message(data):
        session_id = data.get('sessionId')
        message_data = data.get('message')
        emit('new_message', message_data, room=session_id)

    @socketio.on('start_screen_share')
    def handle_start_screen_share(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        with SQLSession(Config.engine) as db_session:
            user = db_session.query(User).filter_by(user_id=user_id).first()
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            
            if user and session:
                session.shared_screen = user_id
                db_session.commit()
                emit('screen_share_started', {
                    'userId': user_id,
                    'userName': user.name
                }, room=session_id)

    @socketio.on('stop_screen_share')
    def handle_stop_screen_share(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        with SQLSession(Config.engine) as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if session and session.shared_screen == user_id:
                session.shared_screen = None
                db_session.commit()
                emit('screen_share_stopped', {
                    'userId': user_id
                }, room=session_id)

    @socketio.on('start_livestream')
    def handle_start_livestream(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        with SQLSession(Config.engine) as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            user = db_session.query(User).filter_by(user_id=user_id).first()
            
            if session and user and user.is_teacher:
                session.is_livestreaming = True
                user.is_streaming = True
                if not session.created_at:
                    session.created_at = datetime.now(pytz.UTC)
                db_session.commit()
                
                emit('start_webrtc_setup', {}, room=user_id)
                
                emit('livestream_started', {
                    'userId': user_id,
                    'userName': user.name
                }, room=session_id, include_self=False)

    @socketio.on('stop_livestream')
    def handle_stop_livestream(data):
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        with SQLSession(Config.engine) as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            user = db_session.query(User).filter_by(user_id=user_id).first()
            
            if session and user and user.is_teacher:
                session.is_livestreaming = False
                user.is_streaming = False
                
                if session.producer_id:
                    try:
                        response = requests.post(f"{MEDIASOUP_SERVER_URL}/closeProducer", json={
                            'producerId': session.producer_id
                        })
                        if response.status_code != 200:
                            logger.error(f"Failed to close producer {session.producer_id} on mediasoup server")
                    except Exception as e:
                        logger.error(f"Error closing producer on mediasoup server: {str(e)}")
                
                db_session.commit()
                
                emit('livestream_ended', {
                    'userId': user_id,
                    'userName': user.name
                }, room=session_id)