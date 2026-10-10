import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

import tempfile
db_fd, db_path = tempfile.mkstemp()
os.environ["STORE_MODE"] = "sqlite"
os.environ["DATABASE_PATH"] = db_path
os.environ["RAHAT_SOS_CONTACT_NUMBER"] = "+1234567890"
os.environ["RAHAT_SOS_ENABLED"] = "true"

from main import app
from emergency.sms import SMSProvider

client = TestClient(app)

@pytest.fixture
def mock_sms():
    with patch.object(SMSProvider, 'send_sms') as mock_s, \
         patch.object(SMSProvider, 'send_voice') as mock_v:
        mock_s.return_value = {"status": "success", "message_id": "mock_sms_123"}
        mock_v.return_value = {"status": "success", "message_id": "mock_voice_123"}
        yield mock_s, mock_v

def test_sos_valid_request(mock_sms):
    mock_s, mock_v = mock_sms
    response = client.post("/api/emergency/sos", json={
        "idempotency_key": "test_req_1",
        "latitude": 18.5,
        "longitude": 73.8,
        "reason": "Heatstroke"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["incident_id"] == "sos_test_req_1"
    assert data["notification_status"] == "success"
    
    # Check SMS was called
    mock_s.assert_called_once()
    mock_v.assert_called_once()
    args, _ = mock_s.call_args
    assert args[0] == "+1234567890"
    assert "18.5,73.8" in args[1]
    assert "Heatstroke" in args[1]

def test_sos_invalid_coordinates():
    response = client.post("/api/emergency/sos", json={
        "idempotency_key": "test_req_invalid",
        "latitude": 100, # Invalid latitude
        "longitude": 73.8
    })
    assert response.status_code == 422 # FastAPI validation error

def test_sos_missing_contact_config(mock_sms):
    with patch.dict(os.environ, {}, clear=True):
        os.environ["STORE_MODE"] = "sqlite"
        os.environ["DATABASE_PATH"] = db_path
        response = client.post("/api/emergency/sos", json={
            "idempotency_key": "test_req_no_contact",
            "latitude": 18.5,
            "longitude": 73.8
        })
        assert response.status_code == 500
        assert "Emergency contact is not configured" in response.text

def test_sos_duplicate_idempotency_key(mock_sms):
    mock_s, mock_v = mock_sms
    # Send first
    res1 = client.post("/api/emergency/sos", json={
        "idempotency_key": "test_duplicate",
        "latitude": 18.5,
        "longitude": 73.8
    })
    assert res1.status_code == 200
    
    # Send second
    res2 = client.post("/api/emergency/sos", json={
        "idempotency_key": "test_duplicate",
        "latitude": 18.5,
        "longitude": 73.8
    })
    assert res2.status_code == 200
    assert res2.json()["status"] == "duplicate"
    
    # Ensure SMS was only sent ONCE
    mock_s.assert_called_once()
    mock_v.assert_called_once()

def test_sos_provider_failure():
    with patch.object(SMSProvider, 'send_sms') as mock_s, \
         patch.object(SMSProvider, 'send_voice') as mock_v:
        mock_s.return_value = {"status": "error", "message": "AWS SMS error"}
        mock_v.return_value = {"status": "error", "message": "AWS Voice error"}
        response = client.post("/api/emergency/sos", json={
            "idempotency_key": "test_req_fail",
            "latitude": 18.5,
            "longitude": 73.8
        })
        assert response.status_code == 502
        assert "Failed to deliver SOS" in response.text

def test_sos_db_failure(mock_sms):
    from store import SQLiteStore
    with patch.object(SQLiteStore, 'create', side_effect=Exception("DB Error")):
        response = client.post("/api/emergency/sos", json={
            "idempotency_key": "test_req_db_fail",
            "latitude": 18.5,
            "longitude": 73.8
        })
        assert response.status_code == 503
