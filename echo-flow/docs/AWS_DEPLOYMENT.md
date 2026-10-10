# AWS deployment

**Status: not deployed.** `infra/template.yaml` passes `cfn-lint`; it has not been applied to an account. Deploy only
after local tests pass. Deployment incurs charges.

## Services used
Lambda, API Gateway (HTTP API + Cognito JWT), Step Functions, S3 (versioned, TLS-only, encrypted snapshots),
DynamoDB (`StateTable` version pointers, `AuditTable` append-only), CloudWatch (log group + Lambda error alarm), IAM
(SAM-generated least-privilege roles), Bedrock (optional). **Not integrated:** Amazon Location (documented gap).
No EventBridge/SQS/ECS were added: the workload is small and fits Lambda (1 GB, 180 s).

## Ordered steps
```bash
# 0. Local gate
pytest && (cd frontend && npm test && npm run build)
cfn-lint infra/template.yaml

# 1. Credentials via SSO/role (no static keys in files)
aws sts get-caller-identity

# 2-6. IAM, S3, DynamoDB (state + audit), Lambda, Step Functions, API Gateway, CloudWatch — all one stack
sam build --template-file infra/template.yaml
sam deploy --guided --template-file infra/template.yaml \
  --parameter-overrides AllowedOrigin=https://YOUR-FRONTEND-ORIGIN AgentProvider=local_rules
aws cloudformation describe-stacks --stack-name <stack> --query "Stacks[0].Outputs"

# 7. Create a commander user (admin-only sign-up)
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username you@example.com

# 8. Health (public route) — expect aws: "CONNECTED — DynamoDB and S3 probes succeeded"
curl https://<ApiUrl>/api/health

# 9. Bedrock (after enabling model access in the console)
sam deploy --parameter-overrides AgentProvider=bedrock BedrockModelId=<id> BedrockResourceArn=<narrow arn> ...

# 10. External providers: set TavilyApiKey (prefer Secrets Manager), CWC URL etc. as Lambda env vars

# 11. End-to-end: build frontend with VITE_API_BASE=<ApiUrl>, host (S3+CloudFront or Amplify), paste JWT, run hero flow,
#     then GET /api/scenarios/<id>/audit/verify and confirm sink_consistent=true
```
Do not report "AWS ONLINE" unless `/api/health` returns the CONNECTED line from step 8.

## Known deployment risks
- Lambda role for AuditTable intentionally lacks Update/Delete; do not widen it.
- Failed concurrent writes can leave unreferenced S3 snapshots (versioned bucket; harmless).
- Amazon Location, IMERG and CWC remain unimplemented; see `docs/DATA_SOURCES.md`.
