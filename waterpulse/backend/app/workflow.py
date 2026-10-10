from .repositories import create_repository, default_workspace
from .service import analyze, ensure_current, find_action


# Step Functions is an optional observer of the SAME persisted action workflow.
# It cannot approve, execute, dispatch, or control infrastructure.
def handler(event, context):
    repository = create_repository()
    # The observer reads the workspace selected by APP_MODE (pilot on AWS) unless
    # the event names one explicitly.
    workspace = event.get("workspace")
    state = repository.read(workspace)
    action = find_action(state, event["action_id"])
    stage = event["stage"]
    if stage in {"WATCH", "DIAGNOSE", "SIMULATE", "VALIDATE"}:
        ensure_current(state, action)
        result = analyze(state, action["zone_id"], workspace=workspace or default_workspace())
        field = {
            "WATCH": "model", "DIAGNOSE": "diagnosis",
            "SIMULATE": "scenarios", "VALIDATE": "validator"
        }[stage]
        output = result[field]
    else:
        output = action["verification"] if stage == "VERIFY" \
            else {"status": action["status"]}
    return {
        "action_id": action["id"], "stage": stage,
        "status": action["status"], "output": output
    }
