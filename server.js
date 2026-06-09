const http = require('http');
require('dotenv').config();
const OpenAI = require("openai");

const server = http.createServer();

const port = 3000;
const host = 'localhost';


require("dotenv").config();

let prompt = `You are a wording processor for frontend localization.
Your job is to analyze a compact wording payload (already extracted from Figma) and return a structured object for ngx-translate.

## Your Task
Given compact text entries, organize them into a nested wording object.

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

### Input Shape
The input includes:
- page: metadata like pageName, fileId, pageId
- entries: array of wording entries with path, name, text, source
- stats: counts/timestamp

Use only these fields. Ignore anything else.

### What to Skip
- Navigation/header/footer/sidebar labels when they are clearly global chrome
- Technical labels, placeholders, or duplicated boilerplate text
- Any empty text

### Output Format
Return only a valid JSON object. No explanation, no markdown fences, no extra text.
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
Here is the compact payload:

[PASTE_COMPACT_PAYLOAD_HERE]`


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

function extractJsonObject(text) {
  const raw = String(text || '').trim();

  // Strip markdown code fences if the model returns them.
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenced ? fenced[1] : raw).trim();

  // Try direct parse first.
  try {
    return JSON.parse(candidate);
  } catch (_) {
    // Fallback: parse the first JSON object substring.
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('Model response does not contain a JSON object.');
    }

    const sliced = candidate.slice(firstBrace, lastBrace + 1);
    return JSON.parse(sliced);
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}



server.on('request', (req, res) => {
    setCorsHeaders(res);

    if (req.url === '/copilot-process' && req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/copilot-process' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });

        req.on('end', async () => {
            try {
            const parsed = JSON.parse(body || '{}');
            const compactPayload = JSON.stringify(parsed);
            const fullPrompt = prompt.replace('[PASTE_COMPACT_PAYLOAD_HERE]', compactPayload);
                const response = await run(fullPrompt);
            const responseObject = extractJsonObject(response);
                res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ response: responseObject }));
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

            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(port, host, () => {
    console.log(`Server is listening on http://${host}:${port}`);
});