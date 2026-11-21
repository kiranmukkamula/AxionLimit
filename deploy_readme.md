# AxionLimit — Single EC2 Multi-Container Deployment Guide

> Complete, secure, and cost-conscious AWS deployment guide for **AxionLimit** — a centralized API rate limiter and real-time telemetry service running on a **single EC2 instance** via Docker Compose.

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
3. **Same-Origin API Communication:** The React frontend communicates with the backend using relative URLs (e.g. `baseURL: '/'`). No public IP hardcoding, no CORS issues between frontend and backend, and no frontend rebuild required when the EC2 dynamic public IP changes.
4. **Persistent EBS-Backed Redis:** Redis data is stored on a persistent Docker volume (`axion_redis_data`) located on the EC2 host's 20 GB gp3 encrypted EBS disk, with AOF and RDB snapshots.
5. **Zero AWS NAT or Load Balancer Fees:** Eliminates Application Load Balancers ($18+/month) and NAT Gateways ($32+/month), delivering a full stack on AWS at baseline compute and storage cost.

---

## 2. Project Directory Structure

```text
AxionLimit/
├── Backend/                       # Node.js 18 & Express REST API
│   ├── config/                    # Mongoose & ioredis connection managers
│   ├── middleware/                # Rate limit & JWT authentication middleware
│   ├── models/                    # MongoDB schemas (ApiKey.js, User.js)
│   ├── routes/                    # API endpoints (/api, /api/keys, /auth)
│   ├── services/                  # Sliding window algorithm & Redis telemetry
│   ├── test/                      # Unit tests (apiKeySecurity, perUserRateLimit)
│   ├── Dockerfile                 # Alpine Node.js 18 container (non-root node user)
│   ├── .dockerignore              # Excludes local node_modules and .env files
│   └── package.json
│
├── Frontend/                      # React 19 + Vite SPA
│   ├── nginx/
│   │   └── default.conf           # Reverse proxy configuration & SPA try_files
│   ├── src/
│   │   ├── api/client.js          # Axios client with same-origin relative baseURL: '/'
│   │   ├── components/            # UI components (Toast, IntegrationSnippets, etc.)
│   │   └── pages/                 # Dashboard, Docs, LoginPage
│   ├── Dockerfile                 # Multi-stage build: Node.js builder -> Nginx Alpine
│   ├── .dockerignore              # Excludes node_modules and build artifacts
│   └── package.json
│
├── Testing/                       # Load testing and traffic simulation scripts
│   ├── test-rate-limit.js         # Traffic simulator (constant & burst modes)
│   └── package.json
│
├── docker-compose.prod.yml        # Production multi-container definition (Frontend + Backend + Redis)
├── docker-compose.yml             # Local development Docker Compose (Redis only)
│
├── infrastructure/                # Terraform Infrastructure as Code (ap-south-1)
│   ├── versions.tf                # Terraform >= 1.5.0, AWS provider ~> 5.40
│   ├── providers.tf               # AWS provider config with default tags
│   ├── variables.tf               # Parameterized variables
│   ├── networking.tf              # Dedicated VPC (10.0.0.0/16), Public Subnet, IGW, Route Table
│   ├── security.tf                # Security Group (Port 80 HTTP open, Port 5000/6379 closed)
│   ├── iam.tf                     # EC2 IAM instance profile for SSM & GitHub Actions OIDC role
│   ├── user_data.sh               # Cloud-init script: installs Docker CE & enables SSM Agent
│   ├── ec2.tf                     # t3.small, Standard CPU credits, 20GB gp3 EBS disk
│   ├── outputs.tf                 # Public application URL, EC2 instance ID, public IP
│   └── terraform.tfvars.example   # Variable templates
│
├── .github/
│   └── workflows/
│       └── deploy.yml             # Automated CI/CD pipeline using AWS OIDC & AWS SSM
│
├── .gitignore                     # Ignores Terraform state, lock files, and secrets
└── deploy_readme.md               # Master deployment guide (this document)
```

---

## 3. Container Stack Specification

### Multi-Stage Frontend Container (`Frontend/Dockerfile`)

