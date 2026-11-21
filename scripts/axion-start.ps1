<#
.SYNOPSIS
  Starts the AxionLimit EC2 instance, discovers its public IP, updates S3 runtime config,
  configures MongoDB Atlas allowlist, and verifies application health.

.PARAMETER InstanceId
  Optional. Explicit EC2 instance ID. If omitted, discovers instance by tag Name=axionlimit-server.

.PARAMETER Region
  Optional. AWS Region. Defaults to ap-south-1 (Mumbai).

.PARAMETER S3Bucket
  Optional. S3 Bucket name. If omitted, discovers bucket with prefix axionlimit-frontend.
#>

param(
    [string]$InstanceId = "",
    [string]$Region = "ap-south-1",
    [string]$S3Bucket = ""
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "🚀 AxionLimit Application Startup Controller" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Verify AWS CLI is installed
if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: AWS CLI is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install AWS CLI from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# 2. Verify AWS Credentials
Write-Host "[1/6] Verifying AWS credentials..." -ForegroundColor White
try {
    $callerIdentity = aws sts get-caller-identity --output json | ConvertFrom-Json
    Write-Host "  ✔ Authenticated as IAM identity: $($callerIdentity.Arn)" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Failed to authenticate with AWS. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}

# 3. Discover Instance ID if not provided
if (-not $InstanceId) {
    Write-Host "[2/6] Discovering AxionLimit EC2 instance in $Region..." -ForegroundColor White
    $discoveredId = (aws ec2 describe-instances `
        --region $Region `
        --filters "Name=tag:Name,Values=axionlimit-server" "Name=instance-state-name,Values=running,stopped,pending,stopping" `
        --query "Reservations[0].Instances[0].InstanceId" `
        --output text).Trim()

    if (-not $discoveredId -or $discoveredId -eq "None") {
        Write-Host "❌ Error: Could not find an EC2 instance with tag Name=axionlimit-server." -ForegroundColor Red
        Write-Host "Please pass -InstanceId i-0123456789abcdef0 explicitly." -ForegroundColor Yellow
        exit 1
    }
    $InstanceId = $discoveredId
}
Write-Host "  ✔ Target EC2 Instance: $InstanceId" -ForegroundColor Green

# 4. Check Current Instance State
$state = (aws ec2 describe-instances --instance-ids $InstanceId --region $Region --query "Reservations[0].Instances[0].State.Name" --output text).Trim()
Write-Host "  ✔ Current state: $state" -ForegroundColor Yellow

if ($state -eq "running") {
    Write-Host "  Instance is already running." -ForegroundColor Green
} elseif ($state -eq "stopped") {
    Write-Host "[3/6] Starting EC2 instance ($InstanceId)..." -ForegroundColor White
    aws ec2 start-instances --instance-ids $InstanceId --region $Region --output json | Out-Null
    Write-Host "  Waiting for instance to reach running state..." -ForegroundColor Yellow
    aws ec2 wait instance-running --instance-ids $InstanceId --region $Region
    Write-Host "  ✔ EC2 instance is now RUNNING." -ForegroundColor Green
} else {
    Write-Host "  Instance is in '$state' state. Waiting for stability..." -ForegroundColor Yellow
    aws ec2 wait instance-running --instance-ids $InstanceId --region $Region
}

# 5. Retrieve Public IPv4 Address
Write-Host "[4/6] Discovering dynamic public IPv4 address..." -ForegroundColor White
$publicIp = (aws ec2 describe-instances --instance-ids $InstanceId --region $Region --query "Reservations[0].Instances[0].PublicIpAddress" --output text).Trim()

if (-not $publicIp -or $publicIp -eq "None") {
    Write-Host "❌ Error: Could not retrieve a public IP for instance $InstanceId." -ForegroundColor Red
    exit 1
}
Write-Host "  ✔ Current Public IP: $publicIp" -ForegroundColor Cyan
Write-Host "  ✔ Backend API URL : http://${publicIp}:5000" -ForegroundColor Cyan

# 6. MongoDB Atlas Allowlist Check / Update
Write-Host "`n[5/6] Checking MongoDB Atlas Network Access..." -ForegroundColor White
# Check for local Atlas credentials in scripts/.atlas.env if present
$atlasEnvPath = Join-Path $PSScriptRoot ".atlas.env"
if (Test-Path $atlasEnvPath) {
    Get-Content $atlasEnvPath | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)\s*=\s*(.*)$") {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
        }
    }
}

