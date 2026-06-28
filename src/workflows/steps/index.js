"use strict";

function createStepRegistry(steps) {
  return new Map(Object.entries(steps));
}

module.exports = { createStepRegistry };
