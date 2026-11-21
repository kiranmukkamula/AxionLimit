# AxionLimit — Complete AWS Infrastructure and Deployment Automation Guide

> Production-ready, secure, and cost-conscious AWS deployment guide for **AxionLimit** — a centralized API rate limiter and real-time telemetry service.

---

## 1. Architecture Overview

AxionLimit is architected for deployment in the **Mumbai region (`ap-south-1`)**. It balances low ongoing cloud expenditure with security, reliability, and containerized operational isolation.

### Complete Architecture Diagram

```text
                                [ User Browser / API Client ]
                                               │
                   ┌───────────────────────────┴───────────────────────────┐
                   │ (HTTP GET static files)                               │ (HTTP API / Auth requests)
                   ▼                                                       ▼
       ┌────────────────────────┐                             ┌────────────────────────┐
       │     AWS S3 Bucket      │                             │   EC2: t3.small        │
       │ Static Website Hosting │                             │ (Ubuntu 22.04 LTS)     │
       │ Holds compiled React   │                             │ Dynamic Public IPv4    │
       │ + dynamic config.json  │                             └───────────┬────────────┘
       └────────────────────────┘                                         │
                                                           ┌──────────────┴──────────────┐
                                                           │ Docker Engine & Compose Net │
                                                           │                             │
                                                           │  ┌───────────────────────┐  │
                                                           │  │ Container: backend    │  │
                                                           │  │ Node.js 18 (Port 5000)│  │
                                                           │  └───────────┬───────────┘  │
                                                           │              │ Internal Net │
                                                           │  ┌───────────▼───────────┐  │
                                                           │  │ Container: redis      │  │
                                                           │  │ 7.2-alpine (Port 6379)│  │
                                                           │  │ AOF everysec + RDB    │  │
                                                           │  └───────────┬───────────┘  │
                                                           └──────────────┼──────────────┘
                                                                          │ Persistent Volume Mount
                                                           ┌──────────────▼──────────────┐
                                                           │ EBS Volume (20GB gp3)       │
                                                           │ Docker Volume: redis_data   │
                                                           └─────────────────────────────┘
                                                                          │ Outbound TLS (Port 27017)
                                                           ┌──────────────▼──────────────┐
                                                           │ MongoDB Atlas (M0 Cluster)  │
                                                           │ Whitelisted EC2 Public IP   │
                                                           └─────────────────────────────┘
```

### Classification: Development/Testing vs. Production

> [!WARNING]
> **Environment Classification:**
> The baseline single-instance deployment configured here is classified as **Development / Testing / Staging**.
> * **Security Limitation:** The S3 Static Website endpoint and the EC2 backend port 5000 operate over **unencrypted HTTP**. Data in transit is not protected by TLS certificates.
> * **OAuth Limitation:** Production Google OAuth 2.0 strictly requires an HTTPS callback URL.
> * **Production Requirements:** Upgrading this architecture to secure production requires:
>   1. A registered custom domain name (e.g. `api.yourdomain.com`).
>   2. An SSL/TLS Certificate from AWS Certificate Manager (ACM) or Let's Encrypt.
>   3. AWS CloudFront in front of S3 for HTTPS static delivery.
>   4. An NGINX reverse proxy or an Application Load Balancer (ALB) terminating HTTPS on EC2.

---

## 2. Project Directory Structure

