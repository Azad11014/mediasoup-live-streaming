from flask import Blueprint, request, jsonify
from sqlalchemy.orm import Session as SQLSession
from config import Config
import requests
import time
import hmac
import hashlib
import base64
import logging

webrtc_bp = Blueprint('webrtc', __name__)
logger = logging.getLogger(__name__)

def register_webrtc_routes(app, socketio):
    app.register_blueprint(webrtc_bp)
    webrtc_bp.socketio = socketio

# Mediasoup server URL
MEDIASOUP_SERVER_URL = Config.MEDIASOUP_SERVER_URL

# TURN server settings (used only when TURN is enabled)
# Uncomment the following lines to enable TURN
"""
TURN_SERVER = "turn:127.0.0.1:3478"
TURN_SECRET = "mysecret123"  # Shared secret with coturn
"""

# Uncomment this endpoint to enable TURN
"""
@webrtc_bp.route('/api/turn-credentials', methods=['GET'])
def get_turn_credentials():
    #Generate TURN credentials for WebRTC (used when TURN is enabled)
    try:
        # Generate a time-based username (24-hour expiry)
        expiry = int(time.time()) + 24 * 3600
        username = f"{expiry}:turnuser"
        
        # Generate HMAC-SHA1 credential using the shared secret
        hmac_obj = hmac.new(TURN_SECRET.encode(), username.encode(), hashlib.sha1)
        credential = base64.b64encode(hmac_obj.digest()).decode()
        
        return jsonify({
            'success': True,
            'turnCredentials': {
                'urls': [TURN_SERVER],
                'username': username,
                'credential': credential
            }
        })
    except Exception as e:
        logger.error(f"Error generating TURN credentials: {str(e)}")
        return jsonify({'error': 'Failed to generate TURN credentials', 'success': False}), 500
"""

@webrtc_bp.route('/api/create-producer-transport', methods=['POST'])
def create_producer_transport():
    """Create a producer transport on the mediasoup server"""
    try:
        data = request.json
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        
        response = requests.post(f"{MEDIASOUP_SERVER_URL}/createProducerTransport", json={})
        if response.status_code != 200:
            return jsonify({'error': 'Failed to create producer transport', 'success': False}), 500
        
        transport_data = response.json()
        
        webrtc_bp.socketio.emit('producer_transport_created', {
            'transportId': transport_data['id'],
            'iceParameters': transport_data['iceParameters'],
            'iceCandidates': transport_data['iceCandidates'],
            'dtlsParameters': transport_data['dtlsParameters']
        }, room=user_id)
        
        return jsonify({'success': True, 'transportId': transport_data['id']})
    except Exception as e:
        logger.error(f"Error creating producer transport: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@webrtc_bp.route('/api/connect-producer-transport', methods=['POST'])
def connect_producer_transport():
    """Connect a producer transport on the mediasoup server"""
    try:
        data = request.json
        transport_id = data.get('transportId')
        dtls_parameters = data.get('dtlsParameters')
        
        response = requests.post(f"{MEDIASOUP_SERVER_URL}/connectProducerTransport", json={
            'transportId': transport_id,
            'dtlsParameters': dtls_parameters
        })
        if response.status_code != 200:
            return jsonify({'error': 'Failed to connect producer transport', 'success': False}), 500
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error connecting producer transport: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@webrtc_bp.route('/api/produce', methods=['POST'])
def produce():
    """Create a producer on the mediasoup server and store producer_id in Session"""
    try:
        data = request.json
        session_id = data.get('sessionId')
        user_id = data.get('userId')
        transport_id = data.get('transportId')
        kind = data.get('kind')  # audio or video
        rtp_parameters = data.get('rtpParameters')
        
        response = requests.post(f"{MEDIASOUP_SERVER_URL}/produce", json={
            'transportId': transport_id,
            'kind': kind,
            'rtpParameters': rtp_parameters
        })
        if response.status_code != 200:
            return jsonify({'error': 'Failed to produce stream', 'success': False}), 500
        
        producer_data = response.json()
        producer_id = producer_data['id']
        
        with SQLSession(Config.engine) as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if session:
                session.set_producer_id(producer_id)
                db_session.commit()
            else:
                logger.error(f"Session {session_id} not found when storing producer_id")
        
        webrtc_bp.socketio.emit('new_producer', {
            'producerId': producer_id,
            'kind': kind,
            'userId': user_id
        }, room=session_id, include_self=False)
        
        return jsonify({'success': True, 'producerId': producer_id})
    except Exception as e:
        logger.error(f"Error producing stream: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@webrtc_bp.route('/api/create-consumer-transport', methods=['POST'])
def create_consumer_transport():
    """Create a consumer transport on the mediasoup server"""
    try:
        data = request.json
        user_id = data.get('userId')
        
        response = requests.post(f"{MEDIASOUP_SERVER_URL}/createConsumerTransport", json={})
        if response.status_code != 200:
            return jsonify({'error': 'Failed to create consumer transport', 'success': False}), 500
        
        transport_data = response.json()
        
        webrtc_bp.socketio.emit('consumer_transport_created', {
            'transportId': transport_data['id'],
            'iceParameters': transport_data['iceParameters'],
            'iceCandidates': transport_data['iceCandidates'],
            'dtlsParameters': transport_data['dtlsParameters']
        }, room=user_id)
        
        return jsonify({'success': True, 'transportId': transport_data['id']})
    except Exception as e:
        logger.error(f"Error creating consumer transport: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@webrtc_bp.route('/api/connect-consumer-transport', methods=['POST'])
def connect_consumer_transport():
    """Connect a consumer transport on the mediasoup server"""
    try:
        data = request.json
        transport_id = data.get('transportId')
        dtls_parameters = data.get('dtlsParameters')
        
        response = requests.post(f"{MEDIASOUP_SERVER_URL}/connectConsumerTransport", json={
            'transportId': transport_id,
            'dtlsParameters': dtls_parameters
        })
        if response.status_code != 200:
            return jsonify({'error': 'Failed to connect consumer transport', 'success': False}), 500
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error connecting consumer transport: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@webrtc_bp.route('/api/consume', methods=['POST'])
def consume():
    """Create a consumer on the mediasoup server"""
    try:
        data = request.json
        user_id = data.get('userId')
        producer_id = data.get('producerId')
        rtp_capabilities = data.get('rtpCapabilities')
        transport_id = data.get('transportId')
        
        response = requests.post(f"{MEDIASOUP_SERVER_URL}/consume", json={
            'producerId': producer_id,
            'rtpCapabilities': rtp_capabilities,
            'transportId': transport_id
        })
        if response.status_code != 200:
            return jsonify({'error': 'Failed to consume stream', 'success': False}), 500
        
        consumer_data = response.json()
        
        webrtc_bp.socketio.emit('consumer_created', consumer_data, room=user_id)
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error consuming stream: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500

@webrtc_bp.route('/api/close-producer', methods=['POST'])
def close_producer():
    """Close a producer on the mediasoup server"""
    try:
        data = request.json
        producer_id = data.get('producerId')
        
        response = requests.post(f"{MEDIASOUP_SERVER_URL}/closeProducer", json={
            'producerId': producer_id
        })
        if response.status_code != 200:
            return jsonify({'error': 'Failed to close producer', 'success': False}), 500
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error closing producer: {str(e)}")
        return jsonify({'error': 'Internal server error', 'success': False}), 500