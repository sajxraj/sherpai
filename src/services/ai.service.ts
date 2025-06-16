import OpenAI from "openai";

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

interface AIComment {
    line?: number;
    text: string;
}

export async function getAIComments(
    filename: string,
    patch: string,
    config: string | null
) {
    const numberedPatch = patch
        .split("\n")
        .map((line, i) => `${i + 1}: ${line}`)
        .join("\n");
    const prompt = `You are an expert code reviewer with deep knowledge of multiple programming languages and software development best practices.
    Review this diff in file ${filename} and provide detailed inline comments.

    IMPORTANT:
        - You must return a valid JSON array.
        - Each object in the array must include:
            - "line": the number of the line in the list below (from the prefix)
            - "text": your comment as a string
            
    DO NOT return comments for lines that are not present.
    DO NOT include general feedback unless it's relevant to the added code.

    Example format:
    [
        {
            "line": 12,
            "text": "The attribute 'src' is missing quotes. It should be src=\"...\""
        },
        {
            "text": "General comment about the code structure"
        }
    ]

    Look for:
    1. Syntax errors (e.g., incorrect attributes, missing quotes, typos in keywords, invalid syntax)
    2. Common programming mistakes and anti-patterns
    3. Security vulnerabilities
    4. Performance issues
    5. Code style and best practices
    6. Potential bugs or edge cases
    7. Maintainability concerns

    ${
        config
            ? "Also, take into account the following configuration:" + config
            : ""
    }
    
    For each issue found, provide a clear explanation and suggestion for improvement.
    Be thorough and don't hesitate to point out even minor issues that could cause problems.
    
    CRITICAL: Your response must be a valid JSON array ONLY. Do not include any markdown formatting, code blocks, or any other text outside the JSON array.
    Do not wrap the response in \`\`\`json or any other markdown formatting.
    
    Here's the added line to review:\n\n${numberedPatch}`;

    const completion = await openai.chat.completions.create({
        model: "gpt-4",
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
