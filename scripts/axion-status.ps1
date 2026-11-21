<#
.SYNOPSIS
  Checks the real-time status of the AxionLimit EC2 instance, public IP, and application health.

.PARAMETER InstanceId
  Optional. Explicit EC2 instance ID. If omitted, discovers instance by tag Name=axionlimit-server.

.PARAMETER Region
  Optional. AWS Region. Defaults to ap-south-1 (Mumbai).
#>

param(
    [string]$InstanceId = "",
    [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "📊 AxionLimit Status & Health Monitor" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Verify AWS CLI
if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: AWS CLI is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# 2. Discover Instance ID if not provided
if (-not $InstanceId) {
    $discoveredId = (aws ec2 describe-instances `
        --region $Region `
        --filters "Name=tag:Name,Values=axionlimit-server" "Name=instance-state-name,Values=running,stopped,pending,stopping" `
        --query "Reservations[0].Instances[0].InstanceId" `
        --output text).Trim()

    if (-not $discoveredId -or $discoveredId -eq "None") {
        Write-Host "❌ Error: Could not find an EC2 instance with tag Name=axionlimit-server in $Region." -ForegroundColor Red
        exit 1
    }
    $InstanceId = $discoveredId
}

# 3. Retrieve Details
$instanceData = aws ec2 describe-instances --instance-ids $InstanceId --region $Region --output json | ConvertFrom-Json
$instance = $instanceData.Reservations[0].Instances[0]

$state = $instance.State.Name
$publicIp = $instance.PublicIpAddress
$launchTime = $instance.LaunchTime
$instanceType = $instance.InstanceType

Write-Host "🖥️  EC2 Instance Details:" -ForegroundColor White
Write-Host "  • Instance ID   : $InstanceId" -ForegroundColor Cyan
Write-Host "  • Instance Type : $instanceType (Credit Specification: standard)" -ForegroundColor White
Write-Host "  • Region / AZ   : $($instance.Placement.AvailabilityZone)" -ForegroundColor White
Write-Host "  • State         : $state" -ForegroundColor $(if ($state -eq "running") { "Green" } else { "Yellow" })
Write-Host "  • Public IPv4   : $(if ($publicIp) { $publicIp } else { 'None (Released / Stopped)' })" -ForegroundColor White
Write-Host "  • Launch Time   : $launchTime" -ForegroundColor Gray

# 4. Probe Application Health if Running
Write-Host "`n🩺 Application Health Status:" -ForegroundColor White
if ($state -eq "running" -and $publicIp) {
    $healthUrl = "http://${publicIp}:5000/health"
    try {
        $healthResponse = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 4 -ErrorAction Stop
        if ($healthResponse.status -eq "UP") {
            Write-Host "  • Backend Service : " -NoNewline
            Write-Host "ONLINE (HTTP 200 UP)" -ForegroundColor Green
            Write-Host "  • MongoDB State   : $($healthResponse.services.database)" -ForegroundColor Green
            Write-Host "  • Redis State     : $($healthResponse.services.redis)" -ForegroundColor Green
            Write-Host "  • API Endpoint    : http://${publicIp}:5000" -ForegroundColor Cyan
        } else {
            Write-Host "  • Backend Service : " -NoNewline
            Write-Host "DEGRADED (HTTP 503 DOWN)" -ForegroundColor Red
            Write-Host "    Details: $($healthResponse | ConvertTo-Json -Compress)" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  • Backend Service : " -NoNewline
        Write-Host "UNREACHABLE on port 5000 (Containers may still be starting)" -ForegroundColor Yellow
        Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Gray
    }
} else {
    Write-Host "  • Backend Service : " -NoNewline
    Write-Host "OFFLINE (EC2 is $state)" -ForegroundColor Yellow
}

# 5. S3 Frontend Website Status
$discoveredBucket = (aws s3api list-buckets --query "Buckets[?starts_with(Name, 'axionlimit-frontend')].Name | [0]" --output text).Trim()
if ($discoveredBucket -and $discoveredBucket -ne "None") {
    $s3Url = "http://${discoveredBucket}.s3-website.${Region}.amazonaws.com"
    Write-Host "`n🌐 Frontend Dashboard URL:" -ForegroundColor White
    Write-Host "  • $s3Url" -ForegroundColor Cyan
}

Write-Host "`n========================================================`n" -ForegroundColor Cyan
