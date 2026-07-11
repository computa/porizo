"use strict";

const APPLE_APP_SITE_ASSOCIATION = Object.freeze({
  applinks: {
    apps: [],
    details: [
      {
        appID: "5VCH6937XM.porizo.ios.app.PorizoApp",
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
  appclips: {
    apps: ["5VCH6937XM.porizo.ios.app.PorizoApp.Clip"],
  },
});

module.exports = { APPLE_APP_SITE_ASSOCIATION };
