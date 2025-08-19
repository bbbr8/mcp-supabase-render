const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Use CORS with optional allowed origins from env
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));

// Supabase configuration from environment
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const rawTables = process.env.ALLOWED_TABLES || '';
const ALLOWED_TABLES = rawTables
  .split(',')
  .map(t => t.trim())
  .filter(Boolean);
const ALLOW_WRITES = process.env.ALLOW_WRITES === 'true';

const supabaseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

// Internal helper to perform a select from Supabase
async function supabaseSelect({ table, select, match, limit, order }) {
  if (ALLOWED_TABLES.length && !ALLOWED_TABLES.includes(table)) {
    throw new Error('Table not allowed');
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
  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch (e) {
      errorBody = await response.text();
    }
    throw new Error(JSON.stringify(errorBody));
  }
  return await response.json();
}

// Internal helper to perform an insert into Supabase
async function supabaseInsert({ table, rows, returnRepresentation }) {
  if (!ALLOW_WRITES) {
    throw new Error('Inserts not allowed');
  }
  if (ALLOWED_TABLES.length && !ALLOWED_TABLES.includes(table)) {
    throw new Error('Table not allowed');
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
  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch (e) {
      errorBody = await response.text();
    }
    throw new Error(JSON.stringify(errorBody));
  }
  const contentLength = response.headers.get('content-length') || response.headers.get('Content-Length');
  if (response.status !== 204 && contentLength && contentLength !== '0') {
    return await response.json();
  }
  return { status: response.status, message: 'Insert successful' };
}

// JSON parser used on specific routes so streaming isn't broken
const jsonParser = express.json();

// Health check
app.get('/', (req, res) => {
  res.json({ ok: true });
});

// supabase_select tool: read rows with error handling
app.post('/tools/supabase_select', jsonParser, async (req, res) => {
  try {
    const result = await supabaseSelect(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// supabase_insert tool: write rows with error/body handling
app.post('/tools/supabase_insert', jsonParser, async (req, res) => {
  try {
    const result = await supabaseInsert(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve plugin manifest and OpenAPI spec
app.get('/.well-known/ai-plugin.json', (req, res) => {
  const pluginPath = path.join(__dirname, 'ai-plugin.json');
  try {
    const content = require(pluginPath);
    if (content.api && content.api.url && content.api.url.includes('{{HOST}}')) {
      content.api.url = `https://${req.headers.host}/openapi.json`;
    }
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load plugin manifest' });
  }
});

app.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.json'));
});

// Session store for MCP streaming connections
const sessions = new Map();

// MCP endpoint implementing simple tool dispatching over streamable HTTP
app.post('/mcp', (req, res) => {
  const requestedId = req.headers['mcp-session-id'];
  if (requestedId && !sessions.has(requestedId)) {
    return res.status(400).json({ error: 'Unknown session' });
  }
  const sessionId = requestedId || uuidv4();
  sessions.set(sessionId, { res });
  res.setHeader('Mcp-Session-Id', sessionId);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  });
  res.write(JSON.stringify({ event: 'ready', sessionId }) + '\n');
  let buffer = '';
  req.on('data', async chunk => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        res.write(JSON.stringify({ event: 'error', message: 'Invalid JSON' }) + '\n');
        continue;
      }
      const { id, name, args } = msg;
      if (!id || !name) {
        res.write(JSON.stringify({ id, error: 'Invalid message format' }) + '\n');
        continue;
      }
      try {
        let result;
        if (name === 'supabase_select') {
          result = await supabaseSelect(args);
        } else if (name === 'supabase_insert') {
          result = await supabaseInsert(args);
        } else {
          throw new Error('Unknown tool');
        }
        res.write(JSON.stringify({ id, result }) + '\n');
      } catch (e) {
        res.write(JSON.stringify({ id, error: e.message }) + '\n');
      }
    }
  });
  const cleanup = () => {
    sessions.delete(sessionId);
    res.end();
  };
  req.on('end', cleanup);
  req.on('close', cleanup);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
