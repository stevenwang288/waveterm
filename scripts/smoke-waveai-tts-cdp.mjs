// Smoke test: launch WAVE with --remote-debugging-port and drive Wave AI + TTS via CDP.
//
// This script is intentionally dependency-light and uses the existing "ws" dependency.
//
// Usage:
//   node scripts/smoke-waveai-tts-cdp.mjs --port 9223 --message "你好"
//
// Exit codes:
//   0 = Wave AI returned an assistant message and TTS was triggered (speechSynthesis or audio.play)
//   1 = failure

import WebSocket from "ws";

function parseArgs(argv) {
    const args = new Map();
    for (let i = 2; i < argv.length; i++) {
        const raw = argv[i];
        if (!raw.startsWith("--")) {
            continue;
        }
        const key = raw.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
            args.set(key, "true");
            continue;
        }
        args.set(key, next);
        i++;
    }
    return args;
}

const args = parseArgs(process.argv);
const port = Number(args.get("port") || "9223");
const message = String(args.get("message") || "你好");
const timeoutMs = Number(args.get("timeout-ms") || "180000");
const connectTimeoutMs = Number(args.get("connect-timeout-ms") || "15000");
const requestTimeoutMs = Number(args.get("request-timeout-ms") || "20000");
const scenario = String(args.get("scenario") || "waveai"); // waveai | settings | terminal

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { timeoutMs: fetchTimeoutMs = 5000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.json();
}

async function waitForTargets(baseUrl, timeout) {
    const deadline = Date.now() + timeout;
    let lastErr = null;
    while (Date.now() < deadline) {
        try {
            const list = await fetchJson(`${baseUrl}/json/list`, { timeoutMs: 2500 });
            if (Array.isArray(list) && list.length > 0) {
                return list;
            }
        } catch (e) {
            lastErr = e;
        }
        await sleep(150);
    }
    throw lastErr || new Error("timed out waiting for CDP targets");
}

function listPageTargets(targets) {
    const pages = targets.filter((t) => t && t.type === "page" && typeof t.webSocketDebuggerUrl === "string");
    return pages.filter((t) => !String(t.url || "").startsWith("devtools://"));
}

class CDPClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
    }

    async connect() {
        this.ws = new WebSocket(this.wsUrl);
        this.ws.on("message", (data) => {
            let msg;
            try {
                msg = JSON.parse(String(data));
            } catch {
                return;
            }
            if (msg && typeof msg.id === "number") {
                const pending = this.pending.get(msg.id);
                if (!pending) {
                    return;
                }
                this.pending.delete(msg.id);
                if (msg.error) {
                    pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                } else {
                    pending.resolve(msg.result);
                }
            }
        });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timed out connecting to ${this.wsUrl}`)), connectTimeoutMs);
            this.ws.on("open", () => {
                clearTimeout(timer);
                resolve();
            });
            this.ws.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    async send(method, params, timeoutOverrideMs) {
        const id = this.nextId++;
        const payload = { id, method, params: params || {} };
        const timeout = Number.isFinite(timeoutOverrideMs) ? timeoutOverrideMs : requestTimeoutMs;
        const p = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timed out waiting for ${method} response`));
            }, timeout);
            this.pending.set(id, {
                resolve: (val) => {
                    clearTimeout(timer);
                    resolve(val);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            });
        });
        this.ws.send(JSON.stringify(payload));
        return await p;
    }

    async evaluate(expression, { awaitPromise = true } = {}) {
        const result = await this.send(
            "Runtime.evaluate",
            {
            expression,
            awaitPromise,
            returnByValue: true,
            },
            timeoutMs + 30000
        );
        if (result?.exceptionDetails) {
            const desc = result.exceptionDetails?.exception?.description || "Runtime.evaluate exception";
            throw new Error(desc);
        }
        return result?.result?.value;
    }

    close() {
        try {
            this.ws?.close();
        } catch {
            // ignore
        }
    }
}

