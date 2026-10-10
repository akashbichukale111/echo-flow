import os
import logging
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional

from .sms import SMSProvider
from store import SQLiteStore, DynamoStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/emergency")

class SOSRequest(BaseModel):
    idempotency_key: str = Field(..., description="Unique key to prevent duplicate SMS sends")
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    reason: Optional[str] = Field(None, description="The selected emergency reason")
    action: str = Field("both", description="The action to perform: 'sms', 'voice', or 'both'")
    contact_number: Optional[str] = Field(None, description="The emergency contact. If omitted, uses env var.")

def get_store():
    # Helper to get the correct store based on env
    if os.getenv("STORE_MODE", "sqlite") == "dynamodb":
        return DynamoStore(
            os.getenv("DYNAMODB_TABLE", ""),
            os.getenv("AWS_REGION", "ap-south-1"),
        )
    return SQLiteStore(os.getenv("DATABASE_PATH", "rahat.db"))

def get_sms_provider():
    return SMSProvider()

@router.post("/sos")
def trigger_sos(request: SOSRequest, store=Depends(get_store), sms=Depends(get_sms_provider)):
    # 1. Identify the emergency contact
    contact_number = request.contact_number or os.getenv("RAHAT_SOS_CONTACT_NUMBER")
    if not contact_number:
        logger.error("RAHAT_SOS_CONTACT_NUMBER is not configured.")
        raise HTTPException(status_code=500, detail="Emergency contact is not configured.")
    
    # 2. Idempotency Check
    incident_id = f"sos_{request.idempotency_key}"
    existing = store.get("incident", incident_id)
    if existing:
        return {
            "incident_id": incident_id,
            "status": "duplicate",
            "message": "An SOS request for this idempotency key was already processed.",
            "details": {
                "sms": existing.get("sms_status", "skipped"),
                "voice": existing.get("voice_status", "skipped")
            }
        }
    
    # 3. Construct Message
    maps_link = f"https://www.google.com/maps?q={request.latitude},{request.longitude}"
    msg_reason = f" Reason: {request.reason}." if request.reason else ""
    message = f"EMERGENCY SOS: Rider needs immediate assistance!{msg_reason} Location: {maps_link}"
    
    # 4. Send SMS and Voice Call
    sms_enabled = os.getenv("RAHAT_SOS_ENABLED", "false").lower() == "true"
    sms_result = {"status": "skipped"}
    voice_result = {"status": "skipped"}
    
    if sms_enabled:
        if request.action in ("sms", "both"):
            sms_result = sms.send_sms(contact_number, message)
        if request.action in ("voice", "both"):
            voice_result = sms.send_voice(contact_number, "This is an automated emergency alert from RAHAT AI. " + message.replace("https://www.google.com/maps?q=", "at coordinates "))
            
        if request.action == "both" and sms_result.get("status") == "error" and voice_result.get("status") == "error":
            logger.error("Failed to deliver SOS SMS and Voice")
            raise HTTPException(status_code=502, detail="Failed to deliver SOS message via provider.")
        elif request.action == "sms" and sms_result.get("status") == "error":
            raise HTTPException(status_code=502, detail="Failed to deliver SOS SMS.")
        elif request.action == "voice" and voice_result.get("status") == "error":
            raise HTTPException(status_code=502, detail="Failed to deliver SOS Voice call.")
    else:
        logger.info("RAHAT_SOS_ENABLED is false. Would execute %s to %s: %s", request.action, contact_number, message)
        if request.action in ("sms", "both"):
            sms_result = {"status": "simulated", "message_id": "simulated_sms"}
        if request.action in ("voice", "both"):
            voice_result = {"status": "simulated", "message_id": "simulated_voice"}
        
        # 4.5. Broadcast to AWS SNS (ECHO-FLOW-DISASTER-ALERTS)
    try:
        import boto3
        sns = boto3.client('sns', region_name=os.getenv("AWS_REGION", "ap-south-1"))
        topic = sns.create_topic(Name='ECHO-FLOW-DISASTER-ALERTS')
        sns.publish(
            TopicArn=topic['TopicArn'],
            Message=f"URGENT: New SOS Triggered in RAHAT AI!\nLocation: {maps_link}\nReason: {request.reason}\nAction Taken: {request.action}",
            Subject="ECHO-FLOW SYSTEM ALERT"
        )
        logger.info(f"Successfully broadcasted SOS to SNS Topic: ECHO-FLOW-DISASTER-ALERTS")
    except Exception as e:
        logger.warning(f"SNS Broadcast skipped/failed (Ensure IAM permissions for sns:CreateTopic and sns:Publish): {e}")

            # 4.6. Analyze Severity with Amazon Comprehend
    severity_level = "Unknown"
    try:
        if request.reason:
            import boto3
            comprehend = boto3.client('comprehend', region_name=os.getenv("AWS_REGION", "ap-south-1"))
            comp_resp = comprehend.detect_sentiment(Text=request.reason, LanguageCode='en')
            sentiment = comp_resp.get('Sentiment', 'UNKNOWN')
            severity_level = "HIGH" if sentiment in ["NEGATIVE", "MIXED"] else "NORMAL"
            logger.info(f"Comprehend analyzed SOS reason: {sentiment} -> Severity: {severity_level}")
    except Exception as e:
        logger.warning(f"Comprehend Sentiment Analysis skipped/failed: {e}")

    # 5. Persist Incident
    incident_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latitude": request.latitude,
        "longitude": request.longitude,
        "reason": request.reason,
        "action": request.action,
        "contact_number_masked": f"****{contact_number[-4:]}" if len(contact_number) > 4 else "****",
        "sms_status": sms_result["status"],
        "voice_status": voice_result["status"],
        "sms_message_id": sms_result.get("message_id"),
        "voice_message_id": voice_result.get("message_id")
    }
    
    store.create("incident", incident_id, incident_data)
    
    # Determine overall status
    statuses = [s for s in [sms_result["status"], voice_result["status"]] if s != "skipped"]
    overall_status = "error"
    if "success" in statuses:
        overall_status = "success"
    elif "simulated" in statuses:
        overall_status = "simulated"
    
    return {
        "incident_id": incident_id,
        "notification_status": overall_status,
        "details": {
            "sms": sms_result["status"],
            "voice": voice_result["status"]
        }
    }


class TranslateRequest(BaseModel):
    text: str
    target_language: str = "hi"

@router.post("/translate")
def translate_instruction(request: TranslateRequest):
    try:
        import boto3
        translate = boto3.client('translate', region_name=os.getenv("AWS_REGION", "ap-south-1"))
        response = translate.translate_text(
            Text=request.text,
            SourceLanguageCode="en",
            TargetLanguageCode=request.target_language
        )
        return {"translated_text": response.get('TranslatedText', request.text)}
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        return {"translated_text": request.text, "error": str(e)}

class PollyRequest(BaseModel):
    text: str
    voice_id: str = "Aditi"

@router.post("/speak")
def generate_speech(request: PollyRequest):
    try:
        import boto3
        import base64
        polly = boto3.client('polly', region_name=os.getenv("AWS_REGION", "ap-south-1"))
        response = polly.synthesize_speech(
            Text=request.text,
            OutputFormat="mp3",
            VoiceId=request.voice_id
        )
        if "AudioStream" in response:
            audio_base64 = base64.b64encode(response["AudioStream"].read()).decode("utf-8")
            return {"audio_base64": f"data:audio/mp3;base64,{audio_base64}"}
        return {"error": "No AudioStream returned"}
    except Exception as e:
        logger.error(f"Polly Synthesis failed: {e}")
        return {"error": str(e)}

