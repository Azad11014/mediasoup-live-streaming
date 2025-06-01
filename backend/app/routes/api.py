from flask import Flask, jsonify, request, Blueprint
import uuid
from datetime import datetime
import logging
from sqlalchemy import text
from sqlalchemy.orm import Session as SQLSession
from sqlalchemy.exc import SQLAlchemyError, OperationalError
from app.models.models import Session, User, Message
from config import Config
import traceback
import requests  # Added for mediasoup server communication
import pytz

logger = logging.getLogger(__name__)

# Create Blueprint
api_bp = Blueprint('api', __name__)

#Mediasoup server URL
MEDIASOUP_SERVER_URL = Config.MEDIASOUP_SERVER_URL

def register_api_routes(app):
    app.register_blueprint(api_bp)

def handle_db_error(error, operation):
    """Handle database errors consistently"""
    logger.error(f"Database error in {operation}: {str(error)}")
    logger.error(f"Full traceback: {traceback.format_exc()}")
    
    if isinstance(error, OperationalError):
        return jsonify({
            'error': 'Database connection error',
            'message': 'Unable to connect to database. Please try again.',
            'success': False
        }), 503
    else:
        return jsonify({
            'error': 'Database error',
            'message': 'An error occurred while processing your request.',
            'success': False
        }), 500

@api_bp.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        with SQLSession(Config.engine) as db_session:
            db_session.execute(text("SELECT 1"))
        
        return jsonify({
            'status': 'healthy',
            'database': 'connected',
            'timestamp': datetime.now(pytz.UTC).isoformat()
        })
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            'status': 'unhealthy',
            'database': 'disconnected',
            'error': str(e),
            'timestamp': datetime.now(pytz.UTC).isoformat()
        }), 503

@api_bp.route('/api/create-session', methods=['POST'])
def create_session():
    """Create a new video conference session"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        teacher_name = data.get('teacherName', 'Teacher')
        session_name = data.get('sessionName', 'Class Session')
        
        if not teacher_name.strip():
            return jsonify({'error': 'Teacher name cannot be empty', 'success': False}), 400
        
        session_id = str(uuid.uuid4())
        teacher_id = str(uuid.uuid4())
        
        try:
            with SQLSession(Config.engine) as db_session:
                teacher = User(
                    user_id=teacher_id, 
                    name=teacher_name.strip(), 
                    is_teacher=True
                )
                db_session.add(teacher)
                
                session = Session(
                    session_id=session_id, 
                    teacher_id=teacher_id, 
                    name=session_name.strip(),
                    created_at=datetime.now(pytz.UTC)
                )
                db_session.add(session)
                
                db_session.commit()
                
                logger.info(f"Created session {session_id} with teacher {teacher_id}")
                
                return jsonify({
                    'sessionId': session_id,
                    'userId': teacher_id,
                    'name': session_name,
                    'success': True
                })
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'create_session')
    
    except Exception as e:
        logger.error(f"Unexpected error in create_session: {str(e)}")
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'An unexpected error occurred',
            'success': False
        }), 500

@api_bp.route('/api/join-session', methods=['POST'])
def join_session():
    """Join an existing video conference session"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        session_id = data.get('sessionId')
        is_teacher = data.get('isTeacher', False)
        user_name = data.get('userName', 'Student')
        
        if not session_id:
            return jsonify({'error': 'Session ID is required', 'success': False}), 400
        
        if not user_name.strip():
            return jsonify({'error': 'User name cannot be empty', 'success': False}), 400
        
        try:
            with SQLSession(Config.engine) as db_session:
                session = db_session.query(Session).filter_by(session_id=session_id).first()
                if not session:
                    return jsonify({'error': 'Session not found', 'success': False}), 404
                
                if not session.is_active:
                    return jsonify({'error': 'Session is no longer active', 'success': False}), 400
                
                user_id = str(uuid.uuid4())
                
                user = User(
                    user_id=user_id,
                    name=user_name.strip(),
                    is_teacher=is_teacher
                )
                db_session.add(user)
                
                session.add_participant(user)
                
                db_session.commit()
                
                db_session.refresh(session)
                
                participants = session.get_participant_list()
                messages = [msg.to_dict() for msg in session.messages]
                
                logger.info(f"User {user_id} ({user_name}) joined session {session_id}")
                
                return jsonify({
                    'sessionId': session_id,
                    'userId': user_id,
                    'participants': participants,
                    'messages': messages,
                    'isLivestreaming': session.is_livestreaming,
                    'success': True
                })
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'join_session')
    
    except Exception as e:
        logger.error(f"Unexpected error in join_session: {str(e)}")
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'An unexpected error occurred',
            'success': False
        }), 500
    
