import { Redis } from "@upstash/redis";
import crypto from "crypto";
import "dotenv/config";
import { Probot } from "probot";
import { getAIComments } from "./services/ai.service.js";

if (!process.env.APP_ID) {
  throw new Error("APP_ID environment variable is not set");
}
if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY environment variable is not set");
}
if (
  !process.env.UPSTASH_REDIS_REST_URL ||
  !process.env.UPSTASH_REDIS_REST_TOKEN
) {
  throw new Error(
    "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables must be set"
  );
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function hashPatch(patch: string): string {
  return crypto.createHash("sha256").update(patch).digest("hex");
}

export default (app: Probot) => {
  app.on(
    ["pull_request.opened", "pull_request.synchronize"],
    async (context) => {
      const eslintConfigFiles = [
        ".eslintrc.js",
        ".eslintrc.json",
        ".eslintrc",
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
      ];

      const config = await context.config("sherpai.yml");
      const pr = context.payload.pull_request;
      const owner = context.payload.repository.owner.login;
      const repo = context.payload.repository.name;
      const prNumber = pr.number;
      const headSha = pr.head.sha;

      let eslintConfigContent = null;

      for (const path of eslintConfigFiles) {
        try {
          const response = await context.octokit.repos.getContent({
            owner: owner,
            repo: repo,
            path,
            ref: pr.head.sha, // get file from PR branch
          });

          console.log(response.data);

          const content = Buffer.from(
            (response.data as { content: string }).content,
            "base64"
          ).toString();
          console.log("🚀 ~ content:", content);

          // Handle based on file type
          if (path.endsWith(".json") || path.endsWith(".eslintrc")) {
            const config = JSON.parse(content);
            eslintConfigContent = config;
            console.log("ESLint config:", config);
          } else if (
            path.endsWith(".js") ||
            path.endsWith(".cjs") ||
            path.endsWith(".mjs")
          ) {
            eslintConfigContent = content;
            console.log("ESLint config:", content);
          }

          break; // found one, no need to keep searching
        } catch (e) {
          console.error(`Error reading ${path}:`, e);
        }
      }

      const files = await context.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      for (const file of files.data) {
        if (!file.patch) continue;

        const patchHash = hashPatch(file.patch);
        const cacheKey = `${repo}#${prNumber}:${file.filename}:${headSha}:${patchHash}`;

        const cachedComments = await redis.get(cacheKey);
        if (cachedComments) {
          context.log.info(
            `Using cached result for ${file.filename} - skipping comment posting`
          );

          continue;
        }

        const comments = await getAIComments(
          file.filename,
          file.patch,
          config ? JSON.stringify(config) : null,
          eslintConfigContent
        );

        // Cache the comments with a 4-day expiration
        await redis.set(cacheKey, JSON.stringify(comments), { ex: 345600 });

        for (const c of comments) {
          if (c.line) {
            await context.octokit.pulls.createReviewComment({
              owner,
              repo,
              pull_number: prNumber,
              body: c.text,
              commit_id: headSha,
              path: file.filename,
              line: c.line,
              side: "RIGHT",
              position: c.line,
              subject_type: "line",
            });
          } else {
            await context.octokit.pulls.createReview({
              owner,
              repo,
              pull_number: prNumber,
              body: c.text,
              event: "COMMENT",
            });
          }
        }
      }
    }
  );
};
