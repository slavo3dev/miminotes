/// <reference types="chrome" />

import {
  registerAnalyticsMessageListener,
  trackInstalled,
  trackUpdated,
  trackStartup,
} from "./analytics/bg-analytics";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await trackInstalled();
  } else if (details.reason === "update") {
    await trackUpdated();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void trackStartup();
});

registerAnalyticsMessageListener();
