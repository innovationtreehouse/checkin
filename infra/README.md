# AWS ECS Deployment

This directory contains CloudFormation templates to provision the AWS infrastructure
for the checkin app on ECS Fargate + RDS PostgreSQL.

## Architecture

```
Internet
   │
   ▼
[ALB]  ←─ public subnets (2 AZs)
   │
   ▼
[ECS Fargate service]  ←─ private subnets
   │                        (Node 24 container, port 4000)
   ▼
[RDS PostgreSQL 15]  ←─ private subnets
```

Secrets (database URL, OAuth credentials, etc.) are stored in **AWS Secrets Manager**
and injected into the container as environment variables at launch time.

The CD pipeline uses **GitHub Actions OIDC** — no static AWS credentials are stored
in GitHub; the workflow exchanges a short-lived GitHub token for an AWS role.

---

## One-time setup

### 1. Deploy the VPC stack

```bash
aws cloudformation deploy \
  --stack-name checkin-vpc \
  --template-file cloudformation/vpc.yml \
  --capabilities CAPABILITY_IAM \
  --region us-east-1
```

### 2. Deploy the app stack

Collect the values you need first:

| Parameter | How to get it |
|-----------|--------------|
| `DBPassword` | Generate: `openssl rand -base64 24` |
| `NextAuthSecret` | Generate: `openssl rand -base64 32` |
| `GoogleClientId` | Google Cloud Console → OAuth 2.0 credentials |
| `GoogleClientSecret` | Google Cloud Console → OAuth 2.0 credentials |
| `ResendApiKey` | resend.com dashboard |
| `GitHubOrg` | Your GitHub username or org (e.g. `myorg`) |
| `NextAuthUrl` | Leave blank for now; update after step 3 |

```bash
aws cloudformation deploy \
  --stack-name checkin-app \
  --template-file cloudformation/app.yml \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides \
      DBPassword=<db-password> \
      NextAuthSecret=<nextauth-secret> \
      GoogleClientId=<google-client-id> \
      GoogleClientSecret=<google-client-secret> \
      ResendApiKey=<resend-api-key> \
      GitHubOrg=<your-github-org> \
      GitHubRepo=checkin
```

> The initial deploy uses a placeholder image for the ECS task definition.
> The first CD pipeline run (after step 4) will replace it with the real image.

### 3. Note the stack outputs

```bash
aws cloudformation describe-stacks \
  --stack-name checkin-app \
  --query "Stacks[0].Outputs" \
  --output table
```

Key outputs:

| Output | Use |
|--------|-----|
| `ALBDnsName` | Point your DNS CNAME here |
| `GitHubActionsRoleArn` | Set as `AWS_ROLE_ARN` in GitHub secrets |
| `ECRRepositoryUri` | Set as `ECR_REPOSITORY` in GitHub secrets |
| `ECSClusterName` | Set as `ECS_CLUSTER` in GitHub secrets |
| `ECSServiceName` | Set as `ECS_SERVICE` in GitHub secrets |
| `RDSEndpoint` | Already embedded in the `checkin/database-url` secret |

### 4. Set GitHub Actions secrets

In your GitHub repo → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | From `GitHubActionsRoleArn` output |
| `AWS_REGION` | e.g. `us-east-1` |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID |
| `ECR_REPOSITORY` | Repository name portion of `ECRRepositoryUri` (e.g. `checkin`) |
| `ECS_CLUSTER` | From `ECSClusterName` output |
| `ECS_SERVICE` | From `ECSServiceName` output |
| `ECS_PRIVATE_SUBNETS` | Comma-separated private subnet IDs (from vpc stack outputs) |
| `ECS_SECURITY_GROUP` | ECS security group ID (from vpc stack outputs) |
| `NEXTAUTH_URL` | `http://<ALBDnsName>` or your custom domain |

### 5. Push to `main` to trigger the first deployment

```bash
git push origin main
```

The CD pipeline will:
1. Run all tests against a ephemeral PostgreSQL container
2. Build the Node 24 Docker image and push to ECR
3. Run `prisma migrate deploy` as a one-off Fargate task
4. Deploy the updated task definition to the ECS service

---

## Updating secrets after initial deploy

To update any secret (e.g. rotate credentials):

```bash
aws secretsmanager put-secret-value \
  --secret-id checkin/google-client-secret \
  --secret-string "new-value"
```

Then redeploy the ECS service to pick up the new value:

```bash
aws ecs update-service \
  --cluster checkin-cluster \
  --service checkin-service \
  --force-new-deployment
```

---

## HTTPS / custom domain

The ALB listener is HTTP-only by default. To enable HTTPS:

1. Request a certificate in **AWS Certificate Manager** for your domain.
2. Add an HTTPS listener in the `app.yml` template (port 443, your ACM ARN).
3. Redirect HTTP → HTTPS on the port 80 listener.
4. Update `NextAuthUrl` and the `checkin/database-url` secret if needed.

---

## Costs (approximate, us-east-1, as of 2025)

| Resource | Approx. monthly |
|----------|----------------|
| Fargate (0.5 vCPU / 1 GB, 1 task) | ~$15 |
| RDS db.t3.micro (PostgreSQL) | ~$15 |
| NAT Gateway | ~$35 |
| ALB | ~$18 |
| ECR storage | ~$1 |

Smallest useful monthly cost is around **$85**. Swap to `db.t3.micro` Multi-AZ
or increase Fargate count for production hardening.
