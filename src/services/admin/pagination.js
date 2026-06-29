"use strict";

function safeBounds(limit, offset, maxLimit = 100) {
  return {
    limit: Math.min(Math.max(parseInt(limit) || 50, 1), maxLimit),
    offset: Math.max(parseInt(offset) || 0, 0),
  };
}

module.exports = {
  safeBounds,
};
