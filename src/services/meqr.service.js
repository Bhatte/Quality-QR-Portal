/*
 ME-QR service client
 - Creates branded Link QR codes using ME-QR API
 - Uses Node 18+ global fetch
*/

const DEFAULTS = {
  SIZE: Number(process.env.MEQR_QR_SIZE || 1024),
  ECL: String(process.env.MEQR_QR_ECL || 'Q'),
  DESIGN_TYPE: String(process.env.MEQR_QR_DESIGN_TYPE || 'base'),
  // Theme defaults (aim to match uploaded example)
  PATTERN_COLOR: String(process.env.MEQR_QR_PATTERN_COLOR || '#000000'), // black
  BG_COLOR: String(process.env.MEQR_QR_BG_COLOR || '#FFFFFF'),
  PATTERN_SHAPE: String(process.env.MEQR_QR_PATTERN_SHAPE || 'square'), // e.g., 'square' | 'rounded' | 'dots' if supported
  CORNERS_OUTER_SHAPE: String(process.env.MEQR_QR_CORNERS_OUTER_SHAPE || 'square'),
  CORNERS_INNER_SHAPE: String(process.env.MEQR_QR_CORNERS_INNER_SHAPE || 'square'),
  CORNERS_OUTER_COLOR: String(process.env.MEQR_QR_CORNERS_OUTER_COLOR || '#000000'), // black outer
  CORNERS_INNER_COLOR: String(process.env.MEQR_QR_CORNERS_INNER_COLOR || '#000000'), // black inner
  LOGO_URL: String(process.env.MEQR_QR_LOGO_URL || ''),
  FRAME_NAME: String(process.env.MEQR_QR_FRAME_NAME || 'noFrame'), // e.g., 'helmet' if supported
  FRAME_COLOR: String(process.env.MEQR_QR_FRAME_COLOR || '#000000'),
  FRAME_BG_COLOR: String(process.env.MEQR_QR_FRAME_BG_COLOR || '#FFFFFF'),
};

const API_BASE = 'https://me-qr.com';

// Simple in-memory cache for frame enum list
let FRAME_ENUM_CACHE = { at: 0, list: null };

function buildQrOptions(overrides = {}, designType = DEFAULTS.DESIGN_TYPE) {
  const ART_PATTERNS = [
    'small-dots',
    'random-dots',
    'rhombus',
    'rounded-stripe',
    'small-square',
    'square-stripe',
  ];

  // Start with common fields
  const out = {
    size: DEFAULTS.SIZE,
    errorCorrectionLevel: DEFAULTS.ECL,
    pattern: DEFAULTS.PATTERN_SHAPE,
    patternColor: DEFAULTS.PATTERN_COLOR,
    patternBackground: DEFAULTS.BG_COLOR,
    cornetsOuter: DEFAULTS.CORNERS_OUTER_SHAPE,
    cornetsOuterColor: DEFAULTS.CORNERS_OUTER_COLOR,
    cornetsInterior: DEFAULTS.CORNERS_INNER_SHAPE,
    cornetsInteriorColor: DEFAULTS.CORNERS_INNER_COLOR,
    logotype: DEFAULTS.LOGO_URL || null,
    logotypeSize: 0.3,
    logotypeMargin: 0,
    logotypeHideBackground: true,
    gradientPattern: null,
    gradientCornetsOuter: null,
    gradientCornetsInterior: null,
    gradientBackground: null,
    ...overrides,
  };

  // If using art design, ensure valid pattern and remove unsupported fields
  if (String(designType) === 'art') {
    const desired = out.pattern;
    if (!ART_PATTERNS.includes(desired)) {
      // Map common base patterns to closest art equivalents
      const normalized = String(desired || '').toLowerCase();
      let mapped = 'small-square';
      if (normalized.includes('dot')) mapped = 'small-dots';
      if (normalized.includes('stripe')) mapped = 'square-stripe';
      if (normalized.includes('rhomb')) mapped = 'rhombus';
      out.pattern = ART_PATTERNS.includes(mapped) ? mapped : 'small-square';
    }
    // patternBackground not listed in ApiArtQrOptions2; remove to avoid validation issues
    delete out.patternBackground;
    // errorCorrectionLevel not present in ApiArtQrOptions2
    delete out.errorCorrectionLevel;
    // Remove fields not present in ApiArtQrOptions2 to avoid validation errors
    delete out.logotype;
    delete out.logotypeSize;
    delete out.logotypeMargin;
    delete out.logotypeHideBackground;
    delete out.gradientPattern;
    delete out.gradientCornetsOuter;
    delete out.gradientCornetsInterior;
    delete out.gradientBackground;
  }

  return out;
}

