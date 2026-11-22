# AxionLimit — Single EC2 Multi-Container Deployment Guide

> Production-ready, secure, and cost-conscious AWS deployment guide for **AxionLimit** — a centralized API rate limiter and real-time telemetry service running on a **single EC2 instance** via Docker Compose.

---

## 1. Architecture Overview

AxionLimit runs entirely on **one EC2 instance (`t3.small`)** in the **Mumbai region (`ap-south-1`)**. All frontend, backend, and caching services are containerized using Docker and Docker Compose behind an **Nginx reverse proxy**.

External persistence is provided by a free **MongoDB Atlas (M0)** managed cluster.

### Architecture Diagram

```text
                                  [ INTERNET ]
                               (Client / Browser)
                                       │
                                       │ HTTP (Port 80)
                                       ▼
                       ┌───────────────────────────────┐
                       │        AWS EC2 Instance       │
                       │           (t3.small)          │
                       │      Dynamic Public IPv4      │
                       │                               │
                       │  ┌─────────────────────────┐  │
                       │  │     NGINX CONTAINER     │  │
                       │  │      Host Port: 80      │  │
                       │  └────────────┬────────────┘  │
                       │               │               │
                       │      ┌────────┴────────┐      │
                       │      │ (Docker Network)│      │
                       │      ▼                 ▼      │
                       │ ┌──────────┐    ┌──────────┐  │
                       │ │ React SPA│    │ Express  │  │
                       │ │  Static  │    │ Backend  │  │
                       │ │  Assets  │    │  :5000   │  │
                       │ └──────────┘    └────┬─────┘  │
                       │                      │        │
                       │                      ▼        │
                       │                 ┌──────────┐  │
                       │                 │  Redis   │  │
                       │                 │  :6379   │  │
                       │                 └────┬─────┘  │
                       │                      │        │
                       │                      ▼        │
                       │                 ┌──────────┐  │
                       │                 │20GB gp3  │  │
                       │                 │EBS Volume│  │
                       │                 └──────────┘  │
                       └──────────────┬────────────────┘
                                      │
                                      │ Outbound TLS (:27017)
                                      ▼
                       ┌───────────────────────────────┐
                       │      MongoDB Atlas (M0)       │
                       │  (Whitelisted EC2 Public IP)  │
                       └───────────────────────────────┘
```

### Core Architecture Highlights

1. **Single Entry Point (Port 80):** Nginx is the only service that publishes a port to the EC2 host. It serves compiled React static assets and reverse-proxies `/api/`, `/auth/`, `/health`, and `/server-info` requests internally to the Express backend.
2. **Private Internal Networking:** The Express backend (port 5000) and Redis (port 6379) are completely private inside the Docker bridge network (`axion-internal`). Neither is directly reachable from the public internet.
3. **Same-Origin API Communication:** The React frontend communicates with the backend using relative URLs (`baseURL: '/'`). No public IP hardcoding, no CORS issues between frontend and backend, and no frontend rebuild required when the EC2 dynamic public IP changes.
4. **Persistent EBS-Backed Redis:** Redis data is stored on a persistent named Docker volume (`axion_redis_data`) located on the EC2 host's 20 GB gp3 encrypted EBS disk, with AOF and RDB snapshots.
5. **Zero AWS NAT or Load Balancer Fees:** Eliminates Application Load Balancers ($18+/month) and NAT Gateways ($32+/month), delivering a full stack on AWS at baseline compute and storage cost (~$1.76/mo stopped, ~$20.60/mo running 24/7).

---

## 2. Infrastructure as Code: Terraform Resource Breakdown

### Resource Recalculation

The Terraform code declares **10 baseline resources**, with up to **4 optional/conditional resources**:

```text
Baseline (use_elastic_ip = false, github_repo = ""):      10 resources
With GitHub Actions OIDC (github_repo configured):        13 resources
With Elastic IP + GitHub OIDC:                            14 resources
```

#### Complete Resource Inventory

