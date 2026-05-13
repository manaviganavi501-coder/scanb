import firebase_admin
from firebase_admin import credentials, firestore
import os

def init_firebase():
    """Initialize Firebase Firestore connection"""
    if not firebase_admin._apps:
        # Use the service account JSON file
        cred = credentials.Certificate(os.path.join(os.path.dirname(__file__), 'firebase-service-account.json'))
        firebase_admin.initialize_app(cred)
    
    return firestore.client()