from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Table, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import pytz

Base = declarative_base()

# Association table for many-to-many relationship between sessions and users
session_participants = Table(
    'session_participants',
    Base.metadata,
    Column('session_id', String, ForeignKey('sessions.session_id'), primary_key=True),
    Column('user_id', String, ForeignKey('users.user_id'), primary_key=True)
)

class User(Base):
    __tablename__ = 'users'
    
    user_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    is_teacher = Column(Boolean, default=False)
    hand_raised = Column(Boolean, default=False)
    is_muted = Column(Boolean, default=True)  # Default to muted
    video_enabled = Column(Boolean, default=True)  # Default video on
    is_streaming = Column(Boolean, default=False)  # For teacher livestream status
    
    def to_dict(self):
        """Convert user object to dictionary for JSON serialization"""
        return {
            'userId': self.user_id,
            'name': self.name,
            'isTeacher': self.is_teacher,
            'handRaised': self.hand_raised,
            'isMuted': self.is_muted,
            'videoEnabled': self.video_enabled,
            'isStreaming': self.is_streaming
        }

class Session(Base):
    __tablename__ = 'sessions'
    
    session_id = Column(String, primary_key=True)
    teacher_id = Column(String, ForeignKey('users.user_id'), nullable=False)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, nullable=True)  # DateTime for timezone support
    shared_screen = Column(String, nullable=True)  # user_id of user sharing screen
    is_livestreaming = Column(Boolean, default=False)
    recording_url = Column(String, nullable=True)
    producer_id = Column(String, nullable=True)  # Stores mediasoup producer ID
    
    # Relationships
    teacher = relationship("User", foreign_keys=[teacher_id])
    participants = relationship("User", secondary=session_participants, backref="sessions")
    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")
    
    def add_participant(self, user):
        """Add a participant to the session"""
        if user not in self.participants:
            self.participants.append(user)
    
    def remove_participant(self, user_id):
        """Remove a participant from the session"""
        self.participants = [p for p in self.participants if p.user_id != user_id]
    
    def get_participants(self):
        """Get list of participants in the session"""
        return self.participants
    
    def get_participant_list(self):
        """Get a list of participant dictionaries"""
        return [user.to_dict() for user in self.participants]
    
    def add_message(self, message):
        """Add a message to the session"""
        self.messages.append(message)
    
    def start_livestream(self):
        """Start the livestream session"""
        self.is_livestreaming = True
    
    def stop_livestream(self):
        """Stop the livestream session"""
        self.is_livestreaming = False
        self.producer_id = None  # Clear producer ID when livestream stops
    
    def set_producer_id(self, producer_id):
        """Set the mediasoup producer ID for the session"""
        self.producer_id = producer_id
    
    def to_dict(self):
        """Convert session to dictionary for JSON serialization"""
        return {
            'sessionId': self.session_id,
            'teacherId': self.teacher_id,
            'name': self.name,
            'isActive': self.is_active,
            'createdAt': self.created_at.isoformat() if self.created_at else None,
            'participants': self.get_participant_list(),
            'isLivestreaming': self.is_livestreaming,
            'recordingUrl': self.recording_url,
            'producerId': self.producer_id
        }

class Message(Base):
    __tablename__ = 'messages'
    
    message_id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey('sessions.session_id'), nullable=False)
    user_id = Column(String, ForeignKey('users.user_id'), nullable=False)
    user_name = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, nullable=False)  # DateTime for timezone support
    is_question = Column(Boolean, default=False)
    answered = Column(Boolean, default=False)
    
    # Relationships
    session = relationship("Session", back_populates="messages")
    user = relationship("User")
    
    def to_dict(self):
        """Convert message to dictionary for JSON serialization"""
        return {
            'messageId': self.message_id,
            'userId': self.user_id,
            'userName': self.user_name,
            'content': self.content,
            'timestamp': self.timestamp.isoformat(),
            'isQuestion': self.is_question,
            'answered': self.answered
        }