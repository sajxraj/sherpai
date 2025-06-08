import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface AIComment {
  line?: number;
  text: string;
}

export async function getAIComments(
  filename: string,
  patch: string,
  config: string | null
) {
  const prompt = `You are an expert code reviewer with deep knowledge of multiple programming languages and software development best practices.
    Review this diff in file ${filename} and provide detailed inline comments.

    IMPORTANT: You must respond with a valid JSON array of comments. Each comment should be an object with:
    - line: (optional) the line number if the comment is specific to a line
    - text: the comment text

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
    
    Remember: Your entire response must be a valid JSON array. Do not include any other text or explanation outside the JSON array.
    
    Here's the diff to review:\n\n${patch}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  try {
    const response = completion.choices[0].message.content ?? "[]";
    return JSON.parse(response) as AIComment[];
  } catch (error) {
    console.error("Error parsing AI response:", error);
    return [];
  }
}