| # | Resource Address in Terraform | Type | Condition | Purpose |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `aws_vpc.main` | Core Network | Baseline | Dedicated VPC (`10.0.0.0/16`) in `ap-south-1` |
| 2 | `aws_internet_gateway.gw` | Core Network | Baseline | Internet gateway attached to VPC |
| 3 | `aws_subnet.public` | Core Network | Baseline | Public subnet (`10.0.1.0/24`) in `ap-south-1a` |
| 4 | `aws_route_table.public` | Core Network | Baseline | Default route table directing `0.0.0.0/0` to IGW |
| 5 | `aws_route_table_association.public` | Core Network | Baseline | Associates route table with public subnet |
| 6 | `aws_security_group.ec2` | Security | Baseline | Inbound Port 80 open; Ports 5000 & 6379 blocked |
| 7 | `aws_iam_role.ec2_role` | IAM | Baseline | Service role for EC2 (`sts:AssumeRole`) |
| 8 | `aws_iam_role_policy_attachment.ssm_core` | IAM | Baseline | Attaches `AmazonSSMManagedInstanceCore` for AWS Systems Manager |
| 9 | `aws_iam_instance_profile.ec2_profile` | IAM | Baseline | Links IAM role to EC2 instance |
| 10 | `aws_instance.server` | Compute | Baseline | `t3.small` instance, Standard CPU credits, 20GB gp3 EBS disk |
| 11 | `aws_eip.ec2_eip` | Compute | `var.use_elastic_ip ? 1 : 0` | Optional static public IPv4 address |
| 12 | `aws_iam_openid_connect_provider.github` | IAM | `var.github_repo != "" ? 1 : 0` | GitHub Actions OIDC identity provider |
| 13 | `aws_iam_role.github_actions` | IAM | `var.github_repo != "" ? 1 : 0` | IAM role assumed by GitHub Actions workflow |
| 14 | `aws_iam_role_policy.github_actions_policy` | IAM | `var.github_repo != "" ? 1 : 0` | SSM & EC2 deployment permissions for GitHub Actions |

