const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ ok: true });
});

// Supabase config from environment
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ALLOWED_TABLES = process.env.ALLOWED_TABLES?.split(',') || [];
const ALLOW_WRITES = process.env.ALLOW_WRITES === 'true';

const supabaseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

// `supabase_select` tool: read rows
app.post('/tools/supabase_select', async (req, res) => {
  try {
    const { table, select, match, limit, order } = req.body;
    if (ALLOWED_TABLES.length && !ALLOWED_TABLES.includes(table)) {
      return res.status(403).json({ error: 'Table not allowed' });
    }
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    if (match) {
      Object.keys(match).forEach(key => {
        url += `&${encodeURIComponent(key)}=eq.${encodeURIComponent(match[key])}`;
      });
    }
    if (limit) {
      url += `&limit=${limit}`;
    }
    if (order) {
      url += `&order=${encodeURIComponent(order.column)}.${order.ascending ? 'asc' : 'desc'}`;
    }
    const response = await fetch(url, { headers: supabaseHeaders });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// `supabase_insert` tool: write rows (if enabled)
app.post('/tools/supabase_insert', async (req, res) => {
  if (!ALLOW_WRITES) {
    return res.status(403).json({ error: 'Inserts not allowed' });
  }
  try {
    const { table, rows, returnRepresentation } = req.body;
    if (ALLOWED_TABLES.length && !ALLOWED_TABLES.includes(table)) {
      return res.status(403).json({ error: 'Table not allowed' });
    }
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...supabaseHeaders,
          Prefer: returnRepresentation ? 'return=representation' : 'return=minimal'
        },
        body: JSON.stringify(rows)
      });
      const contentLength = response.headers.get('Content-Length');
      if (response.status !== 204 && contentLength && contentLength !== '0') {
        const data = await response.json();
        res.status(response.status).json(data);
      } else {
        res.status(response.status).json({ status: response.status, message: 'Insert successful' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// Serve plugin manifest and OpenAPI spec
app.get('/.well-known/ai-plugin.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'ai-plugin.json'));
});

app.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.json'));
});

// MCP endpoint using streamable HTTP
app.post('/mcp', (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || uuidv4();
  res.setHeader('Mcp-Session-Id', sessionId);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  });
  // For demonstration purposes, send a handshake event and close the stream
  res.write(JSON.stringify({ event: 'hello', sessionId }));
  res.end();
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
