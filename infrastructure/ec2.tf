# Lookup the latest official Ubuntu 22.04 LTS AMI from Canonical
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical official owner ID

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# The Single EC2 Instance hosting AxionLimit Backend & Redis
resource "aws_instance" "server" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name

  # T3 Standard Credit Mode: Strictly throttles to baseline rather than billing
  # $0.05/vCPU-hour surplus charges if credit balance is depleted.
  credit_specification {
    cpu_credits = "standard"
  }

  # Persistent 20 GB gp3 SSD Volume
  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = false # Protects EBS disk and Redis data from accidental deletion
  }

  user_data = file("${path.module}/user_data.sh")

  # Safety Rule: Prevents accidental destruction via 'terraform destroy'
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name = "${var.project_name}-server"
  }
}

# Optional Elastic IP (Only created if use_elastic_ip is true)
resource "aws_eip" "ec2_eip" {
  count    = var.use_elastic_ip ? 1 : 0
  instance = aws_instance.server.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-eip"
  }
}