async function main() {
    const baseUrl = `http://127.0.0.1:${port}`;
    const targets = await waitForTargets(baseUrl, timeoutMs);
    const pageTargets = listPageTargets(targets);
    if (pageTargets.length === 0) {
        throw new Error(`No page targets found on ${baseUrl}`);
    }

    const failures = [];
    for (const candidate of pageTargets) {
        const cdp = new CDPClient(candidate.webSocketDebuggerUrl);
        await cdp.connect();
        try {
            await cdp.send("Runtime.enable");

            // Install one-time hooks to detect speech playback.
            await cdp.evaluate(String.raw`(() => {
  if (!window.__waveTtsSmoke) {
    window.__waveTtsSmoke = { speechSynthesisCalls: [], audioPlayCalls: [], speechRequests: [], errors: [] };
    try {
      if (window.speechSynthesis && typeof window.speechSynthesis.speak === "function") {
        const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = (utterance) => {
          try {
            const text = utterance && typeof utterance.text === "string" ? utterance.text : "";
            window.__waveTtsSmoke.speechSynthesisCalls.push({ ts: Date.now(), text });
          } catch {}
          return origSpeak(utterance);
        };
      }
    } catch (e) {
      window.__waveTtsSmoke.errors.push({ where: "hook:speechSynthesis", error: String(e) });
    }

    try {
      const api = window.api;
      if (api && typeof api.speechRequest === "function") {
        const origReq = api.speechRequest.bind(api);
        api.speechRequest = async (req) => {
          try {
            const url = req && typeof req.url === "string" ? req.url : "";
            const body = req && typeof req.body === "string" ? req.body : "";
            let input = null;
            try { input = JSON.parse(body || "{}")?.input ?? null; } catch {}
            window.__waveTtsSmoke.speechRequests.push({ ts: Date.now(), url, input, bodyLen: body.length });
          } catch {}
          return await origReq(req);
        };
      }
    } catch (e) {
      window.__waveTtsSmoke.errors.push({ where: "hook:speechRequest", error: String(e) });
    }

    try {
      if (typeof window.fetch === "function") {
        const origFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          try {
            const url =
              typeof input === "string" ? input : (input && typeof input.url === "string" ? input.url : "");
            const method = (init && typeof init.method === "string" ? init.method : "") || "";
            const body = init && typeof init.body === "string" ? init.body : "";
            if (method.toUpperCase() === "POST" && /audio\/speech/i.test(url) && body) {
              let parsedInput = null;
              try { parsedInput = JSON.parse(body || "{}")?.input ?? null; } catch {}
              window.__waveTtsSmoke.speechRequests.push({
                ts: Date.now(),
                url,
                input: parsedInput,
                bodyLen: body.length,
              });
            }
          } catch {}
          return await origFetch(input, init);
        };
      }
    } catch (e) {
      window.__waveTtsSmoke.errors.push({ where: "hook:fetch", error: String(e) });
    }

    try {
      const origPlay = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function() {
        try {
          window.__waveTtsSmoke.audioPlayCalls.push({ ts: Date.now(), src: String(this?.src || "") });
        } catch {}
        return origPlay.apply(this, arguments);
      };
    } catch (e) {
      window.__waveTtsSmoke.errors.push({ where: "hook:audioPlay", error: String(e) });
    }
  }
  return { ok: true };
})()`);

            const findInputExpr = String.raw`(() => {
  const textarea =
    document.querySelector('textarea[placeholder="Ask Wave AI anything..."]') ||
    document.querySelector('textarea[placeholder="Continue..."]') ||
    document.querySelector('textarea[placeholder="What would you like to build..."]');
  if (textarea) {
    return { found: true, placeholder: textarea.getAttribute("placeholder") || "", disabled: !!textarea.disabled };
  }
  const placeholders = Array.from(document.querySelectorAll("textarea"))
    .map((t) => t.getAttribute("placeholder") || "")
    .slice(0, 20);
  return {
    found: false,
    haveSparkles: !!document.querySelector("i.fa-sparkles"),
    placeholders,
    textareaCount: document.querySelectorAll("textarea").length,
  };
})()`;

            if (scenario === "terminal") {
                const expectedText = message.trim() || "smoke terminal reply";

                // Best-effort: disable global autoplay (AI panel) to avoid unrelated speech events,
                // while keeping speech enabled for terminal autoplay.
                await cdp.evaluate(String.raw`(async () => {
  try {
    if (window.RpcApi?.SetConfigCommand && window.TabRpcClient) {
      await window.RpcApi.SetConfigCommand(window.TabRpcClient, {
        "speech:enabled": true,
        "speech:autoplay": false,
        "speech:provider": "local",
        "speech:localengine": "edge",
        "speech:model": "edge-tts",
      });
    }
  } catch {}
  return { ok: true };
})()`);

                const termDeadline = Date.now() + 60000;
                let termInfo = null;
                while (Date.now() < termDeadline) {
                    termInfo = await cdp.evaluate(String.raw`(() => {
  const termWrap = window.term;
  const hasTerm = !!termWrap && !!termWrap.terminal;
  return {
    hasTerm,
    loaded: !!termWrap?.loaded,
    bufferLines: termWrap?.terminal?.buffer?.active?.length ?? null,
  };
})()`);
                    if (termInfo?.hasTerm && termInfo?.loaded) {
                        break;
                    }
                    await sleep(500);
                }

                if (!termInfo?.hasTerm) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "terminal not found (window.term missing)",
                        details: termInfo,
                    });
                    continue;
                }

                // Clear previous calls so we only observe this scenario.
                await cdp.evaluate(String.raw`(() => {
  if (window.__waveTtsSmoke) {
    window.__waveTtsSmoke.speechSynthesisCalls = [];
    window.__waveTtsSmoke.audioPlayCalls = [];
    window.__waveTtsSmoke.speechRequests = [];
    window.__waveTtsSmoke.errors = [];
  }
  return { ok: true };
})()`);

                // Turn on TERMINAL auto-play (local per-block toggle) by clicking the header chip.
                const enableAutoRes = await cdp.evaluate(String.raw`(() => {
  try {
    const termWrap = window.term;
    const blockId = termWrap?.blockId || "";
    if (!blockId) {
      return { ok: false, error: "window.term.blockId missing" };
    }
    const root = document.querySelector('[data-blockid="' + blockId + '"]');
    if (!root) {
      return { ok: false, error: "terminal block root not found", blockId };
    }
    const btn = root.querySelector(".block-frame-speech-mode");
    if (!btn) {
      return { ok: false, error: "terminal speech-mode chip not found", blockId };
    }
    const before = String(btn.textContent || "").trim();
    const isAuto = before.includes("自动") || before.toUpperCase().includes("AUTO");
    if (!isAuto && typeof btn.click === "function") {
      btn.click();
    }
    return { ok: true, blockId, before, clicked: !isAuto };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`);

                if (!enableAutoRes?.ok) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: enableAutoRes?.error || "failed to enable terminal autoplay",
                        details: enableAutoRes,
                    });
                    continue;
                }

                const chipDeadline = Date.now() + 8000;
                let chipState = null;
                while (Date.now() < chipDeadline) {
                    chipState = await cdp.evaluate(String.raw`(() => {
  try {
    const termWrap = window.term;
    const blockId = termWrap?.blockId || "";
    const root = blockId ? document.querySelector('[data-blockid="' + blockId + '"]') : null;
    const btn = root ? root.querySelector(".block-frame-speech-mode") : null;
    const text = btn ? String(btn.textContent || "").trim() : "";
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`);
                    const chipText = String(chipState?.text || "");
                    if (chipText.includes("自动") || chipText.toUpperCase().includes("AUTO")) {
                        break;
                    }
                    await sleep(250);
                }

                const chipTextFinal = String(chipState?.text || "");
                if (!(chipTextFinal.includes("自动") || chipTextFinal.toUpperCase().includes("AUTO"))) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "terminal autoplay chip did not switch to auto",
                        details: { enableAutoRes, chipState },
                    });
                    continue;
                }

                // Terminal autoplay should NOT speak historical content immediately when you enable it.
                const quietDeadline = Date.now() + 2500;
                let quietState = null;
                while (Date.now() < quietDeadline) {
                    quietState = await cdp.evaluate(String.raw`(() => ({
  speechSynthesisCalls: window.__waveTtsSmoke?.speechSynthesisCalls || [],
  audioPlayCalls: window.__waveTtsSmoke?.audioPlayCalls || [],
  speechRequests: window.__waveTtsSmoke?.speechRequests || [],
  hookErrors: window.__waveTtsSmoke?.errors || [],
}))()`);
                    const anyTts =
                        (quietState?.speechSynthesisCalls?.length || 0) > 0 ||
                        (quietState?.audioPlayCalls?.length || 0) > 0 ||
                        (quietState?.speechRequests?.length || 0) > 0;
                    if (anyTts) {
                        break;
                    }
                    await sleep(250);
                }

                const quietHadTts =
                    (quietState?.speechSynthesisCalls?.length || 0) > 0 ||
                    (quietState?.audioPlayCalls?.length || 0) > 0 ||
                    (quietState?.speechRequests?.length || 0) > 0;
                if (quietHadTts) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "terminal autoplay spoke historical content immediately after enabling",
                        details: { enableAutoRes, chipState, tts: quietState },
                    });
                    continue;
                }

                // Force shell integration state to null so the terminal block uses lastOutputTs-based payload refresh.
                await cdp.evaluate(String.raw`(() => {
  try {
    const termWrap = window.term;
    if (termWrap && window.globalStore?.set && termWrap.shellIntegrationStatusAtom) {
      window.globalStore.set(termWrap.shellIntegrationStatusAtom, null);
    }
  } catch {}
  return { ok: true };
})()`);

                // Clear again after toggling auto to isolate the injected reply.
                await cdp.evaluate(String.raw`(() => {
  if (window.__waveTtsSmoke) {
    window.__waveTtsSmoke.speechSynthesisCalls = [];
    window.__waveTtsSmoke.audioPlayCalls = [];
    window.__waveTtsSmoke.speechRequests = [];
    window.__waveTtsSmoke.errors = [];
  }
  return { ok: true };
})()`);

                // Inject a Codex-like prompt + final bullet reply + trailing prompt boundary into the terminal scrollback.
                const injectRes = await cdp.evaluate(String.raw`(() => {
  try {
    const termWrap = window.term;
    if (!termWrap || typeof termWrap.handleNewFileSubjectData !== "function") {
      return { ok: false, error: "window.term.handleNewFileSubjectData missing" };
    }

    const expected = ${JSON.stringify(expectedText)};
    const content = ["› smoke question", "• " + expected, "›"].join("\\r\\n") + "\\r\\n";
    const bytes = new TextEncoder().encode(content);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const data64 = btoa(bin);
    termWrap.handleNewFileSubjectData({ fileop: "append", data64 });
    return { ok: true, expected, injectedBytes: bytes.length };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`);

                if (!injectRes?.ok) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: injectRes?.error || "failed to inject terminal scrollback data",
                    });
                    continue;
                }

                // Wait for TTS hook to fire and validate the spoken text.
                const ttsDeadline = Date.now() + 30000;
                let state = null;
                while (Date.now() < ttsDeadline) {
                    state = await cdp.evaluate(String.raw`(() => ({
  speechSynthesisCalls: window.__waveTtsSmoke?.speechSynthesisCalls || [],
  audioPlayCalls: window.__waveTtsSmoke?.audioPlayCalls || [],
  speechRequests: window.__waveTtsSmoke?.speechRequests || [],
  hookErrors: window.__waveTtsSmoke?.errors || [],
}))()`);
                    const synthCalls = state?.speechSynthesisCalls || [];
                    const synthTexts = synthCalls.map((c) => (c && typeof c.text === "string" ? c.text : ""));
                    const reqCalls = state?.speechRequests || [];
                    const reqTexts = reqCalls.map((c) => (c && typeof c.input === "string" ? c.input : ""));
                    const texts = synthTexts.length > 0 ? synthTexts : reqTexts;
                    if (texts.includes(expectedText)) {
                        break;
                    }
                    await sleep(300);
                }

                const synthCalls = state?.speechSynthesisCalls || [];
                const synthTexts = synthCalls.map((c) => (c && typeof c.text === "string" ? c.text : ""));
                const reqCalls = state?.speechRequests || [];
                const reqTexts = reqCalls.map((c) => (c && typeof c.input === "string" ? c.input : ""));

                const observedKind = synthTexts.length > 0 ? "speechSynthesis" : "speechRequest";
                const texts = synthTexts.length > 0 ? synthTexts : reqTexts;

                const spokenMatch = texts.includes(expectedText);
                const spokeOnce = texts.length === 1 && texts[0] === expectedText;

                if (!spokenMatch) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "terminal autoplay did not speak expected text",
                        details: { expectedText, observedKind, texts, tts: state },
                    });
                    continue;
                }
                if (!spokeOnce) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "terminal autoplay spoke unexpected number of utterances",
                        details: { expectedText, observedKind, texts, tts: state },
                    });
                    continue;
                }

                console.log(
                    JSON.stringify(
                        {
                            cdpTarget: {
                                title: candidate.title,
                                url: candidate.url,
                                ws: candidate.webSocketDebuggerUrl,
                            },
                        },
                        null,
                        2
                    )
                );
                console.log(JSON.stringify({ ok: true, scenario, expectedText, tts: state }, null, 2));
                return;
            }

            if (scenario === "settings") {
                const openDeadline = Date.now() + 60000;
                let opened = false;
                while (Date.now() < openDeadline) {
                    const res = await cdp.evaluate(String.raw`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // Ensure the WaveAIModel singleton exists by opening the AI side panel once.
    try {
      const icon = document.querySelector("i.fa-sparkles");
      const btn = icon ? icon.parentElement : null;
      if (btn && typeof btn.click === "function") {
        btn.click();
      }
    } catch {}
    try { window.api?.setWaveAIOpen?.(true); } catch {}

    for (let i = 0; i < 40; i++) {
      if (window.WaveAIModel?.openWaveAIConfig) {
        await window.WaveAIModel.openWaveAIConfig();
        return { opened: true };
      }
      await sleep(100);
    }
    return { opened: false, reason: "WaveAIModel.openWaveAIConfig missing" };
  } catch (e) {
    return { opened: false, error: String(e) };
  }
})()`);
                    if (res?.opened) {
                        opened = true;
                        break;
                    }
                    await sleep(500);
                }
                if (!opened) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "failed to open waveconfig",
                    });
                    continue;
                }

                // Switch to Speech file entry (label is default "Speech" even under zh-CN).
                const selectDeadline = Date.now() + 60000;
                let selected = false;
                while (Date.now() < selectDeadline) {
                    const res = await cdp.evaluate(String.raw`(() => {
  const items = Array.from(document.querySelectorAll('div[class*="cursor-pointer"][class*="border-b"]'));
  const item = items.find((el) => {
    const name = el.querySelector('div[class*="whitespace-nowrap"]');
    return name && (name.textContent || "").trim() === "Speech";
  });
  if (item && typeof item.click === "function") {
    item.click();
    return { clicked: true };
  }
  return { clicked: false };
})()`);
                    if (res?.clicked) {
                        selected = true;
                        break;
                    }
                    await sleep(250);
                }
                if (!selected) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "failed to select Speech config view",
                    });
                    continue;
                }

                // Click the "播放测试" button.
                const playDeadline = Date.now() + 60000;
                let clickedPlay = false;
                let playDebug = null;
                while (Date.now() < playDeadline) {
                    const res = await cdp.evaluate(String.raw`(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const playBtn = buttons.find((btn) => (btn.getAttribute("title") || "").includes("播放测试") || (btn.textContent || "").includes("播放测试"));
  if (playBtn && typeof playBtn.click === "function") {
    playBtn.click();
    return { clicked: true };
  }
  const sample = buttons.slice(0, 30).map((btn) => ({ title: btn.getAttribute("title") || "", text: (btn.textContent || "").trim().slice(0, 40) }));
  return { clicked: false, sample };
})()`);
                    if (res?.clicked) {
                        clickedPlay = true;
                        break;
                    }
                    playDebug = res?.sample || playDebug;
                    await sleep(250);
                }
                if (!clickedPlay) {
                    failures.push({
                        title: candidate.title,
                        url: candidate.url,
                        error: "failed to click play test button",
                        details: { buttons: playDebug },
                    });
                    continue;
                }

                // Wait for TTS hook to fire.
                const ttsDeadline = Date.now() + 15000;
                let state = null;
                while (Date.now() < ttsDeadline) {
                    state = await cdp.evaluate(String.raw`(() => ({
  speechSynthesisCalls: window.__waveTtsSmoke?.speechSynthesisCalls?.length || 0,
  audioPlayCalls: window.__waveTtsSmoke?.audioPlayCalls?.length || 0,
  lastSpeechSynthesisText: window.__waveTtsSmoke?.speechSynthesisCalls?.slice(-1)?.[0]?.text || null,
  lastAudioSrc: window.__waveTtsSmoke?.audioPlayCalls?.slice(-1)?.[0]?.src || null,
  hookErrors: window.__waveTtsSmoke?.errors || [],
}))()`);
                    const ok = (state?.speechSynthesisCalls || 0) > 0 || (state?.audioPlayCalls || 0) > 0;
                    if (ok) {
                        console.log(
                            JSON.stringify(
                                {
                                    cdpTarget: {
                                        title: candidate.title,
                                        url: candidate.url,
                                        ws: candidate.webSocketDebuggerUrl,
                                    },
                                },
                                null,
                                2
                            )
                        );
                        console.log(JSON.stringify({ ok: true, scenario, tts: state }, null, 2));
                        return;
                    }
                    await sleep(300);
                }

                failures.push({ title: candidate.title, url: candidate.url, result: { ok: false, scenario, tts: state } });
                continue;
            }

            let inputInfo = null;
            let clickedAi = false;
            const openDeadline = Date.now() + 60000;
            while (Date.now() < openDeadline) {
                inputInfo = await cdp.evaluate(findInputExpr);
                if (inputInfo?.found) {
                    break;
                }

                // Click the AI toggle once (when it exists) so the side panel view becomes "ai".
                if (!clickedAi) {
                    const clickRes = await cdp.evaluate(String.raw`(() => {
  try {
    const icon = document.querySelector("i.fa-sparkles");
    const btn = icon ? icon.parentElement : null;
    if (btn && typeof btn.click === "function") {
      btn.click();
      return { clicked: true };
    }
    return { clicked: false, present: !!icon };
  } catch (e) {
    return { clicked: false, error: String(e) };
  }
})()`);
                    if (clickRes?.clicked) {
                        clickedAi = true;
                    }
                }

                // Best-effort focus helper.
                await cdp.evaluate(String.raw`(() => {
  try { window.WaveAIModel?.focusInput?.(); } catch {}
  try { window.api?.setWaveAIOpen?.(true); } catch {}
  return { ok: true };
})()`);

                await sleep(500);
            }

            if (!inputInfo?.found) {
                failures.push({
                    title: candidate.title,
                    url: candidate.url,
                    error: "AI input textarea not found",
                    details: inputInfo,
                });
                continue;
            }

            const submitRes = await cdp.evaluate(String.raw`(async () => {
  const model = window.WaveAIModel;
  if (!model || typeof model.handleSubmit !== "function") {
    return { ok: false, error: "WaveAIModel.handleSubmit not available" };
  }

  // Prefer model-level submit so we don't depend on React event timing.
  try {
    if (typeof model.appendText === "function") {
      model.appendText(${JSON.stringify(message)}, false);
    }
  } catch {}

  try {
    await model.handleSubmit();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`);

            if (!submitRes?.ok) {
                failures.push({
                    title: candidate.title,
                    url: candidate.url,
                    error: submitRes?.error || "failed to submit message",
                });
                continue;
            }

            const readStateExpr = String.raw`(() => {
  const status = window.aichatstatus ?? null;
  const msgs = Array.isArray(window.aichatmessages) ? window.aichatmessages : [];
  let lastAssistant = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === "assistant") { lastAssistant = msgs[i]; break; }
  }
  const text = (lastAssistant?.parts || [])
    .filter((p) => p && p.type === "text")
    .map((p) => p.text || "")
    .join("\\n\\n")
    .trim();

  let errorText = null;
  try {
    const closeBtn = document.querySelector('[aria-label="Close error"]');
    const errRoot = closeBtn ? closeBtn.closest("div") : null;
    errorText = errRoot ? String(errRoot.textContent || "").trim().slice(0, 400) : null;
  } catch {}

  return {
    status,
    messagesCount: msgs.length,
    errorText,
    assistantChars: text.length,
    assistantPreview: text.slice(0, 200),
    tts: {
      speechSynthesisCalls: window.__waveTtsSmoke?.speechSynthesisCalls?.length || 0,
      audioPlayCalls: window.__waveTtsSmoke?.audioPlayCalls?.length || 0,
      lastSpeechSynthesisText: window.__waveTtsSmoke?.speechSynthesisCalls?.slice(-1)?.[0]?.text || null,
      lastAudioSrc: window.__waveTtsSmoke?.audioPlayCalls?.slice(-1)?.[0]?.src || null,
      hookErrors: window.__waveTtsSmoke?.errors || [],
    },
  };
})()`;

            let state = null;
            const chatDeadline = Date.now() + 180000;
            while (Date.now() < chatDeadline) {
                state = await cdp.evaluate(readStateExpr);
                const assistantOk = !!state?.assistantChars;
                const ttsOk =
                    (state?.tts?.speechSynthesisCalls || 0) > 0 || (state?.tts?.audioPlayCalls || 0) > 0;

                if (assistantOk && ttsOk) {
                    console.log(
                        JSON.stringify(
                            { cdpTarget: { title: candidate.title, url: candidate.url, ws: candidate.webSocketDebuggerUrl } },
                            null,
                            2
                        )
                    );
                    console.log(JSON.stringify(state, null, 2));
                    return;
                }

                // If the assistant finished but TTS didn't trigger yet, give it a brief grace window.
                if (state?.status === "ready" && assistantOk) {
                    const graceDeadline = Date.now() + 6000;
                    while (Date.now() < graceDeadline) {
                        state = await cdp.evaluate(readStateExpr);
                        const graceTtsOk =
                            (state?.tts?.speechSynthesisCalls || 0) > 0 || (state?.tts?.audioPlayCalls || 0) > 0;
                        if (graceTtsOk) {
                            console.log(
                                JSON.stringify(
                                    { cdpTarget: { title: candidate.title, url: candidate.url, ws: candidate.webSocketDebuggerUrl } },
                                    null,
                                    2
                                )
                            );
                            console.log(JSON.stringify(state, null, 2));
                            return;
                        }
                        await sleep(500);
                    }
                    break;
                }

                await sleep(750);
            }

            failures.push({ title: candidate.title, url: candidate.url, result: state });
        } catch (e) {
            console.error(`CDP target failed: ${candidate.title || candidate.url}: ${String(e)}`);
            failures.push({ title: candidate.title, url: candidate.url, error: String(e) });
        } finally {
            cdp.close();
        }
    }

    console.log(JSON.stringify({ failures }, null, 2));
    throw new Error(`WaveAI+TTS smoke failed (targets tried: ${failures.map((f) => f.title || f.url).join(", ")})`);
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exitCode = 1;
});
