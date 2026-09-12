// ==UserScript==
// @name         Marks PYQ Ideal Time
// @namespace    local.marks.ideal-time
// @version      1.0.0
// @description  shows ideal solve time for Marks PYQs and compares it with your actual time.
// @author       Hitz
// @match        https://*.getmarks.app/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const QUESTION_API_RE = /\/api\/v4\/questions\/([a-f0-9]{24})(?:[/?#]|$)/i;
  const STATE_API_RE = /\/api\/v3\/cs\/question\/([a-f0-9]{24})\/state(?:[/?#]|$)/i;
  const PAGE_QUESTION_RE = /\/question\/([a-f0-9]{24})(?:[/?#]|$)/i;
  const ANALYSIS_RE = /\/analysis(?:[/?#]|$)/i;
  const QUESTION_API_BASE = "https://production.getmarks.app/api/v4/questions/";

  const questionTimes = new Map();
  const answeredStats = new Map();
  const questionOpenedAt = new Map();
  let activeQuestionId = null;
  let lastUrl = location.href;
  const requestedQuestions = new Set();

  function parseUrl(value) {
    try {
      return new URL(String(value), location.origin);
    } catch {
      return null;
    }
  }

  function questionIdFromUrl(urlLike) {
    const url = parseUrl(urlLike);
    if (!url) return null;
    const text = url.pathname + url.search;
    return (
      text.match(QUESTION_API_RE)?.[1] ||
      text.match(STATE_API_RE)?.[1] ||
      text.match(PAGE_QUESTION_RE)?.[1] ||
      null
    );
  }

  function isAnalysisUrl(urlLike) {
    const url = parseUrl(urlLike);
    return Boolean(url && ANALYSIS_RE.test(url.pathname));
  }

  function readPayload(body) {
    if (!body) return null;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }
    if (body instanceof URLSearchParams) {
      return Object.fromEntries(body.entries());
    }
    if (body instanceof FormData) {
      return Object.fromEntries(body.entries());
    }
    return typeof body === "object" ? body : null;
  }

  async function readFetchPayload(input, init) {
    if (init?.body) return readPayload(init.body);
    if (!input || typeof input === "string" || typeof input.clone !== "function") return null;

    try {
      const text = await input.clone().text();
      return readPayload(text);
    } catch {
      return null;
    }
  }

  function secondsToClock(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function clockToSeconds(text) {
    const match = String(text || "").match(/\b(\d{1,2}):([0-5]\d)\b/);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function humanDelta(seconds) {
    const abs = Math.abs(Math.round(Number(seconds) || 0));
    const mins = Math.floor(abs / 60);
    const secs = abs % 60;
    if (mins && secs) return `${mins} min ${secs} sec`;
    if (mins) return `${mins} min`;
    return `${secs} sec`;
  }

  function crossedSlowerMinuteMark(idealSeconds, actualSeconds) {
    const ideal = Math.round(Number(idealSeconds) || 0);
    const actual = Math.round(Number(actualSeconds) || 0);
    const boundary = (Math.floor(ideal / 60) + 1) * 60;
    return ideal > 0 && ideal < boundary && actual >= boundary ? boundary : null;
  }

  function crossedFasterMinuteMark(idealSeconds, actualSeconds) {
    const ideal = Math.round(Number(idealSeconds) || 0);
    const actual = Math.round(Number(actualSeconds) || 0);
    const boundary = Math.floor(ideal / 60) * 60;
    return boundary > 0 && actual < boundary && ideal >= boundary ? boundary : null;
  }

  function subMinuteLabel(boundarySeconds) {
    const mins = Math.round(boundarySeconds / 60);
    return `sub-${mins}-minute`;
  }

  function paceFeedback(deltaSeconds, idealSeconds, outcome) {
    const delta = Math.round(Number(deltaSeconds) || 0);
    const ideal = Math.max(1, Number(idealSeconds) || 1);
    const absDelta = Math.abs(delta);
    const actual = ideal + delta;
    const nearBand = Math.min(18, Math.max(10, Math.round(ideal * 0.08)));
    const strongBand = Math.max(30, Math.round(ideal * 0.2));
    const outcomeText =
      outcome === "wrong" ? " but got it wrong" : outcome === "right" ? " and got it right" : "";
    const slowerMinuteMark = crossedSlowerMinuteMark(ideal, actual);
    const fasterMinuteMark = crossedFasterMinuteMark(ideal, actual);

    if (absDelta <= nearBand) {
      if (slowerMinuteMark) {
        return {
          tone: "watch",
          text: `Close to the ideal pace${outcomeText}, but just missed the ${subMinuteLabel(
            slowerMinuteMark
          )} mark. Tiny trim next time.`,
        };
      }

      return {
        tone: "steady",
        text: `Right around the ideal pace${outcomeText}. Nice, this is the speed zone to repeat.`,
      };
    }

    if (delta < 0) {
      if (fasterMinuteMark) {
        return {
          tone: "good",
          text: `You were ${humanDelta(delta)} quicker and cleared the ${subMinuteLabel(
            fasterMinuteMark
          )} mark${outcomeText}. Great pace.`,
        };
      }

      return {
        tone: "good",
        text:
          absDelta >= strongBand
            ? `You were ${humanDelta(delta)} quicker than the ideal pace${outcomeText}. Excellent speed.`
            : `You were ${humanDelta(delta)} quicker than the ideal pace${outcomeText}. Good pace.`,
      };
    }

    if (slowerMinuteMark) {
      return {
        tone: absDelta >= strongBand ? "slow" : "watch",
        text: `You were ${humanDelta(delta)} over and crossed the ${subMinuteLabel(
          slowerMinuteMark
        )} mark${outcomeText}. Worth tightening.`,
      };
    }

    return {
      tone: absDelta >= strongBand ? "slow" : "watch",
      text:
        absDelta >= strongBand
          ? `You took ${humanDelta(delta)} longer than the ideal pace${outcomeText}. Aim to trim this next time.`
          : `You were ${humanDelta(delta)} over the ideal pace${outcomeText}. Close, but worth tightening.`,
    };
  }

  function storeQuestionTime(questionId, json) {
    const question = json?.data?.question;
    const time = Number(question?.approximateTimeRequired);
    if (!questionId || !Number.isFinite(time) || time <= 0) return;
    activeQuestionId = questionId;
    questionTimes.set(questionId, time);
    scheduleRender(questionId);
  }

  function setActiveQuestion(questionId) {
    if (!questionId) return;
    if (activeQuestionId !== questionId) {
      document.querySelector("#marks-ideal-time-panel")?.remove();
      questionOpenedAt.set(questionId, Date.now());
    }
    if (!questionOpenedAt.has(questionId)) questionOpenedAt.set(questionId, Date.now());
    activeQuestionId = questionId;
    ensureQuestionTime(questionId);
    scheduleRender(questionId);
  }

  function storeAnswer(payload) {
    if (!payload || payload.status !== "answered") return;
    const questionId = activeQuestionId;
    if (!questionId) return;
    answeredStats.set(questionId, {
      timeTaken: Number(payload.timeTaken),
      source: "marks",
      answeredAt: Date.now(),
    });
    scheduleRender(questionId);
  }

  function pageLooksSolved() {
    const bodyText = document.body?.innerText || "";
    const solutionVisible = /Marks Solution|Solutions by Others|Solution:/i.test(bodyText);
    const markedVisible = /You Marked/i.test(bodyText);
    return solutionVisible || markedVisible;
  }

  function answerOutcome() {
    const bodyText = document.body?.innerText || "";
    if (/Solve Again/i.test(bodyText)) return "wrong";
    if (/You Marked|Marks Solution|Solutions by Others|Solution:/i.test(bodyText)) return "right";
    return null;
  }

  function readVisibleTakenSeconds() {
    const header = document.querySelector(".question-header");
    const fromHeader = clockToSeconds(header?.innerText || "");
    if (Number.isFinite(fromHeader)) return fromHeader;

    const bodyClone = document.body?.cloneNode(true);
    bodyClone?.querySelector("#marks-ideal-time-panel")?.remove();
    return clockToSeconds(bodyClone?.innerText || "");
  }

  function markAnsweredFromPage() {
    const questionId = activeQuestionId || questionIdFromUrl(location.href);
    if (!questionId) return;

    if (!pageLooksSolved()) return;

    const visibleTimeTaken = readVisibleTakenSeconds();
    const existing = answeredStats.get(questionId);
    if (
      existing &&
      existing.source === "visible" &&
      existing.outcome === answerOutcome() &&
      existing.timeTaken === visibleTimeTaken
    ) {
      return;
    }

    answeredStats.set(questionId, {
      timeTaken: visibleTimeTaken,
      source: "visible",
      outcome: answerOutcome(),
      answeredAt: Date.now(),
    });
    scheduleRender(questionId);
  }

  function buildPanel(questionId) {
    const idealSeconds = questionTimes.get(questionId);
    const answer = answeredStats.get(questionId);
    if (!idealSeconds || !answer) return null;

    const timeTaken = Number(answer.timeTaken);
    const hasTaken = Number.isFinite(timeTaken) && timeTaken >= 0;
    const delta = hasTaken ? timeTaken - idealSeconds : 0;
    const feedback = hasTaken ? paceFeedback(delta, idealSeconds, answer.outcome) : null;

    const panel = document.createElement("section");
    panel.id = "marks-ideal-time-panel";
    panel.setAttribute("aria-label", "Ideal time to solve");
    panel.innerHTML = `
      <div class="mit-main">
        <span class="mit-label">Ideal time to solve</span>
        <strong class="mit-time">${secondsToClock(idealSeconds)}</strong>
      </div>
      <div class="mit-delta ${feedback?.tone || "steady"}">${hasTaken ? feedback.text : "Answer time was not available for this attempt."}</div>
      ${hasTaken ? `<div class="mit-note">You took ${secondsToClock(timeTaken)}</div>` : ""}
    `;
    return panel;
  }

  function likelyQuestionContainer() {
    const existing = document.querySelector("#marks-ideal-time-panel");
    if (existing?.parentElement) return existing.parentElement;

    const options = document.querySelector(".question-options");
    const optionsBlock = options?.parentElement;
    if (optionsBlock) return optionsBlock;

    const selectors = [
      ".question-body",
      '[data-testid*="question" i]',
      '[class*="question" i]',
      '[id*="question" i]',
      "article",
      "main",
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const candidate = nodes.find((node) => {
        const rect = node.getBoundingClientRect();
        const text = (node.textContent || "").trim();
        return rect.width > 280 && rect.height > 80 && text.length > 30;
      });
      if (candidate) return candidate;
    }

    return document.body;
  }

  let renderTimer = 0;
  function scheduleRender(questionId = activeQuestionId) {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => render(questionId), 80);
  }

  function render(questionId = activeQuestionId) {
    if (!questionId || !questionTimes.has(questionId) || !answeredStats.has(questionId)) return;
    if (!pageLooksSolved()) {
        document.querySelector("#marks-ideal-time-panel")?.remove();
      answeredStats.delete(questionId);
      return;
    }

    const host = likelyQuestionContainer();
    if (!host) return;

    const oldPanel = document.querySelector("#marks-ideal-time-panel");
    const newPanel = buildPanel(questionId);
    if (!newPanel) return;

    if (oldPanel) oldPanel.replaceWith(newPanel);
    else {
      const options = host.querySelector(".question-options");
      if (options?.nextSibling) host.insertBefore(newPanel, options.nextSibling);
      else host.appendChild(newPanel);
    }
  }

  function ensureQuestionTime(questionId) {
    if (!questionId || questionTimes.has(questionId) || requestedQuestions.has(questionId)) return;
    requestedQuestions.add(questionId);

    originalFetch(`${QUESTION_API_BASE}${questionId}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then((response) => response.json())
      .then((json) => storeQuestionTime(questionId, json))
      .catch(() => requestedQuestions.delete(questionId));
  }

  function syncFromLocation() {
    const questionId = questionIdFromUrl(location.href);
    if (questionId) setActiveQuestion(questionId);
  }

  function installStyles() {
    if (document.querySelector("#marks-ideal-time-style")) return;
    const style = document.createElement("style");
    style.id = "marks-ideal-time-style";
    style.textContent = `
      #marks-ideal-time-panel {
        box-sizing: border-box;
        width: fit-content;
        min-width: min(430px, 100%);
        max-width: 620px;
        margin: 18px auto 8px;
        padding: 13px 16px 14px;
        border: 1px solid rgba(48, 67, 90, 0.95);
        border-radius: 8px;
        background: #151b24;
        color: #e5e7eb;
        font-family: inherit;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }
      #marks-ideal-time-panel .mit-main {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      #marks-ideal-time-panel .mit-label {
        font-size: 13px;
        font-weight: 600;
        color: #b6c3d1;
      }
      #marks-ideal-time-panel .mit-time {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 10px;
        border: 1px solid rgba(59, 130, 246, 0.28);
        border-radius: 999px;
        background: rgba(21, 137, 238, 0.10);
        font-size: 18px;
        line-height: 1;
        color: #f8fafc;
        font-variant-numeric: tabular-nums;
      }
      #marks-ideal-time-panel .mit-delta {
        margin-top: 9px;
        font-size: 13px;
        line-height: 1.35;
        font-weight: 600;
        text-align: center;
      }
      #marks-ideal-time-panel .mit-delta.good { color: #36e17f; }
      #marks-ideal-time-panel .mit-delta.steady { color: #facc15; }
      #marks-ideal-time-panel .mit-delta.watch { color: #fb923c; }
      #marks-ideal-time-panel .mit-delta.slow { color: #f87171; }
      #marks-ideal-time-panel .mit-note {
        margin-top: 5px;
        font-size: 12px;
        line-height: 1.35;
        text-align: center;
        color: #8f9baa;
      }
      @media (max-width: 520px) {
        #marks-ideal-time-panel {
          width: 100%;
          min-width: 0;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === "string" ? input : input?.url;
    const questionId = questionIdFromUrl(url);
    const analysis = isAnalysisUrl(url);

    if (questionId) setActiveQuestion(questionId);

    if (analysis) {
      const payload = await readFetchPayload(input, init);
      storeAnswer(payload);
    }

    const response = await originalFetch.apply(this, args);

    if (questionId && QUESTION_API_RE.test(parseUrl(url)?.pathname || "")) {
      response
        .clone()
        .json()
        .then((json) => storeQuestionTime(questionId, json))
        .catch(() => {});
    } else if (questionId) {
      setActiveQuestion(questionId);
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mitUrl = url;
    this.__mitQuestionId = questionIdFromUrl(url);
    this.__mitIsAnalysis = isAnalysisUrl(url);
    if (this.__mitQuestionId) setActiveQuestion(this.__mitQuestionId);
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__mitIsAnalysis) storeAnswer(readPayload(body));

    this.addEventListener("load", () => {
      const questionId = this.__mitQuestionId;
      if (!questionId) return;

      const url = parseUrl(this.__mitUrl);
      if (url && QUESTION_API_RE.test(url.pathname)) {
        try {
          storeQuestionTime(questionId, JSON.parse(this.responseText));
        } catch {}
      } else {
        setActiveQuestion(questionId);
      }
    });

    return originalSend.call(this, body);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        installStyles();
        syncFromLocation();
      },
      { once: true }
    );
  } else {
    installStyles();
    syncFromLocation();
  }

  new MutationObserver(() => {
    installStyles();
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncFromLocation();
    }
    markAnsweredFromPage();
    scheduleRender();
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("popstate", syncFromLocation);
  window.setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncFromLocation();
    }
    markAnsweredFromPage();
  }, 1000);
})();
