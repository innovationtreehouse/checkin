import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { withAuth } from "@/lib/auth";

const REPO_OWNER = "innovationtreehouse";
const REPO_NAME = "checkin";

export const GET = withAuth(
    { roles: ['sysadmin'] },
    async () => {
        try {
            // 1. Get current version (SHA)
            let currentSha = "";
            try {
                if (process.env.VERCEL_GIT_COMMIT_SHA) {
                    currentSha = process.env.VERCEL_GIT_COMMIT_SHA;
                } else {
                    currentSha = execSync("git rev-parse HEAD").toString().trim();
                }
            } catch (e) {
                console.error("Failed to get current SHA:", e);
                currentSha = "unknown";
            }

            // 2. Get latest commit from GitHub
            const latestRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'CheckMeIn-App'
                },
                next: { revalidate: 3600 } // Cache for 1 hour
            });

            if (!latestRes.ok) {
                throw new Error(`GitHub API returned ${latestRes.status}`);
            }

            const latestCommit = await latestRes.json();
            const latestSha = latestCommit.sha;

            if (currentSha !== latestSha && currentSha !== "unknown") {
                // 3. Get comparison for changelog
                const compareRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/compare/${currentSha}...${latestSha}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'CheckMeIn-App'
                    },
                    next: { revalidate: 3600 }
                });

                let changes: string[] = [];
                if (compareRes.ok) {
                    const comparison = await compareRes.json();
                    changes = comparison.commits.map((c: { commit: { message: string } }) => c.commit.message.split('\n')[0]);
                }

                return NextResponse.json({
                    updateAvailable: true,
                    currentSha,
                    latestSha,
                    changes: changes.reverse() // Show newest first
                });
            }

            return NextResponse.json({
                updateAvailable: false,
                currentSha,
                latestSha
            });

        } catch (error) {
            console.error("Failed to check for updates:", error);
            return NextResponse.json({ error: "Internal Server Error", details: String(error) }, { status: 500 });
        }
    }
);
