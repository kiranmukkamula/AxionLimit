output "ec2_instance_id" {
  description = "The EC2 Instance ID used for management and SSM deployment"
  value       = aws_instance.server.id
}

output "ec2_public_ip" {
  description = "The current public IPv4 address of the EC2 instance"
  value       = var.use_elastic_ip ? aws_eip.ec2_eip[0].public_ip : aws_instance.server.public_ip
}

output "app_url" {
  description = "The public HTTP URL for AxionLimit web dashboard and API (Port 80 via Nginx)"
  value       = "http://${var.use_elastic_ip ? aws_eip.ec2_eip[0].public_ip : aws_instance.server.public_ip}"
}

output "github_actions_role_arn" {
  description = "The IAM Role ARN to configure in GitHub Actions Secrets as AWS_ROLE_ARN"
  value       = var.github_repo != "" ? aws_iam_role.github_actions[0].arn : "OIDC role omitted (no github_repo variable provided)"
}

output "aws_region" {
  description = "The AWS deployment region"
  value       = var.aws_region
}
