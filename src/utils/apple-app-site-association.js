"use strict";

const APPLE_APP_SITE_ASSOCIATION = Object.freeze({
  applinks: {
    apps: [],
    details: [
      {
        appID: "5VCH6937XM.com.porizo.PorizoApp",
        paths: [
          "/play/*",
          "/s/*",
          "/poem/*",
          "/create*",
          "/verify-email*",
        ],
      },
    ],
  },
});

module.exports = { APPLE_APP_SITE_ASSOCIATION };
