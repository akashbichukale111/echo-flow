import pytest

from backend.analysis import analyze, information_value, plan_set, stress, breakpoint, linchpins
from backend.domain import Assumptions, HumanRequest, Intervention, State
from backend.repository import Conflict, SQLiteRepository
from backend.scenarios import create
from backend.service import RuleViolation, Service
from backend.simulation import find_options, routes, simulate


def test_flood_mass_conservation():
    result = simulate(State(mode="flood"), Intervention(pump=0.6, buffer="B6", gate_open=False),
                      Assumptions(unknown=0.2))
    assert abs(result["mass_balance_error_m3"]) < 1e-6
    assert result["after"]["a_m3"] >= 0 and result["after"]["b_m3"] >= 0


def test_buffer_capacity_is_not_exceeded():
    state = State(mode="flood", buffers_m3={"B5": 0, "B6": 8400})
    result = simulate(state, Intervention(buffer="B6"), Assumptions(unknown=0.2))
    assert result["after"]["buffers_m3"]["B6"] <= 8500
    assert result["flows"]["retained_m3"] == 100


def test_b5_precheck_is_overruled_by_consequence():
    options = find_options(State(mode="flood"), Assumptions(unknown=0.2))
    b5 = next(o for o in options if o["id"] == "B5")
    b6 = next(o for o in options if o["id"] == "B6")
    assert b5["precheck_pass"]
    assert b5["status"] == "FAIL"
    assert b6["status"] == "PASS"


def test_phantom_island():
    result = routes(depth_a=0.8, depth_r7=0.7, closed=False)
    assert result["phantom_island"]
    assert result["isolated_population"] == 4400
    assert not result["hospital_connected"]


def test_robustness_is_repeatable():
    state = State(mode="flood")
    p = Intervention(pump=0.6, buffer="B6", gate_open=False)
    u = {"low": 0.18, "high": 0.22}
    assert stress(state, p, u) == stress(state, p, u)
    assert stress(state, p, u)["total"] == 20


def test_voi_nonnegative():
    state = State(mode="flood")
    u = {"low": 0.1, "high": 0.55}
    stresses = {n: stress(state, p, u) for n, p in plan_set("flood").items()}
    value = information_value(stresses, "flood")
    assert all(c["expected_loss_avoided"] >= 0 for c in value["candidates"])


def test_high_uncertainty_blocks_gate():
    d = create("flood", "test")
    r = analyze(State.model_validate(d["state"]), d["unknown"], d["graph"])
    assert not r["safety"]["allowed"]


def test_linchpins_and_breakpoint_run():
    d = create("flood", "t")
    assert linchpins(d["graph"])[0]["reachable_pairs_lost_on_removal"] > 0
    bp = breakpoint(State(mode="flood"), Intervention(pump=0.6, buffer="B6", gate_open=False))
    assert len(bp["rows"]) == 91


def test_heat_power_priority_beats_no_action_on_load():
    s = State(mode="heat")
    a = Assumptions(unknown=0.1)
    base = simulate(s, Intervention(pump=1), a)
    prio = simulate(s, Intervention(pump=1, noncritical_shed=0.35, priority_power=True), a)
    assert prio["metrics"]["transformer_load_fraction"] <= base["metrics"]["transformer_load_fraction"] + 1e-9


@pytest.mark.parametrize("mode", ["flood", "heat"])
def test_full_human_workflow(tmp_path, mode):
    svc = Service(SQLiteRepository(str(tmp_path / f"{mode}.sqlite3")))
    d = svc.new(mode, "test")
    d = svc.run(d["id"], "test")
    assert len(d["run"]["agents"]) == 4
    assert not d["run"]["safety"]["allowed"]

    with pytest.raises(RuleViolation):
        svc.execute(d["id"], "test", d["run"]["id"])

    d = svc.verify(d["id"], "test", True)

    with pytest.raises(RuleViolation):
        svc.human(d["id"], "test", HumanRequest(run_id=d["run"]["id"], decision="approve", confirmed=True))

    d = svc.run(d["id"], "test")
    assert d["run"]["safety"]["allowed"], [c for c in d["run"]["safety"]["checks"] if not c["pass"]]
    run_id = d["run"]["id"]

    d = svc.human(d["id"], "test", HumanRequest(run_id=run_id, decision="approve", confirmed=True))
    assert d["approval"]["run_id"] == run_id

    d = svc.execute(d["id"], "test", run_id)
    assert d["state_revision"] == 1
    assert d["approval"] is None
    assert len(d["learning"]) == 1

    with pytest.raises(RuleViolation):
        svc.execute(d["id"], "test", run_id)

    d = svc.run(d["id"], "test")
    assert d["run"]["state_revision"] == 1
    assert d["run"]["id"] != run_id


def test_rejection_requires_reason(tmp_path):
    svc = Service(SQLiteRepository(str(tmp_path / "reject.sqlite3")))
    d = svc.run(svc.new("flood", "test")["id"], "test")
    with pytest.raises(RuleViolation):
        svc.human(d["id"], "test", HumanRequest(run_id=d["run"]["id"], decision="reject"))


def test_other_owner_cannot_read(tmp_path):
    svc = Service(SQLiteRepository(str(tmp_path / "o.sqlite3")))
    d = svc.new("flood", "alice")
    with pytest.raises(KeyError):
        svc.get(d["id"], "bob")


def test_optimistic_concurrency(tmp_path):
    repo = SQLiteRepository(str(tmp_path / "conflict.sqlite3"))
    d = create("flood", "test")
    repo.create(d)
    first, second = repo.get(d["id"]), repo.get(d["id"])
    repo.save(first, 0)
    with pytest.raises(Conflict):
        repo.save(second, 0)


def test_cross_mode_intervention_rejected():
    with pytest.raises(ValueError):
        simulate(State(mode="heat"), Intervention(buffer="B6"), Assumptions(unknown=0.1))


def test_bedrock_failure_blocks_gate(monkeypatch, tmp_path):
    monkeypatch.setenv("ECHO_AGENT_PROVIDER", "bedrock")
    monkeypatch.setenv("ECHO_BEDROCK_MODEL_ID", "x")

    import boto3

    class Boom:
        def converse(self, **_):
            raise TimeoutError("simulated timeout")

    monkeypatch.setattr(boto3, "client", lambda *a, **k: Boom())
    svc = Service(SQLiteRepository(str(tmp_path / "b.sqlite3")))
    d = svc.run(svc.new("flood", "t")["id"], "t")
    assert all(a["status"] == "ERROR" for a in d["run"]["agents"])
    assert not d["run"]["safety"]["allowed"]
