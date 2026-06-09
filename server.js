const http = require('http');
require('dotenv').config();
const OpenAI = require("openai");

const server = http.createServer();

const port = 3000;
const host = 'localhost';


require("dotenv").config();

let prompt = `You are a wording processor for frontend localization. 
Your job is to analyze Figma page JSON responses and extract all visible text content into a structured wording object used in NX translate (i18n) for frontend apps.

## Your Task
Given a Figma JSON response, extract all text nodes and organize them into a deeply nested wording object.

## Rules

### Element Naming
- Use **camelCase** for all keys
- Names must be **semantically meaningful** — they describe the UI element's purpose, not its visual style
- Names will be used directly in NX translate, so they must be developer-friendly and descriptive
- If a group of elements shares a parent section, reflect that hierarchy in nesting

### Allowed Props (ONLY these four — no others)
| Prop | When to use |
|---|---|
| 'std-headline' | Main label, title, or heading of an element |
| 'std-subHeadline' | Secondary label or subtitle beneath a headline |
| 'text-body' | Longer descriptive/paragraph text |
| 'link-href' | URL value from a link/button element |

### Nesting
- Reflect the visual/logical hierarchy from Figma
- If a section contains sub-elements, nest them as children
- Each child can itself have props and/or further children

### What to Skip
- Navigation components, logos, icons, decorative elements
- Internal Figma metadata (IDs, style references, component names like "main-nav", "logo-speechmark")
- Any node that has no visible text content
- Duplicate/repeated structural wrappers with no text

### Output Format
Return **only** a valid JSON object — no explanation, no markdown fences, no extra text.
The top-level key should be a camelCase name that describes the page or section.

## Example Output Structure
{
  "workOrderDetails": {
    "installation": {
      "std-headline": "Installation",
      "datum": {
        "std-headline": "Datum:"
      },
      "adresse": {
        "std-headline": "Adresse:",
        "std-subHeadline": "Str."
      }
    },
    "productInformation": {
      "std-headline": "Produkt-Informationen",
      "info": {
        "text-body": "Leider können wir Dir..."
      }
    }
  }
}

## Input
Here is the Figma JSON response:

[PASTE FIGMA JSON HERE]`


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Your OpenAI API key
  baseURL: "https://models.inference.ai.azure.com",
});

async function run(prompt) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 1,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0].message.content;
}




server.on('request', (req, res) => {
    if (req.url === '/copilot-process' && req.method === 'POST') {
        console.log(process.env['GEMINI_API_KEY']);
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });

        console.log('body received:', body);
        req.on('end', async () => {
            try {
                const fullPrompt = prompt.replace('[PASTE FIGMA JSON HERE]', body);
                const response = await run(fullPrompt);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ response }));
            } catch (error) {
                console.error('Error processing request:', error);
                const statusCode = error?.status || error?.code || 500;
                const details = error?.error?.message || error?.message || 'Internal Server Error';
                const payload = {
                    error: statusCode === 429
                        ? 'Quota exceeded. Check your Gemini API plan, billing, and usage.'
                        : 'Internal Server Error',
                    details,
                };
                res.writeHead(statusCode === 429 ? 429 : 500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(payload));
            }
        });

      
    } 
});

server.listen(port, host, () => {
    console.log(`Server is listening on http://${host}:${port}`);
});