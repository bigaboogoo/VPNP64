const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const cheerio = require('cheerio');
const url = require('url');
const path = require('path');
const fs = require('fs');

const app = express();
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Cache statistics
const cacheStats = {
  hits: 0,
  misses: 0,
  totalRequests: 0,
};

// Sanitize URL to prevent SSRF attacks
function sanitizeUrl(targetUrl) {
  try {
    const parsed = new url.URL(targetUrl);
    // Block private IP ranges
    const hostname = parsed.hostname;
    const privateRanges = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^::1$/,
      /^fc00:/i,
      /^fe80:/i,
    ];
    
    for (let range of privateRanges) {
      if (range.test(hostname)) {
        throw new Error('Private IP ranges not allowed');
      }
    }
    
    return parsed.toString();
  } catch (error) {
    throw new Error('Invalid URL: ' + error.message);
  }
}

// Generate cache key
function getCacheKey(targetUrl, options = {}) {
  return `proxy_${Buffer.from(targetUrl).toString('base64')}_${JSON.stringify(options)}`;
}

// Fetch and cache website
async function fetchAndCache(targetUrl, options = {}) {
  const cacheKey = getCacheKey(targetUrl, options);
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) {
    cacheStats.hits++;
    return { data: cached, fromCache: true, timestamp: cached.timestamp };
  }
  
  cacheStats.misses++;
  
  try {
    sanitizeUrl(targetUrl);
    
    const response = await axios.get(targetUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'VPNP64-Proxy/1.0 (Website Archiver)',
      },
      maxRedirects: 5,
    });
    
    const contentType = response.headers['content-type'];
    const data = {
      status: response.status,
      headers: response.headers,
      contentType: contentType,
      data: response.data,
      timestamp: new Date(),
      originalUrl: targetUrl,
      size: Buffer.byteLength(response.data),
    };
    
    // Process HTML to fix asset paths if needed
    if (contentType && contentType.includes('text/html')) {
      data.data = processHtmlAssets(response.data, targetUrl);
    }
    
    // Cache the result
    cache.set(cacheKey, data);
    
    return { data, fromCache: false };
  } catch (error) {
    // Try to return stale cache if available
    const staleCache = cache.get(cacheKey);
    if (staleCache) {
      return { data: staleCache, fromCache: true, stale: true, error: error.message };
    }
    throw error;
  }
}

// Process HTML to handle relative asset paths
function processHtmlAssets(html, baseUrl) {
  const $ = cheerio.load(html);
  const baseParsed = new url.URL(baseUrl);
  
  // Fix image paths
  $('img').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      const absoluteUrl = new url.URL(src, baseUrl).toString();
      $(elem).attr('src', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
    }
  });
  
  // Fix stylesheet paths
  $('link[rel="stylesheet"]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (href && !href.startsWith('http') && !href.startsWith('data:')) {
      const absoluteUrl = new url.URL(href, baseUrl).toString();
      $(elem).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
    }
  });
  
  // Fix script paths
  $('script').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      const absoluteUrl = new url.URL(src, baseUrl).toString();
      $(elem).attr('src', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
    }
  });
  
  return $.html();
}

// Main proxy endpoint
app.get('/proxy', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
      return res.status(400).json({
        error: 'Missing URL parameter',
        example: '/proxy?url=https://example.com',
      });
    }
    
    const result = await fetchAndCache(targetUrl);
    const { data, fromCache, stale } = result;
    
    res.set({
      'Content-Type': data.contentType || 'text/html; charset=utf-8',
      'X-Proxy-Cache': fromCache ? (stale ? 'STALE' : 'HIT') : 'MISS',
      'X-Proxy-Original-Url': data.originalUrl,
      'X-Proxy-Cached-At': data.timestamp.toISOString(),
    });
    
    if (data.contentType && data.contentType.includes('application/json')) {
      return res.json(data.data);
    }
    
    return res.send(data.data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch URL',
      message: error.message,
    });
  }
});

// Reverse proxy endpoint (for registered/trusted domains)
app.all('/rproxy/:domain/*', async (req, res) => {
  try {
    const domain = req.params.domain;
    const path = req.params[0];
    const targetUrl = `https://${domain}/${path}${req.url.split('?')[1] ? '?' + req.url.split('?')[1] : ''}`;
    
    const result = await fetchAndCache(targetUrl);
    const { data, fromCache } = result;
    
    res.set({
      'Content-Type': data.contentType || 'text/html; charset=utf-8',
      'X-Proxy-Cache': fromCache ? 'HIT' : 'MISS',
    });
    
    return res.send(data.data);
  } catch (error) {
    console.error('Reverse proxy error:', error);
    res.status(500).json({
      error: 'Reverse proxy failed',
      message: error.message,
    });
  }
});

// API: Get cache statistics
app.get('/api/stats', (req, res) => {
  const hitRate = cacheStats.totalRequests > 0
    ? ((cacheStats.hits / cacheStats.totalRequests) * 100).toFixed(2)
    : 0;
  
  res.json({
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    totalRequests: cacheStats.totalRequests,
    hitRate: `${hitRate}%`,
    cacheKeys: cache.keys().length,
  });
});

// API: List cached URLs
app.get('/api/cache/list', (req, res) => {
  const keys = cache.keys();
  const cachedUrls = keys
    .filter(key => key.startsWith('proxy_'))
    .slice(0, 50) // Limit to 50
    .map(key => {
      const cached = cache.get(key);
      return {
        url: cached.originalUrl,
        size: cached.size,
        timestamp: cached.timestamp,
      };
    });
  
  res.json({
    total: keys.length,
    mostRecent: cachedUrls,
  });
});

// API: Clear cache
app.post('/api/cache/clear', (req, res) => {
  cache.flushAll();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.totalRequests = 0;
  
  res.json({ message: 'Cache cleared successfully' });
});

// API: Get specific cached page
app.get('/api/cache/:urlHash', (req, res) => {
  const urlHash = req.params.urlHash;
  const cached = cache.get(`proxy_${urlHash}`);
  
  if (!cached) {
    return res.status(404).json({ error: 'Page not found in cache' });
  }
  
  res.json({
    url: cached.originalUrl,
    cached_at: cached.timestamp,
    size: cached.size,
    preview: cached.data.substring(0, 500),
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'operational', timestamp: new Date() });
});

// Track requests
app.use((req, res, next) => {
  cacheStats.totalRequests++;
  next();
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`VPNP64 Proxy Server running on port ${PORT}`);
  console.log(`Web interface available at http://localhost:${PORT}`);
});