> [!IMPORTANT]
> **Terraform Plan Prerequisite:**
> Running `terraform plan` requires valid AWS credentials configured on the workstation (via `aws configure` or environment variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`). Without credentials, Terraform cannot query the live Ubuntu 22.04 LTS AMI data source (`data.aws_ami.ubuntu`) or inspect existing state in `ap-south-1`.

---

## 3. GitHub Actions OIDC: Immutable Subject Claim Enforcement

GitHub enforces **Immutable Subject Claims** for all repositories created after **July 15, 2026** (to eliminate namespace recycling vulnerabilities when repos are renamed or transferred):

* **Repository Creation Date:** July 17, 2026 (`kiranmukkamula/AxionLimit`)
* **Repository ID:** `1303665861`
* **Owner ID:** `152879853`
* **Immutable Subject Claim Format:**
  ```text
  repo:kiranmukkamula@152879853/AxionLimit@1303665861:ref:refs/heads/main
  ```

In `infrastructure/iam.tf`, the IAM trust policy strictly matches this immutable claim and restricts assumption exclusively to the **`main` branch**:

```hcl
Condition = {
  StringEquals = {
    "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
    "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo_owner}@${var.github_owner_id}/${var.github_repo_name}@${var.github_repo_id}:ref:refs/heads/${var.github_branch}"
  }
}
```

### AWS Systems Manager (SSM) Deployment Policy

AWS IAM does not support resource-level permissions for `ssm:GetCommandInvocation`, `ec2:DescribeInstances`, or `ssm:DescribeInstanceInformation`. In `infrastructure/iam.tf`, permissions are cleanly segregated with least-privilege scoping:

```hcl
Statement = [
  {
    Sid      = "EC2DescribeInstance"
    Effect   = "Allow"
    Action   = ["ec2:DescribeInstances"]
    Resource = "*"
  },
  {
    Sid      = "SSMDescribeInstance"
    Effect   = "Allow"
    Action   = ["ssm:DescribeInstanceInformation"]
    Resource = "*"
  },
  {
    Sid      = "SSMSendCommand"
    Effect   = "Allow"
    Action   = ["ssm:SendCommand"]
    Resource = [
      "arn:aws:ssm:${var.aws_region}:*:document/AWS-RunShellScript",
      aws_instance.server.arn
    ]
  },
  {
    Sid      = "SSMGetInvocation"
    Effect   = "Allow"
    Action   = ["ssm:GetCommandInvocation"]
    Resource = "*"
  },
  {
    Sid      = "SSMPutSecrets"
    Effect   = "Allow"
    Action   = ["ssm:PutParameter"]
    Resource = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/axionlimit/prod/MONGO_URI",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/axionlimit/prod/JWT_SECRET"
    ]
  }
]
```

### EC2 Role Inline Policy for Secrets Decryption

The EC2 instance role (`ec2_role`) includes an inline policy permitting secure retrieval and decryption of production parameters from SSM Parameter Store:

```hcl
inline_policy {
  name = "${var.project_name}-ec2-secrets-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMGetSecrets"
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/axionlimit/prod/MONGO_URI",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/axionlimit/prod/JWT_SECRET"
        ]
      },
      {
        Sid      = "KMSDecryptSecrets"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
      }
    ]
  })
}
```

---

## 4. Client IP Security & Anti-Spoofing Architecture

To prevent malicious clients from bypassing rate limits or spoofing arbitrary IP addresses to ban innocent users:

1. **Nginx Header Replacement:**
   In `Frontend/nginx/default.conf`, Nginx explicitly overwrites any client-supplied `X-Forwarded-For` header with the verified TCP remote address:
   ```nginx
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $remote_addr;
   ```
2. **Express Trusted Proxy:**
   In `Backend/server.js`, `app.set('trust proxy', 1)` instructs Express to trust the single reverse-proxy hop (Nginx) and extract `req.ip` from the Nginx-supplied header.
3. **Strict Backend IP Extraction:**
   In `Backend/middleware/auth.js`, client IP detection strictly uses `req.ip`:
   ```javascript
   const clientIp = (req.ip || req.socket?.remoteAddress || '127.0.0.1').trim();
   req.clientIp = clientIp;
   ```
   Untrusted headers such as `x-user-ip` or `x-client-ip` are ignored for network address resolution, preventing header spoofing.

---

## 5. Authentication, JWT & Production Security

1. **Header-Only API Key Verification:**
   In `Backend/middleware/auth.js`, API keys are accepted exclusively via the `x-api-key` header. Query parameter transmission (`req.query.apiKey`) is strictly rejected to prevent credentials from being leaked into access logs, browser history, or shoulder surfing.
2. **Secure Key ID Authentication with JWT:**
   When authenticating via `x-api-key-id`, the client must supply a valid `Authorization: Bearer <token>` header. The middleware verifies that the authenticated user owns the key (`ApiKey.findOne({ _id: suppliedKeyId, userId: decoded.userId })`), and checks `isActive === true` and expiration. Unauthenticated Key ID lookups without a token have been completely removed.
3. **JWT_SECRET Enforcement:**
   In `Backend/server.js`, startup verification fails immediately (`process.exit(1)`) if `JWT_SECRET` is missing in production mode. Hardcoded fallback strings have been removed from the codebase.
4. **Developer Mock Login Protection:**
   In `Backend/routes/auth.js`, the `/auth/dev-login` endpoint returns `403 Forbidden` in production mode unless explicitly opted into via `ENABLE_DEV_LOGIN=true` (which defaults to `false` in `docker-compose.prod.yml`).
5. **Exact CORS Origin Matching:**
   In `Backend/server.js`, unsafe `startsWith()` matching has been replaced with exact origin matching. Permitted origins include `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL`, and same-origin host headers (`http://${host}`, `https://${host}`). Non-browser clients (such as cURL or microservices) without an Origin header remain permitted. Untrusted external origins are blocked with 403 Forbidden.
6. **Google OAuth 2.0 Limitation:**
   > [!WARNING]
   > Google Cloud Console strictly prohibits raw HTTP IPv4 addresses (`http://13.234.x.x/auth/google/callback`) as authorized redirect URIs for production OAuth credentials. Google OAuth strictly requires a registered domain name and valid HTTPS certificate (via ACM + ALB or CloudFront). When accessing AxionLimit over an HTTP dynamic IP, Google OAuth will produce `redirect_uri_mismatch`. Developers must use Developer Mock Login (`ENABLE_DEV_LOGIN=true`) or direct API key headers.

---

## 6. Container Stack & Runtime Versions

All container definitions use maintained, supported LTS releases:

| Container | Base Image | Version / Branch | Healthcheck |
| :--- | :--- | :--- | :--- |
| **Frontend** | `node:24-alpine` (Build) $\rightarrow$ `nginx:1.30.7-alpine` (Run) | Node 24 LTS / Nginx 1.30.7 Stable | `wget -qO- http://localhost/` |
| **Backend** | `node:24-alpine` | Node 24 LTS | `wget -qO- http://localhost:5000/health` |
| **Redis** | `redis:7.2-alpine` | Redis 7.2 Stable | `redis-cli ping` |