* **Stage 1 (Builder):** Uses `node:18-alpine` to run `npm ci` and compile production static assets (`dist/`) via Vite.
* **Stage 2 (Production Runner):** Copies compiled assets into `nginx:1.25-alpine` (`/usr/share/nginx/html`) along with `Frontend/nginx/default.conf`. Node.js and build tools are completely discarded in Stage 2, resulting in a minimal attack surface and small image footprint (~25 MB).

### Nginx Routing Rules (`Frontend/nginx/default.conf`)

| Request Path | Action | Description |
| :--- | :--- | :--- |
| `/` and `/*` | `try_files $uri $uri/ /index.html` | Serves React SPA pages with client-side routing. |
| `/assets/*` | Static file delivery | Cached for 1 year with `Cache-Control: public, immutable`. |
| `/api/*` | `proxy_pass http://backend:5000` | Proxies API key validation, rate check, and telemetry to backend. |
| `/auth/*` | `proxy_pass http://backend:5000` | Proxies authentication, dev login, and Google OAuth to backend. |
| `/health` | `proxy_pass http://backend:5000` | Exposes application readiness status (`UP` / `DOWN`). |
| `/server-info` | `proxy_pass http://backend:5000` | Returns server metadata and uptime. |

### Backend Container (`Backend/Dockerfile`)

* Runs as unprivileged standard user (`USER node`).
* Internal port `5000` (not published to host).
* Graceful shutdown handlers catch `SIGTERM` and `SIGINT` to safely disconnect MongoDB and Redis before exit.
* Healthcheck polls `http://localhost:5000/health`.

### Redis Container

* Image: `redis:7.2-alpine`.
* Private internal port `6379` (`expose: - "6379"`).
* **Persistence:** Named volume `redis_data` mapping to `/data` on the 20 GB gp3 EBS root volume.
* **AOF + RDB:** Append-only logging flushed every second (`--appendfsync everysec`) plus snapshot points (`--save 900 1 --save 300 10`).
* **Memory Management:** `--maxmemory 256mb --maxmemory-policy volatile-lru`. Keys with TTLs (`rate_limit:*`, `apikey:*`) are evicted under memory pressure using LRU order. Persistent telemetry keys without TTL (`telemetry:*`) remain preserved.
* **Fail-Open Strategy:** If Redis experiences temporary failure or eviction pressure, AxionLimit catch blocks fail open (`allowed: true`) to ensure upstream clients are not blocked.

---

## 4. AWS Networking & Security Group Configuration

Target Region: **Mumbai (`ap-south-1`)**.

### Security Group Inbound & Outbound Rules

| Direction | Port | Protocol | Source / Destination | Security Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Inbound** | `80` | TCP | `0.0.0.0/0` | Public HTTP traffic to Nginx (serves frontend & proxies API). |
| **Inbound** | `22` | TCP | *Admin IP only* | Controlled via `var.enable_ssh`. Disabled by default in favor of AWS SSM. |
| **Inbound** | `5000` | TCP | **BLOCKED** | Backend is internal only inside Docker bridge network. |
| **Inbound** | `6379` | TCP | **BLOCKED** | Redis is internal only inside Docker bridge network. |
| **Inbound** | `27017`| TCP | **BLOCKED** | MongoDB is hosted remotely on MongoDB Atlas. |
| **Outbound**| All | All | `0.0.0.0/0` | Outbound TLS to MongoDB Atlas (27017), AWS SSM (443), and Docker Hub. |

---

## 5. Cost Management & Billing Analysis

All costs are calculated using **Mumbai (`ap-south-1`)** AWS pricing:

| Resource | Running State (24/7) | Stopped State (Default) | Cost Details |
| :--- | :--- | :--- | :--- |
| **EC2 `t3.small` (Standard)** | ~$15.18 / month | **$0.00 / month** | $0.0208/hour in `ap-south-1` (Billed only while running) |
| **EBS Storage (20 GB gp3)** | ~$1.76 / month | **~$1.76 / month** | $0.088/GB-month (Preserves OS, Docker images & Redis data) |
| **Dynamic Public IPv4** | ~$3.65 / month | **$0.00 / month** | $0.005/hour while running; **released ($0) when stopped** |
| **MongoDB Atlas (M0 Shared)** | **$0.00** | **$0.00** | Free Tier cluster (512 MB storage) |
| **TOTAL ESTIMATED MONTHLY:** | **~$20.60 / month** | **~$1.76 / month** | **>91% cost reduction when stopped** |

