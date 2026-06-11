/**
 * Base HTML email layout with consistent branding.
 */
export function baseEmailLayout(content: string): string {
    return `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            ${content}
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                Innovation Treehouse — CheckMeIn
            </p>
        </div>
    `;
}