```text
AxionLimit/
├── Backend/                       # Express 4.x REST API & Rate Limiting Engine
│   ├── config/                    # Database connectors (MongoDB Mongoose & Redis ioredis)
│   ├── middleware/                # WAF blacklist checks & SHA-256 API key caching
│   ├── models/                    # MongoDB schemas (ApiKey.js, User.js)
│   ├── routes/                    # API endpoints (auth.js, apiKeys.js, rateLimit.js)
│   ├── services/                  # Lua Sliding Window Log (rateLimiter.js) & Telemetry
│   ├── test/                      # Native Node.js unit tests (apiKeySecurity, perUserRateLimit)
│   ├── Dockerfile                 # Optimized Alpine production container
│   ├── .dockerignore              # Prevents copying local node_modules and .env
│   └── package.json               # Dependencies & scripts
│
├── Frontend/                      # React 19 + Vite 8 Single Page Application
│   ├── public/
│   │   └── config.json            # Runtime configuration for dynamic backend targeting
│   ├── src/
│   │   ├── api/client.js          # Axios client with runtime config loading
│   │   └── pages/                 # UI pages (DashboardPage, DocsPage, LoginPage)
│   ├── package.json               # Dependencies & build scripts
│   └── vite.config.js             # Vite development server & proxy settings
│
├── Testing/                       # Load testing and traffic simulation
│   ├── test-rate-limit.js         # Traffic simulator (constant & burst modes)
│   └── package.json
│
├── docker-compose.prod.yml        # Production Docker Compose definition for EC2
├── docker-compose.yml             # Local development Docker Compose
│
├── infrastructure/                # Terraform Infrastructure as Code
│   ├── versions.tf                # Provider versions (AWS ~> 5.40, Terraform >= 1.5.0)
│   ├── providers.tf               # AWS provider configuration & default tags
│   ├── variables.tf               # Parameterized variables
│   ├── networking.tf              # VPC, Public Subnet, IGW, Route Table
│   ├── security.tf                # Least-privilege Security Group rules
│   ├── iam.tf                     # EC2 SSM Role & GitHub Actions OIDC Role
│   ├── user_data.sh               # Cloud-init script: installs Docker & enables SSM
│   ├── ec2.tf                     # t3.small EC2 instance with Standard CPU credits
│   ├── s3.tf                      # S3 static website hosting bucket & public read policy
│   ├── outputs.tf                 # Useful output endpoints and IDs
│   └── terraform.tfvars.example   # Variable values template
│
├── scripts/                       # Windows PowerShell Terminal Automation
│   ├── axion-start.ps1            # Starts EC2, updates S3 config, whitelists Atlas IP
│   ├── axion-stop.ps1             # Safely stops EC2 (never terminates)
│   ├── axion-status.ps1           # Probes EC2 state and backend /health readiness
│   └── .atlas.env (Optional)      # Atlas API keys for automated IP allowlist updates
│
├── .github/
│   └── workflows/
│       └── deploy.yml             # Automated CI/CD pipeline with AWS OIDC
│
├── .gitignore                     # Ignores Terraform state, .env, and script secrets
└── deploy_readme.md               # Master deployment guide (this document)
```

---

## 3. AWS Account Preparation & Prerequisites

