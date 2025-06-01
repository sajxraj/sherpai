import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function getAIComments(filename: string, patch: string) {
    const prompt = `You are an expert code reviewer with deep knowledge of multiple programming languages and software development best practices.
    Review this diff in file ${filename} and provide detailed inline comments.

    For line-specific issues, use this format:
    LINE: <line_number>
    <your comment>

    For general comments about the code, use this format:
    GENERAL:
    <your comment>

    Look for:
    1. Syntax errors (e.g., incorrect attributes, missing quotes, typos in keywords, invalid syntax)
    2. Common programming mistakes and anti-patterns
    3. Security vulnerabilities
    4. Performance issues
    5. Code style and best practices
    6. Potential bugs or edge cases
    7. Maintainability concerns
    
    For each issue found, provide a clear explanation and suggestion for improvement.
    Be thorough and don't hesitate to point out even minor issues that could cause problems.
    
    Here's the diff to review:\n\n${patch}`;

    const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
    });

    const response = completion.choices[0].message.content ?? "";
    console.log("AI Response:", response);
    return parseAIResponse(response);
}

const parseAIResponse = (content: string) => {
    const comments = [];
    const lines = content.split("\n");
    let currentLine: number | undefined = undefined;
    let currentText: string[] = [];

    console.log("Parsing lines:", lines);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        console.log("Processing line:", line);
        
        if (line.startsWith("LINE:")) {
            // If we have accumulated text, add it as a comment
            if (currentText.length > 0) {
                comments.push({
                    text: currentText.join("\n"),
                    line: currentLine
                });
                currentText = [];
            }
            // Extract line number
            const lineMatch = line.match(/LINE:\s*(\d+)/);
            currentLine = lineMatch ? parseInt(lineMatch[1]) : undefined;
            console.log("Found LINE marker, line number:", currentLine);
        } else if (line.startsWith("GENERAL:")) {
            // If we have accumulated text, add it as a comment
            if (currentText.length > 0) {
                comments.push({
                    text: currentText.join("\n"),
                    line: currentLine
                });
                currentText = [];
            }
            currentLine = undefined;
            console.log("Found GENERAL marker");
        } else if (line !== "" && (currentLine !== undefined || currentText.length > 0)) {
            // Add to current comment text, but only if it's not empty
            currentText.push(line);
            console.log("Added to current text:", line);
        }
    }

    // Add the last comment if there is one
    if (currentText.length > 0) {
        comments.push({
            text: currentText.join("\n"),
            line: currentLine
        });
    }

    console.log("Final comments:", comments);
    return comments;
};
