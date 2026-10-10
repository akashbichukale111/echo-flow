# ECHO-FLOW PLATFORM: Unified Deployment Architecture

This document outlines the architecture and deployment steps required to host the main site and the three integrated applications (ECHO-FLOW, RAHAT AI, WATERPULSE) under ONE primary domain on AWS.

## Architecture: Unified CloudFront + API Gateway

To achieve a single primary domain (e.g., `platform.example.com`) without modifying the internal FastAPI routing or introducing a new backend proxy layer, we use **Amazon CloudFront** to unify the routing.

### 1. Static Assets (S3)
1. Build all frontends locally:
   - `echo-flow/frontend`: `npm run build` (outputs to `dist/`)
   - `rahat-ai/apps/web`: `npm run build` (outputs to `dist/`)
   - `waterpulse/frontend`: `npm run build` (outputs to `dist/`)
2. Consolidate into a single artifact folder:
   - Copy `site/*` into a new `platform-dist/` folder.
   - Copy `echo-flow/frontend/dist` into `platform-dist/echo-flow/`.
   - Copy `rahat-ai/apps/web/dist` into `platform-dist/rahat/`.
   - Copy `waterpulse/frontend/dist` into `platform-dist/waterpulse/`.
3. Upload `platform-dist/` to a single private S3 bucket.

### 2. Backends (API Gateway + Lambda)
Deploy the three existing backend AWS SAM templates independently. Each will create its own API Gateway HTTP API and output an `ApiUrl`.

### 3. Routing (CloudFront)
Create a single CloudFront distribution connected to your primary domain.

Configure the following **Behaviors**:

- **`/echo-flow/api/*`**
  - Origin: ECHO-FLOW API Gateway URL
  - CloudFront Function (Viewer Request): Strip `/echo-flow` prefix before sending to origin.
- **`/rahat/api/*`**
  - Origin: RAHAT AI API Gateway URL
  - CloudFront Function (Viewer Request): Strip `/rahat` prefix before sending to origin.
- **`/waterpulse/api/*`**
  - Origin: WATERPULSE API Gateway URL
  - CloudFront Function (Viewer Request): Strip `/waterpulse` prefix before sending to origin.
- **`Default (*)`**
  - Origin: S3 Bucket (via Origin Access Control / OAC)
  - Purpose: Serves the static HTML, JS, and CSS for the main site and the three apps.

## Deployment Steps

1. **Deploy Backends:** Navigate to each of the three project folders and deploy using `sam build` and `sam deploy --guided`. Note the output API URLs.
2. **Build Frontends:** Ensure Node.js is installed. Run `npm install` and `npm run build` in each frontend directory.
3. **Consolidate and Upload:** Organize the output files into the `platform-dist` folder structure and upload to your designated S3 bucket.
4. **Configure CloudFront:** Set up the CloudFront distribution with the behaviors specified above, and attach the CloudFront Functions to rewrite the API paths.
5. **Verify:** Navigate to your primary domain to verify the main site loads, the project cards navigate to the respective apps, and the apps can communicate with their APIs.

*Note: The frontend applications have been updated to expect these unified paths (e.g. Vite `base` paths, React Router `basename`, and API fetch base paths).*