### Prerequisites
1. **AWS Account:** Active account with administrative credentials.
2. **AWS CLI v2:** Installed on Windows ([Download AWS CLI](https://aws.amazon.com/cli/)).
   * Verify: `aws --version`
   * Configure: Run `aws configure` and set:
     * AWS Access Key ID & Secret Access Key
     * Default region: `ap-south-1`
     * Default output format: `json`
3. **Terraform CLI:** Version `>= 1.5.0` ([Download Terraform](https://developer.hashicorp.com/terraform/install)).
   * Verify: `terraform version`
4. **Git:** Installed on Windows.
5. **MongoDB Atlas Account:** Free shared M0 cluster deployed in AWS Mumbai region ([MongoDB Atlas](https://www.mongodb.com/cloud/atlas)).

### Recommended AWS Budget Setup
To ensure no surprise bills exceed your threshold:
1. Open the **AWS Billing Console** $\rightarrow$ **Budgets**.
2. Click **Create budget** $\rightarrow$ **Zero spend budget** (or a **Monthly Cost Budget** of `$10.00`).
3. Set alert threshold at 80% (`$8.00`) and 100% (`$10.00`) directed to your personal email address.

---

## 4. Networking Architecture (Mumbai `ap-south-1`)

### VPC & Subnet Design
* **VPC CIDR:** `10.0.0.0/16` (Provides 65,536 private IP addresses without conflicting with standard local subnets).
* **Public Subnet:** `10.0.1.0/24` (251 usable IP addresses in Availability Zone `ap-south-1a`).
* **Internet Gateway:** Attached to the VPC to enable internet ingress and egress.
* **Route Table:** Default route `0.0.0.0/0` forwarded to the Internet Gateway.
* **No NAT Gateway:** Eliminates the ~$32.40/month baseline AWS NAT fee.

### Security Group Inbound & Outbound Rules

| Direction | Port | Protocol | Source / Destination | Security Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Inbound** | `5000` | TCP | `0.0.0.0/0` | Allows public API clients and browser frontends to reach the Express rate limiter. |
| **Inbound** | `22` | TCP | *Admin IP only* | Controlled via `enable_ssh` variable. Disabled by default in favor of AWS Systems Manager (SSM). |
| **Inbound** | `6379` | TCP | **BLOCKED (None)** | **Redis is 100% private.** Never exposed to the public internet. |
| **Inbound** | `27017`| TCP | **BLOCKED (None)** | MongoDB is hosted externally on MongoDB Atlas. |
| **Outbound**| All | All | `0.0.0.0/0` | Required for outbound connections to MongoDB Atlas (port 27017), AWS SSM endpoints (443), and Docker Hub. |

---

## 5. Terraform Infrastructure as Code

### Terraform Workflow
All infrastructure files reside inside the `infrastructure/` directory.

```powershell
cd infrastructure

# 1. Initialize Terraform & download AWS provider plugins
terraform init

# 2. Format configuration files to standard styling
terraform fmt

# 3. Validate syntax and argument references
terraform validate

# 4. Generate and inspect execution plan
terraform plan -out=tfplan

# 5. Apply changes (Requires your explicit review and confirmation)
terraform apply tfplan
```

### Safety Features in Terraform
* **`prevent_destroy = true`:** Configured on the EC2 instance block to prevent accidental deletion via `terraform destroy`.
* **State File Security:** `.gitignore` excludes `*.tfstate`, `*.tfstate.*`, and `terraform.tfvars` from Git commits to prevent credential exposure.

---

## 6. EC2 Setup & Sizing Considerations

### Instance Selection: `t3.small`
* **vCPUs & RAM:** 2 vCPUs, 2.0 GB RAM, x86_64 architecture.
* **Why not `t3.micro` (1 GB RAM)?** Running Ubuntu 22.04 OS, Docker daemon, Redis in-memory tables, and Node.js V8 engine on 1 GB RAM risks Out-Of-Memory (OOM) process termination during burst traffic or package installations. 2 GB RAM provides stable headroom.

### T3 CPU Credit Behavior & Cost Control
* A `t3.small` instance has a baseline CPU performance of **20% per vCPU** (40% total across both cores).
* **Standard Credit Mode:** In `infrastructure/ec2.tf`, we explicitly set:
  ```hcl
  credit_specification {
    cpu_credits = "standard"
  }
  ```
* **Surplus Charge Prevention:** By default, AWS provisions T3 instances in *Unlimited Mode*, which charges **$0.05 per vCPU-hour** surplus if the instance sustains CPU >20% for prolonged periods. In *Standard Mode*, the instance throttles back to baseline when banked credits are exhausted, **guaranteeing $0.00 unexpected burst charges**.

---

## 7. Docker & Container Deployment

### Production Docker Compose (`docker-compose.prod.yml`)
Both the backend and Redis services run on the same EC2 instance across an internal Docker bridge network (`axion-internal`):

* **Redis Service:**
  * Runs official `redis:7.2-alpine`.
  * Port 6379 is **exposed internally only** (`expose: - "6379"`). Host port mapping (`ports: - "6379:6379"`) is intentionally omitted.
* **Backend Service:**
  * Built using Alpine Node.js 18 with unprivileged user `USER node`.
  * Communicates with Redis using container DNS: `redis://redis:6379`.
  * Connects to MongoDB Atlas using your secure connection string: `mongodb+srv://...`.
  * Published on port `5000:5000`.
  * Healthcheck monitors `http://localhost:5000/health`.

---

## 8. Redis Persistence & Eviction Policies

### Persistence Architecture
* **Data Volume:** Named Docker volume `redis_data` mapping to `/data` on the EC2 host's 20 GB `gp3` EBS volume.
* **AOF (Append-Only File):** Configured with `appendfsync everysec`. Writes are flushed to disk every second.
* **RDB (Redis Database Snapshots):** Periodic background snapshots (`save 900 1 300 10`).

### Eviction Policy & Rate Limit Impact
* **Settings:** `--maxmemory 256mb --maxmemory-policy volatile-lru`
* **Behavior:**
  * Redis keys with TTLs (`rate_limit:*`, `apikey:*`, `blacklist:*`) are evicted under memory pressure using Least Recently Used (LRU) prioritization.
  * Persistent telemetry counters (`telemetry:*`), which have no TTL, are preserved.
  * **Trade-off:** If memory reaches 256 MB, evicting an active `rate_limit:*` key will reset that specific user's quota early.
* **Fail-Open Resilience:** If Redis runs out of memory or becomes unreachable, the backend catches the error and **fails open** (`allowed: true`), ensuring downstream applications remain operational.

---

## 9. MongoDB Atlas Setup & Dynamic Allowlist Management

### Setup Procedure
1. Create a free shared cluster (`M0 Sandbox`) on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Create a Database User (e.g. `axion_app_user`) with read/write permissions on the `axionlimit` database.
3. Obtain your connection string:
   `mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/axionlimit?retryWrites=true&w=majority`

### Managing Dynamic Public IP Allowlist
Because `use_elastic_ip = false`, the EC2 instance receives a new public IP every time it starts.

* **Method 1: Automated via Atlas Administration API v2 (Recommended):**
  Create a file `scripts/.atlas.env` (automatically ignored by Git):
  ```env
  MONGODB_ATLAS_PUBLIC_KEY=your_atlas_public_api_key
  MONGODB_ATLAS_PRIVATE_KEY=your_atlas_private_api_key
  MONGODB_ATLAS_GROUP_ID=your_atlas_project_id
  ```
  When you run `.\scripts\axion-start.ps1`, it automatically invokes the MongoDB Atlas Administration API v2 endpoint (`https://cloud.mongodb.com/api/atlas/v2/groups/{groupId}/accessList`) with Digest Authentication and header `Accept: application/vnd.atlas.2023-11-15+json` to whitelist the new IP in seconds.

* **Method 2: Manual Update in Atlas Web Console:**
  If Atlas API keys are not configured, `axion-start.ps1` displays:
  ```text
  👉 Add this EC2 Public IP to your MongoDB Atlas Network Access allowlist: 13.234.120.45/32
  ```
  Go to **Atlas Console** $\rightarrow$ **Security** $\rightarrow$ **Network Access** $\rightarrow$ **Add IP Address** $\rightarrow$ enter the IP.

---

## 10. S3 Frontend Hosting & Runtime Configuration

### Zero-Cost Dynamic Targeting (`config.json`)
To avoid rebuilding the entire React frontend every time the EC2 public IP changes:
1. The frontend fetches `/config.json` on application load.
2. In `scripts/axion-start.ps1`, when EC2 boots with a new IP, it uploads a 50-byte JSON file:
   ```json
   { "apiUrl": "http://13.234.120.45:5000" }
   ```
3. The frontend immediately targets the live EC2 backend without requiring any rebuild or re-upload.

---

## 11. GitHub Actions CI/CD with AWS OIDC

### Security Architecture
* **No Permanent AWS Access Keys:** GitHub Actions authenticates directly to AWS using an **OpenID Connect (OIDC)** identity token.
* **Trust Policy:** Restricted strictly to pushes to the `main` branch of your specific GitHub repository.

### Pipeline Stages
1. **Test:** Runs Backend unit tests (`npm test`).
2. **Deploy Frontend:** Compiles React static assets (`npm run build`) and synchronizes `Frontend/dist/` to the S3 bucket.
3. **Deploy Backend:** Sends an AWS Systems Manager (SSM) Run Command to EC2 to pull the latest code and restart containers via `docker compose -f docker-compose.prod.yml up -d --build`.

---

## 12. Terminal Automation: Start, Stop & Status Scripts

Execute these scripts directly from your Windows PowerShell terminal:

### Start AxionLimit
```powershell
.\scripts\axion-start.ps1
```
* Starts the stopped EC2 instance.
* Discovers the new dynamic public IP.
* Updates MongoDB Atlas Network Access allowlist.
* Uploads dynamic `/config.json` to S3.
* Polls `http://<IP>:5000/health` until UP.
* Displays live API and Dashboard URLs.

### Stop AxionLimit
```powershell
.\scripts\axion-stop.ps1
```
* Prompts interactive confirmation.
* Calls `aws ec2 stop-instances` (Never terminates).
* Waits until instance reaches `stopped` state.
* Releases the dynamic public IP ($0.00 IP charge).
* Displays cost advisory on preserved storage.

### Check Status & Health
```powershell
.\scripts\axion-status.ps1
```
* Displays EC2 instance state, public IP, and uptime.
* Probes backend `/health` endpoint and reports MongoDB and Redis connection status.

---

## 13. Step-by-Step Initial Deployment Procedure

1. **Configure AWS CLI:**
   ```powershell
   aws configure
   ```
2. **Prepare Terraform Variables:**
   ```powershell
   cd infrastructure
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your settings
   ```
3. **Provision Infrastructure:**
   ```powershell
   terraform init
   terraform plan -out=tfplan
   terraform apply tfplan
   ```
4. **Deploy Backend on EC2:**
   SSH or connect via AWS SSM Session Manager to your EC2 instance:
   ```bash
   sudo su - ubuntu
   cd /opt/axionlimit
   git clone <YOUR_REPO_URL> .
   # Create production .env with your MONGO_URI and JWT_SECRET
   docker compose -f docker-compose.prod.yml up -d --build
   ```
5. **Deploy Frontend to S3:**
   ```powershell
   cd Frontend
   npm ci
   npm run build
   aws s3 sync dist/ s3://<YOUR_BUCKET_NAME>/ --delete
   ```
6. **Start Application:**
   ```powershell
   .\scripts\axion-start.ps1
   ```

---

## 14. Troubleshooting Reference

| Symptom | Probable Cause | Corrective Action |
| :--- | :--- | :--- |
| `HTTP 503 Service Unavailable` on `/health` | Redis or MongoDB connection down | Check `docker logs axion-backend`. Verify MongoDB Atlas allowlist has current EC2 IP. |
| `CORS Error` in Browser Console | Backend allowedOrigins missing frontend URL | Check `server.js` `allowedOrigins` list. S3 website endpoint must be included or match pattern. |
| `Developer login failed` (403 Forbidden) | `NODE_ENV=production` without `ENABLE_DEV_LOGIN=true` | In production mode, dev-login is disabled by default. Pass `ENABLE_DEV_LOGIN=true` in `.env` if testing. |
| `AWS SSM Command Timeout` | SSM Agent not running or IAM role missing | Verify instance profile has `AmazonSSMManagedInstanceCore`. Verify outbound HTTPS (443) is open in security group. |
| `Google OAuth redirect_uri_mismatch` | Dynamic EC2 IP changed | Use Developer Mock Login for dynamic IP testing, or update authorized redirect URI in Google Cloud Console. |

---

## 15. Cost Management & Billing Analysis

### Summary Cost Table (Mumbai `ap-south-1`)

| Resource | Running State (24/7) | Stopped State (Normal) | Cost Details |
| :--- | :--- | :--- | :--- |
| **EC2 `t3.small` (Standard)** | ~$15.18 / month | **$0.00 / month** | $0.0208/hour in `ap-south-1` (Billed per second running) |
| **EBS Storage (20 GB gp3)** | ~$1.76 / month | **~$1.76 / month** | $0.088/GB-month in Mumbai (Persists while stopped) |
| **Dynamic Public IPv4** | ~$3.65 / month | **$0.00 / month** | $0.005/hr while running; **$0 when stopped** |
| **S3 Static Website Hosting** | < $0.01 / month | < $0.01 / month | $0.025/GB-month (< 20 MB storage) |
| **MongoDB Atlas (M0 Shared)** | **$0.00** | **$0.00** | Free Tier cluster |
| **Data Transfer (<10 GB)** | < $0.10 / month | **$0.00** | First 100 GB/month outbound is free |
| **TOTAL ESTIMATED MONTHLY:** | **~$20.60 / month** | **~$1.76 / month** | **>91% cost reduction when stopped** |

---

## 16. Permanent Cleanup & Deletion Procedure

If you decide to permanently delete all resources and stop all AWS charges:

1. **Empty the S3 Bucket:**
   ```powershell
   aws s3 rm s3://<YOUR_BUCKET_NAME> --recursive
   ```
2. **Remove Terraform Destruction Safety Lock:**
   In `infrastructure/ec2.tf`, change `prevent_destroy = true` to `prevent_destroy = false`.
3. **Destroy AWS Infrastructure:**
   ```powershell
   cd infrastructure
   terraform destroy
   ```
4. **Delete Retained EBS Storage Volume:**
   > [!IMPORTANT]
   > Because `delete_on_termination = false` is enabled on the root block device to protect your Redis data against accidental deletion, the 20 GB `gp3` volume is **detached and retained** in AWS rather than deleted.
   > To prevent the continued **$1.76/month** storage fee after termination:
   > 1. Open **EC2 Console** $\rightarrow$ **Elastic Block Store** $\rightarrow$ **Volumes**.
   > 2. Find the detached volume (State: `available`).
   > 3. Click **Actions** $\rightarrow$ **Delete volume** (or run `aws ec2 delete-volume --volume-id <vol-id>`).
5. **Delete MongoDB Atlas Cluster:**
   Log into MongoDB Atlas web console and terminate the M0 free cluster.
