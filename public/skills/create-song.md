# Skill: create-song

Create a personalized song on Porizo.

## What it does

Given an occasion (e.g. "birthday", "anniversary"), a recipient name, and a personal message, returns a deep link the user can open to start creating a song. The song is generated in the Porizo iOS app — voice enrollment must be completed in-app on the device (it cannot be uploaded for security reasons).

## Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `occasion` | string (≤ 200 chars) | yes | The occasion the song is for (birthday, anniversary, graduation, etc.) |
| `recipient` | string (≤ 200 chars) | yes | The recipient's name |
| `message` | string (≤ 200 chars) | yes | A short personal message to weave into the song lyrics |

## Output

A deep link of the form `https://porizo.co/?occasion=<urlencoded>&recipient=<urlencoded>&message=<urlencoded>`. Opening the link on iOS launches the Porizo app via Universal Links and prefills the create-song flow.

## How to invoke

This skill is exposed as a tool by the Porizo MCP server at `https://porizo.co/mcp`. See `https://porizo.co/.well-known/mcp/server-card.json` for the server discovery card.

## Limits

- Inputs may not contain `<script` or `javascript:` substrings — they are rejected at the server.
- All inputs are URL-encoded before being embedded in the returned deep link.
- The endpoint is rate-limited to 60 requests per minute per IP.
