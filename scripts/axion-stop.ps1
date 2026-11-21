<#
.SYNOPSIS
  Safely stops the AxionLimit EC2 instance using StopInstances (NEVER TerminateInstances).
  Releases dynamic public IP to stop hourly IPv4 charges while keeping EBS and S3 data intact.

.PARAMETER InstanceId
  Optional. Explicit EC2 instance ID. If omitted, discovers instance by tag Name=axionlimit-server.

.PARAMETER Region
  Optional. AWS Region. Defaults to ap-south-1 (Mumbai).

.PARAMETER Force
  Optional switch to bypass interactive confirmation prompt.
#>

param(
    [string]$InstanceId = "",
    [string]$Region = "ap-south-1",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Yellow
Write-Host "⏸️  AxionLimit Application Shutdown Controller" -ForegroundColor Yellow
Write-Host "========================================================`n" -ForegroundColor Yellow

# 1. Verify AWS CLI
if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: AWS CLI is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# 2. Discover Instance ID if not provided
if (-not $InstanceId) {
    Write-Host "Discovering AxionLimit EC2 instance in $Region..." -ForegroundColor White
    $discoveredId = (aws ec2 describe-instances `
        --region $Region `
        --filters "Name=tag:Name,Values=axionlimit-server" "Name=instance-state-name,Values=running,stopped,pending,stopping" `
        --query "Reservations[0].Instances[0].InstanceId" `
        --output text).Trim()

    if (-not $discoveredId -or $discoveredId -eq "None") {
        Write-Host "❌ Error: Could not find an EC2 instance with tag Name=axionlimit-server." -ForegroundColor Red
        exit 1
    }
    $InstanceId = $discoveredId
}

# 3. Check Current State
$state = (aws ec2 describe-instances --instance-ids $InstanceId --region $Region --query "Reservations[0].Instances[0].State.Name" --output text).Trim()
Write-Host "Target Instance : $InstanceId" -ForegroundColor Cyan
Write-Host "Current State   : $state" -ForegroundColor Yellow

if ($state -eq "stopped") {
    Write-Host "`n✔ Instance is ALREADY STOPPED. No action required.`" -ForegroundColor Green
    exit 0
}

# 4. Confirmation Prompt
if (-not $Force) {
    Write-Host "`n⚠️  SAFETY NOTICE:" -ForegroundColor Yellow
    Write-Host "  This action will call EC2 StopInstances (NOT Terminate)." -ForegroundColor White
    Write-Host "  • All running containers will be stopped." -ForegroundColor White
    Write-Host "  • Persistent Redis data on EBS volume is PRESERVED." -ForegroundColor White
    Write-Host "  • Dynamic Public IP will be released to avoid IPv4 charges.`n" -ForegroundColor White

    $confirm = Read-Host "Are you sure you want to STOP AxionLimit? (type 'yes' or 'y' to confirm)"
    if ($confirm -ne "yes" -and $confirm -ne "y") {
        Write-Host "Operation cancelled by user." -ForegroundColor Gray
        exit 0
    }
}

# 5. Stop the Instance (Never terminate)
Write-Host "`nExecuting StopInstances on $InstanceId..." -ForegroundColor White
aws ec2 stop-instances --instance-ids $InstanceId --region $Region --output json | Out-Null

Write-Host "Waiting for EC2 instance to safely shut down..." -ForegroundColor Yellow
aws ec2 wait instance-stopped --instance-ids $InstanceId --region $Region

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "✔ AxionLimit EC2 instance is now STOPPED." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "`n💰 Cost Status While Stopped:" -ForegroundColor Cyan
Write-Host "  • EC2 Compute      : `$0.00 / hour (Compute billing is paused)" -ForegroundColor Green
Write-Host "  • Dynamic IPv4     : `$0.00 / hour (Address released back to AWS pool)" -ForegroundColor Green
Write-Host "  • Persistent EBS   : ~`$1.76 / month (20 GB gp3 volume preserved for your data)" -ForegroundColor White
Write-Host "  • S3 Static Files  : < `$0.01 / month (Frontend assets preserved)" -ForegroundColor White
Write-Host "`nTo start the service again, run: .\scripts\axion-start.ps1`n" -ForegroundColor White
