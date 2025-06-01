import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Load environment variables from .env file
load_dotenv()

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL")
    
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL not set in environment variables")
    
    # Fix PostgreSQL URL format if needed (Neon sometimes uses postgres:// instead of postgresql://)
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    
    # Create sqlalchemy engine with proper PostgreSQL settings
    engine = create_engine(
        DATABASE_URL,
        echo=os.getenv('SQL_ECHO', 'False').lower() == 'true',
        pool_pre_ping=True,  # Verify connections before use
        pool_recycle=300,    # Recycle connections every 5 minutes
        pool_size=5,         # Connection pool size
        max_overflow=10,     # Maximum overflow connections
        connect_args={
            "sslmode": "require",
            "connect_timeout": 10,
            "application_name": "streaming_backend"
        }
    )
    
    # Create session factory
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    # Other configuration
    SECRET_KEY = os.getenv('SECRET_KEY', 'your-secret-key-here-change-in-production')
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'

    #Mediasoup server configuration
    MEDIASOUP_SERVER_URL = os.getenv('MEDIASOUP_SERVER_URL', 'http://localhost:3000')