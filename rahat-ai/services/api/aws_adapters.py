import json
import os

class BedrockExplainer:
    def __init__(self, client=None):
        self.model = os.getenv("BEDROCK_MODEL_ID", "")
        self.client = client

    def explain(self, validated_context):
        if not self.model:
            raise ValueError("BEDROCK_MODEL_ID is not configured")
        if not validated_context.get("validated"):
            raise ValueError("Only validated engine output may be explained")
        if self.client is None:
            import boto3
            self.client = boto3.client(
                "bedrock-runtime",
                region_name=os.getenv("AWS_REGION", "ap-south-1"),
            )
        # Free-form numeric output is disallowed. UI metrics remain engine-owned.
        evidence = {
            "routes": [
                {
                    "mode": r["mode"], "load": r["load"],
                    "shade": r["shade"], "minutes": r["minutes"],
                    "relief_count": r["relief_count"],
                }
                for r in validated_context["routes"]
            ],
            "limitations": validated_context["evidence"],
        }
        result = self.client.converse(
            modelId=self.model,
            system=[{"text": (
                "Explain only the supplied route comparison in plain English. "
                "Use at most three sentences. Do not write any digits, numeric "
                "quantities, medical claims, health probabilities, or guarantees. "
                "Do not recommend an action unsupported by the evidence. "
                "Explicitly say the data is synthetic and the model uncalibrated. "
                "Briefly mention how Amazon Bedrock's natural language capabilities help users understand complex thermal data."
            )}],
            messages=[{
                "role": "user",
                "content": [{"text": json.dumps(evidence)}],
            }],
            inferenceConfig={"maxTokens": 250, "temperature": 0},
        )
        blocks = result["output"]["message"]["content"]
        text = " ".join(b["text"] for b in blocks if "text" in b).strip()
        forbidden = ("heatstroke", "dehydration", "body temperature", "guaranteed safe")
        if not text or any(c.isdigit() for c in text) or any(
            term in text.lower() for term in forbidden
        ):
            raise ValueError("AI explanation failed the output guard")
        # This guard is deliberately not represented as complete semantic validation.
        return text

class AmazonLocationRoutes:
    """External route acquisition only; not a replacement thermal street graph."""
    def __init__(self, client=None):
        if client is None:
            import boto3
            client = boto3.client(
                "geo-routes", region_name=os.getenv("AWS_REGION", "ap-south-1")
            )
        self.client = client

    def calculate(self, origin_lon_lat, destination_lon_lat, mode="Pedestrian"):
        for point in (origin_lon_lat, destination_lon_lat):
            if len(point) != 2 or not (
                -180 <= point[0] <= 180 and -90 <= point[1] <= 90
            ):
                raise ValueError("Expected valid [longitude, latitude]")
        if mode not in {"Pedestrian", "Bicycle", "Car", "Scooter"}:
            raise ValueError("Unsupported Amazon Location travel mode")
        return self.client.calculate_routes(
            Origin=origin_lon_lat,
            Destination=destination_lon_lat,
            TravelMode=mode,
            LegGeometryFormat="Simple",
        )
