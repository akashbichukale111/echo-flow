import sys

file_path = 'apps/web/src/real/RealJourneyPage.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add Bedrock badge
bedrock_target = '{j.explain && <p><Badge kind={j.explain.source === "AI EXPLANATION" ? "AI EXPLANATION" : "MODEL ESTIMATE"} /> {j.explain.text}</p>}'
bedrock_replacement = '{j.explain && <p><Badge kind={j.explain.source === "AI EXPLANATION" ? "AI EXPLANATION" : "MODEL ESTIMATE"} /> {j.explain.text} {j.explain.source === "AI EXPLANATION" && <span style={{fontSize: "11px", color: "#888", display: "inline-block", marginLeft: "6px"}}>— Powered by Amazon Bedrock</span>}</p>}'
content = content.replace(bedrock_target, bedrock_replacement)

# Add DynamoDB badge
db_target = '<Card title="Community" tag="COMMUNITY REPORT">'
db_replacement = '<Card title="Community" tag="COMMUNITY REPORT">\n        {j.dbSaved && <p style={{fontSize: "11px", color: "#888", marginTop: "8px", marginBottom: "8px"}}>Saved to Amazon DynamoDB</p>}'
content = content.replace(db_target, db_replacement)

# Add S3 badge
s3_target = '</Card>\n    </>}'
s3_replacement = '<div style={{marginTop: "16px"}}><button onClick={() => j.saveSnapshot(a)} disabled={j.s3Saved} style={{fontSize: "11px"}}>{j.s3Saved ? "Stored in Amazon S3" : "Archive Snapshot to S3"}</button></div></Card>\n    </>}'
content = content.replace(s3_target, s3_replacement)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
