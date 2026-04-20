# Membership Workflow

This document records the understanding of the membership application and approval workflow based on the recent requirements.

## 1. Initial Information Collection
A household begins the process either by converting an existing household profile or through a public form for new households.
The required information includes:
* **Parents (Household Leads):** Names, emails, and phone numbers.
* **Children:** Names and ages (emails are optional).
* **Emergency Contacts:** Names and contact info.
*(If a household is already in the system, this information will be pre-filled or skipped).*

## 2. Membership Agreement
* The user is presented with a Membership Agreement (currently using lorem ipsum text).
* They must check a prominent "I agree" checkbox next to the "Proceed" button.

## 3. Health Insurance Information
* The user must provide their health insurance details.

## 4. Payment
* The user is provided a link to Shopify Pay to complete membership dues.
* Underneath the link, there will be text reading: "talk to board sub-committee if desired" for alternative arrangements.

## 5. Background Check Initiation
* A single household lead must be designated as the **Primary Lead**.
* **Skip Condition:** If *any* household lead has had a background check completed within the last 3 years, this step is skipped.
* If a check is required, an email (currently lorem ipsum) is sent to the Primary Lead containing a link to complete an external background check.
* The household status is then set to **Pending Background Check**.

---

## Board Administration & Approval

### Pending Memberships Admin Page
A new admin page will be added for the board to review the statuses of every household that has started but not completed the membership process. (The current page only lets the board override status; this new page will be more nuanced).

### Background Check Certification (Two-Party Control)
For households in the "Pending Background Check" status:
* We do not store background check data directly in our system. Board members will verify the status via the external site.
* The admin page will feature a "Click here to check website" button (link TBD) and a "Certify" button for each pending household.
* **Two board members** must independently verify the external check and click "Certify" in our system.
* The names of board members who have already certified a household will be visible to prevent duplicate work.

### Approval & Welcome
* After the second board member certifies the background check, the household is officially marked as a **Member**.
* A congratulatory welcome email is automatically sent to the household leads.

### Automated Reminders
* If there are families waiting in the "Pending Background Check" queue, the system will send weekly nag emails to the board as a reminder to review them.
