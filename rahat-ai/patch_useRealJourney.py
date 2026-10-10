import sys
import re

file_path = 'apps/web/src/real/useRealJourney.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add states
content = content.replace(
    '  const [error, setError] = useState<string>("");',
    '  const [error, setError] = useState<string>("");\n  const [dbSaved, setDbSaved] = useState(false);\n  const [s3Saved, setS3Saved] = useState(false);'
)

# Add saveSnapshot method
save_snapshot_code = '''
  const saveSnapshot = async (a: Analysis) => {
    if (!origin || !dest) return;
    try {
      setS3Saved(false);
      const { realSnapshot } = await import("./realApi");
      await realSnapshot(origin.point, dest, sunAt(origin.point.lat, origin.point.lon));
      setS3Saved(true);
    } catch (e) {
      console.error(e);
    }
  };
'''
content = content.replace(
    '  const chooseDest = (p: Place) => { setDest(p); setChosen("fastest"); setAnalysis(null); void calculate(origin?.point, p); };',
    '  const chooseDest = (p: Place) => { setDest(p); setChosen("fastest"); setAnalysis(null); void calculate(origin?.point, p); };' + save_snapshot_code
)

# Expose states
content = content.replace(
    'return { status, origin, dest, busy, error, acquire, useDemoStart, chooseDest, retry, analysis, route, chosen, setChosen: pickMode, explain, live, startLive, stopLive, takeRelief, needRahat };',
    'return { status, origin, dest, busy, error, acquire, useDemoStart, chooseDest, retry, analysis, route, chosen, setChosen: pickMode, explain, live, startLive, stopLive, takeRelief, needRahat, dbSaved, setDbSaved, s3Saved, saveSnapshot };'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
