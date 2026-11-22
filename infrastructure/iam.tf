# ─────────────────────────────────────────────────────────────────────────────
# EC2 IAM Role & Instance Profile for AWS Systems Manager (SSM)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ec2_role" {
  name = "${var.project_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-ec2-role"
  }
}

# Attach AWS managed policy for Systems Manager Session Manager & Run Command
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project_name}-ec2-instance-profile"
  role = aws_iam_role.ec2_role.name
}

# ─────────────────────────────────────────────────────────────────────────────
# GitHub Actions OIDC Role (Zero permanent AWS access keys in GitHub Secrets)
# ─────────────────────────────────────────────────────────────────────────────

# GitHub OIDC Identity Provider (Created when github_repo is configured)
resource "aws_iam_openid_connect_provider" "github" {
  count           = var.github_repo != "" ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c5878692eee48e7137fa1116483303370f73894"]
}

resource "aws_iam_role" "github_actions" {
  count = var.github_repo != "" ? 1 : 0
  name  = "${var.project_name}-github-actions-role"

  # Trust Policy: Matches GitHub OIDC tokens strictly on the 'main' branch.
  # Accounts for GitHub's immutable subject claim format:
  # repo:owner@owner_id/repo@repo_id:ref:refs/heads/<branch>
  # (automatically enforced for all repositories created after July 15, 2026).
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github[0].arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = [
              "repo:${var.github_repo_owner}@${var.github_owner_id}/${var.github_repo_name}@${var.github_repo_id}:ref:refs/heads/${var.github_branch}",
              "repo:${var.github_repo}:ref:refs/heads/${var.github_branch}"
            ]
          }
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-github-actions-role"
  }
}

# Least-Privilege Policy for GitHub Actions to trigger SSM deployments on EC2
resource "aws_iam_role_policy" "github_actions_policy" {
  count = var.github_repo != "" ? 1 : 0
  name  = "${var.project_name}-github-actions-deploy-policy"
  role  = aws_iam_role.github_actions[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMSendCommand"
        Effect = "Allow"
        Action = [
          "ssm:SendCommand"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:*:document/AWS-RunShellScript",
          aws_instance.server.arn
        ]
      },
      {
        Sid    = "SSMGetInvocation"
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation"
        ]
        Resource = "*"
      }
    ]
  })
}
