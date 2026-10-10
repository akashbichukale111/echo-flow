# AWS setup

Nothing here has been deployed by the author. Use a test account first.

1. Install AWS SAM CLI; configure credentials (prefer SSO/role over static keys).
2. `sam build --template infra/template.yaml` then `sam deploy --guided`
   (parameters: `ApiToken` 32+ chars, `AllowedOrigin`, optional `BedrockModelId`, `BedrockModelArn`,
   `WeatherProvider`/`WeatherApiKey`, `AmazonLocationKey`). `sam build` uses `backend/Makefile`, which
   bundles `data/raw` and `data/reference` into both Lambda packages. Needs `make` and Python 3.12 locally
   (or `sam build --use-container`). The template has been checked with `cfn-lint`; `sam build`/deploy
   have not been run by the author.
3. Resources: DynamoDB table (PAY_PER_REQUEST, encrypted, PITR), S3 evidence bucket
   (private, versioned, encrypted), HTTP API (throttled), API Lambda, workflow Lambda and a
   Step Functions observer state machine. The `EVIDENCE_BUCKET` variable is provisioned for
   exports; the application does not yet write to it.
4. Bedrock: enable model access in the Bedrock console for your region, set `BEDROCK_MODEL_ID`
   and `BedrockModelArn`. Confirm the model is available in your region (default region
   is ap-south-1; check availability or use an inference profile). Without it the app uses
   deterministic text.
5. Frontend: `npm run build` in `frontend/`, host `dist/` (S3 + CloudFront or Amplify) and set
   `VITE_API_BASE` to the API URL at build time.
6. Pilot mode uses a shared bearer token; replace with Cognito/IAM authorizers for real use.
7. Observability: explicit CloudWatch log groups (retention parameter), HTTP API access logs, state-machine
   error logs and X-Ray tracing. IAM: DynamoDB GetItem/PutItem only (observer: GetItem), Bedrock InvokeModel on
   the single supplied ARN. Provider keys are `NoEcho` parameters; prefer Secrets Manager beyond a pilot.
8. The observer state machine reads the workspace selected by `APP_MODE` (pilot) unless the event names one.
