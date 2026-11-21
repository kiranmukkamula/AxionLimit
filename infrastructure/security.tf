resource "aws_security_group" "ec2" {
  name        = "${var.project_name}-ec2-sg"
  description = "Security group for AxionLimit single EC2 host"
  vpc_id      = aws_vpc.main.id

  # Inbound Rule 1: HTTP Port 80 (Nginx Reverse Proxy & Frontend)
  # Accepts public HTTP web traffic and client API calls, routing them internally.
  ingress {
    description = "Public HTTP access to Nginx web server and reverse proxy"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Inbound Rule 2: Optional SSH Port 22
  # Controlled via var.enable_ssh and restricted to var.admin_ip.
  # Preferred administration method is AWS Systems Manager (SSM) which needs no open ports.
  dynamic "ingress" {
    for_each = var.enable_ssh ? [1] : []
    content {
      description = "Restricted SSH access for administrative troubleshooting"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [var.admin_ip]
    }
  }

  # NOTE ON BACKEND (PORT 5000):
  # There is NO public ingress rule for port 5000. The Node.js Express backend
  # runs entirely within Docker internal networking and is accessible only via Nginx.

  # NOTE ON REDIS (PORT 6379):
  # There is NO ingress rule for port 6379. Redis is strictly isolated inside
  # the internal Docker bridge network on the EC2 host and is inaccessible from the public internet.

  # NOTE ON MONGODB (PORT 27017):
  # There is NO ingress rule for port 27017. MongoDB is hosted remotely on MongoDB Atlas.

  # Outbound Rules: Full Internet Access
  # Required for:
  # - Outbound HTTPS (443) to AWS SSM regional endpoints (for SSM Session Manager)
  # - Outbound TCP (27017) to MongoDB Atlas cluster
  # - Outbound HTTP/HTTPS (80/443) for Ubuntu OS package updates and Docker Hub image pulls
  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-ec2-sg"
  }
}
