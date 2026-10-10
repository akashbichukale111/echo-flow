import sys
import re

file_path = 'apps/web/src/real/RealJourneyPage.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace reportHere to use setDbSaved
old_report_here = 'const reportHere = (kind: string) => { if (j.origin) void realReport(kind, j.origin.point).catch(() => undefined); };'
new_report_here = 'const reportHere = (kind: string) => { if (j.origin) { j.setDbSaved(false); realReport(kind, j.origin.point).then(() => j.setDbSaved(true)).catch(() => undefined); } };'
content = content.replace(old_report_here, new_report_here)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
