import OpenAI from "openai";


// Lazy initialization to avoid side effects on import
let openai: OpenAI | null = null;

function getOpenAI() {
    if (!openai) {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            throw new Error("OPENROUTER_API_KEY environment variable is required");
        }
        
        openai = new OpenAI({
            apiKey,
            baseURL: "https://openrouter.ai/api/v1",
            defaultHeaders: {
                "X-Title": "Sherpai",
            },
        });
    }
    return openai;
}

interface AIComment {
    line?: number;
    text: string;
}

export async function getAIComments(
    filename: string,
    patch: string,
    config: string | null
) {
    // Process the patch to number added lines for the AI
    const patchLines = patch.split("\n");
    let addedLineCount = 0;
    const numberedPatch = patchLines
        .map((line) => {
            if (line.startsWith("+") && !line.startsWith("+++")) {
                addedLineCount++;
                return `[Line ${addedLineCount}] ${line}`;
            }
            return line;
        })
        .join("\n");

    const prompt = `You are an expert code reviewer acting as a Senior Software Engineer.
    Your goal is to review the provided code patch and identify **critical issues, bugs, security vulnerabilities, and major logic errors**.

    CONTEXT:
    File: ${filename}
    
    INSTRUCTIONS:
    1. Review the code patch below.
    2. ONLY comment on lines that start with "[Line <number>]".
    3. Do NOT comment on unchanged lines.
    4. **NOISE REDUCTION RULES (CRITICAL):**
        - **DO NOT** suggest adding comments or documentation.
        - **DO NOT** make vague requests for verification (e.g., "Ensure that...", "Make sure to handle...").
        - **DO NOT** warn about optional properties being undefined unless you see a **direct property access** that would cause a crash (e.g., \`prop.value\` without checking \`prop\`).
        - **DO NOT** complain about "use client" or "use server" directives; these are valid Next.js features.
        - **DO NOT** nitpick on minor style issues.
        - **ONLY** report issues with **HIGH CONFIDENCE**.
    5. If the code is good and no critical issues are found, return an empty array.

    OUTPUT FORMAT:
    Return a strictly valid JSON array of objects.
    - "line": The integer number from "[Line <number>]".
    - "text": The comment string.

    Example Output:
    [
        { "line": 1, "text": "Potential SQL injection vulnerability. Use parameterized queries." },
        { "line": 3, "text": "Off-by-one error in loop condition." }
    ]

    FOCUS AREAS:
    - **Bugs**: Logic errors, off-by-one, null pointer exceptions (only if certain), unhandled errors.
    - **Security**: XSS, SQLi, sensitive data exposure, auth bypass.
    - **Performance**: N+1 queries, expensive loops, memory leaks.
    - **Types**: Type safety issues (if applicable).

    ${
        config
            ? "ADDITIONAL CONFIGURATION:\n" + config
            : ""
    }

    PATCH TO REVIEW:
    ${numberedPatch}`;

    const completion = await getOpenAI().chat.completions.create({
        model: process.env.AI_MODEL || "openai/gpt-4-turbo",
        messages: [{role: "user", content: prompt}],
        temperature: 0.3,
    });

    try {
        let response = completion.choices[0].message.content ?? "[]";
        response = response.replace(/```json\n?|```/g, "").trim();

        return JSON.parse(response) as AIComment[];
    } catch (error) {
        console.error("Error parsing AI response:", error);
        return [];
    }
}
