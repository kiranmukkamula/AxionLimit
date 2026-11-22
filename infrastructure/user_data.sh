#!/bin/bash
set -e

# Log all output to user-data.log
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "===================================================="
echo "🚀 AxionLimit EC2 Initialization Started"
echo "Timestamp: $(date -u)"
echo "===================================================="

# 1. Update OS packages
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git awscli

# 2. Install Official Docker Engine & Docker Compose Plugin
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Add ubuntu user to docker group
usermod -aG docker ubuntu

# 4. Enable Docker on boot
systemctl enable docker.service
systemctl start docker.service

# 5. Ensure Amazon SSM Agent is running
if snap list | grep -q amazon-ssm-agent; then
  echo "✔ AWS Systems Manager (SSM) Agent found via snap."
  systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
  systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service
else
  echo "Installing AWS Systems Manager (SSM) Agent via snap..."
  snap install amazon-ssm-agent --classic
  systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
  systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service
fi

# 6. Create production deployment directory with permissions
mkdir -p /opt/axionlimit
chown -R ubuntu:ubuntu /opt/axionlimit

echo "===================================================="
echo "✅ AxionLimit EC2 Initialization Complete!"
echo "Docker Version: $(docker --version)"
echo "Compose Version: $(docker compose version)"
echo "Timestamp: $(date -u)"
echo "===================================================="