### Startup Ordering & Atlas Recovery

In `docker-compose.prod.yml`, the frontend depends on the backend container without healthcheck gating:
```yaml
frontend:
  depends_on:
    - backend
```
* **Resilience Benefit:** Nginx starts immediately and serves the React SPA on port 80 even if the backend is waiting for the EC2 IP to be added to MongoDB Atlas Network Access.
* **Backend Self-Healing Loop:** If MongoDB Atlas rejects the connection, Mongoose logs the error and calls `process.exit(1)`. The Docker daemon (`restart: unless-stopped`) automatically restarts the backend container with exponential backoff. As soon as the administrator enters the IP in MongoDB Atlas, the next container restart connects cleanly and `/health` turns `UP`.

---

## 7. Redis Telemetry: Bounded Retention & Eviction Strategy

* **Settings:** `--maxmemory 256mb --maxmemory-policy volatile-lru`
* **Atomic Execution:** In `Backend/services/rateLimiter.js`, the `SLIDING_WINDOW_LUA` script executes sliding-window rate limiting and telemetry recording in a single atomic Redis round-trip.
* **Rolling TTL:** A 90-day rolling expiration (`expire 7776000`) is refreshed on all 5 telemetry keys (`tTotal`, `tAllowed`, `tBlocked`, `tTopUsers`, `tTopEndpoints`) during logging.
* **Bounded Cardinality:** Sorted sets (`topUsers`, `topEndpoints`) are pruned atomically to retain only the top 100 entries (`zremrangebyrank(key, 0, -101)`), preventing memory exhaustion from endpoint scanning.
* **What Happens When Redis Fills to 256 MB?**
  1. Under `volatile-lru`, Redis evicts the least recently used keys that have a TTL (transient rate-limit counters and expired cache keys).
  2. If an active rate-limit counter is evicted, that specific client's counter resets to 0, granting extra quota for the remainder of that 60-second window.
  3. If Redis runs out of evictable keys, any subsequent write command throws `OOM command not allowed`. AxionLimit's catch blocks in `Backend/services/rateLimiter.js` **fail open** (`allowed: true, remaining: 1`), ensuring upstream APIs are not blocked.

---

## 8. Verification & Testing Status

### Executed Tests (Verified & Passed)

1. **Backend Unit Tests:**
   ```text
   > npm test --prefix Backend
   # tests 21 | pass 21 | fail 0 (All 21 unit tests passed in 2.6s)
   ```
   Covers:
   - Cryptographic API key generation, hashing (SHA-256), and masking.
   - Header-only API key parsing (query param rejection).
   - Rejection of `x-api-key-id` without valid JWT Bearer token.
   - Rejection of invalid token or unauthorized user for Key ID.
   - IP detection anti-spoofing (`req.ip` priority).
   - IP blacklist and whitelist enforcement.
   - Exact CORS matching and rejection of prefix/subdomain spoofing.
   - Rate limiter Lua script atomic 90-day TTL on all 5 telemetry keys.
   - Rate limiter Lua script sorted set top 100 bounding.
   - Rate limiter fail-open behavior when Redis is offline.

2. **Frontend Production Build:**
   ```text
   > npm run build --prefix Frontend
   dist/index.html                   0.76 kB
   dist/assets/index-DWc-8-Xz.css   15.04 kB
   dist/assets/index-BtQthxLq.js   693.29 kB
   ✓ built in 1.88s (Clean Vite production bundle)
   ```

3. **Docker Compose Syntax & Config Validation:**
   ```text
   > docker-compose -f docker-compose.prod.yml config
   # Validated: all 3 services, networks, volumes, healthchecks, and environment mappings
   ```

4. **Git Tracking & Repository Cleanliness:**
   - Removed 2,865 tracked files from `Backend/node_modules/` in Git.
   - Removed obsolete `Frontend/.env.production`.
   - Tracked and committed `infrastructure/.terraform.lock.hcl`.

### Non-Executed Tests (Local Environment Limitations)

1. **Local Container Image Build (`docker build`) & Live `nginx -t`:**
   - **Reason:** Docker Desktop daemon is not running on this Windows host (virtualization/Hyper-V/WSL2 permissions).
   - **Target Execution:** Container builds and live Nginx tests execute natively on the target Ubuntu EC2 instance via the cloud-init script (`user_data.sh`) during deployment.
