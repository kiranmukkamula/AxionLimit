variable "aws_region" {
  type        = string
  description = "AWS region for deployment"
  default     = "ap-south-1" # Mumbai
}

variable "environment" {
  type        = string
  description = "Deployment environment name"
  default     = "dev"
}

variable "project_name" {
  type        = string
  description = "Project identifier used in resource names"
  default     = "axionlimit"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the dedicated VPC"
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  type        = string
  description = "CIDR block for the single public subnet"
  default     = "10.0.1.0/24"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for Nginx, Backend & Redis. t3.small provides 2 vCPU and 2GB RAM."
  default     = "t3.small"
}

variable "use_elastic_ip" {
  type        = bool
  description = "Whether to allocate an Elastic IP. Default false to avoid $3.65/mo idle IPv4 charges when stopped."
  default     = false
}

variable "enable_ssh" {
  type        = bool
  description = "Whether to open port 22 in Security Group. Default false in favor of AWS Systems Manager (SSM)."
  default     = false
}

variable "admin_ip" {
  type        = string
  description = "CIDR block allowed for SSH when enable_ssh is true (e.g. 203.0.113.50/32)"
  default     = "0.0.0.0/0"
}

variable "github_repo" {
  type        = string
  description = "GitHub repository string for standard OIDC (e.g. 'kiranmukkamula/AxionLimit')"
  default     = "kiranmukkamula/AxionLimit"
}

variable "github_repo_owner" {
  type        = string
  description = "GitHub account or organization login (e.g. 'kiranmukkamula')"
  default     = "kiranmukkamula"
}

variable "github_repo_name" {
  type        = string
  description = "GitHub repository name (e.g. 'AxionLimit')"
  default     = "AxionLimit"
}

variable "github_owner_id" {
  type        = string
  description = "GitHub account/org numeric ID for immutable OIDC subject claim (enforced after July 15, 2026)"
  default     = "152879853"
}

variable "github_repo_id" {
  type        = string
  description = "GitHub repository numeric ID for immutable OIDC subject claim (enforced after July 15, 2026)"
  default     = "1303665861"
}

variable "github_branch" {
  type        = string
  description = "Target git branch permitted to assume the AWS OIDC role"
  default     = "main"
}
