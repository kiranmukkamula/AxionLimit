output "ec2_instance_id" {
  description = "The EC2 Instance ID used by axion-start.ps1 and axion-stop.ps1"
  value       = aws_instance.server.id
}

output "ec2_public_ip" {
  description = "The current public IPv4 address of the EC2 instance"
  value       = var.use_elastic_ip ? aws_eip.ec2_eip[0].public_ip : aws_instance.server.public_ip
}

output "backend_api_url" {
  description = "The HTTP REST API URL for AxionLimit Backend"
  value       = "http://${var.use_elastic_ip ? aws_eip.ec2_eip[0].public_ip : aws_instance.server.public_ip}:5000"
}

output "s3_website_endpoint" {
  description = "The public HTTP website endpoint for the React Frontend hosted on S3"
  value       = "http://${aws_s3_bucket_website_configuration.frontend_website.website_endpoint}"
}

output "s3_bucket_name" {
  description = "The name of the S3 bucket hosting frontend static assets"
  value       = aws_s3_bucket.frontend.id
}

output "github_actions_role_arn" {
  description = "The IAM Role ARN to configure in GitHub Actions Secrets as AWS_ROLE_ARN"
  value       = var.github_repo != "" ? aws_iam_role.github_actions[0].arn : "OIDC role omitted (no github_repo variable provided)"
}

output "aws_region" {
  description = "The AWS deployment region"
  value       = var.aws_region
}
