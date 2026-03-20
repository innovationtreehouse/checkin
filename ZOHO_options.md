# Zoho Integration for Background Checks: Research Findings

This document summarizes the research into integrating a background check solution with Zoho for the upcoming membership signup feature.

## 1. Is API Access Possible?

Yes, API access is highly supported across the Zoho ecosystem and third-party background check providers.

*   **Direct Zoho CRM/Creator API:** Zoho CRM and Zoho Creator have robust REST APIs that allow you to programmatically create, read, update, and delete records (like a Contact or Membership Application). You can use these APIs to sync applicant data from your Next.js app to Zoho.
*   **Third-Party Integration:** Zoho itself does not natively perform background checks. Instead, it integrates with specialized providers like **Checkr** or **Verified First**.
    *   **Zoho Recruit** has out-of-the-box integrations with Checkr and Verified First via the Zoho Marketplace.
    *   If using **Zoho CRM or Creator**, you would typically build a custom integration: your app sends the data to the Checkr API directly, or your app sends data to Zoho, and Zoho Flow/webhooks trigger the Checkr API.
*   **Checkr API:** Checkr offers a very developer-friendly modern API to invite candidates, track status, and retrieve background check reports.

## 2. Cost Analysis

### Zoho API Costs
*   **Credit System:** Zoho APIs are based on a daily credit limit included in your subscription. Basic API calls usually cost 1 credit.
*   **Included Limits:** Limits vary by edition (e.g., Standard, Professional). For example, Professional Edition gives a base pool of credits plus credits per user license (up to a daily maximum, often 100,000+ credits).
*   **Overage:** If you exceed the daily API limit, additional API calls can be purchased (e.g., $0.14 per 1,000 calls). For a membership flow, you are unlikely to hit these limits unless you have tens of thousands of signups per day.

### Background Check Costs (e.g., Checkr)
*   **No Subscription:** Providers like Checkr charge per report.
*   **Pricing Tiers:**
    *   *Basic/Standard Check* (SSN Trace, Sex Offender Registry, National Criminal Search): Starts around **$29.99/report**.
    *   *Essential Check* (adds unlimited county criminal searches): Starts around **$54.99/report**.
    *   *Comprehensive/Professional Check*: **$79.99+/report**.
*   *Note: Additional pass-through fees from local county courts may apply.*

## 3. Push vs. Pull & Webhooks

### Push Notifications (Webhooks)
*   **Zoho Webhooks:** Zoho CRM, Creator, and Zoho Flow all natively support **Outgoing Webhooks (Push)**. When a record is updated (e.g., a board member approves a membership in Zoho), Zoho can automatically fire an HTTP POST webhook to your Next.js API route to update the database in real-time.
*   **Checkr Webhooks:** Checkr also uses webhooks to push status updates to your system. When a background check status changes to "Clear" or "Consider", Checkr sends a webhook payload to your app, eliminating the need to constantly poll the API.

### Pull (Polling)
*   While you *can* poll both Zoho's and Checkr's APIs for status updates, it consumes API credits/rate limits and introduces latency.
*   **Recommendation:** Use **Push (Webhooks)** for both Zoho and the background check provider for real-time, efficient synchronization.

## 4. Proposed Critical User Journeys (CUJs)

### CUJ 1: Family Member (Applicant)
1.  **Initiate:** User logs into the Check-in app and navigates to the "Membership Signup" section.
2.  **Consent & Data Entry:** User fills out the required personal details (Name, DOB, SSN, Address) and provides digital consent for the background check via a secure form or widget.
3.  **Submission:** The app creates a "Pending Member" record in your database and syncs this profile to Zoho CRM.
4.  **Background Check Trigger:** The app securely passes the applicant's data to the Checkr API to initiate the background check.
5.  **Waiting State:** The user's dashboard displays a "Background Check Pending" status.
6.  **Completion:** Once the background check is completed, Checkr sends a webhook to the app. The app updates the UI to reflect completion and notifies the user that their application is under Board Review.

### CUJ 2: Board Member (Reviewer)
1.  **Notification:** The board member receives an automated notification (via email or Zoho push notification) that a new background check has been completed and requires review.
2.  **Review Dashboard:** The board member logs into a secure Zoho Dashboard (or a specialized admin view in your app) to view the applicant's profile.
3.  **Evaluate:** The board member reviews the background check summary. (Detailed reports usually require logging directly into the Checkr dashboard for compliance/security reasons).
4.  **Decision:** The board member clicks "Approve" or "Reject".
5.  **Automated Action:**
    *   If **Approved**, Zoho fires a webhook to the Check-in app, upgrading the user's role to "Member" and sending them a welcome email.
    *   If **Rejected**, an adverse action flow is initiated (as required by FCRA compliance), and the user's application is marked declined.
