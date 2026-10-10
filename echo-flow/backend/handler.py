from mangum import Mangum

from .domain import Intervention
from .main import app
from .repository import repository
from .service import Service

http_handler = Mangum(app)


def handler(event, context):
    command = event.get("command")
    if command == "analyze":
        service = Service(repository())
        data = event["input"]
        intervention = Intervention.model_validate(data["intervention"]) if data.get("intervention") else None
        d = service.run(data["scenario_id"], data["owner"], intervention,
                        execution_id=event["execution_id"],
                        expected_version=data["expected_version"])
        return {"scenario_id": d["id"], "run_id": d["run"]["id"], "owner": data["owner"],
                "execution_id": event["execution_id"]}
    if command == "audit":
        service = Service(repository())
        data = event["input"]
        d = service.get(data["scenario_id"], data["owner"])
        version = d["version"]
        service.event(d, "AWS workflow completed", "step-functions",
                      {"execution_id": data["execution_id"], "run_id": data["run_id"]})
        service.repo.save(d, version)
        return {"status": "COMPLETE", **data}
    return http_handler(event, context)