$atlasPubKey = $env:MONGODB_ATLAS_PUBLIC_KEY
$atlasPrivKey = $env:MONGODB_ATLAS_PRIVATE_KEY
$atlasGroupId = $env:MONGODB_ATLAS_GROUP_ID

if ($atlasPubKey -and $atlasPrivKey -and $atlasGroupId) {
    Write-Host "  Found Atlas API credentials. Automatically whitelisting $publicIp/32..." -ForegroundColor Yellow
    try {
        $body = @"
[
  {
    "ipAddress": "$publicIp",
    "comment": "AxionLimit Dynamic EC2 IP (Automated)"
  }
]
"@
        # Invoke MongoDB Atlas Administration API v2 with Digest Authentication
        $url = "https://cloud.mongodb.com/api/atlas/v2/groups/$atlasGroupId/accessList"
        # Using curl.exe for reliable Digest Authentication
        $digestAuth = "${atlasPubKey}:${atlasPrivKey}"
        & curl.exe -s --digest -u $digestAuth -X POST $url -H "Accept: application/vnd.atlas.2023-11-15+json" -H "Content-Type: application/json" -d $body | Out-Null
        Write-Host "  ✔ Successfully updated MongoDB Atlas allowlist (API v2) with $publicIp/32!" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️ Automatic Atlas API update failed: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ℹ Notice: Atlas API credentials not configured in scripts/.atlas.env." -ForegroundColor Yellow
    Write-Host "  👉 Ensure '$publicIp/32' is added to MongoDB Atlas Network Access:" -ForegroundColor Cyan
    Write-Host "     Atlas Console -> Security -> Network Access -> Add IP Address: $publicIp/32" -ForegroundColor White
}

# 7. Update S3 Runtime Configuration (config.json)
if (-not $S3Bucket) {
    $discoveredBucket = (aws s3api list-buckets --query "Buckets[?starts_with(Name, 'axionlimit-frontend')].Name | [0]" --output text).Trim()
    if ($discoveredBucket -and $discoveredBucket -ne "None") {
        $S3Bucket = $discoveredBucket
    }
}

if ($S3Bucket) {
    Write-Host "`n[6/6] Updating S3 frontend runtime config ($S3Bucket)..." -ForegroundColor White
    $runtimeConfig = "{`"apiUrl`":`"http://${publicIp}:5000`"}"
    $tempFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tempFile -Value $runtimeConfig -Encoding ASCII
    aws s3 cp $tempFile "s3://${S3Bucket}/config.json" --content-type "application/json" --cache-control "no-cache, no-store, must-revalidate" | Out-Null
    Remove-Item -Path $tempFile -Force
    Write-Host "  ✔ S3 runtime config updated. Frontend will now target http://${publicIp}:5000" -ForegroundColor Green
}

# 8. Poll Application Health Endpoint
Write-Host "`nVerifying backend application readiness..." -ForegroundColor White
$healthUrl = "http://${publicIp}:5000/health"
$maxRetries = 20
$retryCount = 0
$isHealthy = $false

while ($retryCount -lt $maxRetries -and -not $isHealthy) {
    $retryCount++
    try {
        $res = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($res.status -eq "UP") {
            $isHealthy = $true
            break
        }
    } catch {}
    Write-Host "  Attempt $retryCount/$maxRetries: waiting for containers (Docker + Redis + Node.js)..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
}

Write-Host "`n========================================================" -ForegroundColor Cyan
if ($isHealthy) {
    Write-Host "🎉 AxionLimit is ONLINE and HEALTHY!" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Cyan
    Write-Host "  📡 Backend API Endpoint : http://${publicIp}:5000" -ForegroundColor White
    Write-Host "  🩺 Healthcheck Endpoint : http://${publicIp}:5000/health" -ForegroundColor White
    if ($S3Bucket) {
        $websiteUrl = "http://${S3Bucket}.s3-website.${Region}.amazonaws.com"
        Write-Host "  🌐 Frontend Dashboard   : $websiteUrl" -ForegroundColor White
    }
} else {
    Write-Host "⚠️ Warning: EC2 is running, but /health endpoint has not responded with UP yet." -ForegroundColor Yellow
    Write-Host "  Backend container may still be pulling or connecting to MongoDB Atlas." -ForegroundColor Yellow
    Write-Host "  Test manually: curl http://${publicIp}:5000/health" -ForegroundColor White
}
Write-Host "========================================================`n" -ForegroundColor Cyan