2. **Live `terraform plan` / `apply`:**
   - **Reason:** Requires active AWS credentials configured on the workstation. No AWS resources have been provisioned in the cloud.

---

## 9. EC2 Lifecycle: Manual Management via AWS Console

### Start Procedure
1. Open [AWS Management Console](https://console.aws.amazon.com/) $\rightarrow$ **EC2** $\rightarrow$ **Instances** $\rightarrow$ `axionlimit-server`.
2. Click **Instance state** $\rightarrow$ **Start instance**.
3. Copy the new **Public IPv4 address** (e.g. `13.234.120.45`).
4. In [MongoDB Atlas Console](https://cloud.mongodb.com/) $\rightarrow$ **Network Access**, add `<PUBLIC_IP>/32`.
5. Access AxionLimit at `http://<PUBLIC_IP>`.

### Stop Procedure (Cost Optimization)
1. Select `axionlimit-server` in the EC2 Console.
2. Click **Instance state** $\rightarrow$ **Stop instance** (never *Terminate*).
3. Compute and public IPv4 billing stop immediately ($0.00/hr). The 20 GB gp3 volume preserves all containers and Redis data for ~\$1.76/month.

---

## 10. Cost Breakdown (Mumbai `ap-south-1`)

| Resource | Running State (24/7) | Stopped State (Default) | Cost Details |
| :--- | :--- | :--- | :--- |
| **EC2 `t3.small` (Standard)** | ~$15.18 / month | **$0.00 / month** | $0.0208/hour in `ap-south-1` |
| **EBS Storage (20 GB gp3)** | ~$1.76 / month | **~$1.76 / month** | $0.088/GB-month |
| **Dynamic Public IPv4** | ~$3.65 / month | **$0.00 / month** | $0.005/hour while running; **released when stopped** |
| **MongoDB Atlas (M0 Shared)** | **$0.00** | **$0.00** | Free Tier cluster |
| **TOTAL ESTIMATED MONTHLY:** | **~$20.60 / month** | **~$1.76 / month** | **>91% cost reduction when stopped** |

---

## 11. Step-by-Step Deployment Guide

### Step 1: Provision Infrastructure with Terraform

1. Open PowerShell or Terminal and navigate to the `infrastructure` directory:
   ```bash
   cd infrastructure
   cp terraform.tfvars.example terraform.tfvars
   ```
2. Configure AWS credentials on your workstation:
   ```bash
   aws configure
   ```
3. Initialize and provision AWS resources:
   ```bash
   terraform init
   terraform plan -out=tfplan
   terraform apply tfplan
   ```
4. Note the output values:
   - `ec2_instance_id`
   - `ec2_public_ip`
   - `github_actions_role_arn`

### Step 2: Configure GitHub Repository Secrets

In your GitHub repository, navigate to **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions** and add the following repository secrets:

| Secret Name | Value Description |
| :--- | :--- |
| `AWS_ROLE_ARN` | The ARN of the IAM role (`github_actions_role_arn` from Terraform) |
| `AWS_REGION` | `ap-south-1` |
| `EC2_INSTANCE_ID` | The EC2 instance ID (`i-...`) |
| `MONGO_URI` | Your MongoDB Atlas connection string |
| `JWT_SECRET` | A secure random 64-character secret (`openssl rand -hex 32`) |

### Step 3: Trigger Deployment via GitHub Actions

1. In GitHub, go to the **Actions** tab.
2. Select the **AxionLimit Continuous Deployment** workflow.
3. Click **Run workflow** on the `main` branch.
4. The workflow will:
   - Run all 21 unit tests.
   - Run preflight checks: verify the EC2 instance is in `running` state.
   - Verify the SSM Agent is `Online`.
   - Send the deployment command via SSM Run Command (`docker compose -f docker-compose.prod.yml up -d --build`).
   - Run health checks and confirm success.

### Step 4: MongoDB Atlas IP Allowlisting

1. Copy the EC2 dynamic public IPv4 address from the AWS Console.
2. In MongoDB Atlas, go to **Network Access** $\rightarrow$ **Add IP Address**.
3. Add `<EC2_PUBLIC_IP>/32` with description "AxionLimit EC2".
4. Refresh your browser at `http://<EC2_PUBLIC_IP>`. The AxionLimit dashboard is live!
