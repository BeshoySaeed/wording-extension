/**
 * Wording Feature Processor
 * Extracts and processes all text/wording content from Figma API response
 */

/**
 * Extract text content from Figma node tree
 * @param {Object} node - Figma node object
 * @param {Array} path - Current path in node hierarchy
 * @returns {Array} Array of text objects
 */
function extractTexts(node, path = []) {
  const texts = [];

  // Skip common UI sections
  if (path[1] === 'Navigation' || path[1] === 'Footer' || path[1] === 'Header' || path[1] === 'Sidebar') {
    return texts;
  }

  // Skip placeholder components
  if (node.name && (node.name.includes('Child component') || node.name.includes('This is a placeholder'))) {
    return texts;
  }

  // Extract text from characters field
  if (node.characters && node.name) {
    texts.push({
      path: [...path, node.name].join(' > '),
      name: node.name,
      text: node.characters,
      id: node.id
    });
  }

  // Extract TEXT type component properties
  if (node.componentProperties) {
    const currentPath = [...path, node.name].join(' > ');
    for (const [key, prop] of Object.entries(node.componentProperties)) {
      if (prop.type === 'TEXT' && prop.value) {
        texts.push({
          path: currentPath,
          name: node.name,
          text: prop.value,
          id: node.id,
          propertyKey: key
        });
      }
    }
  }

  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    const newPath = node.name ? [...path, node.name] : path;
    for (const child of node.children) {
      texts.push(...extractTexts(child, newPath));
    }
  }

  return texts;
}

/**
 * Convert path to meaningful key
 * @param {string} path - Path string like "Parent > Child > Text"
 * @returns {string} Normalized key
 */
function pathToKey(path) {
  const parts = path
    .toLowerCase()
    .replace(/[^a-z0-9\s>]/g, '')
    .split(' > ')
    .map(part => part.trim())
    .filter(part => part.length > 0);

  const relevantParts = parts.slice(-2);

  return relevantParts
    .join('-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

/**
 * Main processor: Extract wording from Figma API response
 * @param {Object} figmaApiResponse - Response from Figma API (contains nodes/children)
 * @returns {Object} Processed wording data {textsArray, keyValuePairs, stats}
 */
function processWordings(figmaApiResponse) {
  const allTexts = [];

  // Extract texts from all nodes in the response
  if (figmaApiResponse.nodes) {
    Object.values(figmaApiResponse.nodes).forEach(nodeWrapper => {
      if (nodeWrapper.document) {
        allTexts.push(...extractTexts(nodeWrapper.document));
      } else if (nodeWrapper.children) {
        nodeWrapper.children.forEach(child => {
          allTexts.push(...extractTexts(child));
        });
      }
    });
  } else if (figmaApiResponse.children) {
    // Fallback for direct children array
    figmaApiResponse.children.forEach(node => {
      allTexts.push(...extractTexts(node));
    });
  }

  // Convert to key-value pairs
  const textsObject = {};
  const keyCount = {};

  allTexts.forEach((item) => {
    let baseKey = pathToKey(item.path);

    if (keyCount[baseKey] !== undefined) {
      keyCount[baseKey]++;
      var key = `${baseKey}-${keyCount[baseKey]}`;
    } else {
      keyCount[baseKey] = 0;
      var key = baseKey;
    }

    textsObject[key] = {
      "std-headline": item.text,
    };
  });

  return {
    textsArray: allTexts,
    keyValuePairs: textsObject,
    stats: {
      totalTexts: allTexts.length,
      uniqueKeys: Object.keys(textsObject).length,
      processedAt: new Date().toISOString()
    }
  };
}

/**
 * Build a compact payload for AI processing.
 * Keeps only wording-relevant fields to reduce token usage.
 * @param {Object} figmaApiResponse
 * @param {Object} options
 * @returns {Object}
 */
function createAiPayload(figmaApiResponse, options = {}) {
  const wording = processWordings(figmaApiResponse);

  const entries = wording.textsArray
    .map((item) => ({
      path: item.path,
      name: item.name,
      text: String(item.text || '').trim(),
      source: item.propertyKey ? 'componentProperty' : 'characters'
    }))
    .filter((item) => item.text.length > 0);

  return {
    page: {
      fileId: options.fileId || null,
      pageId: options.pageId || null,
      pageName: options.pageName || null
    },
    stats: {
      totalTexts: entries.length,
      processedAt: wording.stats.processedAt
    },
    entries
  };
}

// Export for use in popup.js
if (typeof window !== 'undefined') {
  window.WordingProcessor = {
    processWordings,
    createAiPayload
  };
}
