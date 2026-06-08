/**
 * Anthropic Claude API client
 *
 * All Claude calls go through this module so the API key
 * is in exactly one place and never touches extension code.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // Timeout for long JD+profile prompts
  timeout: 30_000,
});

const MODEL       = 'claude-sonnet-4-20250514';
const MAX_TOKENS  = 1024;

/**
 * Sends a single-turn prompt to Claude and returns the text response.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} [opts]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]   — default 0.7
 * @returns {Promise<string>}
 */
async function callClaude(systemPrompt, userMessage, opts = {}) {
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: opts.maxTokens || MAX_TOKENS,
    temperature:opts.temperature ?? 0.7,
    system:     systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const block = response.content?.[0];
  if (!block || block.type !== 'text') {
    throw new Error('Unexpected Claude response format');
  }
  return block.text.trim();
}

module.exports = { callClaude, MODEL };

