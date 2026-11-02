# Recap

Paste a meeting's notes, get what was decided and the action items.

## Run it

Node 22 or later.

```bash
npm install
cp .env.example .env   # OPENAI_API_KEY for the real model; empty, a local stub answers
npm start              # http://localhost:3000
```

Or from a script:

```bash
curl -s localhost:3000/api/recap -H 'content-type: application/json' \
  -d '{"notes": "Sam will update the release notes by Friday."}'
```

## How it works

- `src/recap.js`: the prompt and how the model's answer is read.
- `src/llm.js`: the model: OpenAI's chat completions with a key, a stub that reads the notes' own task lines without one.
- `src/views.js`: the page. `src/server.js`: the routes.

## Test

```bash
npm test     # no key needed: the model is faked
```
