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
    window.__waveTtsSmoke = { speechSynthesisCalls: [], audioPlayCalls: [], errors: [] };
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