@api_bp.route('/api/leave-session', methods=['POST'])
def leave_session():
    """Leave a video conference session and clean up mediasoup resources if session ends"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        if not session_id or not user_id:
            return jsonify({'error': 'Session ID and User ID are required', 'success': False}), 400
        
        try:
            with SQLSession(Config.engine) as db_session:
                session = db_session.query(Session).filter_by(session_id=session_id).first()
                if not session:
                    return jsonify({'error': 'Session not found', 'success': False}), 404
                
                user = db_session.query(User).filter_by(user_id=user_id).first()
                if not user:
                    return jsonify({'error': 'User not found', 'success': False}), 404
                
                session.remove_participant(user_id)
                
                should_cleanup = False
                if user.is_teacher:
                    teacher_still_present = any(u.is_teacher for u in session.get_participants())
                    if not teacher_still_present:
                        session.is_active = False
                        session.stop_livestream()
                        should_cleanup = True
                
                if len(session.get_participants()) == 0:
                    session.is_active = False
                    should_cleanup = True
                    logger.info(f"Session {session_id} marked inactive as it's empty")
                
                if should_cleanup and session.producer_id:
                    try:
                        response = requests.post(f"{MEDIASOUP_SERVER_URL}/closeProducer", json={
                            'producerId': session.producer_id
                        })
                        if response.status_code != 200:
                            logger.error(f"Failed to close producer {session.producer_id} on mediasoup server")
                    except Exception as e:
                        logger.error(f"Error closing producer on mediasoup server: {str(e)}")
                
                db_session.commit()
                
                logger.info(f"User {user_id} left session {session_id}")
                
                return jsonify({'success': True})
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'leave_session')
    
    except Exception as e:
        logger.error(f"Unexpected error in leave_session: {str(e)}")
        return jsonify({
            'error': 'Internal server error',
            'success': False
        }), 500

@api_bp.route('/api/raise-hand', methods=['POST'])
def raise_hand():
    """Toggle hand raise status"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        is_raised = data.get('isRaised', True)
        
        if not session_id or not user_id:
            return jsonify({'error': 'Session ID and User ID are required', 'success': False}), 400
        
        try:
            with SQLSession(Config.engine) as db_session:
                user = db_session.query(User).filter_by(user_id=user_id).first()
                if not user:
                    return jsonify({'error': 'User not found', 'success': False}), 404
                
                user.hand_raised = is_raised
                db_session.commit()
                
                return jsonify({'success': True})
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'raise_hand')
    
    except Exception as e:
        logger.error(f"Unexpected error in raise_hand: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@api_bp.route('/api/send-message', methods=['POST'])
def send_message():
    """Send a chat message to the session"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        message_text = data.get('message')
        is_question = data.get('isQuestion', False)
        timestamp = data.get('timestamp')
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        else:
            timestamp = datetime.now(pytz.UTC)
        
        if not session_id or not user_id or not message_text:
            return jsonify({
                'error': 'Session ID, User ID, and message are required',
                'success': False
            }), 400
        
        try:
            with SQLSession(Config.engine) as db_session:
                session = db_session.query(Session).filter_by(session_id=session_id).first()
                user = db_session.query(User).filter_by(user_id=user_id).first()
                
                if not session or not user:
                    return jsonify({'error': 'Session or user not found', 'success': False}), 404
                
                msg_id = str(uuid.uuid4())
                message = Message(
                    message_id=msg_id,
                    user_id=user_id,
                    user_name=user.name,
                    content=message_text.strip(),
                    timestamp=timestamp,
                    session_id=session_id,
                    is_question=is_question
                )
                
                db_session.add(message)
                db_session.commit()
                
                return jsonify({
                    'success': True,
                    'message': message.to_dict()
                })
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'send_message')
    
    except Exception as e:
        logger.error(f"Unexpected error in send_message: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@api_bp.route('/api/start-livestream', methods=['POST'])
def start_livestream():
    """Start a livestream session with state validation"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        if not session_id or not user_id:
            return jsonify({'error': 'Session ID and User ID are required', 'success': False}), 400
        
        try:
            with SQLSession(Config.engine) as db_session:
                session = db_session.query(Session).filter_by(session_id=session_id).first()
                user = db_session.query(User).filter_by(user_id=user_id).first()
                
                if not session or not user:
                    return jsonify({'error': 'Session or user not found', 'success': False}), 404
                
                if not user.is_teacher:
                    return jsonify({'error': 'Only teachers can start livestream', 'success': False}), 403
                
                if session.is_livestreaming:
                    return jsonify({'error': 'Livestream is already active', 'success': False}), 400
                
                session.start_livestream()
                user.is_streaming = True
                
                if not session.created_at:
                    session.created_at = datetime.now(pytz.UTC)
                
                db_session.commit()
                
                logger.info(f"Livestream started in session {session_id} by teacher {user_id}")
                
                return jsonify({'success': True})
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'start_livestream')
    
    except Exception as e:
        logger.error(f"Unexpected error in start_livestream: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@api_bp.route('/api/stop-livestream', methods=['POST'])
def stop_livestream():
    """Stop a livestream session with state validation and mediasoup cleanup"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        producer_id = data.get('producerId')  # Optional, as we can use session.producer_id
        
        if not session_id or not user_id:
            return jsonify({'error': 'Session ID and User ID are required', 'success': False}), 400
        
        try:
            with SQLSession(Config.engine) as db_session:
                session = db_session.query(Session).filter_by(session_id=session_id).first()
                user = db_session.query(User).filter_by(user_id=user_id).first()
                
                if not session or not user:
                    return jsonify({'error': 'Session or user not found', 'success': False}), 404
                
                if not user.is_teacher:
                    return jsonify({'error': 'Only teachers can stop livestream', 'success': False}), 403
                
                if not session.is_livestreaming:
                    return jsonify({'error': 'Livestream is not active', 'success': False}), 400
                
                session.stop_livestream()
                user.is_streaming = False
                
                effective_producer_id = session.producer_id or producer_id
                if effective_producer_id:
                    try:
                        response = requests.post(f"{MEDIASOUP_SERVER_URL}/closeProducer", json={
                            'producerId': effective_producer_id
                        })
                        if response.status_code != 200:
                            logger.error(f"Failed to close producer {effective_producer_id} on mediasoup server")
                    except Exception as e:
                        logger.error(f"Error closing producer on mediasoup server: {str(e)}")
                
                db_session.commit()
                
                logger.info(f"Livestream stopped in session {session_id} by teacher {user_id}")
                
                return jsonify({'success': True})
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'stop_livestream')
    
    except Exception as e:
        logger.error(f"Unexpected error in stop_livestream: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@api_bp.route('/api/mark-question-answered', methods=['POST'])
def mark_question_answered():
    """Mark a question as answered"""
    try:
        if not request.json:
            return jsonify({'error': 'No JSON data provided', 'success': False}), 400
        
        data = request.json
        session_id = data.get('sessionId')
        message_id = data.get('messageId')
        
        if not session_id or not message_id:
            return jsonify({'error': 'Session ID and Message ID are required', 'success': False}), 400
        
        try:
            with SQLSession(Config.engine) as db_session:
                message = db_session.query(Message).filter_by(
                    message_id=message_id, 
                    session_id=session_id,
                    is_question=True
                ).first()
                
                if not message:
                    return jsonify({'error': 'Question not found', 'success': False}), 404
                
                message.answered = True
                db_session.commit()
                
                return jsonify({'success': True})
        
        except SQLAlchemyError as e:
            return handle_db_error(e, 'mark_question_answered')
    
    except Exception as e:
        logger.error(f"Unexpected error in mark_question_answered: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@api_bp.route('/api/get-active-sessions', methods=['GET'])
def get_active_sessions():
    """Get list of active livestream sessions"""
    try:
        active_streams = []
        
        with SQLSession(Config.engine) as db_session:
            active_sessions = db_session.query(Session).filter_by(
                is_active=True,
                is_livestreaming=True
            ).all()
            
            for session in active_sessions:
                teacher = db_session.query(User).filter_by(user_id=session.teacher_id).first()
                
                if teacher:
                    participant_count = len(session.participants)
                    
                    active_streams.append({
                        'sessionId': session.session_id,
                        'name': session.name,
                        'teacherId': session.teacher_id,
                        'teacherName': teacher.name,
                        'participantCount': participant_count,
                        'createdAt': session.created_at.isoformat() if session.created_at else None
                    })
        
        return jsonify({
            'sessions': active_streams,
            'success': True
        })
    
    except SQLAlchemyError as e:
        return handle_db_error(e, 'get_active_sessions')
    
    except Exception as e:
        logger.error(f"Unexpected error in get_active_sessions: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500