> [!TIP]
> **T3 Standard CPU Credit Protection:**
> In `infrastructure/ec2.tf`, `cpu_credits = "standard"` is explicitly configured. If your instance runs out of banked CPU credits during heavy load, it will throttle to baseline performance rather than charging **$0.05 per vCPU-hour** surplus fees (T3 Unlimited mode).

---

## 6. EC2 Lifecycle: Manual Management via AWS Console

To avoid maintaining automation scripts, manage the EC2 instance lifecycle directly from the AWS Management Console:

### How to Start the Application

1. Log into the [AWS Management Console](https://console.aws.amazon.com/).
2. Navigate to **EC2** $\rightarrow$ **Instances**.
3. Select your instance (`axionlimit-server`).
4. Click **Instance state** $\rightarrow$ **Start instance**.
5. Wait ~30–60 seconds for the instance state to show **Running** and status checks to show **2/2 checks passed**.
6. Note the new **Public IPv4 address** shown in the instance details (e.g. `13.234.120.45`).
7. Access your application in your browser:
   `http://<YOUR_EC2_PUBLIC_IP>`

### How to Stop the Application (Save Money)

When you are not actively testing or using the application:

1. In the EC2 Console, select `axionlimit-server`.
2. Click **Instance state** $\rightarrow$ **Stop instance** (do NOT click *Terminate*).
3. The instance state changes to **Stopped**.
   * Compute billing stops immediately ($0.00/hour).
   * The dynamic IPv4 address is released back to AWS ($0.00/hour).
   * Your 20 GB gp3 EBS volume preserves all container images, code, and Redis data (~$1.76/month).

### Whitelisting Dynamic IP in MongoDB Atlas

Because `use_elastic_ip = false` is configured to prevent stopped-state IPv4 charges, the EC2 instance receives a new public IPv4 address each time it is started:

1. In the AWS Console, copy your EC2 instance's **Public IPv4 address**.
2. Open the [MongoDB Atlas Console](https://cloud.mongodb.com/).
3. Navigate to **Security** $\rightarrow$ **Network Access**.
4. Click **Add IP Address**.
5. Enter `<EC2_PUBLIC_IP>/32` and set comment to `AxionLimit EC2`.
6. Click **Confirm**. (Atlas updates rules in ~15 seconds).

---

## 7. Step-by-Step Initial Deployment Walkthrough

### Step 1: Configure AWS CLI Credentials
Ensure your local terminal has administrative AWS access:
```powershell
aws configure
# AWS Access Key ID: <YOUR_KEY>
# AWS Secret Access Key: <YOUR_SECRET>
# Default region: ap-south-1
# Default output format: json
```

### Step 2: Initialize & Review Terraform
```powershell
cd infrastructure
terraform init
terraform validate
terraform plan
```

Review the plan. It will create **9 AWS resources**:
- 1 VPC (`10.0.0.0/16`)
- 1 Public Subnet (`10.0.1.0/24`)
- 1 Internet Gateway
- 1 Route Table & Association
- 1 Security Group (Port 80 open)
- 1 IAM Role & Instance Profile (with `AmazonSSMManagedInstanceCore`)
- 1 EC2 Instance (`t3.small` with 20GB gp3 EBS)

Apply the infrastructure when ready:
```powershell
terraform apply
```

### Step 3: Connect to EC2 & Set Up Application
Connect to your EC2 instance using **AWS Systems Manager (SSM) Session Manager** (no SSH key or open port 22 required):
1. In the AWS EC2 Console, select `axionlimit-server`.
2. Click **Connect** $\rightarrow$ **Session Manager** $\rightarrow$ **Connect**.
3. Once the terminal opens, switch to the `ubuntu` user and navigate to `/opt/axionlimit`:
   ```bash
   sudo su - ubuntu
   cd /opt/axionlimit
   ```
4. Clone the repository:
   ```bash
   git clone https://github.com/<YOUR_USER>/AxionLimit.git .
   ```
5. Create the production environment file (`/opt/axionlimit/.env`):
   ```bash
   cat << 'EOF' > .env
   PORT=5000
   NODE_ENV=production
   REDIS_URL=redis://redis:6379
   MONGO_URI=mongodb+srv://<USER>:<PASS>@<CLUSTER>.mongodb.net/axionlimit?retryWrites=true&w=majority
   JWT_SECRET=generate_a_secure_random_string_here_32chars
   ENABLE_DEV_LOGIN=true
   EC2_SERVER_NAME=EC2-Mumbai
   EOF
   ```
6. Build and launch all three containers:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
7. Verify all containers are running and healthy:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   curl http://localhost/health
   ```

### Step 4: Access the Application
Open your browser and navigate to:
`http://<YOUR_EC2_PUBLIC_IP>`

You will see the AxionLimit Dashboard with full real-time telemetry, API key management, and documentation.

---

## 8. Continuous Deployment with GitHub Actions (CI/CD)

The repository includes [.github/workflows/deploy.yml](file:///.github/workflows/deploy.yml) which automatically runs tests and deploys code changes to your EC2 instance on every push to `main`.

### Prerequisites for GitHub Actions
1. In `infrastructure/variables.tf`, set `github_repo = "your-github-username/AxionLimit"` and run `terraform apply` to provision the GitHub OIDC role.
2. In your GitHub repository, navigate to **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions** and add:
   - `AWS_ROLE_ARN`: The ARN output by Terraform (`github_actions_role_arn`).
   - `AWS_REGION`: `ap-south-1`.
   - `EC2_INSTANCE_ID`: Your EC2 instance ID (`i-0xxxxxxxxxxxxxxxxx`).

### How the Pipeline Works
1. Runs Backend unit tests (`npm test`).
2. Obtains short-lived temporary AWS credentials using GitHub OIDC (zero permanent AWS access keys stored in GitHub).
3. Sends an AWS Systems Manager (SSM) Run Command to EC2:
   ```bash
   cd /opt/axionlimit
   git pull origin main
   docker compose -f docker-compose.prod.yml up -d --build
   curl -f http://localhost/health || exit 1
   ```

---

## 9. Troubleshooting Reference

| Symptom | Cause | Resolution |
| :--- | :--- | :--- |
| **Browser shows `502 Bad Gateway`** | Backend container is starting or crashed | Run `docker logs axion-backend` on EC2. Verify MongoDB connection string in `.env`. |
| **`HTTP 503 Service Unavailable` on `/health`** | Redis or MongoDB connection down | Check `docker ps` to ensure `axion-redis` is healthy. Check MongoDB Atlas Network Access allowlist for current EC2 IP. |
| **Developer login fails with 403 Forbidden** | `ENABLE_DEV_LOGIN` not set to `true` | Add `ENABLE_DEV_LOGIN=true` to `/opt/axionlimit/.env` on EC2 and run `docker compose -f docker-compose.prod.yml up -d`. |
| **GitHub Actions SSM command timeout** | SSM Agent inactive or IAM role missing | Verify EC2 has IAM role with `AmazonSSMManagedInstanceCore`. Verify outbound port 443 is open in Security Group. |
| **Page reloads show 404 Not Found** | Nginx `try_files` missing | Verify `Frontend/nginx/default.conf` contains `try_files $uri $uri/ /index.html;`. |

---

## 10. Permanent Teardown & Deletion

If you wish to decommission all resources and ensure zero ongoing costs:

1. **Disable Deletion Protection:**
   In `infrastructure/ec2.tf`, set `prevent_destroy = false`.
2. **Destroy Infrastructure:**
   ```powershell
   cd infrastructure
   terraform destroy
   ```
3. **Delete Detached EBS Volume:**
   Because `delete_on_termination = false` is configured to protect data from accidental EC2 termination, the 20 GB gp3 volume will remain in your AWS account in the `available` state.
   - Go to **EC2** $\rightarrow$ **Elastic Block Store** $\rightarrow$ **Volumes**.
   - Select the detached volume and choose **Actions** $\rightarrow$ **Delete volume**.
4. **Delete MongoDB Atlas Cluster:**
   Log into [MongoDB Atlas](https://cloud.mongodb.com/) and terminate your M0 free cluster.
