# Productionization Plan

This document outlines the steps, considerations, and options for fully productionizing the Checkmein application, moving it off the manual AWS EC2 setup to a more maintainable, volunteer-friendly hosting environment.

## Pre-Launch Checklist (TODOs)

Moving to a "true" production environment involves more than just copying the code over. Here are the core steps to ensure the app is secure, functional, and ready for actual user traffic:

- [ ] **1. Transactional Email Registration (Resend)**
  - Create an account with [Resend](https://resend.com/pricing) (Free tier allows 3,000 emails/mo).
  - Verify the custom domain (requires access to DNS records for `innovationtreehouse.org` to add TXT/MX records).
  - Update the local application with the new production Resend API Key.

- [ ] **2. Choose Hosting Provider & Provision (See Options Below)**
  - Select the final hosting provider (Railway, Vercel Pro, or AWS Amplify).
  - Provision both the Next.js frontend and the PostgreSQL database.
  - Configure automated backups for the database.

- [ ] **3. Authentication & API Keys (NextAuth & GCP)**
  - Generate a secure cryptographically strong `NEXTAUTH_SECRET` for production.
  - Set the `NEXTAUTH_URL` to the new official domain in the hosting environment.
  - Get API keys for the treehouse GCP project to support Google OAuth login and Calendar management.
  - Update any third-party authentication providers (e.g., Google/Apple/GitHub OAuth) with the new production callback URLs.

- [ ] **4. Database Setup & Migration**
  - Run [Prisma migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/production) against the new production database (`npx prisma migrate deploy`).
  - Plan a brief maintenance window to export the database from the current EC2 instance and import it into the new database to prevent data loss.

- [ ] **5. Environment Variables & Secrets**
  - Gather all secrets from the current `.env` file.
  - Securely input them into the new hosting provider's encrypted environment variables dashboard (never commit these to GitHub!).

- [ ] **6. External Integrations (Shopify & Zoho)**
  - Update Shopify Store webhooks to point to the new production domain so inventory and payments sync correctly.
  - Ensure any Zoho integration endpoints or API keys correctly point to the new domain.

- [ ] **7. Domain Go-Live (DNS Cutover)**
  - Point the desired subdomain (e.g., `checkin.innovationtreehouse.org`) to your new hosting provider via your domain registrar.
  - Verify SSL certificates are provisioning correctly.

---

## Hosting Options Summary

Given the constraints of being a micro-non-profit run by volunteers, the primary goals for hosting are **low maintenance**, **low cost**, and **easy handover**.

### 1. [Railway](https://railway.app/pricing) (Recommended: Best Balance)
Railway is a modern PaaS (Platform as a Service) that allows you to host both the Next.js frontend and PostgreSQL database in a single dashboard.  

- **Estimated Cost:** ~$5 to $10 / month (usage-based).
- **Maintenance Level:** **Very Low**. It offers push-to-deploy from GitHub.
- **Pros:** 
  - No application/approval process required.
  - Organization accounts allow multiple volunteers to have login access.
  - The database and app are managed in the same UI.
- **Cons:** No formal hardware grants or non-profit free tiers.

### 2. [Vercel Pro](https://vercel.com/pricing) + [Neon DB](https://neon.tech/pricing) (Premium DX)
Vercel is the creator of Next.js and offers the absolute best developer experience. Because it strictly requires a Pro plan for organizational use, you have to use Vercel Pro to comply with their Terms of Service.

- **Estimated Cost:** $20/month per developer (Vercel Pro) + Free/$5 (Neon Postgres DB). *Note: Vercel offers 100% discount [sponsorships](https://vercel.com/docs/accounts/plans/pro/sponsorships) to registered 501(c)(3) organizations, but you must apply.*
- **Maintenance Level:** **Extremely Low**. 
- **Pros:** 
  - Flawless Next.js integration and Preview deployments.
  - Zero server management.
- **Cons:** 
  - Requires jumping through hoops to apply for the sponsorship or paying $20/mo per seat.
  - Requires managing a separate database provider.

### 3. AWS Amplify + [Neon DB](https://neon.tech/pricing) (via TechSoup)
If minimizing monthly credit card charges is the absolute highest priority, you can leverage AWS through the [TechSoup non-profit program](https://www.techsoup.org/amazon-web-services).

- **Estimated Cost:** $175 flat annual admin fee to TechSoup, which grants **$2,000/year** in AWS credits.
- **Maintenance Level:** **Medium**.
- **Pros:** 
  - Huge credit surplus means you never worry about traffic spikes running up a monthly bill.
- **Cons:** 
  - AWS is notoriously complex. Handing over AWS IAM permissions, VPCs, and Amplify settings to the next volunteer engineer will be a much steeper learning curve than Vercel or Railway.
