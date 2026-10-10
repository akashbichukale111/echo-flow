"""Apply negative community reports to an analysis' relief lists (labelled, never silent)."""
from .community import apply_negatives


def apply(out, reports):
    negatives = [r for r in reports if r.get("negative")]
    if not negatives:
        return out
    out["relief"] = apply_negatives(out["relief"], negatives)
    for rt in out["routes"]:
        rt["reliefNear"] = apply_negatives(rt["reliefNear"], negatives)
    out["negativeReports"] = len(negatives)
    return out