async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      const m = data?.message || data?.error || text || `HTTP ${res.status}`;
      const err = new Error(`ME-QR API error: ${m}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

async function httpBinary(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      // Try parse JSON for a better error message
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(buf.toString('utf8')); msg = j.error || j.message || msg; } catch (_) {}
      const err = new Error(`ME-QR binary fetch failed: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return { buffer: buf, contentType };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Create a Link QR as PNG bytes. Returns { pngBuffer, entryUID? }
 * Strategy: attempt format=png to get image bytes directly. If the API returns JSON,
 * we also attempt a JSON call to capture the entryUID for logging.
 */
async function createLinkQrPng({ link, title, qrOptions = {}, qrFrame, designType }) {
  if (!process.env.MEQR_API_TOKEN) {
    throw new Error('MEQR_API_TOKEN is not configured');
  }
  if (!link) throw new Error('link is required');
  const body = {
    qrFieldsData: { link },
    title: title || 'QR Code',
    format: 'png',
    designType: designType || DEFAULTS.DESIGN_TYPE,
    qrOptions: buildQrOptions(qrOptions, designType || DEFAULTS.DESIGN_TYPE),
    qrFrame: qrFrame || {
      name: DEFAULTS.FRAME_NAME,
      color: DEFAULTS.FRAME_COLOR,
      backgroundColor: DEFAULTS.FRAME_BG_COLOR,
      text: '',
    },
  };

  // First try PNG directly
  const { buffer, contentType } = await httpBinary(`${API_BASE}/api/v2/qr/link/create`, {
    method: 'POST',
    headers: { 'X-AUTH-TOKEN': process.env.MEQR_API_TOKEN, 'Content-Type': 'application/json', 'Accept': 'image/png' },
    body: JSON.stringify(body),
    timeoutMs: 25000,
  });

  // If we somehow got JSON, parse it and throw (we expect an image here)
  if (contentType.includes('application/json')) {
    let meta;
    try { meta = JSON.parse(buffer.toString('utf8')); } catch (_) { meta = null; }
    const entryUID = meta?.entryUID || meta?.uid || undefined;
    const err = new Error('ME-QR returned JSON when PNG was requested');
    err.meta = meta;
    err.entryUID = entryUID;
    throw err;
  }

  // Optionally get metadata (entryUID) for traceability
  let entryUID;
  try {
    const meta = await httpJson(`${API_BASE}/api/v2/qr/link/create`, {
      method: 'POST',
      headers: { 'X-AUTH-TOKEN': process.env.MEQR_API_TOKEN },
      body: { ...body, format: 'json' },
      timeoutMs: 15000,
    });
    entryUID = meta?.entryUID || meta?.uid || undefined;
  } catch (_) { /* non-critical */ }

  return { pngBuffer: buffer, entryUID };
}

module.exports = {
  createLinkQrPng,
  buildQrOptions,
};

/**
 * Fetch the list of available frame names from ME-QR OpenAPI JSON.
 * Returns an array like ["noFrame", "one", "two", ...].
 */
async function getFrameNames() {
  const now = Date.now();
  if (FRAME_ENUM_CACHE.list && now - FRAME_ENUM_CACHE.at < 10 * 60 * 1000) {
    return FRAME_ENUM_CACHE.list;
  }
  const doc = await httpJson(`${API_BASE}/api/doc.json`, { method: 'GET', timeoutMs: 20000 });
  const enumList = doc?.components?.schemas?.QrFrame2?.properties?.name?.enum;
  if (Array.isArray(enumList) && enumList.length) {
    FRAME_ENUM_CACHE = { at: now, list: enumList };
    return enumList;
  }
  throw new Error('Unable to load ME-QR frame enum list');
}

module.exports.getFrameNames = getFrameNames;
