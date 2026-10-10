import os
import logging
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

class SMSProvider:
    def __init__(self, region=None):
        self.region = region or os.getenv("AWS_REGION", "ap-south-1")
        self._client = None

    @property
    def client(self):
        if not self._client:
            self._client = boto3.client('pinpoint-sms-voice-v2', region_name=self.region)
        return self._client

    def send_sms(self, phone_number: str, message: str) -> dict:
        """
        Send an SMS message using AWS End User Messaging SMS.
        Returns a dict with 'status' and 'message_id' or 'message' on error.
        """
        try:
            response = self.client.send_text_message(
                DestinationPhoneNumber=phone_number,
                MessageBody=message,
                MessageType='TRANSACTIONAL'
            )
            return {
                "status": "success",
                "message_id": response.get("MessageId")
            }
        except ClientError as e:
            err_msg = e.response.get("Error", {}).get("Message", "Unknown AWS provider error")
            logger.error("Failed to send SMS via AWS: %s", err_msg)
            return {
                "status": "error",
                "message": err_msg
            }
        except Exception as e:
            logger.exception("Unexpected error sending SMS")
            return {
                "status": "error",
                "message": str(e)
            }

    def send_voice(self, phone_number: str, message: str) -> dict:
        """
        Send an automated voice message using AWS End User Messaging SMS/Voice.
        """
        try:
            # Voice requires an OriginationIdentity. 
            # If RAHAT_SOS_VOICE_ORIGINATION is set, we use it. Otherwise, voice might fail in AWS sandbox.
            origination = os.getenv("RAHAT_SOS_VOICE_ORIGINATION")
            kwargs = {
                "DestinationPhoneNumber": phone_number,
                "MessageBody": message,
            }
            if origination:
                kwargs["OriginationIdentity"] = origination
                
            response = self.client.send_voice_message(**kwargs)
            return {
                "status": "success",
                "message_id": response.get("MessageId")
            }
        except ClientError as e:
            err_msg = e.response.get("Error", {}).get("Message", "Unknown AWS provider error")
            logger.error("Failed to send Voice Call via AWS: %s", err_msg)
            return {
                "status": "error",
                "message": err_msg
            }
        except Exception as e:
            logger.exception("Unexpected error sending Voice Call")
            return {
                "status": "error",
                "message": str(e)
            }
